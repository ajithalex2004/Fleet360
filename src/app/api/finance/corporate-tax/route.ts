/**
 * UAE Corporate Tax API — /api/finance/corporate-tax
 * UAE CT: 9% on taxable income above AED 375,000 threshold (Small Business Relief up to AED 3M revenue)
 * FTA return periods, exemptions, tax group registration
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT_CT = `
  CREATE TABLE IF NOT EXISTS finance_ct_returns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    tax_year        INTEGER NOT NULL,
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL,
    status          TEXT DEFAULT 'DRAFT',   -- DRAFT | FILED | AMENDED | ASSESSED
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
    is_sbr_eligible BOOLEAN DEFAULT FALSE,  -- Small Business Relief
    sbr_threshold   NUMERIC(15,2) DEFAULT 3000000,
    filing_deadline DATE,
    filed_at        TIMESTAMPTZ,
    notes           TEXT
  );
`;

const INIT_CT_ADJ = `
  CREATE TABLE IF NOT EXISTS finance_ct_adjustments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    return_id       TEXT NOT NULL,
    adj_type        TEXT NOT NULL,   -- ADD_BACK | DEDUCTION | EXEMPT | TRANSFER_PRICE
    description     TEXT NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    reference       TEXT,
    notes           TEXT
  );
`;

function toN(v: unknown): number { return parseFloat(String(v ?? 0)) || 0; }

async function computeRevenue(from: string, to: string): Promise<number> {
  const [rev] = await prisma.$queryRawUnsafe<{t:string}[]>(
    `SELECT COALESCE(SUM(subtotal_amount),0)::text as t FROM finance_invoices
     WHERE deleted_at IS NULL AND issue_date BETWEEN $1 AND $2
       AND payment_status NOT IN ('DRAFT','CANCELLED')`, from, to
  ).catch(()=>[{t:'0'}]);
  const [rac] = await prisma.$queryRawUnsafe<{t:string}[]>(
    `SELECT COALESCE(SUM(total_amount),0)::text as t FROM rental_invoices
     WHERE deleted_at IS NULL AND created_at::date BETWEEN $1 AND $2`, from, to
  ).catch(()=>[{t:'0'}]);
  const [lg] = await prisma.$queryRawUnsafe<{t:string}[]>(
    `SELECT COALESCE(SUM(total_amount),0)::text as t FROM logistics_bookings
     WHERE deleted_at IS NULL AND status IN ('DELIVERED','CLOSED') AND created_at::date BETWEEN $1 AND $2`, from, to
  ).catch(()=>[{t:'0'}]);
  return toN(rev?.t) + toN(rac?.t) + toN(lg?.t);
}

async function computeDeductions(from: string, to: string): Promise<number> {
  const [fuel]  = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_cost),0)::text as t FROM fuel_logs WHERE created_at::date BETWEEN $1 AND $2`, from, to).catch(()=>[{t:'0'}]);
  const [maint] = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_cost),0)::text as t FROM maintenance_requests WHERE deleted_at IS NULL AND status='COMPLETED' AND created_at::date BETWEEN $1 AND $2`, from, to).catch(()=>[{t:'0'}]);
  const [dep]   = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(depreciation),0)::text as t FROM finance_depreciation_schedule WHERE period_year || '-' || LPAD(period_month::text,2,'0') || '-01' BETWEEN $1 AND $2`, from, to).catch(()=>[{t:'0'}]);
  const [exp]   = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_amount),0)::text as t FROM finance_expenses WHERE deleted_at IS NULL AND status IN ('APPROVED','PAID') AND expense_date BETWEEN $1 AND $2`, from, to).catch(()=>[{t:'0'}]);
  return toN(fuel?.t) + toN(maint?.t) + toN(dep?.t) + toN(exp?.t);
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_CT).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_CT_ADJ).catch(()=>{});

  const sp   = req.nextUrl.searchParams;
  const type = sp.get('type') ?? 'returns';

  if (type === 'estimate') {
    const year = parseInt(sp.get('year') ?? String(new Date().getFullYear()));
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;

    const [revenue, deductions, returns] = await Promise.all([
      computeRevenue(from, to),
      computeDeductions(from, to),
      prisma.$queryRawUnsafe<{adj_type:string; amount:string}[]>(
        `SELECT adj_type, SUM(amount)::text as amount FROM finance_ct_adjustments WHERE return_id IN (
           SELECT id::text FROM finance_ct_returns WHERE tax_year=$1 AND deleted_at IS NULL
         ) GROUP BY adj_type`, year
      ).catch(()=>[]),
    ]);

    const addBacks   = returns.filter(r => r.adj_type === 'ADD_BACK').reduce((s,r) => s + toN(r.amount), 0);
    const extraDeduct = returns.filter(r => r.adj_type === 'DEDUCTION').reduce((s,r) => s + toN(r.amount), 0);
    const exempt     = returns.filter(r => r.adj_type === 'EXEMPT').reduce((s,r) => s + toN(r.amount), 0);

    const isSBREligible  = revenue <= 3_000_000;
    const taxableIncome  = Math.max(0, revenue - deductions + addBacks - extraDeduct - exempt);
    const threshold      = 375_000;
    const aboveThreshold = Math.max(0, taxableIncome - threshold);
    const ctLiability    = isSBREligible ? 0 : Math.round(aboveThreshold * 0.09 * 100) / 100;
    const effectiveRate  = taxableIncome > 0 ? Math.round((ctLiability / taxableIncome) * 1000) / 10 : 0;

    return NextResponse.json({
      year, revenue: Math.round(revenue*100)/100, deductions: Math.round(deductions*100)/100,
      addBacks, extraDeductions: extraDeduct, exemptIncome: exempt,
      taxableIncome: Math.round(taxableIncome*100)/100,
      threshold, aboveThreshold: Math.round(aboveThreshold*100)/100,
      ctRate: 9, ctLiability, effectiveRate,
      isSBREligible, sbrThreshold: 3_000_000,
      filingDeadline: `${year + 1}-09-30`,  // 9 months after FY end
    });
  }

  if (type === 'adjustments') {
    const returnId = sp.get('returnId');
    if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 });
    const rows = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `SELECT * FROM finance_ct_adjustments WHERE return_id=$1 ORDER BY created_at`, returnId
    ).catch(()=>[]);
    return NextResponse.json({ data: rows });
  }

  // Default: list returns
  const returns = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
    `SELECT * FROM finance_ct_returns WHERE deleted_at IS NULL ORDER BY tax_year DESC, period_from DESC`
  ).catch(()=>[]);
  return NextResponse.json({ data: returns });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_CT).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_CT_ADJ).catch(()=>{});

  const body = await req.json();

  if (body.action === 'add_adjustment') {
    const { returnId, adjType, description, amount, reference, notes } = body;
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `INSERT INTO finance_ct_adjustments (return_id, adj_type, description, amount, reference, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      returnId, adjType, description, amount, reference ?? null, notes ?? null
    ).catch(()=>[]);
    return NextResponse.json(row ?? {}, { status: 201 });
  }

  if (body.action === 'file') {
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_ct_returns SET status='FILED', filed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`, body.returnId
    ).catch(()=>[]);
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'record_payment') {
    const { returnId, amount } = body;
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_ct_returns SET tax_paid=$2, balance_due=ct_liability-$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
      returnId, amount
    ).catch(()=>[]);
    return NextResponse.json(row ?? {});
  }

  // Create return
  const { taxYear, periodFrom, periodTo, notes } = body;
  const revenue    = await computeRevenue(periodFrom, periodTo);
  const deductions = await computeDeductions(periodFrom, periodTo);
  const taxableIncome   = Math.max(0, revenue - deductions);
  const isSBR           = revenue <= 3_000_000;
  const aboveThreshold  = Math.max(0, taxableIncome - 375_000);
  const ctLiability     = isSBR ? 0 : Math.round(aboveThreshold * 0.09 * 100) / 100;
  const filingDeadline  = `${taxYear + 1}-09-30`;

  const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
    `INSERT INTO finance_ct_returns
       (tax_year, period_from, period_to, revenue, allowable_deductions, taxable_income,
        taxable_above_threshold, ct_liability, balance_due, is_sbr_eligible, filing_deadline, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11) RETURNING *`,
    taxYear, periodFrom, periodTo,
    Math.round(revenue*100)/100, Math.round(deductions*100)/100, Math.round(taxableIncome*100)/100,
    Math.round(aboveThreshold*100)/100, ctLiability,
    isSBR, filingDeadline, notes ?? null
  ).catch(()=>[]);

  if (!row) return NextResponse.json({ error: 'Failed to create return' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
