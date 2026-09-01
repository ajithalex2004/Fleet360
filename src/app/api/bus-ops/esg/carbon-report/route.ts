export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import {
  generateDepartmentalCarbonMatrix,
  type EsgTripInput,
} from '@/lib/bus-ops/esg-carbon-engine';

export const runtime = 'nodejs';

/**
 * GET /api/bus-ops/esg/carbon-report
 *
 * Query params:
 *   ?period=YYYY-MM (default: current month)
 *
 * Returns Scope-3 GHG greenhouse gas emissions, carbon intensity, and departmental savings statements.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const period = sp.get('period') || new Date().toISOString().slice(0, 7);

      const [year, month] = period.split('-').map(Number);
      const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      // Fetch completed trips in the target period. TripSchedule has no
      // `vehicle` relation object (only the scalar vehicleId), so vehicles
      // are looked up separately below.
      const trips = await tx.tripSchedule.findMany({
        where: {
          tenantId,
          deletedAt: null,
          departureTime: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
        include: {
          route: { select: { totalDistanceKm: true, name: true } },
          passengers: true,
        },
        orderBy: { departureTime: 'desc' },
      });

      const vehicleIds = [...new Set(trips.map((t) => t.vehicleId).filter((id): id is string => !!id))];
      const vehicles = vehicleIds.length
        ? await tx.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, type: true, fuelType: true } })
        : [];
      const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

      const esgTrips: EsgTripInput[] = trips.map((t) => {
        const vehicle = t.vehicleId ? vehicleById.get(t.vehicleId) : undefined;
        return {
          id: t.id,
          tripNumber: t.tripNumber ?? t.id.slice(0, 8),
          distanceKm: Number(t.route?.totalDistanceKm ?? 35),
          vehicleType: vehicle?.type || 'DIESEL_COASTER_30',
          fuelType: vehicle?.fuelType || 'DIESEL',
          departureTime: t.departureTime,
          passengers: t.passengers.map((p) => ({
            staffMemberId: p.staffMemberId || p.id,
            department: p.department || 'Operations',
            status: p.status || 'BOARDED',
          })),
        };
      });

      const report = generateDepartmentalCarbonMatrix(esgTrips, period);

      return NextResponse.json(report);
    } catch (err) {
      console.error('GET /api/bus-ops/esg/carbon-report error:', err);
      return NextResponse.json(
        { error: 'Failed to generate ESG carbon report' },
        { status: 500 }
      );
    }
  });
}
