export const dynamic = 'force-dynamic';

/**
 * /api/telematics/devices — List and pair telematics devices to fleet vehicles.
 * Enriched with Live Monitoring telemetry: Current Location, Location Date & Time,
 * and dynamic safety/geofence alerts (Overspeeding, Harsh Braking, Harsh Acceleration,
 * Excess Idling, Geofence Entry & Exit).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { recordLifecycleEvent } from '@/lib/fleet/lifecycle-events';
import { resolveLocation, ResolvedLocation, haversineKm } from '@/lib/telematics/location-resolver';

export interface TelematicsAlert {
  id: string;
  type: 'OVERSPEEDING' | 'HARSH_BRAKING' | 'HARSH_ACCELERATION' | 'EXCESS_IDLING' | 'GEOFENCE_ENTRY' | 'GEOFENCE_EXIT' | 'OTHER';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  timestamp: string;
}

interface CacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  timestamp: number;
}
const devicesCacheByTenant = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2000; // 2 seconds

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const nowMs = Date.now();
  const cached = devicesCacheByTenant.get(tenantId);
  if (cached && nowMs - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const vehicles = await tx.vehicle.findMany({
        where: { tenantId },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          type: true,
          status: true,
          deviceId: true,
          simCardNo: true,
          odometerReading: true,
          fuelLevel: true,
          updatedAt: true,
          assignedDriverId: true,
          homeDepotId: true,
          zoneId: true,
        },
        orderBy: { vehicleCode: 'asc' },
      });

      const now = new Date();
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const vehicleIds = vehicles.map((v) => v.id).filter((id): id is string => typeof id === 'string' && id.length > 0);

      // Fetch recent pings (up to 200) to allow speed delta and deceleration detection
      // Fetch drivers, active shifts, active trips for geofence stop visits, and open alerts
      const [allPings, drivers, activeShifts, activeTrips, openAlerts] = await Promise.all([
        tx.busGpsPing.findMany({
          where: {
            tenantId,
            vehicleId: { in: vehicleIds },
          },
          orderBy: { occurredAt: 'desc' },
          take: 300,
          select: {
            vehicleId: true,
            latitude: true,
            longitude: true,
            speedKmh: true,
            headingDeg: true,
            occurredAt: true,
            source: true,
          },
        }),
        tx.driver.findMany({
          where: { tenantId, deletedAt: null },
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            contactNumber: true,
            email: true,
            assignedVehicleId: true,
          },
        }),
        tx.driverShift.findMany({
          where: {
            tenantId,
            vehicleId: { in: vehicleIds },
            status: 'ACTIVE',
          },
          select: {
            vehicleId: true,
            driverId: true,
          },
        }),
        tx.tripSchedule.findMany({
          where: {
            tenantId,
            vehicleId: { in: vehicleIds },
            status: { in: ['SCHEDULED', 'STARTED', 'EN_ROUTE', 'DEPARTED', 'IN_TRANSIT'] },
          },
          select: {
            id: true,
            vehicleId: true,
            tripNumber: true,
            routeId: true,
          },
        }),
        tx.alert.findMany({
          where: {
            tenantId,
            subjectType: 'Vehicle',
            subjectId: { in: vehicleIds },
            OR: [
              { status: { in: ['OPEN', 'ACTIVE', 'TRIGGERED'] } },
              { status: null },
            ],
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            code: true,
            type: true,
            title: true,
            description: true,
            severity: true,
            subjectId: true,
            createdAt: true,
          },
        }),
      ]);

      // Group pings by vehicleId (ordered descending by occurredAt)
      const pingsByVehicleId = new Map<string, typeof allPings>();
      for (const p of allPings) {
        if (!p.vehicleId) continue;
        const list = pingsByVehicleId.get(p.vehicleId) || [];
        list.push(p);
        pingsByVehicleId.set(p.vehicleId, list);
      }

      // Group open alerts by vehicleId
      const alertsByVehicleId = new Map<string, typeof openAlerts>();
      for (const a of openAlerts) {
        if (!a.subjectId) continue;
        const list = alertsByVehicleId.get(a.subjectId) || [];
        list.push(a);
        alertsByVehicleId.set(a.subjectId, list);
      }

      // Fetch stop visits for active trips to determine geofence entries/exits
      const activeTripIds = activeTrips.map((t) => t.id);
      const activeTripByVehicleId = new Map(
        activeTrips.filter((t) => t.vehicleId).map((t) => [t.vehicleId!, t])
      );

      const stopVisits = activeTripIds.length > 0
        ? await tx.tripStopVisit.findMany({
            where: {
              tenantId,
              scheduleId: { in: activeTripIds },
            },
            orderBy: { updatedAt: 'desc' },
            take: 100,
            select: {
              scheduleId: true,
              stopId: true,
              approachedAt: true,
              enteredAt: true,
              leftAt: true,
            },
          })
        : [];

      const visitsByScheduleId = new Map<string, typeof stopVisits>();
      for (const sv of stopVisits) {
        const list = visitsByScheduleId.get(sv.scheduleId) || [];
        list.push(sv);
        visitsByScheduleId.set(sv.scheduleId, list);
      }

      // Fetch assigned places (Home Depot or Operational Zone) for vehicles
      const depotOrZoneIds = [
        ...new Set(
          vehicles
            .flatMap((v) => [v.homeDepotId, v.zoneId])
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        ),
      ];

      const assignedPlaces = depotOrZoneIds.length > 0
        ? await tx.place.findMany({
            where: {
              tenantId,
              id: { in: depotOrZoneIds },
              deletedAt: null,
            },
            select: {
              id: true,
              name: true,
              type: true,
              shape: true,
              centerLat: true,
              centerLng: true,
              radiusM: true,
            },
          })
        : [];
      const placeById = new Map(assignedPlaces.map((p) => [p.id, p]));

      // Fetch stop names for active trip visits
      const stopIds = [...new Set(stopVisits.map((sv) => sv.stopId).filter((id): id is string => !!id))];
      const routeStops = stopIds.length > 0
        ? await tx.routeStop.findMany({
            where: { id: { in: stopIds } },
            select: { id: true, stopName: true },
          })
        : [];
      const stopNameById = new Map(routeStops.map((s) => [s.id, s.stopName]));

      const driverById = new Map(drivers.map((d) => [d.id, d]));
      const driverByVehicleId = new Map(
        drivers.filter((d) => d.assignedVehicleId).map((d) => [d.assignedVehicleId!, d])
      );
      const activeShiftByVehicleId = new Map(
        activeShifts.filter((s) => s.vehicleId).map((s) => [s.vehicleId!, s])
      );

      const devices = vehicles.map((v) => {
        const vehiclePings = pingsByVehicleId.get(v.id) || [];
        const ping = vehiclePings[0] || null;
        const prevPing = vehiclePings[1] || null;

        const hasHardwareDevice = Boolean(v.deviceId && v.deviceId.trim() !== '');
        const isMobileTracking = Boolean(!hasHardwareDevice && ping && ping.source === 'DRIVER_APP');

        const activeShift = activeShiftByVehicleId.get(v.id);
        const assignedDriver = (v.assignedDriverId ? driverById.get(v.assignedDriverId) : null)
          || (activeShift ? driverById.get(activeShift.driverId) : null)
          || driverByVehicleId.get(v.id)
          || null;

        const driverInfo = assignedDriver ? {
          id: assignedDriver.id,
          name: assignedDriver.name || [assignedDriver.firstName, assignedDriver.lastName].filter(Boolean).join(' ') || 'Driver',
          phone: assignedDriver.contactNumber || null,
          email: assignedDriver.email || null,
        } : null;

        // Operational Telematics Status:
        // MOVING (Green): Recent signal & speed >= 3.5 km/h (drift-filtered)
        // IDLE (Dark Yellow): Recent signal & speed < 3.5 km/h, or active shift on-duty
        // STOP (Red): Stopped / parked / ignition off / no recent movement or signal
        const isRecent = Boolean(ping && ping.occurredAt >= fifteenMinutesAgo);
        let operationalStatus: 'MOVING' | 'IDLE' | 'STOP' = 'STOP';

        if (isRecent) {
          if ((ping?.speedKmh ?? 0) >= 3.5) {
            operationalStatus = 'MOVING';
          } else {
            operationalStatus = 'IDLE';
          }
        } else if (activeShift || (isMobileTracking && ping && ping.occurredAt >= twoHoursAgo)) {
          operationalStatus = 'IDLE';
        } else {
          operationalStatus = 'STOP';
        }

        // Resolve human-readable location & GPS timestamps
        const location: ResolvedLocation | null = ping
          ? resolveLocation(ping.latitude, ping.longitude, ping.occurredAt)
          : null;

        // Calculate speed delta for Harsh Braking & Harsh Acceleration
        let speedDelta = 0;
        let timeDeltaSec = 0;
        if (ping && prevPing) {
          timeDeltaSec = Math.max(0, (ping.occurredAt.getTime() - prevPing.occurredAt.getTime()) / 1000);
          speedDelta = (ping.speedKmh ?? 0) - (prevPing.speedKmh ?? 0);
        }

        // Active Alerts evaluation
        const vehicleDbAlerts = alertsByVehicleId.get(v.id) || [];
        const alerts: TelematicsAlert[] = [];

        // 1. Overspeeding Alert (> 100 km/h)
        const isOverspeeding = Boolean(ping && ping.speedKmh > 100);
        const dbOverspeed = vehicleDbAlerts.find((a) => a.code?.toUpperCase().includes('OVERSPEED'));
        if (isOverspeeding || dbOverspeed) {
          alerts.push({
            id: dbOverspeed?.id || `alert-speed-${v.id}`,
            type: 'OVERSPEEDING',
            severity: (ping?.speedKmh ?? 0) > 120 ? 'CRITICAL' : 'HIGH',
            title: 'Overspeeding',
            description: isOverspeeding
              ? `${Math.round(ping?.speedKmh ?? 0)} km/h (Commercial Limit: 100 km/h)`
              : (dbOverspeed?.description || 'Commercial speed limit exceeded'),
            timestamp: ping ? ping.occurredAt.toISOString() : (dbOverspeed?.createdAt?.toISOString() || now.toISOString()),
          });
        }

        // 2. Harsh Braking Alert (sudden drop of >= 20 km/h in <= 35 seconds, or database alert)
        const isHarshBraking = Boolean(timeDeltaSec > 0 && timeDeltaSec <= 35 && speedDelta <= -20);
        const dbHarshBrake = vehicleDbAlerts.find((a) => a.code?.toUpperCase().includes('BRAKE') || a.code?.toUpperCase().includes('BRAKING'));
        if (isHarshBraking || dbHarshBrake) {
          alerts.push({
            id: dbHarshBrake?.id || `alert-brake-${v.id}`,
            type: 'HARSH_BRAKING',
            severity: 'MEDIUM',
            title: 'Harsh Braking',
            description: isHarshBraking
              ? `Sudden deceleration: -${Math.abs(Math.round(speedDelta))} km/h in ${Math.round(timeDeltaSec)}s`
              : (dbHarshBrake?.description || 'Emergency braking event detected'),
            timestamp: ping ? ping.occurredAt.toISOString() : (dbHarshBrake?.createdAt?.toISOString() || now.toISOString()),
          });
        }

        // 3. Harsh Acceleration Alert (rapid surge of >= 20 km/h in <= 35 seconds, or database alert)
        const isHarshAccel = Boolean(timeDeltaSec > 0 && timeDeltaSec <= 35 && speedDelta >= 20);
        const dbHarshAccel = vehicleDbAlerts.find((a) => a.code?.toUpperCase().includes('ACCEL') || a.code?.toUpperCase().includes('ACCELERATION'));
        if (isHarshAccel || dbHarshAccel) {
          alerts.push({
            id: dbHarshAccel?.id || `alert-accel-${v.id}`,
            type: 'HARSH_ACCELERATION',
            severity: 'MEDIUM',
            title: 'Harsh Acceleration',
            description: isHarshAccel
              ? `Rapid speed spike: +${Math.round(speedDelta)} km/h in ${Math.round(timeDeltaSec)}s`
              : (dbHarshAccel?.description || 'Aggressive throttle acceleration detected'),
            timestamp: ping ? ping.occurredAt.toISOString() : (dbHarshAccel?.createdAt?.toISOString() || now.toISOString()),
          });
        }

        // 4. Excess Idling Alert (Stationary with ignition/tracking active for >= 15 mins)
        const idleDurationMs = operationalStatus === 'IDLE' && ping
          ? Math.max(0, now.getTime() - ping.occurredAt.getTime())
          : 0;
        const idleMins = Math.floor(idleDurationMs / 60000);
        const isExcessIdling = operationalStatus === 'IDLE' && idleMins >= 15;
        const dbExcessIdle = vehicleDbAlerts.find((a) => a.code?.toUpperCase().includes('IDLE') || a.code?.toUpperCase().includes('IDLING'));
        if (isExcessIdling || dbExcessIdle) {
          alerts.push({
            id: dbExcessIdle?.id || `alert-idle-${v.id}`,
            type: 'EXCESS_IDLING',
            severity: idleMins > 30 ? 'HIGH' : 'MEDIUM',
            title: 'Excess Idling',
            description: isExcessIdling
              ? `Stationary idle: ${idleMins} mins (Exceeds 15m threshold)`
              : (dbExcessIdle?.description || 'Stationary engine idle alert'),
            timestamp: ping ? ping.occurredAt.toISOString() : (dbExcessIdle?.createdAt?.toISOString() || now.toISOString()),
          });
        }

        // 5. Geofence Alerts — ONLY show if the vehicle is assigned to that particular geofence:
        //    A) Assigned to an active trip schedule with route stop geofences
        //    B) Assigned to a specific Home Depot or Operational Zone (Place)
        //    C) Explicit database geofence alert generated for this vehicle
        const activeTrip = activeTripByVehicleId.get(v.id) || null;
        const tripVisits = activeTrip ? visitsByScheduleId.get(activeTrip.id) || [] : [];
        const insideStopVisit = tripVisits.find((sv) => sv.enteredAt && !sv.leftAt);
        const recentExitVisit = tripVisits.find((sv) => sv.leftAt && (now.getTime() - new Date(sv.leftAt).getTime() < 30 * 60 * 1000));

        const vehicleAssignedPlace = (v.homeDepotId ? placeById.get(v.homeDepotId) : null)
          || (v.zoneId ? placeById.get(v.zoneId) : null);

        const dbGeofence = vehicleDbAlerts.find((a) =>
          a.code?.toUpperCase().includes('GEOFENCE') ||
          a.code?.toUpperCase().includes('ROUTE_DEVIATION') ||
          a.code?.toUpperCase().includes('STOP')
        );

        if (insideStopVisit) {
          const stopName = stopNameById.get(insideStopVisit.stopId) || 'Assigned Stop';
          alerts.push({
            id: `geofence-entry-${v.id}-${insideStopVisit.stopId}`,
            type: 'GEOFENCE_ENTRY',
            severity: 'INFO',
            title: 'Geofence Entry',
            description: `Inside assigned stop: ${stopName}`,
            timestamp: insideStopVisit.enteredAt ? new Date(insideStopVisit.enteredAt).toISOString() : now.toISOString(),
          });
        } else if (recentExitVisit) {
          const stopName = stopNameById.get(recentExitVisit.stopId) || 'Assigned Stop';
          alerts.push({
            id: `geofence-exit-${v.id}-${recentExitVisit.stopId}`,
            type: 'GEOFENCE_EXIT',
            severity: 'INFO',
            title: 'Geofence Exit',
            description: `Departed assigned stop: ${stopName}`,
            timestamp: recentExitVisit.leftAt ? new Date(recentExitVisit.leftAt).toISOString() : now.toISOString(),
          });
        } else if (vehicleAssignedPlace && ping && vehicleAssignedPlace.centerLat != null && vehicleAssignedPlace.centerLng != null) {
          // Check if vehicle is inside its assigned home depot or operational zone
          const distKm = haversineKm(ping.latitude, ping.longitude, vehicleAssignedPlace.centerLat, vehicleAssignedPlace.centerLng);
          const radiusKm = (vehicleAssignedPlace.radiusM || 500) / 1000;
          if (distKm <= radiusKm) {
            alerts.push({
              id: `geofence-assigned-${v.id}-${vehicleAssignedPlace.id}`,
              type: 'GEOFENCE_ENTRY',
              severity: 'INFO',
              title: 'Assigned Geofence',
              description: `Inside assigned ${vehicleAssignedPlace.type || 'geofence'}: ${vehicleAssignedPlace.name}`,
              timestamp: ping.occurredAt.toISOString(),
            });
          }
        } else if (dbGeofence) {
          const isExit = dbGeofence.code?.toUpperCase().includes('EXIT') || dbGeofence.code?.toUpperCase().includes('DEVIATION');
          alerts.push({
            id: dbGeofence.id,
            type: isExit ? 'GEOFENCE_EXIT' : 'GEOFENCE_ENTRY',
            severity: 'INFO',
            title: isExit ? 'Geofence Exit' : 'Geofence Entry',
            description: dbGeofence.description || dbGeofence.title || 'Geofence boundary transition',
            timestamp: dbGeofence.createdAt?.toISOString() || now.toISOString(),
          });
        }

        // 6. Other open alerts from database (DTC, Thermal, SOS, etc.)
        for (const a of vehicleDbAlerts) {
          if (!alerts.some((existing) => existing.id === a.id)) {
            alerts.push({
              id: a.id,
              type: 'OTHER',
              severity: (a.severity as any) || 'HIGH',
              title: a.title || a.code || 'Vehicle Alert',
              description: a.description || 'Active operational anomaly reported',
              timestamp: a.createdAt?.toISOString() || now.toISOString(),
            });
          }
        }

        // Active Trip / Job assignment
        const jobInfo = activeTrip
          ? {
              id: activeTrip.id,
              tripNumber: activeTrip.tripNumber || `TRIP-${activeTrip.id.slice(0, 6).toUpperCase()}`,
              status: 'ON_TRIP',
              title: `Trip ${activeTrip.tripNumber || activeTrip.id.slice(0, 6)}`,
              routeId: activeTrip.routeId || null,
            }
          : activeShift
          ? {
              id: activeShift.id,
              tripNumber: 'SHIFT-ACTIVE',
              status: 'ON_SHIFT',
              title: 'On-Duty Dispatch Shift',
              routeId: null,
            }
          : null;

        const isOnTrip = Boolean(jobInfo);

        return {
          vehicleId: v.id,
          vehicleCode: v.vehicleCode,
          licensePlate: v.licensePlate,
          make: v.make,
          model: v.model,
          type: v.type,
          deviceId: v.deviceId,
          simCardNo: v.simCardNo,
          odometerKm: v.odometerReading ? Number(v.odometerReading) : 0,
          fuelLevelPercent: v.fuelLevel ?? null,
          operationalStatus,
          connectionStatus: operationalStatus,
          isMobileTracking,
          isDeviceBlank: !hasHardwareDevice,
          driver: driverInfo,
          job: jobInfo,
          isOnTrip,
          location,
          alerts,
          hasActiveAlerts: alerts.length > 0,
          lastPing: ping
            ? {
                latitude: ping.latitude,
                longitude: ping.longitude,
                speedKmh: ping.speedKmh ?? 0,
                headingDeg: ping.headingDeg ?? 0,
                occurredAt: ping.occurredAt.toISOString(),
                source: ping.source ?? 'TRACKER',
              }
            : null,
        };
      });

      const alertVehiclesCount = devices.filter((d) => d.hasActiveAlerts).length;
      const totalAlertsCount = devices.reduce((sum, d) => sum + d.alerts.length, 0);

      const payload = {
        totalVehicles: vehicles.length,
        pairedDevices: devices.filter((d) => d.deviceId).length,
        movingCount: devices.filter((d) => d.operationalStatus === 'MOVING').length,
        idleCount: devices.filter((d) => d.operationalStatus === 'IDLE').length,
        stopCount: devices.filter((d) => d.operationalStatus === 'STOP').length,
        onlineCount: devices.filter((d) => d.operationalStatus === 'MOVING' || d.operationalStatus === 'IDLE').length,
        mobileTrackingCount: devices.filter((d) => d.isMobileTracking).length,
        alertVehiclesCount,
        totalAlertsCount,
        devices,
      };

      devicesCacheByTenant.set(tenantId, {
        payload,
        timestamp: Date.now(),
      });

      return NextResponse.json(payload);
    } catch (err) {
      console.error('[telematics-devices] GET failed:', err);
      return NextResponse.json({ error: 'Failed to fetch telematics devices' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json().catch(() => null);
    const body = stripTenantOwnershipFields(bodyRaw || {});

    const { vehicleId, deviceId, simCardNo } = body;

    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
    }

    return withTenantRls(prisma, tenantId, async (tx) => {
      // Check if IMEI is already assigned to another vehicle in this tenant
      if (deviceId) {
        const existing = await tx.vehicle.findFirst({
          where: {
            tenantId,
            deviceId,
            id: { not: vehicleId },
          },
          select: { id: true, vehicleCode: true, licensePlate: true },
        });

        if (existing) {
          return NextResponse.json(
            { error: `Device IMEI ${deviceId} is already paired with vehicle ${existing.vehicleCode || existing.licensePlate}` },
            { status: 409 },
          );
        }
      }

      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          deviceId: deviceId || null,
          simCardNo: simCardNo || null,
          updatedAt: new Date(),
        },
      });

      await recordLifecycleEvent(tx, {
        vehicleId,
        eventType: deviceId ? 'DEVICE_PAIRING' : 'DEVICE_UNPAIRED',
        description: deviceId
          ? ('Hardware GPS device (IMEI: ' + deviceId + (simCardNo ? ', SIM: ' + simCardNo : '') + ') paired via Fleet Master')
          : 'Hardware GPS device unlinked from vehicle',
        metadata: { deviceId, simCardNo },
        performedBy: 'Fleet Master Telematics',
      }).catch(() => {});

      devicesCacheByTenant.delete(tenantId);

      return NextResponse.json({
        success: true,
        vehicleId: updated.id,
        deviceId: updated.deviceId,
        simCardNo: updated.simCardNo,
      });
    });
  } catch (err) {
    console.error('[telematics-devices] POST failed:', err);
    return NextResponse.json({ error: 'Failed to update telematics device pairing' }, { status: 500 });
  }
}
