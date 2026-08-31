export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/route-consolidation/vehicle-reuse
 *
 * Read-only "Case 2" analysis: sequential vehicle-reuse opportunities
 * across the tenant's active routes — same vehicle+driver serving route
 * A's trip and then route B's trip back-to-back, with neither route's
 * definition changing. Separate resource model from
 * .../route-consolidation/analyze (route merges) — see
 * route-consolidation-vehicle-reuse.ts for the eligibility funnel and
 * scoring.
 *
 * Advisory only: nothing is written, and there is no Apply endpoint for
 * this yet. Ops completes the actual vehicle/driver reassignment manually
 * via the existing Schedules/Dispatch screens.
 *
 * Body (all optional):
 *   {
 *     routeIds?: string[],   // subset to analyse; defaults to all active
 *     minimumTurnaroundMinutes?: number,  // override; else PlanningConstraint kind VEHICLE_MIN_TURNAROUND, else 30
 *     maxReuseWindowMinutes?: number,     // override; else PlanningConstraint kind MAX_VEHICLE_REUSE_WINDOW, else 180
 *     zoneFallbackKm?: number,            // override; else PlanningConstraint kind PICKUP_ZONE_FALLBACK_KM, else 3.0
 *   }
 *
 * zoneFallbackKm only matters when Route A's dropoff and Route B's pickup
 * don't share a spatial.places id — zoneCompatibility() always prefers a
 * shared place match over distance (see zone-compat-policy.ts).
 *
 * Response 200:
 *   { policy: { minimumTurnaroundMinutes, maxReuseWindowMinutes, zoneFallbackKm }, opportunities[], skipped[], totals }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { loadConsolidationFacts } from '@/lib/planning/route-consolidation-facts';
import { analyzeVehicleReuseOpportunities } from '@/lib/planning/route-consolidation-vehicle-reuse';
import {
  resolveVehicleTurnaroundMinutes,
  resolveMaxVehicleReuseWindowMinutes,
} from '@/lib/planning/route-consolidation-vehicle-reuse-policy';
import { resolveZoneFallbackKm } from '@/lib/planning/zone-compat-policy';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const permError = requireBusOpsAdminAccess(req, 'vehicle-resource-optimization');
  if (permError) return permError;

  let body: unknown = {};
  try {
    const text = await req.text();
    body = text.trim().length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  let routeIds: string[] | undefined;
  if (b.routeIds !== undefined) {
    if (!Array.isArray(b.routeIds) || b.routeIds.some((v) => typeof v !== 'string')) {
      return NextResponse.json({ error: 'routeIds must be an array of strings' }, { status: 400 });
    }
    routeIds = b.routeIds as string[];
  }

  for (const key of ['minimumTurnaroundMinutes', 'maxReuseWindowMinutes', 'zoneFallbackKm'] as const) {
    if (b[key] !== undefined && (typeof b[key] !== 'number' || !Number.isFinite(b[key]))) {
      return NextResponse.json({ error: `${key} must be a finite number` }, { status: 400 });
    }
  }

  try {
    const [facts, minimumTurnaroundMinutes, maxReuseWindowMinutes, zoneFallback] = await Promise.all([
      loadConsolidationFacts(prisma, { tenantId, routeIds }),
      resolveVehicleTurnaroundMinutes(prisma, tenantId, b.minimumTurnaroundMinutes as number | undefined),
      resolveMaxVehicleReuseWindowMinutes(prisma, tenantId, b.maxReuseWindowMinutes as number | undefined),
      resolveZoneFallbackKm(prisma, tenantId, { pickup: b.zoneFallbackKm as number | undefined }),
    ]);
    const zoneFallbackKm = zoneFallback.pickup;

    const result = await analyzeVehicleReuseOpportunities(prisma, tenantId, facts, {
      minimumTurnaroundMinutes,
      maxReuseWindowMinutes,
      zoneFallbackKm,
    });

    return NextResponse.json({
      policy: { minimumTurnaroundMinutes, maxReuseWindowMinutes, zoneFallbackKm },
      ...result,
    });
    } catch (e) {
    console.error('[route-consolidation.vehicle-reuse]', e);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
