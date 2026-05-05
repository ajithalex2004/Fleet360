/**
 * Enhanced Credit Notes API — /api/finance/credit-notes
 * Full lifecycle: DRAFT → ISSUED → APPLIED | REFUNDED | VOIDED
 * Linked to finance_invoices, with reason codes and line items
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT = `
  CREATE TABLE IF NOT EXISTS finance_credit_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    cn_number           TEXT UNIQUE NOT NULL,
    original_invoice_id TEXT,
    original_invoice_no TEXT,
    client_name         TEXT NOT NULL,
    client_email        TEXT,
    module              TEXT,
    reason_code         TEXT NOT NULL,
    reason_detail       TEXT,
    line_items          JSONB,
    subtotal            NUMERIC(15,2) NOT NULL,
    vat_amount          NUMERIC(15,2) DEFAULT 0,
    total_amount        NUMERIC(15,2) NOT NULL,
    currency            TEXT DEFAULT 'AED',
    issue_date          DATE NOT NULL,
    status              TEXT DEFAULT 'DRAFT',
    applied_amount      NUMERIC(15,2) DEFAULT 0,
    refunded_at         TIMESTAMPTZ,
    refund_method       TEXT,
    issued_by           TEXT,
    approved_by         TEXT,
    notes               TEXT
  );
`;

type CnRow = Record<string, unknown>;

async function nextCnNumber(): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_credit_notes`
  ).catch(() => [{ count: '0' }]);
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(4, '0');
  const ym  = new Date().toISOString().slice(0, 7).replace('-', '');
  return `CN-${ym}-${seq}`;
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  const sp      = req.nextUrl.searchParams;
  const status  = sp.get('status');
  const module  = sp.get('module');
  const page    = Math.max(1, parseInt(sp.get('page')  ?? '1'));
  const limit   = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset  = (page - 1) * limit;

  let where = `WHERE deleted_at IS NULL`;
  const params: unknown[] = [];
  let pi = 1;
  if (status) { where += ` AND status = $${pi++}`;  params.push(status); }
  if (module) { where += ` AND module = $${pi++}`;  params.push(module); }

  const [rows, counts] = await Promise.all([
    prisma.$queryRawUnsafe<CnRow[]>(
      `SELECT * FROM finance_credit_notes ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`,
      ...params, limit, offset
    ).catch(() => []),
    prisma.$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
      `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_amount),0)::text as total
         FROM finance_credit_notes WHERE deleted_at IS NULL GROUP BY status`
    ).catch(() => []),
  ]);

  return NextResponse.json({ data: rows, counts, page, limit });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  const body    = await req.json();
  const cnNumber = await nextCnNumber();

  const lineItems  = body.lineItems ?? [];
  const subtotal   = lineItems.reduce((s: number, l: { total: number }) => s + (l.total ?? 0), 0) || parseFloat(body.subtotal ?? '0');
  const vatAmount  = parseFloat(body.vatAmount ?? '0') || Math.round(subtotal * 0.05 * 100) / 100;
  const total      = subtotal + vatAmount;

  const [row] = await prisma.$queryRawUnsafe<CnRow[]>(
    `INSERT INTO finance_credit_notes
       (cn_number, original_invoice_id, original_invoice_no, client_name, client_email,
        module, reason_code, reason_detail, line_items, subtotal, vat_amount, total_amount,
        currency, issue_date, issued_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    cnNumber,
    body.originalInvoiceId ?? null, body.originalInvoiceNo ?? null,
    body.clientName, body.clientEmail ?? null,
    body.module ?? null, body.reasonCode, body.reasonDetail ?? null,
    JSON.stringify(lineItems), subtotal, vatAmount, total,
    body.currency ?? 'AED',
    body.issueDate ?? new Date().toISOString().slice(0, 10),
    body.issuedBy ?? null, body.notes ?? null,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create credit note' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
