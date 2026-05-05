/**
 * Collections & Dunning API — /api/finance/collections
 * AR Aging buckets, collection cases, dunning workflow
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT = `
  CREATE TABLE IF NOT EXISTS finance_collection_cases (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ,
    case_no            TEXT UNIQUE NOT NULL,
    invoice_id         TEXT NOT NULL,
    invoice_no         TEXT NOT NULL,
    client_name        TEXT NOT NULL,
    client_email       TEXT,
    client_phone       TEXT,
    invoice_amount     NUMERIC(15,2) NOT NULL,
    paid_amount        NUMERIC(15,2) DEFAULT 0,
    outstanding_amount NUMERIC(15,2) NOT NULL,
    due_date           DATE NOT NULL,
    days_overdue       INTEGER DEFAULT 0,
    status             TEXT DEFAULT 'OPEN',
    dunning_stage      TEXT,
    last_contact_date  DATE,
    promised_pay_date  DATE,
    promised_amount    NUMERIC(15,2),
    assigned_to        TEXT,
    notes              TEXT,
    timeline           JSONB DEFAULT '[]'::jsonb
  );
`;

type CaseRow = Record<string, unknown>;

async function nextCaseNo(): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_collection_cases`
  ).catch(() => [{ count: '0' }]);
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(4, '0');
  const ym  = new Date().toISOString().slice(0, 7).replace('-', '');
  return `COL-${ym}-${seq}`;
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  const sp     = req.nextUrl.searchParams;
  const status = sp.get('status');
  const page   = Math.max(1, parseInt(sp.get('page')  ?? '1'));
  const limit  = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset = (page - 1) * limit;

  let where = `WHERE deleted_at IS NULL`;
  const params: unknown[] = [];
  let pi = 1;
  if (status) { where += ` AND status = $${pi++}`; params.push(status); }

  // Recalculate days_overdue on every fetch
  await prisma.$executeRawUnsafe(
    `UPDATE finance_collection_cases SET days_overdue = GREATEST(0, CURRENT_DATE - due_date), updated_at = NOW()
     WHERE deleted_at IS NULL AND status NOT IN ('SETTLED','WRITTEN_OFF','CLOSED')`
  ).catch(() => {});

  const [rows, aging] = await Promise.all([
    prisma.$queryRawUnsafe<CaseRow[]>(
      `SELECT * FROM finance_collection_cases ${where} ORDER BY days_overdue DESC LIMIT $${pi} OFFSET $${pi+1}`,
      ...params, limit, offset
    ).catch(() => []),
    prisma.$queryRawUnsafe<{bucket: string; count: string; total: string}[]>(
      `SELECT
         CASE WHEN days_overdue <= 0   THEN 'CURRENT'
              WHEN days_overdue <= 30  THEN '1-30'
              WHEN days_overdue <= 60  THEN '31-60'
              WHEN days_overdue <= 90  THEN '61-90'
              ELSE '90+'
         END as bucket,
         COUNT(*)::text as count,
         COALESCE(SUM(outstanding_amount),0)::text as total
       FROM finance_collection_cases
       WHERE deleted_at IS NULL AND status NOT IN ('SETTLED','WRITTEN_OFF','CLOSED')
       GROUP BY 1 ORDER BY 1`
    ).catch(() => []),
  ]);

  // Pull overdue from finance_invoices to auto-surface new debtors
  const overdueInvoices = await prisma.$queryRawUnsafe<{
    id: string; invoice_number: string; client_name: string; client_email: string;
    total_amount: string; paid_amount: string; due_date: string;
  }[]>(
    `SELECT id, invoice_number, client_name, client_email,
            total_amount::text, paid_amount::text, due_date
     FROM finance_invoices
     WHERE deleted_at IS NULL
       AND payment_status IN ('SENT','PARTIAL','OVERDUE')
       AND due_date < CURRENT_DATE
       AND id NOT IN (SELECT invoice_id FROM finance_collection_cases WHERE deleted_at IS NULL)
     ORDER BY due_date ASC LIMIT 20`
  ).catch(() => []);

  return NextResponse.json({ data: rows, aging, overdueInvoices, page, limit });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  const body   = await req.json();
  const caseNo = await nextCaseNo();

  const outstanding = parseFloat(body.invoiceAmount) - parseFloat(body.paidAmount ?? '0');
  const dueDate     = new Date(body.dueDate);
  const daysOverdue = Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86400000));

  const [row] = await prisma.$queryRawUnsafe<CaseRow[]>(
    `INSERT INTO finance_collection_cases
       (case_no, invoice_id, invoice_no, client_name, client_email, client_phone,
        invoice_amount, paid_amount, outstanding_amount, due_date, days_overdue, assigned_to, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    caseNo, body.invoiceId, body.invoiceNo, body.clientName,
    body.clientEmail ?? null, body.clientPhone ?? null,
    body.invoiceAmount, body.paidAmount ?? 0, outstanding,
    body.dueDate, daysOverdue, body.assignedTo ?? null, body.notes ?? null,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create collection case' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
