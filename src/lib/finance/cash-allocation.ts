import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  recordOperationalChange,
  type OperationalContext,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';
import { ensureFinanceStatementTables } from '@/lib/finance/customer-statement';

type SqlClient = typeof prisma;

type InvoiceRow = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  total_amount: string | number;
  paid_amount: string | number;
  currency: string | null;
  due_date: string | Date | null;
  issue_date: string | Date | null;
  payment_status: string | null;
  outstanding: string | number;
};

export type CashAllocationInput = {
  invoiceId: string;
  amount: number;
};

export type CreateCashReceiptInput = {
  customerName?: string | null;
  customerEmail?: string | null;
  amount: number;
  currency?: string | null;
  receiptDate?: string | null;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  allocations?: CashAllocationInput[];
  autoAllocate?: boolean;
  autoAllocateBy?: 'AGE' | 'DUE_DATE';
  bankStatementLineId?: string | null;
  source?: string | null;
};

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDate(value?: string | null) {
  return value || new Date().toISOString().split('T')[0];
}

function normalizeCustomer(value?: string | null) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? Number(nested) : nested);
}

async function nextNumber(client: SqlClient, table: string, column: string, prefix: string, tenantId: string) {
  const [row] = await client.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${column} LIKE $1 AND tenant_id::text = $2`,
    `${prefix}-%`,
    tenantId,
  ).catch(() => [{ count: '0' }]);
  return `${prefix}-${String(Number(row?.count ?? 0) + 1).padStart(5, '0')}`;
}

export async function ensureCashAllocationTables(client: SqlClient = prisma) {
  await ensureFinanceStatementTables();
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_cash_receipts (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_no              TEXT UNIQUE NOT NULL,
      voucher_no              TEXT UNIQUE NOT NULL,
      tenant_id               TEXT,
      customer_name           TEXT NOT NULL,
      customer_email          TEXT,
      amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
      allocated_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
      unapplied_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
      currency                TEXT NOT NULL DEFAULT 'AED',
      receipt_date            DATE NOT NULL DEFAULT CURRENT_DATE,
      payment_method          TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
      reference               TEXT,
      bank_statement_line_id  TEXT,
      source                  TEXT NOT NULL DEFAULT 'MANUAL',
      status                  TEXT NOT NULL DEFAULT 'UNAPPLIED',
      notes                   TEXT,
      created_by              TEXT,
      reversed_at             TIMESTAMPTZ,
      reversed_by             TEXT,
      reversal_reason         TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at              TIMESTAMPTZ
    )
  `).catch(() => {});

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_cash_allocations (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_id          UUID NOT NULL REFERENCES finance_cash_receipts(id) ON DELETE CASCADE,
      invoice_id          UUID NOT NULL,
      invoice_no          TEXT,
      allocated_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
      allocation_method   TEXT NOT NULL DEFAULT 'MANUAL',
      allocation_date     DATE NOT NULL DEFAULT CURRENT_DATE,
      status              TEXT NOT NULL DEFAULT 'ACTIVE',
      tenant_id           TEXT,
      created_by          TEXT,
      reversed_at         TIMESTAMPTZ,
      reversed_by         TEXT,
      reversal_reason     TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_receipt_vouchers (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      voucher_no      TEXT UNIQUE NOT NULL,
      receipt_id      UUID REFERENCES finance_cash_receipts(id) ON DELETE SET NULL,
      tenant_id       TEXT,
      voucher_type    TEXT NOT NULL DEFAULT 'RECEIPT',
      status          TEXT NOT NULL DEFAULT 'ACTIVE',
      payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      generated_by    TEXT
    )
  `).catch(() => {});

  await client.$executeRawUnsafe(`
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

  await client.$executeRawUnsafe(`
    ALTER TABLE finance_payments ALTER COLUMN invoice_id DROP NOT NULL;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS customer_name TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS customer_email TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS cash_receipt_id UUID;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS cash_allocation_id UUID;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS receipt_no TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS voucher_no TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  `).catch(() => {});

  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_finance_cash_receipts_tenant ON finance_cash_receipts(tenant_id, receipt_date DESC)`).catch(() => {});
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_finance_cash_receipts_customer ON finance_cash_receipts(tenant_id, customer_name)`).catch(() => {});
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_finance_cash_allocations_receipt ON finance_cash_allocations(receipt_id, status)`).catch(() => {});
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_finance_cash_allocations_invoice ON finance_cash_allocations(invoice_id, status)`).catch(() => {});
}

