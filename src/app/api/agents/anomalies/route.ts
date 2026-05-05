/**
 * GET  /api/agents/anomalies  — list anomaly flags with filters
 * PATCH /api/agents/anomalies — update flag status (review/dismiss/confirm)
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
    const sp          = req.nextUrl.searchParams;
    const severity    = sp.get('severity');
    const entityType  = sp.get('entity_type');
    const status      = sp.get('status') ?? 'OPEN';
    const detectorId  = sp.get('detector_id');
    const limit       = Math.min(Number(sp.get('limit') ?? 50), 500);
    const offset      = Number(sp.get('offset') ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (severity)   { params.push(severity);   conditions.push(`severity = $${params.length}`); }
    if (entityType) { params.push(entityType); conditions.push(`entity_type = $${params.length}`); }
    if (status)     { params.push(status);     conditions.push(`status = $${params.length}`); }
    if (detectorId) { params.push(detectorId); conditions.push(`detector_id = $${params.length}`); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countParams = [...params];
    params.push(limit, offset);

    const [countRows, rows, summaryRows] = await Promise.all([
      prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) AS count FROM finance_anomaly_flags ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM finance_anomaly_flags ${where}
         ORDER BY
           CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
           confidence DESC,
           created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ...params,
      ),
      prisma.$queryRawUnsafe<Array<{ severity: string; count: bigint }>>(
        `SELECT severity, COUNT(*) AS count
         FROM finance_anomaly_flags WHERE status = 'OPEN'
         GROUP BY severity`,
      ),
    ]);

    const openCounts = Object.fromEntries(
      summaryRows.map((r) => [r.severity.toLowerCase(), Number(r.count)]),
    );

    return NextResponse.json({
      data:  rows.map(rowToCamel),
      total: Number(countRows[0].count),
      limit,
      offset,
      openCounts,
    });
  } catch (err) {
    console.error('[agents/anomalies GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  await ensureAgentSchema();
  try {
    const body = await req.json() as {
      id: string;
      status: 'REVIEWED' | 'FALSE_POSITIVE' | 'CONFIRMED_ISSUE';
      reviewed_by?: string;
    };

    if (!body.id || !body.status) {
      return NextResponse.json({ error: 'id and status are required' }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE finance_anomaly_flags
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      body.status,
      body.reviewed_by ?? 'User',
      body.id,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[agents/anomalies PATCH]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
