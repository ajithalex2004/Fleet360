export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/plan/compare
 *
 * Compare two saved plans side-by-side. Returns both summaries + a
 * derived diff so the what-if UI can render "Scenario A vs B" without
 * having to compute the diff client-side.
 *
 * Body: { planIdA: string, planIdB: string }
 * Response: { planA, planB, <metric>A, <metric>B, <metric>Delta, <metric>DeltaPct }
 *
 *   The flat shape (runCountA / runCountB / totalPayCostA / totalPayCostB / …)
 *   is what the planner UI binds to directly; nested {left, right, delta}
 *   would force a second transform in the React component.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
interface PlanSummary {
  runCount: number;
  blockCount: number;
  driverCount: number;
  tripCount: number;
  avgTripsPerRun: number;
  avgTripsPerBlock: number;
  avgRunsPerDriver: number;
  totalPayHours: number;
  totalPayCost: number;
  totalWorkHours: number;
  totalDeadheadHours: number;
  overtimeHours: number;
}

interface PlanSummaryShape extends PlanSummary {
  // Allow extra fields without complaint
  [k: string]: number | undefined;
}

const SUMMARY_KEYS: ReadonlyArray<keyof PlanSummary> = [
  'runCount', 'blockCount', 'driverCount', 'tripCount',
  'avgTripsPerRun', 'avgTripsPerBlock', 'avgRunsPerDriver',
  'totalPayHours', 'totalPayCost', 'totalWorkHours',
  'totalDeadheadHours', 'overtimeHours',
];

function flatDiff(a: PlanSummary, b: PlanSummary): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of SUMMARY_KEYS) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    out[`${k}A`] = av;
    out[`${k}B`] = bv;
    // Round to 2 decimals for cost, 1 decimal for hours/counts.
    const round = k === 'totalPayCost' ? 100 : 10;
    out[`${k}Delta`] = Math.round((bv - av) * round) / round;
    if (av === 0) {
      out[`${k}DeltaPct`] = 0;
    } else {
      out[`${k}DeltaPct`] = Math.round(((bv - av) / av) * 1000) / 10;
    }
  }
  return out;
}

function planRow(p: {
  id: string; name: string; description: string | null;
  dateFrom: Date; dateTo: Date; status: string | null;
  workRules: unknown; blockOptions: unknown;
  summary: unknown; createdAt: Date | null;
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    dateFrom: p.dateFrom.toISOString().slice(0, 10),
    dateTo:   p.dateTo.toISOString().slice(0, 10),
    status: p.status,
    workRules: p.workRules,
    blockOptions: p.blockOptions,
    summary: p.summary as PlanSummaryShape,
    createdAt: p.createdAt?.toISOString() ?? null,
  };
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;
  try {
    // Accept both {leftId, rightId} (internal) and {planIdA, planIdB} (test/UI).
    const bodyRaw = await req.json() as { leftId?: string; rightId?: string;
      planIdA?: string; planIdB?: string; };
        const body = stripTenantOwnershipFields(bodyRaw);
    const leftId  = body.leftId  ?? body.planIdA;
    const rightId = body.rightId ?? body.planIdB;
    if (!leftId || !rightId) {
      return NextResponse.json(
        { error: 'planIdA and planIdB (or leftId/rightId) required' },
        { status: 400 },
      );
    }
    const plans = await withTenantRls(prisma, tenantId, async (tx) => {
      return tx.staffTransportPlan.findMany({
        // Both ids come from the request. Without tenantId, supplying another
        // tenant's plan id returned their plan — name, description, work
        // rules, block options and summary — to whoever asked. RLS does not
        // intervene; the database role holds BYPASSRLS.
        where: { tenantId, id: { in: [leftId, rightId] } },
        // The schema uses un-suffixed names for these Json fields.
        select: {
          id: true, name: true, description: true, status: true,
          dateFrom: true, dateTo: true,
          workRules: true, blockOptions: true, summary: true,
          createdAt: true, updatedAt: true,
        },
      });
    });
    const left  = plans.find((p) => p.id === leftId);
    const right = plans.find((p) => p.id === rightId);
    if (!left || !right) {
      return NextResponse.json({ error: 'One or both plans not found' }, { status: 404 });
    }
    const leftSummary  = ((left.summary  ?? {}) as unknown) as PlanSummary;
    const rightSummary = ((right.summary ?? {}) as unknown) as PlanSummary;
    return NextResponse.json({
      planA: planRow(left),
      planB: planRow(right),
      ...flatDiff(leftSummary, rightSummary),
    });
    } catch (e) {
    console.error('[plan compare]', e);
    return NextResponse.json({ error: 'Compare failed' }, { status: 500 });
  }
}
