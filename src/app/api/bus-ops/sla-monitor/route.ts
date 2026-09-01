export const dynamic = 'force-dynamic';

/**
 * GET /api/bus-ops/sla-monitor
 *
 * Live Shift Arrival SLA Monitor data feed.
 * Evaluates active and upcoming commuter trips, predicts destination ETA,
 * and classifies SLA health.
 *
 * Query params:
 *   - status: comma-separated statuses (e.g. IN_TRANSIT,DEPARTED,SCHEDULED)
 *   - raiseAlerts: 'true' | 'false' (default: false for dashboard polling, true on sweep)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { evaluateTenantSla } from '@/lib/bus-ops/sla-monitor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;
  const sp = req.nextUrl.searchParams;

  const statusParam = sp.get('status');
  const statusFilter = statusParam ? statusParam.split(',').map(s => s.trim()) : ['IN_TRANSIT', 'DEPARTED', 'SCHEDULED'];
  const raiseAlerts = sp.get('raiseAlerts') === 'true';

  try {
    const summary = await evaluateTenantSla(tenantId, {
      statusFilter,
      raiseAlerts,
    });

    return NextResponse.json(summary, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    console.error('[api/bus-ops/sla-monitor GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to evaluate shift SLA metrics' },
      { status: 500 },
    );
  }
}
