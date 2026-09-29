export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { spmSql } from '@/lib/assets/spm-sql';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

import { requireAuthorizedTenant } from '@/lib/tenant-context';

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { query } = spmSql(tenantId);

  try {
    await ensureSpmSchema();

    const [
      totalRes,
      activeRes,
      pausedRes,
      due7Res,
      overdueRes,
      openTicketsRes,
      completedMonthRes,
      lastRunRes,
    ] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) AS count FROM spm_cycles WHERE tenant_id = $tenant`),
      query<{ count: bigint }>(`SELECT COUNT(*) AS count FROM spm_cycles WHERE tenant_id = $tenant AND status = 'ACTIVE'`),
      query<{ count: bigint }>(`SELECT COUNT(*) AS count FROM spm_cycles WHERE tenant_id = $tenant AND status = 'PAUSED'`),
      query<{ count: bigint }>(`
        SELECT COUNT(*) AS count FROM spm_cycles
        WHERE tenant_id = $tenant AND status = 'ACTIVE'
          AND next_run_at > NOW() AND next_run_at <= NOW() + INTERVAL '7 days'
      `),
      query<{ count: bigint }>(`
        SELECT COUNT(*) AS count FROM spm_cycles
        WHERE tenant_id = $tenant AND status = 'ACTIVE' AND next_run_at < NOW()
      `),
      query<{ count: bigint }>(`
        SELECT COUNT(*) AS count FROM spm_tickets
        WHERE tenant_id = $tenant AND status IN ('OPEN', 'IN_PROGRESS')
      `),
      query<{ count: bigint }>(`
        SELECT COUNT(*) AS count FROM spm_tickets
        WHERE tenant_id = $tenant AND status = 'COMPLETED'
          AND DATE_TRUNC('month', completed_at) = DATE_TRUNC('month', NOW())
      `),
      query<{ max_run_at: Date | null }>(`SELECT MAX(run_at) AS max_run_at FROM spm_audit_logs WHERE tenant_id = $tenant`),
    ]);

    return NextResponse.json(ser({
      total_cycles: Number(totalRes[0]?.count ?? 0),
      active_cycles: Number(activeRes[0]?.count ?? 0),
      paused_cycles: Number(pausedRes[0]?.count ?? 0),
      due_in_7_days: Number(due7Res[0]?.count ?? 0),
      overdue: Number(overdueRes[0]?.count ?? 0),
      open_tickets: Number(openTicketsRes[0]?.count ?? 0),
      completed_this_month: Number(completedMonthRes[0]?.count ?? 0),
      last_run_at: lastRunRes[0]?.max_run_at ?? null,
    }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
