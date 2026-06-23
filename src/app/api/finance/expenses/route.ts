/**
 * Expense Management API — /api/finance/expenses
 * Handles operational expenses with approval workflow: DRAFT→SUBMITTED→APPROVED/REJECTED→PAID
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

const INIT = `
  CREATE TABLE IF NOT EXISTS finance_expenses (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ,
    expense_no       TEXT UNIQUE NOT NULL,
    category         TEXT NOT NULL,
    sub_category     TEXT,
    description      TEXT NOT NULL,
    amount           NUMERIC(15,2) NOT NULL,
    currency         TEXT DEFAULT 'AED',
    vat_amount       NUMERIC(15,2) DEFAULT 0,
    total_amount     NUMERIC(15,2) NOT NULL,
    expense_date     DATE NOT NULL,
    payment_method   TEXT,
    reference_no     TEXT,
    status           TEXT DEFAULT 'DRAFT',
    vehicle_id       TEXT,
    driver_id        TEXT,
    cost_centre      TEXT,
    receipt_url      TEXT,
    submitted_by     TEXT,
    submitted_at     TIMESTAMPTZ,
    approved_by      TEXT,
    approved_at      TIMESTAMPTZ,
    rejected_by      TEXT,
    rejected_at      TIMESTAMPTZ,
    rejection_reason TEXT,
    paid_at          TIMESTAMPTZ,
    notes            TEXT
  );
`;

const MIGRATE = `
  ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS branch_id UUID;
  ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) DEFAULT 0;
  ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS tenant_id TEXT;
`;

type ExpRow = Record<string, unknown>;

async function nextExpenseNo(): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_expenses`
  ).catch(() => [{ count: '0' }]);
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(4, '0');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `EXP-${ym}-${seq}`;
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await prisma.$executeRawUnsafe(MIGRATE).catch(() => {});
  const sp = req.nextUrl.searchParams;
  const status    = sp.get('status');
  const category  = sp.get('category');
  const centre    = sp.get('costCentre');
  const from      = sp.get('from');
  const to        = sp.get('to');
  const page      = Math.max(1, parseInt(sp.get('page')  ?? '1'));
  const limit     = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset    = (page - 1) * limit;

  let where = `WHERE deleted_at IS NULL`;
  const params: unknown[] = [];
  let pi = 1;
  if (status)   { where += ` AND status = $${pi++}`;          params.push(status); }
  if (category) { where += ` AND category = $${pi++}`;        params.push(category); }
  if (centre)   { where += ` AND cost_centre = $${pi++}`;     params.push(centre); }
  if (from)     { where += ` AND expense_date >= $${pi++}`;   params.push(from); }
  if (to)       { where += ` AND expense_date <= $${pi++}`;   params.push(to); }

  const [rows, summary] = await Promise.all([
    prisma.$queryRawUnsafe<ExpRow[]>(
      `SELECT * FROM finance_expenses ${where} ORDER BY expense_date DESC, created_at DESC LIMIT $${pi} OFFSET $${pi+1}`,
      ...params, limit, offset
    ).catch(() => []),
    prisma.$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
      `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_amount),0)::text as total
         FROM finance_expenses WHERE deleted_at IS NULL GROUP BY status`
    ).catch(() => []),
    prisma.$queryRawUnsafe<{ category: string; total: string }[]>(
      `SELECT category, COALESCE(SUM(total_amount),0)::text as total
         FROM finance_expenses WHERE deleted_at IS NULL AND status IN ('APPROVED','PAID')
         GROUP BY category ORDER BY total DESC`
    ).catch(() => []),
  ]);

  return NextResponse.json({ data: rows, summary, page, limit });
}

export async function POST(req: NextRequest) {
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await prisma.$executeRawUnsafe(MIGRATE).catch(() => {});
  const body = await req.json();
  const expenseNo = await nextExpenseNo();

  const vatAmt   = parseFloat(body.vatAmount ?? '0');
  const amount   = parseFloat(body.amount ?? '0');
  const total    = amount + vatAmt;

  const [row] = await prisma.$queryRawUnsafe<ExpRow[]>(
    `INSERT INTO finance_expenses
       (expense_no, category, sub_category, description, amount, currency,
       vat_amount, total_amount, expense_date, payment_method, reference_no,
        vehicle_id, driver_id, cost_centre, receipt_url, submitted_by, notes, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    expenseNo, body.category, body.subCategory ?? null, body.description,
    amount, body.currency ?? 'AED', vatAmt, total,
    body.expenseDate, body.paymentMethod ?? null, body.referenceNo ?? null,
    body.vehicleId ?? null, body.driverId ?? null, body.costCentre ?? null,
    body.receiptUrl ?? null, body.submittedBy ?? null, body.notes ?? null, ctx.tenantId,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_EXPENSE_EXCEPTION',
    referenceType: 'FinanceExpense',
    referenceId: String(row.id),
    referenceNumber: String(row.expense_no ?? row.id),
    contextData: {
      amount,
      totalAmount: total,
      category: body.category,
      costCentre: body.costCentre ?? null,
      status: row.status ?? 'DRAFT',
    },
  });
  return NextResponse.json({ ...row, workflow }, { status: 201 });
}
