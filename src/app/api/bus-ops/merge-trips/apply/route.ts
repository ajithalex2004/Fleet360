/**
 * POST /api/bus-ops/merge-trips/apply
 *
 * Commit a merge: evaluate through PCE, then transactionally create the
 * merged trip, reassign passengers, and mark sources MERGED. Returns
 * the merged trip's id + reassignment count.
 *
 * BLOCK verdict → 409 with the PCE checks so the UI can explain why.
 * WARN verdict → 200 (merge proceeds); response includes the checks so
 * the client can surface them.
 *
 * Body is the same MergeInput shape as /preview.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyMerge } from '@/lib/bus-ops/merge-trips';
import { parseMergeInputBody } from '@/lib/bus-ops/merge-trips-body';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const userId = req.headers.get('x-user-id');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = parseMergeInputBody(body, tenantId);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await applyMerge(prisma, parsed.input, userId);
    if ('code' in result) {
      const status = result.code === 'MERGE_BLOCKED_BY_CONSTRAINTS' ? 409 : 400;
      return NextResponse.json({ error: result.message, code: result.code, details: result.details }, { status });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    console.error('[merge-trips.apply]', e);
    return NextResponse.json({ error: 'Merge apply failed' }, { status: 500 });
  }
}
