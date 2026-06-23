/**
 * POST /api/logistics/planner/plans/[id]/commit
 *
 * Promote a DRAFT plan to COMMITTED: write logistics_assignments rows
 * linking each shipment to its vehicle + route position, and flip the
 * shipments to ASSIGNED. Idempotent — re-committing returns the same
 * result with assignmentsCreated=0.
 *
 * Auth: tenant operator session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { commitPlan } from '@/lib/logistics/route-optimizer-service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  const userId = req.headers.get('x-user-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  try {
    const result = await commitPlan(tenantId, id, userId ?? 'api');
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    console.error('[planner/plans/[id]/commit]', e);
    const msg = e instanceof Error ? e.message : 'commit failed';
    const status = /not found/i.test(msg) ? 404 : /discarded/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
