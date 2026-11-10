export const dynamic = 'force-dynamic';

/**
 * GET /api/dispatch/jobs/[id]/attempts
 * Returns all dispatch attempts for a specific job, ordered chronologically.
 * Used by the Admin Dispatch Dashboard for attempt history drill-down.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
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
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();

      const { id } = params;

      const rows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          da.*,
          COALESCE(NULLIF(TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')), ''), d.name) AS driver_name,
          d.contact_number                                                    AS driver_phone,
          COALESCE(d.rating, 4.5)                                             AS driver_rating,
          COALESCE(v.registration_no, v.license_plate, v.plate_number)        AS vehicle_reg,
          v.type                                                              AS vehicle_type
        FROM dispatch_attempts da
        JOIN dispatch_jobs dj ON dj.id = da.dispatch_job_id AND dj.tenant_id = $2
        LEFT JOIN drivers  d  ON d.id::text = da.driver_id  AND d.deleted_at IS NULL
        LEFT JOIN vehicles v  ON v.id::text = da.vehicle_id AND v.deleted_at IS NULL
        WHERE da.dispatch_job_id::text = $1
        ORDER BY da.offered_at ASC, da.attempt_number ASC
      `, id, tenantId);

      return NextResponse.json({ data: serialize(rows), total: rows.length });
    } catch (err) {
      console.error('[dispatch/jobs/[id]/attempts GET]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
