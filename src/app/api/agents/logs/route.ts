/**
 * GET /api/agents/logs
 * --------------------
 * Returns agent run history for the audit dashboard.
 * Query params: agent_id, status, limit, offset
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
    const sp      = req.nextUrl.searchParams;
    const agentId = sp.get('agent_id');
    const status  = sp.get('status');
    const limit   = Math.min(Number(sp.get('limit') ?? 50), 200);
    const offset  = Number(sp.get('offset') ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (agentId) { params.push(agentId); conditions.push(`agent_id = $${params.length}`); }
    if (status)  { params.push(status);  conditions.push(`status = $${params.length}`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countParams = [...params];
    params.push(limit, offset);

    const [countRows, rows] = await Promise.all([
      prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) AS count FROM agent_runs ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, agent_id, tenant_id, event_type, entity_id,
                items_processed, actions_created, duration_ms,
                status, error_text, created_at
         FROM agent_runs ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ...params,
      ),
    ]);

    return NextResponse.json({
      data:  rows.map(rowToCamel),
      total: Number(countRows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[agents/logs]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
