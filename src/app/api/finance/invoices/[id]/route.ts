import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';
import { createCashReceipt, ensureCashAllocationTables } from '@/lib/finance/cash-allocation';

/**
 * GET   /api/finance/invoices/:id — full detail with payment history
 * PATCH /api/finance/invoices/:id — update status / fields / record payment
 * DELETE /api/finance/invoices/:id — soft delete
 */

const VALID_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'];

async function ensurePaymentsTable() {
  await ensureCashAllocationTables();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_payments (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id     UUID NOT NULL,
      amount         NUMERIC(14,2) NOT NULL,
      payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
      payment_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
      reference      TEXT,
      notes          TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
}

type InvoiceRow = Record<string, unknown> & {
  invoice_number?: string;
  client_name?: string;
  total_amount?: number;
  paid_amount?: number;
  payment_status?: string;
};

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  await ensurePaymentsTable();
  const { id } = await params;
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const [invoice] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
    `SELECT * FROM finance_invoices
      WHERE id = $1::uuid
        AND deleted_at IS NULL
        AND tenant_id::text = $2
      LIMIT 1`,
    id,
    ctx.tenantId,
  );
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  type PayRow = {
    id: string;
    amount: number;
    payment_date: string;
    payment_method: string;
    reference: string | null;
    notes: string | null;
    created_at: string;
  };
  const payments = await prisma.$queryRawUnsafe<PayRow[]>(
    `SELECT id, amount, payment_date, payment_method, reference, notes, created_at
       FROM finance_payments
      WHERE invoice_id = $1::uuid
      ORDER BY payment_date ASC`,
    id,
  ).catch(() => [] as PayRow[]);

  const fmt = (d: unknown) => d ? (d as Date)?.toISOString?.() ?? d : null;
  const fmtDate = (d: unknown) => d ? String((d as Date)?.toISOString?.().split('T')[0] ?? d) : null;

  return NextResponse.json({
    ...invoice,
    line_items: invoice.line_items ?? [],
    issue_date: fmtDate(invoice.issue_date),
    due_date: fmtDate(invoice.due_date),
    created_at: fmt(invoice.created_at),
    updated_at: fmt(invoice.updated_at),
    payments: payments.map(p => ({
      ...p,
      payment_date: fmtDate(p.payment_date),
      created_at: fmt(p.created_at),
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = requireOperationalContext(req, 'finance', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const { action } = body;

    const [before] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `SELECT * FROM finance_invoices
        WHERE id = $1::uuid
          AND deleted_at IS NULL
          AND tenant_id::text = $2`,
      id,
      ctx.tenantId,
    );
    if (!before) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    if (action === 'record_payment') {
      await ensurePaymentsTable();

      const { amount, paymentDate, paymentMethod = 'BANK_TRANSFER', reference, notes } = body;
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
      }

      const result = await createCashReceipt(req, ctx, {
        customerName: String(before.client_name ?? ''),
        customerEmail: typeof before.client_email === 'string' ? before.client_email : null,
        amount: Number(amount),
        receiptDate: paymentDate ?? new Date().toISOString().split('T')[0],
        paymentMethod,
        reference,
        notes,
        allocations: [{ invoiceId: id, amount: Number(amount) }],
        source: 'INVOICE_DETAIL',
      });
      const [after] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
        `SELECT * FROM finance_invoices
          WHERE id = $1::uuid
            AND deleted_at IS NULL
            AND tenant_id::text = $2`,
        id,
        ctx.tenantId,
      );

      await recordOperationalChange({
        req,
        ctx,
        entityType: 'FinanceInvoice',
        entityId: id,
        action: 'STATUS_CHANGE',
        before,
        after,
        summary: `Recorded payment on invoice ${String(after?.invoice_number ?? id)}.`,
      });

      const workflow = await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'FINANCE_RECEIVABLE_EXCEPTION',
        referenceType: 'FinanceInvoice',
        referenceId: id,
        referenceNumber: String(after?.invoice_number ?? id),
        contextData: {
          action: 'record_payment',
          previousStatus: before.payment_status ?? null,
          status: after?.payment_status ?? null,
          amount,
          paidAmount: after?.paid_amount ?? null,
          totalAmount: after?.total_amount ?? before.total_amount ?? null,
          clientName: after?.client_name ?? before.client_name ?? null,
        },
      });

      return NextResponse.json({
        success: true,
        receiptNo: result.receiptNo,
        voucherNo: result.voucherNo,
        newPaidAmount: after?.paid_amount,
        newStatus: after?.payment_status,
        workflow,
      });
    }

    if (action === 'update_status' || body.paymentStatus) {
      const status = body.paymentStatus ?? body.status;
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
      }

      await prisma.$executeRawUnsafe(
        `UPDATE finance_invoices
            SET payment_status = $2,
                updated_at = NOW()
          WHERE id = $1::uuid
            AND tenant_id::text = $3`,
        id,
        status,
        ctx.tenantId,
      );

      const [after] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
        `SELECT * FROM finance_invoices
          WHERE id = $1::uuid
            AND deleted_at IS NULL
            AND tenant_id::text = $2`,
        id,
        ctx.tenantId,
      );

      await recordOperationalChange({
        req,
        ctx,
        entityType: 'FinanceInvoice',
        entityId: id,
        action: 'STATUS_CHANGE',
        before,
        after,
        summary: `Updated invoice ${String(after?.invoice_number ?? id)} status to ${status}.`,
      });

      const workflow = await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
        referenceType: 'FinanceInvoice',
        referenceId: id,
        referenceNumber: String(after?.invoice_number ?? id),
        contextData: {
          action: 'update_status',
          previousStatus: before.payment_status ?? null,
          status,
          totalAmount: after?.total_amount ?? before.total_amount ?? null,
          clientName: after?.client_name ?? before.client_name ?? null,
        },
        force: status === 'CANCELLED',
      });

      return NextResponse.json({ success: true, status, workflow });
    }

    const allowed: Record<string, string> = {
      clientName: 'client_name',
      clientEmail: 'client_email',
      clientPhone: 'client_phone',
      clientAddress: 'client_address',
      serviceType: 'service_type',
      module: 'module',
      description: 'description',
      dueDate: 'due_date',
      notes: 'notes',
    };
    const setClauses = ['updated_at = NOW()'];
    const values: unknown[] = [id];

    for (const [jsKey, col] of Object.entries(allowed)) {
      if (body[jsKey] !== undefined) {
        values.push(body[jsKey]);
        setClauses.push(`${col} = $${values.length}`);
      }
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE finance_invoices
          SET ${setClauses.join(', ')}
        WHERE id = $1::uuid
          AND tenant_id::text = $${values.length + 1}`,
      ...values,
      ctx.tenantId,
    );

    const [after] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `SELECT * FROM finance_invoices
        WHERE id = $1::uuid
          AND deleted_at IS NULL
          AND tenant_id::text = $2`,
      id,
      ctx.tenantId,
    );

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceInvoice',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      summary: `Updated invoice ${String(after?.invoice_number ?? id)} fields.`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[finance/invoices PATCH]', err);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = requireOperationalContext(req, 'finance', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const [before] = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `SELECT * FROM finance_invoices
        WHERE id = $1::uuid
          AND deleted_at IS NULL
          AND tenant_id::text = $2`,
      id,
      ctx.tenantId,
    );
    if (!before) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    await prisma.$executeRawUnsafe(
      `UPDATE finance_invoices
          SET deleted_at = NOW(),
              updated_at = NOW()
        WHERE id = $1::uuid
          AND tenant_id::text = $2`,
      id,
      ctx.tenantId,
    );

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceInvoice',
      entityId: id,
      action: 'DELETE',
      before,
      after: null,
      summary: `Deleted invoice ${String(before.invoice_number ?? id)}.`,
    });

    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
      referenceType: 'FinanceInvoice',
      referenceId: id,
      referenceNumber: String(before.invoice_number ?? id),
      contextData: {
        action: 'delete',
        previousStatus: before.payment_status ?? null,
        totalAmount: before.total_amount ?? null,
        clientName: before.client_name ?? null,
      },
      force: true,
    });

    return NextResponse.json({ success: true, workflow });
  } catch (err) {
    console.error('[finance/invoices DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
