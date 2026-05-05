/**
 * GET /api/agents/risk-scores
 * ----------------------------
 * Returns current vehicle risk scores with optional filters.
 * Query params: risk_level, limit, offset, sort (score|level|scored_at)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  await ensureAgentSchema();
  try {
    const sp        = req.nextUrl.searchParams;
    const riskLevel = sp.get('risk_level');
    const limit     = Math.min(Number(sp.get('limit') ?? 100), 500);
    const offset    = Number(sp.get('offset') ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (riskLevel) {
      params.push(riskLevel);
      conditions.push(`risk_level = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countParams = [...params];
    params.push(limit, offset);

    const [countRows, rows] = await Promise.all([
      prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) AS count FROM fleet_risk_scores ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
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
    const summaryRows = await prisma.$queryRawUnsafe<
      Array<{ risk_level: string; count: bigint; avg_score: string }>
    >(`SELECT risk_level, COUNT(*) AS count, ROUND(AVG(risk_score)::NUMERIC, 3) AS avg_score
       FROM fleet_risk_scores GROUP BY risk_level`);

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
}
