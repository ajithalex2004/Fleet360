export const dynamic = 'force-dynamic';

/**
 * /api/telematics/automation — Live Geofence Stop Visits, Trip Transitions & PM Alerts (Phase 2).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { evaluatePmOdometerThresholdSync } from '@/lib/telematics/pm-odometer-sync';
import { TRIP_OPEN_STATUSES } from '@/lib/trip-status';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      // 1. Fetch active trips (SCHEDULED, STARTED, EN_ROUTE, and the legacy
      // DEPARTED/IN_TRANSIT strings those were renamed from)
      // Note: TripSchedule.vehicleId / driverId are plain FK columns with no
      // Prisma relation declared (unlike routeId -> route), so vehicle/driver
      // are batch-fetched separately below and joined in-memory.
      const activeTrips = await tx.tripSchedule.findMany({
        where: {
          tenantId,
          status: { in: [...TRIP_OPEN_STATUSES] },
        },
        include: {
          route: {
            include: {
              stops: {
                orderBy: { sequence: 'asc' },
              },
            },
          },
        },
        orderBy: { departureTime: 'asc' },
        take: 15,
      });

      // 2. Fetch all stop visits for these active trips
      const scheduleIds = activeTrips.map((t) => t.id);
      const stopVisits = await tx.tripStopVisit.findMany({
        where: {
          tenantId,
          scheduleId: { in: scheduleIds },
        },
      });

      const visitMap = new Map<string, typeof stopVisits[0]>();
      for (const v of stopVisits) {
        visitMap.set(`${v.scheduleId}:${v.stopId}`, v);
      }

      const tripVehicleIds = [...new Set(activeTrips.map((t) => t.vehicleId).filter((id): id is string => !!id))];
      const tripDriverIds = [...new Set(activeTrips.map((t) => t.driverId).filter((id): id is string => !!id))];

      const [tripVehicles, tripDrivers] = await Promise.all([
        tripVehicleIds.length
          ? tx.vehicle.findMany({
              where: { id: { in: tripVehicleIds } },
              select: { id: true, vehicleCode: true, licensePlate: true, deviceId: true },
            })
          : Promise.resolve([]),
        tripDriverIds.length
          ? tx.driver.findMany({
              where: { id: { in: tripDriverIds } },
              select: { id: true, firstName: true, lastName: true },
            })
          : Promise.resolve([]),
      ]);

      const vehicleById = new Map(tripVehicles.map((v) => [v.id, v]));
      const driverById = new Map(tripDrivers.map((d) => [d.id, d]));

      const activeTripProgress = activeTrips.map((trip) => {
        const tripVehicle = trip.vehicleId ? vehicleById.get(trip.vehicleId) : undefined;
        const tripDriver = trip.driverId ? driverById.get(trip.driverId) : undefined;
        const stops = (trip.route?.stops || []).map((stop) => {
          const visit = visitMap.get(`${trip.id}:${stop.id}`);
          let state: 'PENDING' | 'APPROACHING' | 'AT_STOP' | 'DEPARTED' = 'PENDING';

          if (visit?.enteredAt && visit?.leftAt) {
            state = 'DEPARTED';
          } else if (visit?.enteredAt) {
            state = 'AT_STOP';
          } else if (visit?.approachedAt) {
            state = 'APPROACHING';
          }

          return {
            stopId: stop.id,
            stopName: stop.stopName,
            sequence: stop.sequence,
            gpsLat: stop.gpsLat,
            gpsLng: stop.gpsLng,
            approachedAt: visit?.approachedAt ? visit.approachedAt.toISOString() : null,
            enteredAt: visit?.enteredAt ? visit.enteredAt.toISOString() : null,
            leftAt: visit?.leftAt ? visit.leftAt.toISOString() : null,
            state,
          };
        });

        const completedStops = stops.filter((s) => s.state === 'DEPARTED').length;
        const currentStop = stops.find((s) => s.state === 'AT_STOP' || s.state === 'APPROACHING') || null;

        return {
          tripId: trip.id,
          tripNumber: trip.tripNumber,
          shiftType: trip.shiftType,
          status: trip.status,
          departureTime: trip.departureTime.toISOString(),
          estimatedArrival: trip.arrivalTime ? trip.arrivalTime.toISOString() : null,
          vehicle: tripVehicle
            ? {
                id: tripVehicle.id,
                vehicleCode: tripVehicle.vehicleCode,
                licensePlate: tripVehicle.licensePlate,
                deviceId: tripVehicle.deviceId,
              }
            : null,
          driver: tripDriver
            ? {
                id: tripDriver.id,
                firstName: tripDriver.firstName,
                lastName: tripDriver.lastName,
              }
            : null,
          routeName: trip.route?.name || `${trip.route?.origin} → ${trip.route?.destination}`,
          totalStops: stops.length,
          completedStops,
          currentStop,
          stops,
        };
      });

      // 3. Fetch Vehicles with PM Due Countdowns
      const vehicles = await tx.vehicle.findMany({
        where: {
          tenantId,
          odometerReading: { not: null },
        },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          odometerReading: true,
          deviceId: true,
        },
        take: 50,
      });

      const pmStatusList = vehicles.map((v) => {
        const currentKm = Number(v.odometerReading || 0);
        const evalRes = evaluatePmOdometerThresholdSync(currentKm, 10000);
        return {
          vehicleId: v.id,
          vehicleCode: v.vehicleCode,
          licensePlate: v.licensePlate,
          make: v.make,
          model: v.model,
          deviceId: v.deviceId,
          currentOdometerKm: currentKm,
          nextDueKm: evalRes.nextDueKm,
          kmRemaining: evalRes.kmRemaining,
          status: evalRes.status,
        };
      }).filter((v) => v.currentOdometerKm > 0);

      // Sort by urgency (overdue first, then least remaining km)
      pmStatusList.sort((a, b) => a.kmRemaining - b.kmRemaining);

      return NextResponse.json({
        activeTripsCount: activeTripProgress.length,
        activeTripProgress,
        pmDueSoonCount: pmStatusList.filter((p) => p.status === 'DUE_SOON').length,
        pmOverdueCount: pmStatusList.filter((p) => p.status === 'OVERDUE').length,
        pmStatusList: pmStatusList.slice(0, 15),
      });
    } catch (err) {
      console.error('[telematics-automation] GET failed:', err);
      return NextResponse.json({ error: 'Failed to fetch automation telemetry' }, { status: 500 });
    }
  });
}
