/**
 * POST /api/bus-ops/fleet-optimizer/solve
 *
 * Kicks off a fleet-routing solve for a given target date. Returns the
 * runId immediately; the client polls GET /runs/:id for status + results.
 *
 * The orchestrator fires the pipeline in the background (fire-and-forget).
 * See src/lib/planning/fleet-routing/solve-orchestrator.ts for the caveat
 * about serverless vs long-lived Node servers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { startSolve } from '@/lib/planning/fleet-routing/solve-orchestrator';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface SolveBody {
  /** Anchor / start of the effective range. 'YYYY-MM-DD'. */
  targetDate?:   string;
  /** Optional end of the effective range. When set, publish loops over
   *  every weekday in [targetDate, effectiveTo]. When omitted, same as
   *  targetDate (single-day behaviour, unchanged). */
  effectiveTo?:  string;
  vehicleIds?:   string[];
  timeout?:      string;   // e.g. '30s', '60s'
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  let body: SolveBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  if (!body.targetDate) return NextResponse.json({ error: 'targetDate is required (YYYY-MM-DD)' }, { status: 400 });
  const targetDate = new Date(body.targetDate);
  if (isNaN(targetDate.getTime())) return NextResponse.json({ error: 'targetDate must be a valid date' }, { status: 400 });

  let effectiveTo: Date | undefined;
  if (body.effectiveTo) {
    effectiveTo = new Date(body.effectiveTo);
    if (isNaN(effectiveTo.getTime())) return NextResponse.json({ error: 'effectiveTo must be a valid date' }, { status: 400 });
    if (effectiveTo < targetDate) return NextResponse.json({ error: 'effectiveTo must be on or after targetDate' }, { status: 400 });
  }

  if (body.vehicleIds !== undefined) {
    if (!Array.isArray(body.vehicleIds) || body.vehicleIds.some(v => typeof v !== 'string')) {
      return NextResponse.json({ error: 'vehicleIds must be an array of strings' }, { status: 400 });
    }
  }

  try {
    const { runId } = await startSolve({
      tenantId,
      createdBy:  req.headers.get('x-user-id') ?? 'unknown',
      targetDate,
      effectiveTo,
      vehicleIds: body.vehicleIds,
      timeout:    body.timeout,
    });
    return NextResponse.json({ runId, status: 'PENDING' }, { status: 202 });
  } catch (e) {
    console.error('[fleet-optimizer/solve]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to start solve' },
      { status: 500 },
    );
  }
}
