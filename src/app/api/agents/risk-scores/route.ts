export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/risk-scores
 * ----------------------------
 * Returns current vehicle risk scores with optional filters.
 * Query params: risk_level, limit, offset, sort (score|level|scored_at)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await ensureAgentSchema();
      try {
        const sp        = req.nextUrl.searchParams;
        const riskLevel = sp.get('risk_level');
        const limit     = Math.min(Number(sp.get('limit') ?? 100), 500);
        const offset    = Number(sp.get('offset') ?? 0);

        // Explicit tenant filter on top of RLS (defence in depth).
        const conditions: string[] = ['r.tenant_id = $1'];
        const params: unknown[] = [tenantId];

        if (riskLevel) {
          params.push(riskLevel);
          conditions.push(`r.risk_level = $${params.length}`);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;
        const countParams = [...params];
        params.push(limit, offset);

        const [countRows, rows] = await Promise.all([
          tx.$queryRawUnsafe<[{ count: bigint }]>(
            `SELECT COUNT(*) AS count FROM fleet_risk_scores r ${where}`,
            ...countParams,
          ),
          tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT r.*, v.status AS vehicle_status, v.vehicle_usage, v.branch_name
             FROM fleet_risk_scores r
             LEFT JOIN vehicles v ON v.id = r.vehicle_id
             ${where}
             ORDER BY r.risk_score DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            ...params,
          ),
        ]);

        // Summary counts
        const summaryRows = await tx.$queryRawUnsafe<
          Array<{ risk_level: string; count: bigint; avg_score: string }>
        >(`SELECT risk_level, COUNT(*) AS count, ROUND(AVG(risk_score)::NUMERIC, 3) AS avg_score
           FROM fleet_risk_scores WHERE tenant_id = $1 GROUP BY risk_level`, tenantId);

        const summary = Object.fromEntries(
          summaryRows.map((r) => [r.risk_level.toLowerCase(), { count: Number(r.count), avgScore: Number(r.avg_score) }]),
        );

        return NextResponse.json({
          data:    rows.map(rowToCamel),
          total:   Number(countRows[0].count),
          limit,
          offset,
          summary,
        });
        } catch (err) {
        console.error('[agents/risk-scores]', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
  });
}

