/**
 * GET /api/logistics/planner/plans/[id]
 *
 * Retrieve a single route plan with its full RouteOptimizerResult. Used to
 * re-render the planner page when an operator returns after closing the tab.
 *
 * Auth: tenant operator session. Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlan } from '@/lib/logistics/route-optimizer-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  try {
    const plan = await getPlan(tenantId, id);
    if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(plan, {
      headers: { 'Cache-Control': 'private, max-age=10' },
    });
  } catch (e) {
    console.error('[planner/plans/[id] GET]', e);
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
}
