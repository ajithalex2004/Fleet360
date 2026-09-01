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

      // Fetch completed trips in the target period
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
          Route: { select: { distanceKm: true, name: true } },
          Vehicle: { select: { type: true, fuelType: true } },
          passengers: {
            include: {
              staffMember: { select: { department: true, name: true } },
            },
          },
        },
        orderBy: { departureTime: 'desc' },
      });

      const esgTrips: EsgTripInput[] = trips.map((t) => ({
        id: t.id,
        tripNumber: t.tripNumber ?? t.id.slice(0, 8),
        distanceKm: Number(t.Route?.distanceKm ?? 35),
        vehicleType: t.Vehicle?.type || 'DIESEL_COASTER_30',
        fuelType: t.Vehicle?.fuelType || 'DIESEL',
        departureTime: t.departureTime,
        passengers: t.passengers.map((p) => ({
          staffMemberId: p.staffMemberId || p.id,
          department: p.staffMember?.department || 'Operations',
          status: p.status || 'BOARDED',
        })),
      }));

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
