/**
 * Period Locks API — /api/finance/period-locks
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

const INIT_PERIODS = `
  CREATE TABLE IF NOT EXISTS finance_periods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    fiscal_year     INTEGER NOT NULL,
    period_number   INTEGER NOT NULL,
    period_name     TEXT NOT NULL,
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL,
    status          TEXT DEFAULT 'OPEN',
    locked_at       TIMESTAMPTZ,
    locked_by       TEXT,
    unlock_reason   TEXT,
    notes           TEXT,
    tenant_id       TEXT
  );
`;

const INIT_FY = `
  CREATE TABLE IF NOT EXISTS finance_fiscal_years (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    fiscal_year     INTEGER NOT NULL,
    year_start      DATE NOT NULL,
    year_end        DATE NOT NULL,
    status          TEXT DEFAULT 'OPEN',
    closed_at       TIMESTAMPTZ,
    closing_je_id   TEXT,
    retained_earnings_opening NUMERIC(15,2) DEFAULT 0,
    notes           TEXT,
    tenant_id       TEXT
  );
`;

function makePeriodsForYear(year: number): { number: number; name: string; from: string; to: string }[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periods = months.map((m, i) => {
    const mo = i + 1;
    const from = `${year}-${String(mo).padStart(2, '0')}-01`;
    const lastDay = new Date(year, mo, 0).getDate();
    const to = `${year}-${String(mo).padStart(2, '0')}-${lastDay}`;
    return { number: mo, name: `${m} ${year}`, from, to };
  });
  periods.push({ number: 13, name: `Year-End Adjustments ${year}`, from: `${year}-12-31`, to: `${year}-12-31` });
  return periods;
}

async function ensurePeriodSchema() {
  await prisma.$executeRawUnsafe(INIT_PERIODS).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_FY).catch(() => {});
  await ensureOperationalTenantColumn('finance_periods').catch(() => {});
  await ensureOperationalTenantColumn('finance_fiscal_years').catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE finance_periods DROP CONSTRAINT IF EXISTS finance_periods_fiscal_year_period_number_key`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE finance_fiscal_years DROP CONSTRAINT IF EXISTS finance_fiscal_years_fiscal_year_key`).catch(() => {});
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_periods_tenant_year_period
     ON finance_periods (tenant_id, fiscal_year, period_number)`,
  ).catch(() => {});
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fiscal_years_tenant_year
     ON finance_fiscal_years (tenant_id, fiscal_year)`,
  ).catch(() => {});
}

export async function GET(req: NextRequest) {
  await ensurePeriodSchema();
  const ctx = requireOperationalContext(req, 'finance', {
    requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
  });
  if (ctx instanceof NextResponse) return ctx;

  const sp = req.nextUrl.searchParams;
  const year = sp.get('year');
  const type = sp.get('type') ?? 'periods';

  if (type === 'fiscal_years') {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT fy.*,
         COUNT(p.id)::text as period_count,
         SUM(CASE WHEN p.status='LOCKED' THEN 1 ELSE 0 END)::text as locked_periods
       FROM finance_fiscal_years fy
       LEFT JOIN finance_periods p
         ON p.fiscal_year = fy.fiscal_year
        AND p.tenant_id::text = fy.tenant_id::text
       WHERE fy.tenant_id::text = $1
       GROUP BY fy.id
       ORDER BY fy.fiscal_year DESC`,
      ctx.tenantId,
    ).catch(() => []);
    return NextResponse.json({ data: rows });
  }

  if (type === 'check') {
    const date = sp.get('date');
    if (!date) return NextResponse.json({ locked: false });
    const [period] = await prisma.$queryRawUnsafe<{ status: string; period_name: string }[]>(
      `SELECT status, period_name FROM finance_periods
       WHERE tenant_id::text = $2
         AND period_from <= $1 AND period_to >= $1`,
      date,
      ctx.tenantId,
    ).catch(() => []);
    return NextResponse.json({
      locked: period?.status === 'LOCKED' || period?.status === 'YEAR_END',
      status: period?.status,
      periodName: period?.period_name,
    });
  }

  let where = 'WHERE tenant_id::text = $1';
  const params: unknown[] = [ctx.tenantId];
  if (year) {
    where += ` AND fiscal_year = $2`;
    params.push(parseInt(year, 10));
  }

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM finance_periods ${where} ORDER BY fiscal_year DESC, period_number ASC`,
    ...params,
  ).catch(() => []);
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  await ensurePeriodSchema();
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();

  if (body.action === 'setup_year') {
    const { year, notes } = body;
    const periods = makePeriodsForYear(year);

    await prisma.$executeRawUnsafe(
      `INSERT INTO finance_fiscal_years (fiscal_year, year_start, year_end, notes, tenant_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, fiscal_year) DO NOTHING`,
      year,
      `${year}-01-01`,
      `${year}-12-31`,
      notes ?? null,
      ctx.tenantId,
    ).catch(() => {});

    for (const p of periods) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_periods (fiscal_year, period_number, period_name, period_from, period_to, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, fiscal_year, period_number) DO NOTHING`,
        year, p.number, p.name, p.from, p.to, ctx.tenantId,
      ).catch(() => {});
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceFiscalYear',
      entityId: `${ctx.tenantId}:${year}`,
      action: 'CREATE',
      after: { year, periodsCreated: periods.length },
      summary: `Initialized fiscal year ${String(year)} with ${periods.length} periods.`,
      riskSeverity: 'high',
    });

    return NextResponse.json({ ok: true, year, periodsCreated: periods.length });
  }

  if (body.action === 'lock_period') {
    const { periodId, lockedBy, notes } = body;
    const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_periods WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      periodId,
      ctx.tenantId,
    ).catch(() => []);
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE finance_periods
       SET status='LOCKED', locked_at=NOW(), locked_by=$2, notes=COALESCE($3,notes), updated_at=NOW()
       WHERE id::text=$1 AND tenant_id::text = $4
       RETURNING *`,
      periodId,
      lockedBy ?? 'System',
      notes ?? null,
      ctx.tenantId,
    ).catch(() => []);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinancePeriod',
      entityId: String(row?.id ?? periodId),
      action: 'STATUS_CHANGE',
      before,
      after: row,
      summary: `Locked finance period ${String(row?.period_name ?? periodId)}.`,
      riskSeverity: 'high',
    });
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'soft_close_period') {
    const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_periods WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      body.periodId,
      ctx.tenantId,
    ).catch(() => []);
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE finance_periods
       SET status='SOFT_CLOSED', updated_at=NOW()
       WHERE id::text=$1 AND tenant_id::text = $2
       RETURNING *`,
      body.periodId,
      ctx.tenantId,
    ).catch(() => []);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinancePeriod',
      entityId: String(row?.id ?? body.periodId),
      action: 'STATUS_CHANGE',
      before,
      after: row,
      summary: `Soft-closed finance period ${String(row?.period_name ?? body.periodId)}.`,
      riskSeverity: 'high',
    });
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'unlock_period') {
    const { periodId, unlockReason } = body;
    const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_periods WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      periodId,
      ctx.tenantId,
    ).catch(() => []);
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE finance_periods
       SET status='OPEN', locked_at=NULL, unlock_reason=$2, updated_at=NOW()
       WHERE id::text=$1 AND tenant_id::text = $3
       RETURNING *`,
      periodId,
      unlockReason ?? 'Manually unlocked',
      ctx.tenantId,
    ).catch(() => []);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinancePeriod',
      entityId: String(row?.id ?? periodId),
      action: 'STATUS_CHANGE',
      before,
      after: row,
      summary: `Unlocked finance period ${String(row?.period_name ?? periodId)}.`,
      riskSeverity: 'high',
    });
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'lock_all_periods') {
    const { year } = body;
    await prisma.$executeRawUnsafe(
      `UPDATE finance_periods
       SET status='LOCKED', locked_at=NOW(), locked_by='System', updated_at=NOW()
       WHERE fiscal_year=$1 AND tenant_id::text = $2 AND status IN ('OPEN','SOFT_CLOSED')`,
      year,
      ctx.tenantId,
    ).catch(() => {});
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceFiscalYear',
      entityId: `${ctx.tenantId}:${year}`,
      action: 'STATUS_CHANGE',
      after: { year, status: 'LOCKED' },
      summary: `Locked all periods in fiscal year ${String(year)}.`,
      riskSeverity: 'high',
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'close_fiscal_year') {
    const { year } = body;
    await prisma.$executeRawUnsafe(
      `UPDATE finance_periods
       SET status='YEAR_END', locked_at=NOW(), updated_at=NOW()
       WHERE fiscal_year=$1 AND tenant_id::text = $2`,
      year,
      ctx.tenantId,
    ).catch(() => {});
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE finance_fiscal_years
       SET status='CLOSED', closed_at=NOW(), updated_at=NOW()
       WHERE fiscal_year=$1 AND tenant_id::text = $2
       RETURNING *`,
      year,
      ctx.tenantId,
    ).catch(() => []);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceFiscalYear',
      entityId: String(row?.id ?? `${ctx.tenantId}:${year}`),
      action: 'STATUS_CHANGE',
      after: row,
      summary: `Closed fiscal year ${String(year)}.`,
      riskSeverity: 'critical',
    });
    return NextResponse.json(row ?? {});
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
