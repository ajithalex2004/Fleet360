/**
 * GET /api/agents/route-results
 * Returns all route optimisation results with optional filters.
 *
 * Query params:
 *   status   — SUGGESTED | AUTO_APPLIED | APPLIED | REJECTED
 *   limit    — default 50
 *   offset   — default 0
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';

export async function GET(req: NextRequest) {
  try {
    await ensureAgentSchema();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const whereClause = status ? `WHERE status = '${status.replace(/'/g, "''")}'` : '';

    const rows = await prisma.$queryRawUnsafe<RouteResultRow[]>(`
      SELECT
        id::text,
        route_id::text,
        route_name,
        route_number,
        original_stop_count,
        matched_stop_count,
        original_distance_km::float8,
        optimised_distance_km::float8,
        distance_saved_km::float8,
        distance_saved_pct::float8,
        iterations_2opt,
        solver_duration_ms,
        estimated_duration_min,
        original_sequence,
        optimised_sequence,
        status,
        applied_at,
        rejected_at,
        rejected_by,
        created_at,
        updated_at
      FROM route_optimisation_results
      ${whereClause}
      ORDER BY distance_saved_pct DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Summary counts
    const counts = await prisma.$queryRaw<CountRow[]>`
      SELECT status, COUNT(*)::int AS count
      FROM route_optimisation_results
      GROUP BY status
    `;

    const summary: Record<string, number> = {};
    for (const c of counts) summary[c.status] = c.count;

    return NextResponse.json({ data: rows, summary, total: Object.values(summary).reduce((a, b) => a + b, 0) });
  } catch (err) {
    console.error('route-results GET error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

interface RouteResultRow {
  id: string;
  route_id: string;
  route_name: string;
  route_number: string;
  original_stop_count: number;
  matched_stop_count: number;
  original_distance_km: number;
  optimised_distance_km: number;
  distance_saved_km: number;
  distance_saved_pct: number;
  iterations_2opt: number;
  solver_duration_ms: number;
  estimated_duration_min: number | null;
  original_sequence: unknown;
  optimised_sequence: unknown;
  status: string;
  applied_at: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  status: string;
  count: number;
}