export async function getOpenInvoices(
  tenantId: string,
  options: { customerName?: string | null; orderBy?: 'AGE' | 'DUE_DATE'; limit?: number } = {},
) {
  await ensureCashAllocationTables();
  const params: unknown[] = [tenantId];
  let where = `
    i.deleted_at IS NULL
    AND i.tenant_id::text = $1
    AND i.payment_status NOT IN ('PAID','CANCELLED','DRAFT')
  `;
  const customer = normalizeCustomer(options.customerName);
  if (customer) {
    params.push(customer.toLowerCase());
    where += ` AND lower(trim(i.client_name)) = $${params.length}`;
  }
  const order = options.orderBy === 'AGE'
    ? `COALESCE(i.due_date, i.issue_date) ASC NULLS LAST, i.created_at ASC`
    : `i.due_date ASC NULLS LAST, i.issue_date ASC NULLS LAST, i.created_at ASC`;

  return prisma.$queryRawUnsafe<InvoiceRow[]>(
    `WITH credit_note_net AS (
       SELECT COALESCE(original_invoice_id, original_invoice_no) AS invoice_match_key,
              COALESCE(SUM(total_amount),0)::numeric AS credit_note_amount
         FROM finance_credit_notes
        WHERE deleted_at IS NULL
          AND tenant_id::text = $1
          AND status NOT IN ('DRAFT','VOIDED')
        GROUP BY COALESCE(original_invoice_id, original_invoice_no)
     )
     SELECT i.id::text,
            i.invoice_number,
            i.client_name,
            i.client_email,
            i.client_phone,
            i.total_amount::text,
            i.paid_amount::text,
            i.currency,
            i.due_date,
            i.issue_date,
            i.payment_status,
            GREATEST(0, i.total_amount - i.paid_amount - COALESCE(cn.credit_note_amount, 0))::text AS outstanding
       FROM finance_invoices i
       LEFT JOIN credit_note_net cn
         ON cn.invoice_match_key = i.id::text
         OR cn.invoice_match_key = i.invoice_number
      WHERE ${where}
        AND GREATEST(0, i.total_amount - i.paid_amount - COALESCE(cn.credit_note_amount, 0)) > 0
      ORDER BY ${order}
      LIMIT ${Math.max(1, Math.min(Number(options.limit ?? 100), 300))}`,
    ...params,
  ).catch(() => []);
}

async function recalculateInvoicePaid(client: SqlClient, tenantId: string, invoiceId: string) {
  const [updated] = await client.$queryRawUnsafe<Record<string, unknown>[]>(
    `WITH active_allocations AS (
       SELECT COALESCE(SUM(allocated_amount),0)::numeric AS amount
         FROM finance_cash_allocations
        WHERE invoice_id::text = $1
          AND tenant_id::text = $2
          AND status = 'ACTIVE'
     ),
     legacy_payments AS (
       SELECT COALESCE(SUM(amount),0)::numeric AS amount
         FROM finance_payments
        WHERE invoice_id::text = $1
          AND tenant_id::text = $2
          AND cash_allocation_id IS NULL
          AND COALESCE(status, 'ACTIVE') <> 'REVERSED'
          AND deleted_at IS NULL
     ),
     totals AS (
       SELECT (active_allocations.amount + legacy_payments.amount)::numeric AS paid
         FROM active_allocations, legacy_payments
     )
     UPDATE finance_invoices i
        SET paid_amount = LEAST(i.total_amount, totals.paid),
            payment_status = CASE
              WHEN i.payment_status = 'CANCELLED' THEN 'CANCELLED'
              WHEN totals.paid >= i.total_amount THEN 'PAID'
              WHEN totals.paid > 0 THEN 'PARTIAL'
              WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'OVERDUE'
              ELSE i.payment_status
            END,
            updated_at = NOW()
       FROM totals
      WHERE i.id::text = $1
        AND i.tenant_id::text = $2
      RETURNING i.*`,
    invoiceId,
    tenantId,
  ).catch(() => []);
  return updated ?? null;
}

