/**
 * UAE Corporate Tax API — /api/finance/corporate-tax
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

const INIT_CT = `
  CREATE TABLE IF NOT EXISTS finance_ct_returns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    tax_year        INTEGER NOT NULL,
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL,
    status          TEXT DEFAULT 'DRAFT',
    revenue         NUMERIC(15,2) DEFAULT 0,
    exempt_income   NUMERIC(15,2) DEFAULT 0,
    allowable_deductions NUMERIC(15,2) DEFAULT 0,
    taxable_income  NUMERIC(15,2) DEFAULT 0,
    threshold       NUMERIC(15,2) DEFAULT 375000,
    taxable_above_threshold NUMERIC(15,2) DEFAULT 0,
    ct_rate         NUMERIC(5,4)  DEFAULT 0.09,
    ct_liability    NUMERIC(15,2) DEFAULT 0,
    withholding_tax NUMERIC(15,2) DEFAULT 0,
    tax_paid        NUMERIC(15,2) DEFAULT 0,
    balance_due     NUMERIC(15,2) DEFAULT 0,
    is_sbr_eligible BOOLEAN DEFAULT FALSE,
    sbr_threshold   NUMERIC(15,2) DEFAULT 3000000,
    filing_deadline DATE,
    filed_at        TIMESTAMPTZ,
    notes           TEXT,
    tenant_id       TEXT
  );
`;

const INIT_CT_ADJ = `
  CREATE TABLE IF NOT EXISTS finance_ct_adjustments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    return_id       TEXT NOT NULL,
    adj_type        TEXT NOT NULL,
    description     TEXT NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    reference       TEXT,
    notes           TEXT,
    tenant_id       TEXT
  );
`;

function toN(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

async function ensureCtSchema() {
  await prisma.$executeRawUnsafe(INIT_CT).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_CT_ADJ).catch(() => {});
  await ensureOperationalTenantColumn('finance_ct_returns').catch(() => {});
  await ensureOperationalTenantColumn('finance_ct_adjustments').catch(() => {});
}

async function computeRevenue(from: string, to: string, tenantId: string): Promise<number> {
  const [rev] = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT COALESCE(SUM(subtotal_amount),0)::text as t FROM finance_invoices
     WHERE deleted_at IS NULL AND tenant_id::text = $3
       AND issue_date BETWEEN $1 AND $2
       AND payment_status NOT IN ('DRAFT','CANCELLED')`,
    from, to, tenantId,
  ).catch(() => [{ t: '0' }]);
  const [rac] = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT COALESCE(SUM(total_amount),0)::text as t FROM rental_invoices
     WHERE deleted_at IS NULL AND tenant_id::text = $3
       AND created_at::date BETWEEN $1 AND $2`,
    from, to, tenantId,
  ).catch(() => [{ t: '0' }]);
  const [lg] = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT COALESCE(SUM(total_amount),0)::text as t FROM logistics_bookings
     WHERE deleted_at IS NULL AND tenant_id::text = $3
       AND status IN ('DELIVERED','CLOSED') AND created_at::date BETWEEN $1 AND $2`,
    from, to, tenantId,
  ).catch(() => [{ t: '0' }]);
  return toN(rev?.t) + toN(rac?.t) + toN(lg?.t);
}

async function computeDeductions(from: string, to: string, tenantId: string): Promise<number> {
  const [fuel] = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT COALESCE(SUM(total_cost),0)::text as t FROM fuel_logs
     WHERE tenant_id::text = $3 AND created_at::date BETWEEN $1 AND $2`,
    from, to, tenantId,
  ).catch(() => [{ t: '0' }]);
  const [maint] = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT COALESCE(SUM(total_cost),0)::text as t FROM maintenance_requests
     WHERE deleted_at IS NULL AND tenant_id::text = $3
       AND status='COMPLETED' AND created_at::date BETWEEN $1 AND $2`,
    from, to, tenantId,
  ).catch(() => [{ t: '0' }]);
  const [dep] = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT COALESCE(SUM(depreciation),0)::text as t FROM finance_depreciation_schedule
     WHERE tenant_id::text = $3
       AND period_year || '-' || LPAD(period_month::text,2,'0') || '-01' BETWEEN $1 AND $2`,
    from, to, tenantId,
  ).catch(() => [{ t: '0' }]);
  const [exp] = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT COALESCE(SUM(total_amount),0)::text as t FROM finance_expenses
     WHERE deleted_at IS NULL AND tenant_id::text = $3
       AND status IN ('APPROVED','PAID') AND expense_date BETWEEN $1 AND $2`,
    from, to, tenantId,
  ).catch(() => [{ t: '0' }]);
  return toN(fuel?.t) + toN(maint?.t) + toN(dep?.t) + toN(exp?.t);
}

export async function GET(req: NextRequest) {
  await ensureCtSchema();
  const ctx = requireOperationalContext(req, 'finance', {
    requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
  });
  if (ctx instanceof NextResponse) return ctx;

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') ?? 'returns';

  if (type === 'estimate') {
    const year = parseInt(sp.get('year') ?? String(new Date().getFullYear()), 10);
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const [revenue, deductions, returns] = await Promise.all([
      computeRevenue(from, to, ctx.tenantId),
      computeDeductions(from, to, ctx.tenantId),
      prisma.$queryRawUnsafe<{ adj_type: string; amount: string }[]>(
        `SELECT adj_type, SUM(amount)::text as amount FROM finance_ct_adjustments WHERE tenant_id::text = $2
           AND return_id IN (
             SELECT id::text FROM finance_ct_returns WHERE tax_year=$1 AND deleted_at IS NULL AND tenant_id::text = $2
           )
         GROUP BY adj_type`,
        year,
        ctx.tenantId,
      ).catch(() => []),
    ]);

    const addBacks = returns.filter(r => r.adj_type === 'ADD_BACK').reduce((s, r) => s + toN(r.amount), 0);
    const extraDeduct = returns.filter(r => r.adj_type === 'DEDUCTION').reduce((s, r) => s + toN(r.amount), 0);
    const exempt = returns.filter(r => r.adj_type === 'EXEMPT').reduce((s, r) => s + toN(r.amount), 0);

    const isSBREligible = revenue <= 3_000_000;
    const taxableIncome = Math.max(0, revenue - deductions + addBacks - extraDeduct - exempt);
    const threshold = 375_000;
    const aboveThreshold = Math.max(0, taxableIncome - threshold);
    const ctLiability = isSBREligible ? 0 : Math.round(aboveThreshold * 0.09 * 100) / 100;
    const effectiveRate = taxableIncome > 0 ? Math.round((ctLiability / taxableIncome) * 1000) / 10 : 0;

    return NextResponse.json({
      year,
      revenue: Math.round(revenue * 100) / 100,
      deductions: Math.round(deductions * 100) / 100,
      addBacks,
      extraDeductions: extraDeduct,
      exemptIncome: exempt,
      taxableIncome: Math.round(taxableIncome * 100) / 100,
      threshold,
      aboveThreshold: Math.round(aboveThreshold * 100) / 100,
      ctRate: 9,
      ctLiability,
      effectiveRate,
      isSBREligible,
      sbrThreshold: 3_000_000,
      filingDeadline: `${year + 1}-09-30`,
    });
  }

  if (type === 'adjustments') {
    const returnId = sp.get('returnId');
    if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 });
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_ct_adjustments
       WHERE return_id=$1 AND tenant_id::text = $2
       ORDER BY created_at`,
      returnId,
      ctx.tenantId,
    ).catch(() => []);
    return NextResponse.json({ data: rows });
  }

  const returns = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM finance_ct_returns
     WHERE deleted_at IS NULL AND tenant_id::text = $1
     ORDER BY tax_year DESC, period_from DESC`,
    ctx.tenantId,
  ).catch(() => []);
  return NextResponse.json({ data: returns });
}

export async function POST(req: NextRequest) {
  await ensureCtSchema();
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();

  if (body.action === 'add_adjustment') {
    const { returnId, adjType, description, amount, reference, notes } = body;
    const [returnRow] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_ct_returns WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      returnId,
      ctx.tenantId,
    ).catch(() => []);
    if (!returnRow) return NextResponse.json({ error: 'Return not found' }, { status: 404 });

    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `INSERT INTO finance_ct_adjustments (return_id, adj_type, description, amount, reference, notes, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      returnId, adjType, description, amount, reference ?? null, notes ?? null, ctx.tenantId,
    ).catch(() => []);

    if (!row) return NextResponse.json({ error: 'Failed to add adjustment' }, { status: 500 });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceCorporateTaxAdjustment',
      entityId: String(row.id ?? ''),
      action: 'CREATE',
      after: row,
      summary: `Added corporate tax adjustment ${String(adjType ?? '')}.`,
      riskSeverity: 'medium',
    });
    return NextResponse.json(row ?? {}, { status: 201 });
  }

  if (body.action === 'file') {
    const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_ct_returns WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      body.returnId,
      ctx.tenantId,
    ).catch(() => []);
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE finance_ct_returns
       SET status='FILED', filed_at=NOW(), updated_at=NOW()
       WHERE id::text=$1 AND tenant_id::text = $2
       RETURNING *`,
      body.returnId,
      ctx.tenantId,
    ).catch(() => []);
    if (!row) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceCorporateTaxReturn',
      entityId: String(row.id ?? body.returnId),
      action: 'STATUS_CHANGE',
      before,
      after: row,
      summary: `Filed corporate tax return ${String(row.id ?? body.returnId)}.`,
      riskSeverity: 'high',
    });
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'record_payment') {
    const { returnId, amount } = body;
    const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_ct_returns WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      returnId,
      ctx.tenantId,
    ).catch(() => []);
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE finance_ct_returns
       SET tax_paid=$2, balance_due=ct_liability-$2, updated_at=NOW()
       WHERE id::text=$1 AND tenant_id::text = $3
       RETURNING *`,
      returnId,
      amount,
      ctx.tenantId,
    ).catch(() => []);
    if (!row) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceCorporateTaxReturn',
      entityId: String(row.id ?? returnId),
      action: 'UPDATE',
      before,
      after: row,
      summary: `Recorded corporate tax payment for ${String(row.id ?? returnId)}.`,
      riskSeverity: 'high',
    });
    return NextResponse.json(row ?? {});
  }

  const { taxYear, periodFrom, periodTo, notes } = body;
  const revenue = await computeRevenue(periodFrom, periodTo, ctx.tenantId);
  const deductions = await computeDeductions(periodFrom, periodTo, ctx.tenantId);
  const taxableIncome = Math.max(0, revenue - deductions);
  const isSBR = revenue <= 3_000_000;
  const aboveThreshold = Math.max(0, taxableIncome - 375_000);
  const ctLiability = isSBR ? 0 : Math.round(aboveThreshold * 0.09 * 100) / 100;
  const filingDeadline = `${taxYear + 1}-09-30`;

  const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `INSERT INTO finance_ct_returns
       (tax_year, period_from, period_to, revenue, allowable_deductions, taxable_income,
        taxable_above_threshold, ct_liability, balance_due, is_sbr_eligible, filing_deadline, notes, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12)
     RETURNING *`,
    taxYear,
    periodFrom,
    periodTo,
    Math.round(revenue * 100) / 100,
    Math.round(deductions * 100) / 100,
    Math.round(taxableIncome * 100) / 100,
    Math.round(aboveThreshold * 100) / 100,
    ctLiability,
    isSBR,
    filingDeadline,
    notes ?? null,
    ctx.tenantId,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create return' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceCorporateTaxReturn',
    entityId: String(row.id ?? ''),
    action: 'CREATE',
    after: row,
    summary: `Created corporate tax return for ${String(taxYear)}.`,
    riskSeverity: 'high',
  });
  return NextResponse.json(row, { status: 201 });
}
