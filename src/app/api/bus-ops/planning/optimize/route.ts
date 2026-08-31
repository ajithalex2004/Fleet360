export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/planning/optimize
 *
 * Ranks a list of saved StaffTransportPlan rows by
 *   totalCost = operatingCost + penaltyLambda × pcePenalty
 * with infeasible (BLOCK) plans pushed to the bottom.
 *
 * Body:
 *   {
 *     planIds: string[],               // 1..N saved plan ids
 *     objective?: {
 *       penaltyLambda?: number,        // default 1
 *       costPerPayHour?, costPerDeadheadHour?,
 *       costPerVehicleDay?, costPerDriverDay?
 *     }
 *   }
 *
 * Response:
 *   200 { objective, ranked: PlanScore[] }
 *
 * The endpoint is read-only — nothing is written. Ranked output is a
 * decision-support view; operators pick a plan and apply it through
 * the existing /plan/[id]/apply endpoint (which re-runs PCE).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { rankPlans, type Objective, type ScorablePlan } from '@/lib/planning/optimizer';
import type { PlanBlock, PlanRun, DriverRoster } from '@/lib/planning/plan-deltas';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      let body: unknown;
      try { const bodyRaw = await req.json(); body = stripTenantOwnershipFields(bodyRaw);
      } catch {
        return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
      }
      if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
      }
      const b = body as Record<string, unknown>;

      if (!Array.isArray(b.planIds) || b.planIds.length === 0) {
        return NextResponse.json({ error: 'planIds must be a non-empty array' }, { status: 400 });
      }
      if (b.planIds.some((id) => typeof id !== 'string')) {
        return NextResponse.json({ error: 'planIds must contain only strings' }, { status: 400 });
      }
      const planIds = b.planIds as string[];

      const objective = parseObjective(b.objective);
      if (typeof objective === 'string') {
        return NextResponse.json({ error: objective }, { status: 400 });
      }

      try {
        const rows = await tx.staffTransportPlan.findMany({
          where: { id: { in: planIds }, tenantId },
          select: { id: true, name: true, runs: true, blocks: true, rosters: true, summary: true },
        });
        if (rows.length !== planIds.length) {
          const found = new Set(rows.map((r) => r.id));
          const missing = planIds.filter((id) => !found.has(id));
          return NextResponse.json(
            { error: 'One or more planIds not found in this tenant', missing },
            { status: 404 }
          );
        }

        const plans: ScorablePlan[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          runs: (r.runs as unknown as PlanRun[]) ?? null,
          blocks: (r.blocks as unknown as PlanBlock[]) ?? null,
          rosters: (r.rosters as unknown as DriverRoster[]) ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          summary: (r.summary as any) ?? null,
        }));

        const ranked = await rankPlans(prisma, tenantId, plans, objective);
        return NextResponse.json({ objective, ranked });
        } catch (e) {
        console.error('[planning.optimize]', e);
        return NextResponse.json({ error: 'Plan ranking failed' }, { status: 500 });
      }
  });
}


function parseObjective(raw: unknown): Objective | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'objective must be an object';
  const o = raw as Record<string, unknown>;
  const out: Objective = {};
  for (const key of [
    'penaltyLambda',
    'costPerPayHour',
    'costPerDeadheadHour',
    'costPerVehicleDay',
    'costPerDriverDay',
  ] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) {
      return `objective.${key} must be a finite number`;
    }
    out[key] = o[key] as number;
  }
  return out;
}