async function refreshReceiptTotals(client: SqlClient, tenantId: string, receiptId: string) {
  const [receipt] = await client.$queryRawUnsafe<Record<string, unknown>[]>(
    `WITH totals AS (
       SELECT COALESCE(SUM(allocated_amount),0)::numeric AS allocated
         FROM finance_cash_allocations
        WHERE receipt_id::text = $1
          AND tenant_id::text = $2
          AND status = 'ACTIVE'
     )
     UPDATE finance_cash_receipts r
        SET allocated_amount = LEAST(r.amount, totals.allocated),
            unapplied_amount = GREATEST(0, r.amount - totals.allocated),
            status = CASE
              WHEN r.status = 'REVERSED' THEN 'REVERSED'
              WHEN totals.allocated <= 0 THEN 'UNAPPLIED'
              WHEN totals.allocated < r.amount THEN 'PARTIAL_ALLOCATED'
              ELSE 'ALLOCATED'
            END,
            updated_at = NOW()
       FROM totals
      WHERE r.id::text = $1
        AND r.tenant_id::text = $2
      RETURNING r.*`,
    receiptId,
    tenantId,
  ).catch(() => []);
  return receipt ?? null;
}

async function buildAutoAllocations(
  tenantId: string,
  customerName: string,
  availableAmount: number,
  orderBy: 'AGE' | 'DUE_DATE' = 'DUE_DATE',
) {
  const invoices = await getOpenInvoices(tenantId, { customerName, orderBy, limit: 200 });
  let remaining = roundMoney(availableAmount);
  const allocations: CashAllocationInput[] = [];
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, Number(invoice.outstanding ?? 0));
    if (amount > 0) {
      allocations.push({ invoiceId: invoice.id, amount: roundMoney(amount) });
      remaining = roundMoney(remaining - amount);
    }
  }
  return allocations;
}

async function normalizeAllocations(
  tenantId: string,
  customerName: string,
  amount: number,
  allocations: CashAllocationInput[] | undefined,
  autoAllocate?: boolean,
  autoAllocateBy?: 'AGE' | 'DUE_DATE',
) {
  if (autoAllocate) {
    return buildAutoAllocations(tenantId, customerName, amount, autoAllocateBy ?? 'DUE_DATE');
  }
  return (allocations ?? [])
    .map((item) => ({ invoiceId: String(item.invoiceId ?? ''), amount: roundMoney(Number(item.amount ?? 0)) }))
    .filter((item) => item.invoiceId && item.amount > 0);
}

