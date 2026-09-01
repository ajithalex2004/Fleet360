export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { calculateFleetTcoSummary } from '@/lib/fleet/tco-engine';

/**
 * GET /api/fleet/tco
 *
 * Enterprise Total Cost of Ownership (TCO) breakdown per vehicle & fleet summary.
 * Aggregates 7 cost pillars: Depreciation, Fuel, Maintenance, Tires, Insurance, Fines, and Labor.
 *
 * Query params:
 *   vehicleId    — filter to a single vehicle UUID
 *   vehicleGroup — filter by vehicle group (BUS, VAN, SEDAN, TRUCK)
 *   months       — rolling window in months (default 12)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const vehicleId = sp.get('vehicleId') || undefined;
  const vehicleGroup = sp.get('vehicleGroup') || undefined;
  const months = Math.max(1, Math.min(60, parseInt(sp.get('months') ?? '12', 10)));

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const summary = await calculateFleetTcoSummary(tx, tenantId, {
        months,
        vehicleId,
        vehicleGroup,
      });

      return NextResponse.json({
        months,
        totals: {
          totalTco: summary.fleetTotals.totalTco,
          depreciationCost: summary.fleetTotals.depreciationCost,
          fuelCost: summary.fleetTotals.fuelCost,
          maintenanceCost: summary.fleetTotals.maintenanceCost,
          tiresCost: summary.fleetTotals.tiresCost,
          insuranceCost: summary.fleetTotals.insuranceCost,
          finesCost: summary.fleetTotals.finesCost,
          laborCost: summary.fleetTotals.laborCost,
          totalDistanceKm: summary.fleetTotals.totalDistanceKm,
          totalFuelLiters: summary.fleetTotals.totalFuelLiters,
          averageCpk: summary.fleetTotals.averageCpk,
        },
        costPillarsPct: summary.costPillarsPct,
        replacementRecommendations: summary.replacementRecommendations,
        vehicles: summary.vehicles,
      });
    } catch (err) {
      console.error('[fleet-tco] Calculation failed:', err);
      return NextResponse.json({ error: 'Failed to calculate Fleet TCO' }, { status: 500 });
    }
  });
}
