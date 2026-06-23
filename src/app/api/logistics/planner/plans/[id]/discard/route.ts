/**
 * POST /api/logistics/planner/plans/[id]/discard
 *
 * Soft-archive a DRAFT plan (status → DISCARDED). No side effects on
 * shipments or assignments — this is the "throw away this plan before
 * committing" action.
 *
 * Auth: tenant operator session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { discardPlan } from '@/lib/logistics/route-optimizer-service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  try {
    await discardPlan(tenantId, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error('[planner/plans/[id]/discard]', e);
    return NextResponse.json({ error: 'Failed to discard plan' }, { status: 500 });
  }
}
