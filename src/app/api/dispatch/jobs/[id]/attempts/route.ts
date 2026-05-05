/**
 * GET /api/dispatch/jobs/[id]/attempts
 * Returns all dispatch attempts for a specific job, ordered chronologically.
 * Used by the Admin Dispatch Dashboard for attempt history drill-down.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
      out[k] = v;
    }
    return out;
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await ensureDispatchSchema();

    const { id } = params;

    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        da.*,
        d.first_name || ' ' || d.last_name AS driver_name,
        d.phone                             AS driver_phone,
        d.rating                            AS driver_rating,
        v.registration_number               AS vehicle_reg,
        v.type                              AS vehicle_type
      FROM dispatch_attempts da
      LEFT JOIN drivers  d ON d.id::text = da.driver_id  AND d.deleted_at IS NULL
      LEFT JOIN vehicles v ON v.id::text = da.vehicle_id AND v.deleted_at IS NULL
      WHERE da.dispatch_job_id = $1::uuid
      ORDER BY da.offered_at ASC
    `, id);

    return NextResponse.json({ data: serialize(rows), total: rows.length });
  } catch (err) {
    console.error('[dispatch/jobs/[id]/attempts GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
