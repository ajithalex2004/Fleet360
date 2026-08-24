/**
 * GET /api/logistics/control-tower
 *
 * The operator control-tower feed: every live shipment with its SLA status,
 * carrier, latest GPS/ETA, open-exception counts, plus the latest tracking-event
 * "comment" (driver/dispatch note) for the board's Latest-comment column.
 *
 * Wraps domain.getShipmentControlTower and enriches it with one batched query
 * for the most-recent tracking event per shipment.
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getShipmentControlTower } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '500', 10) || 500, 1), 500);

  try {
    const tower = await getShipmentControlTower({ tenantId, limit });
    const ids = tower.shipments.map(s => s.id);

    // Latest tracking-event note per shipment (the board's "Latest comment").
    let commentById = new Map<string, { text: string | null; at: string | null; type: string }>();
    if (ids.length) {
      const rows = await prisma.$queryRawUnsafe<Array<{
        shipment_order_id: string; notes: string | null; occurred_at: Date; event_type: string;
      }>>(
        `SELECT DISTINCT ON (shipment_order_id)
                shipment_order_id, notes, occurred_at, event_type
           FROM logistics_tracking_events
          WHERE tenant_id = $1 AND shipment_order_id = ANY($2::text[])
          ORDER BY shipment_order_id, occurred_at DESC`,
        tenantId, ids,
      ).catch(() => []);
      commentById = new Map(rows.map(r => [
        r.shipment_order_id,
        { text: r.notes, at: r.occurred_at ? new Date(r.occurred_at).toISOString() : null, type: r.event_type },
      ]));
    }

    const shipments = tower.shipments.map(s => ({
      ...s,
      latestComment: commentById.get(s.id) ?? null,
    }));

    return NextResponse.json(
      { generatedAt: tower.generatedAt, summary: tower.summary, shipments },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[logistics/control-tower GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load control tower' },
      { status: 500 },
    );
  }
}