export async function createCashReceipt(req: NextRequest, ctx: OperationalContext, input: CreateCashReceiptInput) {
  await ensureCashAllocationTables();
  const amount = roundMoney(Number(input.amount));
  if (!amount || amount <= 0) throw new Error('Receipt amount must be greater than zero');

  let customerName = normalizeCustomer(input.customerName);
  let customerEmail = input.customerEmail ?? null;
  const requestedAllocations = (input.allocations ?? []).filter((item) => item.invoiceId && Number(item.amount) > 0);
  if (!customerName && requestedAllocations.length > 0) {
    const [invoice] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `SELECT id::text, invoice_number, client_name, client_email, client_phone,
              total_amount::text, paid_amount::text, currency, due_date, issue_date,
              payment_status, GREATEST(0, total_amount - paid_amount)::text AS outstanding
         FROM finance_invoices
        WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
        LIMIT 1`,
      requestedAllocations[0].invoiceId,
      ctx.tenantId,
    ).catch(() => []);
    customerName = normalizeCustomer(invoice?.client_name);
    customerEmail = invoice?.client_email ?? null;
  }
  if (!customerName) customerName = 'Unapplied Customer Receipt';

  const allocations = await normalizeAllocations(
    ctx.tenantId,
    customerName,
    amount,
    requestedAllocations,
    input.autoAllocate,
    input.autoAllocateBy,
  );
  const allocationTotal = roundMoney(allocations.reduce((sum, item) => sum + item.amount, 0));
  if (allocationTotal > amount) throw new Error('Allocation amount cannot exceed receipt amount');

  const receiptDate = isoDate(input.receiptDate);
  const prefix = `RCPT-${new Date(receiptDate).toISOString().slice(2, 7).replace('-', '')}`;
  const voucherPrefix = `RV-${new Date(receiptDate).toISOString().slice(2, 7).replace('-', '')}`;
  const receiptNo = await nextNumber(prisma, 'finance_cash_receipts', 'receipt_no', prefix, ctx.tenantId);
  const voucherNo = await nextNumber(prisma, 'finance_receipt_vouchers', 'voucher_no', voucherPrefix, ctx.tenantId);

  return prisma.$transaction(async (tx) => {
    const [receipt] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
      `INSERT INTO finance_cash_receipts
         (receipt_no, voucher_no, tenant_id, customer_name, customer_email, amount,
          allocated_amount, unapplied_amount, currency, receipt_date, payment_method,
          reference, bank_statement_line_id, source, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,0,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      receiptNo,
      voucherNo,
      ctx.tenantId,
      customerName,
      customerEmail,
      amount,
      input.currency ?? 'AED',
      receiptDate,
      input.paymentMethod ?? 'BANK_TRANSFER',
      input.reference ?? null,
      input.bankStatementLineId ?? null,
      input.source ?? (input.bankStatementLineId ? 'BANK_MATCH' : 'MANUAL'),
      'UNAPPLIED',
      input.notes ?? null,
      ctx.userId,
    );

    const receiptId = String(receipt.id);
    const headerInvoiceId = allocations.length === 1 && allocationTotal === amount ? allocations[0].invoiceId : null;
    await tx.$executeRawUnsafe(
      `INSERT INTO finance_payments
         (invoice_id, amount, payment_date, payment_method, reference, notes, tenant_id,
          customer_name, customer_email, cash_receipt_id, receipt_no, voucher_no, status)
       VALUES ($1::uuid,$2,$3::date,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,'ACTIVE')`,
      headerInvoiceId,
      amount,
      receiptDate,
      input.paymentMethod ?? 'BANK_TRANSFER',
      input.reference ?? receiptNo,
      input.notes ?? null,
      ctx.tenantId,
      customerName,
      customerEmail,
      receiptId,
      receiptNo,
      voucherNo,
    );

    const invoiceUpdates: Record<string, unknown>[] = [];
    for (const allocation of allocations) {
      const [invoice] = await tx.$queryRawUnsafe<InvoiceRow[]>(
        `SELECT id::text, invoice_number, client_name, client_email, client_phone,
                total_amount::text, paid_amount::text, currency, due_date, issue_date,
                payment_status, GREATEST(0, total_amount - paid_amount)::text AS outstanding
           FROM finance_invoices
          WHERE id::text = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          LIMIT 1`,
        allocation.invoiceId,
        ctx.tenantId,
      );
      if (!invoice) throw new Error(`Invoice ${allocation.invoiceId} was not found for this tenant`);
      const outstanding = Number(invoice.outstanding ?? 0);
      if (allocation.amount > outstanding) {
        throw new Error(`Allocation for ${invoice.invoice_number} exceeds outstanding amount`);
      }
      const [allocationRow] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `INSERT INTO finance_cash_allocations
           (receipt_id, invoice_id, invoice_no, allocated_amount, allocation_method,
            allocation_date, tenant_id, created_by)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::date,$7,$8)
         RETURNING *`,
        receiptId,
        allocation.invoiceId,
        invoice.invoice_number,
        allocation.amount,
        input.autoAllocate ? 'AUTO' : input.bankStatementLineId ? 'BANK_MATCH' : 'MANUAL',
        receiptDate,
        ctx.tenantId,
        ctx.userId,
      );
      const afterInvoice = await recalculateInvoicePaid(tx as unknown as SqlClient, ctx.tenantId, allocation.invoiceId);
      invoiceUpdates.push({ before: invoice, after: afterInvoice, allocation: allocationRow });
    }

    const updatedReceipt = await refreshReceiptTotals(tx as unknown as SqlClient, ctx.tenantId, receiptId);
    await tx.$queryRawUnsafe(
      `INSERT INTO finance_receipt_vouchers
         (voucher_no, receipt_id, tenant_id, payload_json, generated_by)
       VALUES ($1,$2::uuid,$3,$4::jsonb,$5)
       ON CONFLICT (voucher_no) DO NOTHING`,
      voucherNo,
      receiptId,
      ctx.tenantId,
      safeJson({ receipt: updatedReceipt, allocations }),
      ctx.userId,
    );

    if (input.bankStatementLineId) {
      await tx.$executeRawUnsafe(
        `UPDATE finance_bank_statement_lines
            SET match_status='MATCHED',
                matched_payment_id=$2,
                matched_at=NOW(),
                matched_by=$3
          WHERE id::text=$1
            AND tenant_id::text=$4`,
        input.bankStatementLineId,
        receiptId,
        ctx.userId,
        ctx.tenantId,
      ).catch(() => {});
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceCashReceipt',
      entityId: receiptId,
      action: 'CREATE',
      after: { receipt: updatedReceipt, allocations: invoiceUpdates },
      summary: `Created receipt voucher ${voucherNo} / ${receiptNo} for ${customerName}.`,
      riskSeverity: allocationTotal > 0 ? 'medium' : 'low',
    });

    return {
      receipt: updatedReceipt,
      receiptId,
      receiptNo,
      voucherNo,
      allocations: invoiceUpdates,
    };
  });
}

export async function allocateExistingReceipt(
  req: NextRequest,
  ctx: OperationalContext,
  receiptId: string,
  input: { allocations?: CashAllocationInput[]; autoAllocate?: boolean; autoAllocateBy?: 'AGE' | 'DUE_DATE' },
) {
  await ensureCashAllocationTables();
  const [receipt] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM finance_cash_receipts
      WHERE id::text = $1
        AND tenant_id::text = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    receiptId,
    ctx.tenantId,
  );
  if (!receipt) throw new Error('Receipt not found');
  if (receipt.status === 'REVERSED') throw new Error('Reversed receipt cannot be allocated');
  const available = roundMoney(Number(receipt.unapplied_amount ?? 0));
  if (available <= 0) throw new Error('Receipt has no unapplied amount');
  const allocations = await normalizeAllocations(
    ctx.tenantId,
    String(receipt.customer_name ?? ''),
    available,
    input.allocations,
    input.autoAllocate,
    input.autoAllocateBy,
  );
  const allocationTotal = roundMoney(allocations.reduce((sum, item) => sum + item.amount, 0));
  if (allocationTotal > available) throw new Error('Allocation amount cannot exceed unapplied receipt amount');

  return prisma.$transaction(async (tx) => {
    const invoiceUpdates: Record<string, unknown>[] = [];
    for (const allocation of allocations) {
      const [invoice] = await tx.$queryRawUnsafe<InvoiceRow[]>(
        `SELECT id::text, invoice_number, client_name, client_email, client_phone,
                total_amount::text, paid_amount::text, currency, due_date, issue_date,
                payment_status, GREATEST(0, total_amount - paid_amount)::text AS outstanding
           FROM finance_invoices
          WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
          LIMIT 1`,
        allocation.invoiceId,
        ctx.tenantId,
      );
      if (!invoice) throw new Error(`Invoice ${allocation.invoiceId} was not found for this tenant`);
      if (allocation.amount > Number(invoice.outstanding ?? 0)) {
        throw new Error(`Allocation for ${invoice.invoice_number} exceeds outstanding amount`);
      }
      const [allocationRow] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `INSERT INTO finance_cash_allocations
           (receipt_id, invoice_id, invoice_no, allocated_amount, allocation_method,
            allocation_date, tenant_id, created_by)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,CURRENT_DATE,$6,$7)
         RETURNING *`,
        receiptId,
        allocation.invoiceId,
        invoice.invoice_number,
        allocation.amount,
        input.autoAllocate ? 'AUTO' : 'MANUAL',
        ctx.tenantId,
        ctx.userId,
      );
      const afterInvoice = await recalculateInvoicePaid(tx as unknown as SqlClient, ctx.tenantId, allocation.invoiceId);
      invoiceUpdates.push({ before: invoice, after: afterInvoice, allocation: allocationRow });
    }
    const updatedReceipt = await refreshReceiptTotals(tx as unknown as SqlClient, ctx.tenantId, receiptId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceCashReceipt',
      entityId: receiptId,
      action: 'UPDATE',
      before: receipt,
      after: { receipt: updatedReceipt, allocations: invoiceUpdates },
      summary: `Allocated receipt ${String(receipt.receipt_no ?? receiptId)} across ${allocations.length} invoice(s).`,
      riskSeverity: 'medium',
    });
    return { receipt: updatedReceipt, allocations: invoiceUpdates };
  });
}

export async function reverseCashAllocation(
  req: NextRequest,
  ctx: OperationalContext,
  allocationId: string,
  reason: string,
) {
  await ensureCashAllocationTables();
  const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT a.*, r.receipt_no, r.voucher_no, r.customer_name
       FROM finance_cash_allocations a
       JOIN finance_cash_receipts r ON r.id = a.receipt_id
      WHERE a.id::text = $1
        AND a.tenant_id::text = $2
        AND a.status = 'ACTIVE'
      LIMIT 1`,
    allocationId,
    ctx.tenantId,
  );
  if (!before) throw new Error('Active allocation not found');

  return prisma.$transaction(async (tx) => {
    const [after] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE finance_cash_allocations
          SET status='REVERSED',
              reversed_at=NOW(),
              reversed_by=$3,
              reversal_reason=$4,
              updated_at=NOW()
        WHERE id::text=$1
          AND tenant_id::text=$2
        RETURNING *`,
      allocationId,
      ctx.tenantId,
      ctx.userId,
      reason,
    );
    const afterInvoice = await recalculateInvoicePaid(tx as unknown as SqlClient, ctx.tenantId, String(before.invoice_id));
    const receipt = await refreshReceiptTotals(tx as unknown as SqlClient, ctx.tenantId, String(before.receipt_id));
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceCashAllocation',
      entityId: allocationId,
      action: 'STATUS_CHANGE',
      before,
      after: { allocation: after, invoice: afterInvoice, receipt },
      summary: `Reversed receipt allocation ${String(before.invoice_no ?? allocationId)} from ${String(before.receipt_no ?? before.receipt_id)}.`,
      riskSeverity: 'high',
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'FINANCE_RECEIVABLE_EXCEPTION',
      referenceType: 'FinanceCashAllocation',
      referenceId: allocationId,
      referenceNumber: String(before.receipt_no ?? allocationId),
      contextData: {
        action: 'allocation_reversal',
        reason,
        invoiceNo: before.invoice_no,
        amount: before.allocated_amount,
        customerName: before.customer_name,
      },
      force: true,
    });
    return { allocation: after, invoice: afterInvoice, receipt, workflow };
  });
}

export async function writeOffInvoiceOutstanding(
  req: NextRequest,
  ctx: OperationalContext,
  invoiceId: string,
  reason: string,
) {
  await ensureCashAllocationTables();
  const [invoice] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
    `WITH credit_note_net AS (
       SELECT COALESCE(SUM(total_amount),0)::numeric AS amount
         FROM finance_credit_notes
        WHERE deleted_at IS NULL
          AND tenant_id::text = $2
          AND status NOT IN ('DRAFT','VOIDED')
          AND (original_invoice_id = $1 OR original_invoice_no = (
            SELECT invoice_number FROM finance_invoices WHERE id::text = $1
          ))
     )
     SELECT i.id::text, i.invoice_number, i.client_name, i.client_email, i.client_phone,
            i.total_amount::text, i.paid_amount::text, i.currency, i.due_date, i.issue_date,
            i.payment_status,
            GREATEST(0, i.total_amount - i.paid_amount - COALESCE(cn.amount, 0))::text AS outstanding
       FROM finance_invoices i, credit_note_net cn
      WHERE i.id::text = $1
        AND i.tenant_id::text = $2
        AND i.deleted_at IS NULL
      LIMIT 1`,
    invoiceId,
    ctx.tenantId,
  );
  if (!invoice) throw new Error('Invoice not found');
  const outstanding = roundMoney(Number(invoice.outstanding ?? 0));
  if (outstanding <= 0) throw new Error('Invoice has no outstanding amount');

  const cnPrefix = `CN-WO-${new Date().toISOString().slice(2, 7).replace('-', '')}`;
  const cnNumber = await nextNumber(prisma, 'finance_credit_notes', 'cn_number', cnPrefix, ctx.tenantId);
  return prisma.$transaction(async (tx) => {
    const [creditNote] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
      `INSERT INTO finance_credit_notes
         (cn_number, original_invoice_id, original_invoice_no, client_name, client_email,
          module, branch, reason_code, reason_detail, line_items, subtotal, vat_amount,
          total_amount, currency, issue_date, status, applied_amount, issued_by, approved_by,
          notes, tenant_id)
       VALUES ($1,$2,$3,$4,$5,'FINANCE','Unassigned','BAD_DEBT_WRITE_OFF',$6,$7::jsonb,
               $8,0,$8,$9,CURRENT_DATE,'APPLIED',$8,$10,$10,$11,$12)
       RETURNING *`,
      cnNumber,
      invoice.id,
      invoice.invoice_number,
      invoice.client_name,
      invoice.client_email,
      reason,
      safeJson([{ description: 'Receivable write-off', quantity: 1, unitPrice: outstanding, total: outstanding }]),
      outstanding,
      invoice.currency ?? 'AED',
      ctx.userId,
      `Write-off approved/recorded via cash allocation workbench. ${reason}`,
      ctx.tenantId,
    );
    await tx.$executeRawUnsafe(
      `UPDATE finance_invoices
          SET payment_status = CASE
                WHEN paid_amount >= total_amount THEN 'PAID'
                ELSE 'WRITTEN_OFF'
              END,
              updated_at = NOW()
        WHERE id::text = $1
          AND tenant_id::text = $2`,
      invoiceId,
      ctx.tenantId,
    );
    const [afterInvoice] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_invoices WHERE id::text = $1 AND tenant_id::text = $2`,
      invoiceId,
      ctx.tenantId,
    );
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceInvoice',
      entityId: invoiceId,
      action: 'STATUS_CHANGE',
      before: invoice,
      after: { invoice: afterInvoice, creditNote },
      summary: `Wrote off outstanding receivable ${invoice.invoice_number} with credit note ${cnNumber}.`,
      riskSeverity: 'critical',
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'FINANCE_RECEIVABLE_EXCEPTION',
      referenceType: 'FinanceInvoice',
      referenceId: invoiceId,
      referenceNumber: invoice.invoice_number,
      contextData: {
        action: 'write_off',
        reason,
        amount: outstanding,
        creditNoteNo: cnNumber,
        customerName: invoice.client_name,
      },
      force: true,
    });
    return { invoice: afterInvoice, creditNote, workflow };
  });
}
