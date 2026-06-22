/**
 * GET /api/logistics/rates/coverage
 *
 * Reports what fraction of recent shipments were priced from a rate
 * contract vs hand-entered. The leadership-facing answer to "are we
 * actually using the contracts we negotiated?"
 *
 * Query params:
 *   period - rolling window in days, default 30, max 365
 *   status - optional shipment status filter (e.g. ACTIVE, DELIVERED)
 *
 * Response:
 *   {
 *     period: { days, from, to },
 *     totals: { total, withContract, withoutContract, percentage },
 *     byContract: Array<{ contractId, contractNo, count, totalRevenue }>,
 *     uncontractedLanes: Array<{ origin, destination, count }>,
 *   }
 *
 * Auth: tenant operator session (xl-session). Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

interface CoverageRow {
  quoted_contract_id: string | null;
  contract_no: string | null;
  origin_name: string | null;
  destination_name: string | null;
  customer_rate_amount: string | number | null;
  currency: string | null;
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('period') ?? '30', 10) || 30, 1), 365);
  const status = sp.get('status');

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const rows = await prisma.$queryRawUnsafe<CoverageRow[]>(
      `SELECT
         s.quoted_contract_id,
         rc.contract_no,
         s.origin_name,
         s.destination_name,
         s.customer_rate_amount::text,
         s.currency
       FROM logistics_shipment_orders s
       LEFT JOIN logistics_rate_contracts rc
         ON rc.id = s.quoted_contract_id
        AND rc.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1
         AND s.deleted_at IS NULL
         AND s.created_at >= $2
         AND s.created_at < $3
         AND ($4::text IS NULL OR s.status = $4)`,
      tenantId, from.toISOString(), to.toISOString(), status ?? null,
    ).catch(() => [] as CoverageRow[]);

    const total = rows.length;
    let withContract = 0;
    const byContractMap = new Map<string, { contractId: string; contractNo: string; count: number; totalRevenue: number; currency: string }>();
    const uncontractedMap = new Map<string, { origin: string; destination: string; count: number }>();

    for (const r of rows) {
      if (r.quoted_contract_id) {
        withContract += 1;
        const key = r.quoted_contract_id;
        const existing = byContractMap.get(key);
        const rev = Number(r.customer_rate_amount ?? 0);
        if (existing) {
          existing.count += 1;
          existing.totalRevenue += rev;
        } else {
          byContractMap.set(key, {
            contractId: r.quoted_contract_id,
            contractNo: r.contract_no ?? '(deleted)',
            count: 1,
            totalRevenue: rev,
            currency: r.currency ?? 'AED',
          });
        }
      } else {
        const o = (r.origin_name || '').trim();
        const d = (r.destination_name || '').trim();
        if (o && d) {
          const key = `${o}→${d}`;
          const existing = uncontractedMap.get(key);
          if (existing) existing.count += 1;
          else uncontractedMap.set(key, { origin: o, destination: d, count: 1 });
        }
      }
    }

    const byContract = [...byContractMap.values()]
      .sort((a, b) => b.count - a.count)
      .map(c => ({ ...c, totalRevenue: round2(c.totalRevenue) }));

    const uncontractedLanes = [...uncontractedMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);  // top 20 — the long tail isn't actionable

    const withoutContract = total - withContract;
    const percentage = total === 0 ? 0 : Math.round((withContract / total) * 1000) / 10;

    return NextResponse.json({
      period: { days, from: from.toISOString(), to: to.toISOString() },
      totals: { total, withContract, withoutContract, percentage },
      byContract,
      uncontractedLanes,
    }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    console.error('[rates/coverage]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'coverage report failed' },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
