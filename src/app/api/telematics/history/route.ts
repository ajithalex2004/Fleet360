export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';

// Haversine formula to compute distance between GPS coordinates in km
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const vehicleId = sp.get('vehicleId');
  const vehicleCodeOrPlate = sp.get('search');
  const fromParam = sp.get('from');
  const toParam = sp.get('to');
  const limitParam = parseInt(sp.get('limit') || '500', 10);
  const limit = Math.min(Math.max(1, limitParam), 2000);

  if (!vehicleId && !vehicleCodeOrPlate) {
    return NextResponse.json({ error: 'vehicleId or search parameter is required' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      // 1. Resolve vehicle
      const vehicle = await tx.vehicle.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            ...(vehicleId ? [{ id: vehicleId }] : []),
            ...(vehicleCodeOrPlate
              ? [
                  { vehicleCode: { equals: vehicleCodeOrPlate, mode: 'insensitive' as const } },
                  { licensePlate: { equals: vehicleCodeOrPlate, mode: 'insensitive' as const } },
                ]
              : []),
          ],
        },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          deviceId: true,
          simCardNo: true,
          odometerReading: true,
          fuelLevel: true,
          assignedDriverId: true,
        },
      });

      if (!vehicle) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
      }

      // 2. Resolve assigned driver details
      let assignedDriver: { id: string; name: string; contactNumber: string | null } | null = null;
      if (vehicle.assignedDriverId) {
        const driver = await tx.driver.findFirst({
          where: { id: vehicle.assignedDriverId, tenantId, deletedAt: null },
          select: { id: true, name: true, firstName: true, lastName: true, contactNumber: true },
        });
        if (driver) {
          assignedDriver = {
            id: driver.id,
            name: driver.name || [driver.firstName, driver.lastName].filter(Boolean).join(' ') || 'Driver',
            contactNumber: driver.contactNumber,
          };
        }
      }

      // 3. Query historical GPS pings
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (fromParam) {
        const parsedFrom = new Date(fromParam);
        if (!isNaN(parsedFrom.getTime())) dateFilter.gte = parsedFrom;
      }
      if (toParam) {
        const parsedTo = new Date(toParam);
        if (!isNaN(parsedTo.getTime())) dateFilter.lte = parsedTo;
      }

      const pings = await tx.busGpsPing.findMany({
        where: {
          tenantId,
          vehicleId: vehicle.id,
          ...(Object.keys(dateFilter).length > 0 ? { occurredAt: dateFilter } : {}),
        },
        orderBy: { occurredAt: 'asc' },
        take: limit,
        select: {
          id: true,
          latitude: true,
          longitude: true,
          speedKmh: true,
          headingDeg: true,
          accuracyM: true,
          occurredAt: true,
          source: true,
        },
      });

      // 4. Compute trajectory metrics & statistics
      let maxSpeedKmh = 0;
      let totalSpeedSum = 0;
      let totalDistanceKm = 0;

      for (let i = 0; i < pings.length; i++) {
        const p = pings[i];
        const spd = p.speedKmh ?? 0;
        if (spd > maxSpeedKmh) maxSpeedKmh = spd;
        totalSpeedSum += spd;

        if (i > 0) {
          const prev = pings[i - 1];
          const dist = haversineDistanceKm(prev.latitude, prev.longitude, p.latitude, p.longitude);
          // Filter out noisy GPS teleport spikes (> 150 km/h jump)
          if (dist > 0.005 && dist < 50) {
            totalDistanceKm += dist;
          }
        }
      }

      const avgSpeedKmh = pings.length > 0 ? Math.round((totalSpeedSum / pings.length) * 10) / 10 : 0;
      const firstPingAt = pings.length > 0 ? pings[0].occurredAt.toISOString() : null;
      const lastPingAt = pings.length > 0 ? pings[pings.length - 1].occurredAt.toISOString() : null;

      // Return both chronological breadcrumb trail and reverse-chronological log
      return NextResponse.json({
        vehicle: {
          id: vehicle.id,
          vehicleCode: vehicle.vehicleCode,
          licensePlate: vehicle.licensePlate,
          make: vehicle.make,
          model: vehicle.model,
          deviceId: vehicle.deviceId,
          simCardNo: vehicle.simCardNo,
          odometerKm: vehicle.odometerReading ? Number(vehicle.odometerReading) : 0,
          fuelLevelPercent: vehicle.fuelLevel,
          assignedDriver,
        },
        stats: {
          totalPings: pings.length,
          maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
          avgSpeedKmh,
          totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
          firstPingAt,
          lastPingAt,
        },
        breadcrumbs: pings.map((p) => ({
          id: p.id,
          lat: p.latitude,
          lng: p.longitude,
          speedKmh: p.speedKmh ?? 0,
          headingDeg: p.headingDeg ?? 0,
          accuracyM: p.accuracyM ?? 0,
          occurredAt: p.occurredAt.toISOString(),
          source: p.source || 'DRIVER_APP',
        })),
      });
    } catch (err) {
      console.error('[api/telematics/history GET]', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to query telemetry history' },
        { status: 500 }
      );
    }
  });
}
