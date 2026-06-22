/**
 * GET /api/logistics/planner/plans
 *
 * List recent route plans for the dashboard / planner history view.
 * Query: status, limit (default 20, max 100), period (days, default 7).
 *
 * Auth: tenant operator session. Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listPlans } from '@/lib/logistics/route-optimizer-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  try {
    const plans = await listPlans(tenantId, {
      status: sp.get('status'),
      limit: sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined,
      days: sp.get('period') ? parseInt(sp.get('period')!, 10) : undefined,
    });
    return NextResponse.json({ plans }, {
      headers: { 'Cache-Control': 'private, max-age=15' },
    });
  } catch (e) {
    console.error('[planner/plans GET]', e);
    return NextResponse.json({ plans: [] }, { status: 200 });
  }
}
