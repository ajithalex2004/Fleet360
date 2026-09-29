export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { spmSql } from '@/lib/assets/spm-sql';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { query } = spmSql(tenantId);

  try {
    await ensureSpmSchema();
    const { id } = await params;
    const body = await req.json();
    const action: string = body.action;

    if (!['pause', 'resume', 'archive'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Use: pause | resume | archive' }, { status: 400 });
    }

    const currentRows = await query(`SELECT * FROM spm_cycles WHERE id::text = $1 AND tenant_id = $tenant LIMIT 1`, id);
    if (currentRows.length === 0) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }
    const current = currentRows[0] as Row;

    let sql: string;
    let sqlParams: unknown[];

    if (action === 'pause') {
      sql = `
        UPDATE spm_cycles SET status = 'PAUSED', updated_at = NOW()
        WHERE id::text = $1 AND tenant_id = $tenant
        RETURNING *,
          ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
      `;
      sqlParams = [id];
    } else if (action === 'resume') {
      // If next_run_at is null or in the past, recalculate
      const intervalDays = Number(current.interval_days ?? 30);
      const nextRunAt = current.next_run_at as Date | null;
      let newNextRun: string | null = null;
      if (!nextRunAt || new Date(nextRunAt) < new Date()) {
        const d = new Date();
        d.setDate(d.getDate() + intervalDays);
        newNextRun = d.toISOString();
      }
      if (newNextRun) {
        sql = `
          UPDATE spm_cycles SET status = 'ACTIVE', next_run_at = $2::timestamptz, updated_at = NOW()
          WHERE id::text = $1 AND tenant_id = $tenant
          RETURNING *,
            ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
        `;
        sqlParams = [id, newNextRun];
      } else {
        sql = `
          UPDATE spm_cycles SET status = 'ACTIVE', updated_at = NOW()
          WHERE id::text = $1 AND tenant_id = $tenant
          RETURNING *,
            ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
        `;
        sqlParams = [id];
      }
    } else {
      // archive
      sql = `
        UPDATE spm_cycles SET status = 'ARCHIVED', updated_at = NOW()
        WHERE id::text = $1 AND tenant_id = $tenant
        RETURNING *,
          ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
      `;
      sqlParams = [id];
    }

    const [row] = await query(sql, ...sqlParams);
    return NextResponse.json(ser({ action, cycle: row }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
