import { NextRequest, NextResponse } from 'next/server';
import { assertCanWrite } from '@/lib/access-control';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { prisma } from '@/lib/prisma';
import {
  allocateExistingReceipt,
  createCashReceipt,
  ensureCashAllocationTables,
  getOpenInvoices,
} from '@/lib/finance/cash-allocation';

function asNumber(value: unknown) {
  return value == null ? 0 : Number(value);
}

function asDate(value: unknown) {
  if (!value) return null;
  return (value as Date)?.toISOString?.().split('T')[0] ?? String(value).slice(0, 10);
}

export async function GET(req: NextRequest) {
  await ensureCashAllocationTables();
  const sp = req.nextUrl.searchParams;
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: sp.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const customerName = sp.get('customer') ?? '';
  const status = sp.get('status') ?? '';
  const includeOpenInvoices = sp.get('includeOpenInvoices') !== 'false';
  const includeBankCredits = sp.get('includeBankCredits') === 'true';
  const limit = Math.max(1, Math.min(Number(sp.get('limit') ?? 50), 150));

  const params: unknown[] = [ctx.tenantId];
  let where = `r.tenant_id::text = $1 AND r.deleted_at IS NULL`;
  if (customerName) {
    params.push(customerName.toLowerCase());
    where += ` AND lower(r.customer_name) = $${params.length}`;
  }
  if (status) {
    params.push(status);
    where += ` AND r.status = $${params.length}`;
  }

  const receipts = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT r.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', a.id::text,
                  'invoiceId', a.invoice_id::text,
                  'invoiceNo', a.invoice_no,
                  'amount', a.allocated_amount,
                  'status', a.status,
                  'method', a.allocation_method,
                  'allocationDate', a.allocation_date,
                  'reversalReason', a.reversal_reason
                )
                ORDER BY a.created_at ASC
              ) FILTER (WHERE a.id IS NOT NULL),
              '[]'::json
            ) AS allocations
       FROM finance_cash_receipts r
       LEFT JOIN finance_cash_allocations a
         ON a.receipt_id = r.id
        AND a.tenant_id::text = r.tenant_id::text
       WHERE ${where}
       GROUP BY r.id
       ORDER BY r.receipt_date DESC, r.created_at DESC
       LIMIT ${limit}`,
    ...params,
  ).catch(() => []);

  const summaryRows = await prisma.$queryRawUnsafe<Array<{
    total_receipts: string;
    total_amount: string;
    allocated_amount: string;
    unapplied_amount: string;
  }>>(
    `SELECT COUNT(*)::text AS total_receipts,
            COALESCE(SUM(amount),0)::text AS total_amount,
            COALESCE(SUM(allocated_amount),0)::text AS allocated_amount,
            COALESCE(SUM(unapplied_amount),0)::text AS unapplied_amount
       FROM finance_cash_receipts r
      WHERE ${where}`,
    ...params,
  ).catch(() => []);

  const openInvoices = includeOpenInvoices
    ? await getOpenInvoices(ctx.tenantId, { customerName, orderBy: 'DUE_DATE', limit: 150 })
    : [];

  const bankCredits = includeBankCredits
    ? await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id::text, statement_id, txn_date, description, reference, credit::text, balance::text
           FROM finance_bank_statement_lines
          WHERE tenant_id::text = $1
            AND match_status = 'UNMATCHED'
            AND credit IS NOT NULL
          ORDER BY txn_date DESC
          LIMIT 50`,
        ctx.tenantId,
      ).catch(() => [])
    : [];

  return NextResponse.json({
    receipts: receipts.map((row) => ({
      ...row,
      id: String(row.id ?? ''),
      amount: asNumber(row.amount),
      allocated_amount: asNumber(row.allocated_amount),
      unapplied_amount: asNumber(row.unapplied_amount),
      receipt_date: asDate(row.receipt_date),
      created_at: (row.created_at as Date)?.toISOString?.() ?? row.created_at,
      allocations: Array.isArray(row.allocations) ? row.allocations : [],
    })),
    summary: {
      totalReceipts: Number(summaryRows[0]?.total_receipts ?? 0),
      totalAmount: asNumber(summaryRows[0]?.total_amount),
      allocatedAmount: asNumber(summaryRows[0]?.allocated_amount),
      unappliedAmount: asNumber(summaryRows[0]?.unapplied_amount),
    },
    openInvoices: openInvoices.map((invoice) => ({
      ...invoice,
      total_amount: asNumber(invoice.total_amount),
      paid_amount: asNumber(invoice.paid_amount),
      outstanding: asNumber(invoice.outstanding),
      due_date: asDate(invoice.due_date),
      issue_date: asDate(invoice.issue_date),
    })),
    bankCredits,
  });
}

export async function POST(req: NextRequest) {
  const guard = assertCanWrite(req, 'finance');
  if (guard) return guard;

  try {
    const ctx = requireOperationalContext(req, 'finance', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const action = body.action ?? 'create_receipt';

    if (action === 'allocate_existing') {
      if (!body.receiptId) return NextResponse.json({ error: 'receiptId is required' }, { status: 400 });
      const result = await allocateExistingReceipt(req, ctx, String(body.receiptId), {
        allocations: body.allocations ?? [],
        autoAllocate: !!body.autoAllocate,
        autoAllocateBy: body.autoAllocateBy === 'AGE' ? 'AGE' : 'DUE_DATE',
      });
      return NextResponse.json(result);
    }

    if (action === 'create_receipt' || action === 'bank_credit_receipt') {
      const result = await createCashReceipt(req, ctx, {
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        amount: Number(body.amount),
        currency: body.currency ?? 'AED',
        receiptDate: body.receiptDate,
        paymentMethod: body.paymentMethod ?? (action === 'bank_credit_receipt' ? 'BANK_TRANSFER' : 'BANK_TRANSFER'),
        reference: body.reference,
        notes: body.notes,
        allocations: body.allocations ?? [],
        autoAllocate: !!body.autoAllocate,
        autoAllocateBy: body.autoAllocateBy === 'AGE' ? 'AGE' : 'DUE_DATE',
        bankStatementLineId: body.bankStatementLineId,
        source: action === 'bank_credit_receipt' ? 'BANK_MATCH' : body.source,
      });
      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[finance/cash-allocation] POST error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process cash allocation',
    }, { status: 500 });
  }
}
