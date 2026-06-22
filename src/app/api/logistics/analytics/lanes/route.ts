/**
 * GET /api/logistics/analytics/lanes
 *
 * Lane profitability rollup. Closes gap #10 from the logistics
 * competitive analysis: the data lives in logistics_shipment_orders
 * (customer_rate_amount, carrier_cost_amount, margin_amount) but
 * nothing has ever surfaced it. The rate-engine work (Gap #1) made
 * margin_amount reliable; this endpoint is what reads it back.
 *
 * Query params:
 *   period - rolling window in days, default 90, max 365
 *   status - optional status filter (DELIVERED, IN_TRANSIT, ...)
 *   limit  - top N lanes to return, default 25, max 200
 *
 * Response shape:
 *   {
 *     period: { days, from, to },
 *     totals: { lanes, shipments, revenue, carrierCost, margin, marginPct },
 *     lanes: Array<{
 *       origin, destination,
 *       shipments,
 *       revenue, carrierCost, margin, marginPct,
 *       avgRevenue, avgMargin,
 *       hasContract  // any shipment on this lane used a contract
 *     }>,
 *     // Highlights surfaced for the dashboard tile
 *     topByMargin: Array<{origin, destination, margin}>,
 *     topLossMakers: Array<{origin, destination, margin}>,
 *   }
 *
 * Auth: tenant operator session. Read-only, 60s cache + 5min SWR.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

interface LaneRow {
  origin: string;
  destination: string;
  shipments: bigint;
  revenue: string | null;
  carrier_cost: string | null;
  margin_sum: string | null;
  has_contract: boolean;
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('period') ?? '90', 10) || 90, 1), 365);
  const status = sp.get('status');
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '25', 10) || 25, 1), 200);

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const rows = await prisma.$queryRawUnsafe<LaneRow[]>(
      `SELECT
         COALESCE(NULLIF(TRIM(origin_name), ''), '(unknown)')      AS origin,
         COALESCE(NULLIF(TRIM(destination_name), ''), '(unknown)') AS destination,
         COUNT(*)::bigint                            AS shipments,
         SUM(COALESCE(customer_rate_amount, 0))::text AS revenue,
         SUM(COALESCE(carrier_cost_amount, 0))::text  AS carrier_cost,
         SUM(
           COALESCE(margin_amount,
                    COALESCE(customer_rate_amount, 0) - COALESCE(carrier_cost_amount, 0))
         )::text                                      AS margin_sum,
         BOOL_OR(quoted_contract_id IS NOT NULL)      AS has_contract
       FROM logistics_shipment_orders
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND created_at >= $2::timestamptz
         AND created_at <  $3::timestamptz
         AND ($4::text IS NULL OR status = $4)
         AND COALESCE(customer_rate_amount, 0) > 0  -- exclude unquoted drafts
       GROUP BY origin, destination
       ORDER BY shipments DESC
       LIMIT $5`,
      tenantId, from.toISOString(), to.toISOString(), status ?? null, limit,
    ).catch(() => [] as LaneRow[]);

    const lanes = rows.map(r => {
      const revenue = Number(r.revenue ?? 0);
      const carrierCost = Number(r.carrier_cost ?? 0);
      const margin = Number(r.margin_sum ?? 0);
      const shipments = Number(r.shipments);
      const marginPct = revenue > 0 ? round1((margin / revenue) * 100) : 0;
      return {
        origin: r.origin,
        destination: r.destination,
        shipments,
        revenue: round2(revenue),
        carrierCost: round2(carrierCost),
        margin: round2(margin),
        marginPct,
        avgRevenue: shipments > 0 ? round2(revenue / shipments) : 0,
        avgMargin: shipments > 0 ? round2(margin / shipments) : 0,
        hasContract: r.has_contract,
      };
    });

    const totals = lanes.reduce((acc, l) => ({
      lanes: acc.lanes + 1,
      shipments: acc.shipments + l.shipments,
      revenue: acc.revenue + l.revenue,
      carrierCost: acc.carrierCost + l.carrierCost,
      margin: acc.margin + l.margin,
    }), { lanes: 0, shipments: 0, revenue: 0, carrierCost: 0, margin: 0 });

    const totalsRounded = {
      ...totals,
      revenue: round2(totals.revenue),
      carrierCost: round2(totals.carrierCost),
      margin: round2(totals.margin),
      marginPct: totals.revenue > 0 ? round1((totals.margin / totals.revenue) * 100) : 0,
    };

    // Highlights for the dashboard tile — sorted views without re-querying.
    const byMargin = [...lanes].sort((a, b) => b.margin - a.margin);
    const topByMargin = byMargin.slice(0, 5).map(l => ({
      origin: l.origin, destination: l.destination, margin: l.margin, shipments: l.shipments,
    }));
    const topLossMakers = byMargin
      .filter(l => l.margin < 0)
      .slice(-5)
      .reverse()
      .map(l => ({
        origin: l.origin, destination: l.destination, margin: l.margin, shipments: l.shipments,
      }));

    return NextResponse.json({
      period: { days, from: from.toISOString(), to: to.toISOString() },
      totals: totalsRounded,
      lanes,
      topByMargin,
      topLossMakers,
    }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    console.error('[analytics/lanes]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'lane analytics failed' },
      { status: 500 },
    );
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }
