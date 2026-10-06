import { NextRequest, NextResponse } from 'next/server';
import { requireBusOpsRequest } from '@/lib/bus-ops/access';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { evaluateConsolidationEvidence } from '@/lib/planning/consolidation-evidence';
import { loadHistoricalTripEvidence } from '@/lib/planning/consolidation-evidence-db';

export const dynamic = 'force-dynamic';

/** Read-only, aggregate evidence. Only completed, tenant-owned trips; no rider identities. */
export async function POST(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const permError = await requireBusOpsAdminAccess(req, 'route-consolidation');
  if (permError) return permError;

  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const { routeIds, days = 30 } = stripTenantOwnershipFields(input as Record<string, unknown>);
  if (!Array.isArray(routeIds) || routeIds.length !== 2 || routeIds.some(id => typeof id !== 'string' || !id || id.length > 128) || routeIds[0] === routeIds[1]
      || !Number.isInteger(days) || (days as number) < 7 || (days as number) > 90) {
    return NextResponse.json({ error: 'Supply two distinct route IDs and days between 7 and 90' }, { status: 400 });
  }
  const pair = routeIds as [string, string];
  const since = new Date(Date.now() - (days as number) * 86_400_000);

  try {
    const result = await withTenantRls(prisma, authz.tenantId, async tx => {
      const routes = await tx.busRoute.findMany({
        where: { tenantId: authz.tenantId, id: { in: pair }, deletedAt: null },
        select: { id: true, name: true, capacity: true },
      });
      if (routes.length !== 2) return null;
      // 5001st row signals truncation; never certify a partially sampled period.
      const { trips, truncated } = await loadHistoricalTripEvidence(tx, authz.tenantId, pair, since, new Date());
      // Most optimistic existing capacity, disclosed explicitly. A real
      // substitute/merged bus and stop sequence still require approval.
      const capacities = routes.map(route => route.capacity).filter((n): n is number => n !== null && n > 0);
      const capacityAssumption = capacities.length === 2 ? Math.max(...capacities) : null;
      const rate = (key: string, fallback: number) => {
        const value = Number(process.env[key] ?? fallback);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
      };
      const rates = {
        fuelPerLitre: rate('BUS_FUEL_AED_PER_L', 2.95),
        driverPerHour: rate('BUS_DRIVER_AED_PER_HR', 30),
        vehiclePerKm: rate('BUS_VEHICLE_AED_PER_KM', 0.5),
      };
      const evidence = evaluateConsolidationEvidence(trips, pair, capacityAssumption, rates);
      return { windowDays: days, timezone: 'Asia/Dubai', routes, capacityAssumption,
        rates, truncated, ...evidence,
        assessment: truncated ? 'INSUFFICIENT_DATA' : evidence.assessment,
        caveat: 'Observed cost covers complete trip logs only. A historical baseline does not establish realized or future savings, vehicle/driver feasibility, or stop-level timing.',
      };
    });
    return result
      ? NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
      : NextResponse.json({ error: 'Routes not found in tenant' }, { status: 404 });
  } catch (error) {
    console.error('[route-consolidation.evidence]', error);
    return NextResponse.json({ error: 'Historical evidence unavailable' }, { status: 500 });
  }
}
