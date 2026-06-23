import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertCanWrite } from '@/lib/access-control';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { createCashReceipt, ensureCashAllocationTables } from '@/lib/finance/cash-allocation';

/**
 * GET  /api/finance/payments — list all payments with invoice reconciliation data
 * POST /api/finance/payments — record a payment and reconcile against finance_invoices
 */

async function ensureTables() {
  await ensureCashAllocationTables();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_payments (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id     UUID,
      amount         NUMERIC(14,2) NOT NULL,
      payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
      payment_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
      reference      TEXT,
      notes          TEXT,
      tenant_id      TEXT,
      customer_name  TEXT,
      customer_email TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS customer_name TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS customer_email TEXT;
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_invoices (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_number   TEXT NOT NULL UNIQUE,
      client_name      TEXT NOT NULL,
      client_email     TEXT,
      service_type     TEXT NOT NULL DEFAULT 'GENERAL',
      module           TEXT NOT NULL DEFAULT 'GENERAL',
      subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0,
      discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
      vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 5,
      vat_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
      paid_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'AED',
      issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
      due_date         DATE,
      payment_status   TEXT NOT NULL DEFAULT 'DRAFT',
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at       TIMESTAMPTZ
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT
  `).catch(() => {});
}

export async function GET(req: NextRequest) {
  await ensureTables();
  const { searchParams } = new URL(req.url);
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const invoiceId = searchParams.get('invoiceId') ?? '';
  const q         = searchParams.get('q') ?? '';
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit     = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const offset    = (page - 1) * limit;

  const conditions: string[] = [`p.tenant_id::text = $1`];
  const values: unknown[] = [ctx.tenantId];

  if (invoiceId) {
    values.push(invoiceId);
    conditions.push(`p.invoice_id = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    const i = values.length;
    conditions.push(`(i.invoice_number ILIKE $${i} OR i.client_name ILIKE $${i} OR p.reference ILIKE $${i})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  type PayRow = Record<string, unknown>;
  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<PayRow[]>(
      `SELECT p.id, p.invoice_id, p.amount, p.payment_date, p.payment_method,
              p.reference, p.notes, p.created_at,
              i.invoice_number, i.client_name, i.total_amount,
              i.paid_amount, i.payment_status, i.currency
         FROM finance_payments p
         LEFT JOIN finance_invoices i ON i.id = p.invoice_id
         ${where}
        ORDER BY p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      ...values
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM finance_payments p
         LEFT JOIN finance_invoices i ON i.id = p.invoice_id
        ${where}`,
      ...values
    ),
  ]);

  const fmt = (d: unknown) => d ? (d as Date)?.toISOString?.() ?? d : null;
  const fmtDate = (d: unknown) => d ? String((d as Date)?.toISOString?.().split('T')[0] ?? d) : null;

  const enriched = rows.map(r => ({
    ...r,
    payment_date: fmtDate(r.payment_date),
    created_at: fmt(r.created_at),
  }));

  // Summary stats
  type SumRow = { total_paid: number | null; count: bigint };
  const [summary] = await prisma.$queryRawUnsafe<SumRow[]>(
    `SELECT COALESCE(SUM(p.amount),0) as total_paid, COUNT(*) as count
       FROM finance_payments p
       LEFT JOIN finance_invoices i ON i.id = p.invoice_id
      WHERE p.tenant_id::text = $1`,
    ctx.tenantId,
  ).catch(() => [{ total_paid: 0, count: BigInt(0) }]);

  return NextResponse.json({
    data:       enriched,
    total:      Number(countRows[0]?.count ?? 0),
    page,
    limit,
    totalPaid:  Number(summary?.total_paid ?? 0),
    totalCount: Number(summary?.count ?? 0),
  });
}

export async function POST(req: NextRequest) {
  const guard = assertCanWrite(req, 'finance');
  if (guard) return guard;
  await ensureTables();

  try {
    const ctx = requireOperationalContext(req, 'finance', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const {
      invoiceId, amount, paymentDate, paymentMethod = 'BANK_TRANSFER', reference, notes, customerName, customerEmail,
    } = body;

    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });

    let resolvedCustomerName: string | null = customerName ?? null;
    let resolvedCustomerEmail: string | null = customerEmail ?? null;
    if (invoiceId) {
      const [invoice] = await prisma.$queryRawUnsafe<{ client_name: string | null; client_email: string | null }[]>(
        `SELECT client_name, client_email FROM finance_invoices WHERE id = $1 AND deleted_at IS NULL AND tenant_id::text = $2`,
        invoiceId,
        ctx.tenantId,
      ).catch(() => []);
      resolvedCustomerName = invoice?.client_name ?? resolvedCustomerName;
      resolvedCustomerEmail = invoice?.client_email ?? resolvedCustomerEmail;
    }
    const result = await createCashReceipt(req, ctx, {
      customerName: resolvedCustomerName,
      customerEmail: resolvedCustomerEmail,
      amount: Number(amount),
      receiptDate: paymentDate ?? new Date().toISOString().split('T')[0],
      paymentMethod,
      reference,
      notes,
      allocations: invoiceId ? [{ invoiceId, amount: Number(amount) }] : [],
      source: 'PAYMENT_ENDPOINT',
    });

    const firstInvoice = result.allocations?.[0]?.after as { payment_status?: string } | undefined;
    return NextResponse.json({
      success: true,
      id: result.receiptId,
      receiptNo: result.receiptNo,
      voucherNo: result.voucherNo,
      newInvoiceStatus: firstInvoice?.payment_status ?? null,
    }, { status: 201 });
  } catch (err) {
    console.error('[finance/payments POST]', err);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
