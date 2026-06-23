/**
 * PDC Register API — /api/finance/pdc
 * Manages Post-Dated Cheques: INCOMING (from clients) and OUTGOING (to suppliers)
 * UAE-specific: Held → Deposited → Cleared | Bounced lifecycle
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

const INIT = `
  CREATE TABLE IF NOT EXISTS finance_pdc_cheques (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ,
    cheque_number    TEXT NOT NULL,
    bank_name        TEXT NOT NULL,
    account_name     TEXT,
    cheque_date      DATE NOT NULL,
    amount           NUMERIC(15,2) NOT NULL,
    currency         TEXT DEFAULT 'AED',
    direction        TEXT DEFAULT 'INCOMING',
    client_name      TEXT,
    client_ref       TEXT,
    status           TEXT DEFAULT 'HELD',
    deposited_at     TIMESTAMPTZ,
    cleared_at       TIMESTAMPTZ,
    bounced_at       TIMESTAMPTZ,
    bounce_reason    TEXT,
    linked_invoice_id TEXT,
    notes            TEXT,
    created_by       TEXT
  );
`;

const MIGRATE = `
  ALTER TABLE finance_pdc_cheques ADD COLUMN IF NOT EXISTS tenant_id TEXT;
`;

type PdcRow = {
  id: string; created_at: string; cheque_number: string; bank_name: string;
  account_name: string | null; cheque_date: string; amount: string; currency: string;
  direction: string; client_name: string | null; client_ref: string | null;
  status: string; deposited_at: string | null; cleared_at: string | null;
  bounced_at: string | null; bounce_reason: string | null;
  linked_invoice_id: string | null; notes: string | null; created_by: string | null;
};

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await prisma.$executeRawUnsafe(MIGRATE).catch(() => {});
  await ensureOperationalTenantColumn('finance_pdc_cheques').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const direction = sp.get('direction');
  const from = sp.get('from');
  const to   = sp.get('to');
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset = (page - 1) * limit;

  let where = `WHERE deleted_at IS NULL AND tenant_id::text = $1`;
  const params: unknown[] = [ctx.tenantId];
  let pi = 2;
  if (status)    { where += ` AND status = $${pi++}`;         params.push(status); }
  if (direction) { where += ` AND direction = $${pi++}`;      params.push(direction); }
  if (from)      { where += ` AND cheque_date >= $${pi++}`;   params.push(from); }
  if (to)        { where += ` AND cheque_date <= $${pi++}`;   params.push(to); }

  const [rows, counts] = await Promise.all([
    prisma.$queryRawUnsafe<PdcRow[]>(
      `SELECT * FROM finance_pdc_cheques ${where} ORDER BY cheque_date ASC LIMIT $${pi} OFFSET $${pi+1}`,
      ...params, limit, offset
    ).catch(() => [] as PdcRow[]),
    prisma.$queryRawUnsafe<{status: string; count: string; total: string}[]>(
      `SELECT status, COUNT(*) as count, COALESCE(SUM(amount),0)::text as total
         FROM finance_pdc_cheques WHERE deleted_at IS NULL GROUP BY status`
    ).catch(() => []),
  ]);

  // Maturity alerts: cheques due within 7 days still HELD
  const today = new Date();
  const in7   = new Date(today); in7.setDate(today.getDate() + 7);
  const maturingSoon = rows.filter(r =>
    r.status === 'HELD' && new Date(r.cheque_date) >= today && new Date(r.cheque_date) <= in7
  ).length;

  return NextResponse.json({ data: rows, counts, maturingSoon, page, limit });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await prisma.$executeRawUnsafe(MIGRATE).catch(() => {});
  await ensureOperationalTenantColumn('finance_pdc_cheques').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();

  const [row] = await prisma.$queryRawUnsafe<PdcRow[]>(
    `INSERT INTO finance_pdc_cheques
       (cheque_number, bank_name, account_name, cheque_date, amount, currency,
        direction, client_name, client_ref, linked_invoice_id, notes, created_by, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    body.chequeNumber, body.bankName, body.accountName ?? null,
    body.chequeDate, body.amount, body.currency ?? 'AED',
    body.direction ?? 'INCOMING', body.clientName ?? null,
    body.clientRef ?? null, body.linkedInvoiceId ?? null,
    body.notes ?? null, body.createdBy ?? null, ctx.tenantId,
  ).catch(() => [] as PdcRow[]);

  if (!row) return NextResponse.json({ error: 'Failed to create cheque' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinancePdcCheque',
    entityId: row.id,
    action: 'CREATE',
    after: row,
    summary: `Created PDC cheque ${row.cheque_number}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: row.direction === 'OUTGOING' ? 'FINANCE_BILLING_EXCEPTION' : 'FINANCE_RECEIVABLE_EXCEPTION',
    referenceType: 'PdcCheque',
    referenceId: row.id,
    referenceNumber: row.cheque_number,
    contextData: {
      action: 'create',
      status: row.status,
      direction: row.direction,
      amount: row.amount,
      clientName: row.client_name,
      linkedInvoiceId: row.linked_invoice_id,
    },
  });
  return NextResponse.json({ ...row, workflow }, { status: 201 });
}
