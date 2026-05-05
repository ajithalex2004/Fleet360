import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET   /api/finance/invoices/:id  — full detail with payment history
 * PATCH /api/finance/invoices/:id  — update status / fields
 * DELETE /api/finance/invoices/:id — soft delete
 */

const VALID_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'];

async function ensurePaymentsTable() {
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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensurePaymentsTable();

  // Enforce tenant isolation using middleware-injected x-tenant-id header
  const tenantId = req.headers.get('x-tenant-id');
  const queryValues: unknown[] = [params.id];
  let tenantClause = '';
  if (tenantId) {
    queryValues.push(tenantId);
    // Invoices without a tenant_id (created before isolation was added) are visible to any tenant
    // Invoices with a tenant_id are only visible to their own tenant
    tenantClause = ' AND (tenant_id IS NULL OR tenant_id = $2)';
  }

  type InvRow = Record<string, unknown>;
  const [invoice] = await prisma.$queryRawUnsafe<InvRow[]>(
    `SELECT * FROM finance_invoices WHERE id = $1::uuid AND deleted_at IS NULL${tenantClause} LIMIT 1`,
    ...queryValues
  );
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  type PayRow = { id: string; amount: number; payment_date: string; payment_method: string; reference: string | null; notes: string | null; created_at: string };
  const payments = await prisma.$queryRawUnsafe<PayRow[]>(
    `SELECT id, amount, payment_date, payment_method, reference, notes, created_at
       FROM finance_payments WHERE invoice_id = $1::uuid ORDER BY payment_date ASC`,
    params.id
  ).catch(() => [] as PayRow[]);

  const fmt = (d: unknown) => d ? (d as Date)?.toISOString?.() ?? d : null;
  const fmtDate = (d: unknown) => d ? String((d as Date)?.toISOString?.().split('T')[0] ?? d) : null;

  return NextResponse.json({
    ...invoice,
    line_items: invoice.line_items ?? [],
    issue_date: fmtDate(invoice.issue_date),
    due_date:   fmtDate(invoice.due_date),
    created_at: fmt(invoice.created_at),
    updated_at: fmt(invoice.updated_at),
    payments: payments.map(p => ({
      ...p,
      payment_date: fmtDate(p.payment_date),
      created_at:   fmt(p.created_at),
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { action } = body;

    // ── Record a payment ──────────────────────────────────────────────────
    if (action === 'record_payment') {
      await ensurePaymentsTable();

      const { amount, paymentDate, paymentMethod = 'BANK_TRANSFER', reference, notes } = body;
      if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });

      // Get current invoice
      type InvRow = { total_amount: number; paid_amount: number; payment_status: string };
      const [inv] = await prisma.$queryRawUnsafe<InvRow[]>(
        `SELECT total_amount, paid_amount, payment_status FROM finance_invoices WHERE id = $1::uuid AND deleted_at IS NULL`,
        params.id
      );
      if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

      const newPaid = Math.round((Number(inv.paid_amount) + Number(amount)) * 100) / 100;
      const newStatus = newPaid >= Number(inv.total_amount) ? 'PAID' : 'PARTIAL';

      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_payments (invoice_id, amount, payment_date, payment_method, reference, notes)
         VALUES ($1, $2, $3::date, $4, $5, $6)`,
        params.id, Number(amount),
        paymentDate ?? new Date().toISOString().split('T')[0],
        paymentMethod, reference ?? null, notes ?? null
      );

      await prisma.$executeRawUnsafe(
        `UPDATE finance_invoices SET paid_amount = $2, payment_status = $3, updated_at = NOW() WHERE id = $1::uuid`,
        params.id, newPaid, newStatus
      );

      return NextResponse.json({ success: true, newPaidAmount: newPaid, newStatus });
    }

    // ── Update status ─────────────────────────────────────────────────────
    if (action === 'update_status' || body.paymentStatus) {
      const status = body.paymentStatus ?? body.status;
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE finance_invoices SET payment_status = $2, updated_at = NOW() WHERE id = $1::uuid`,
        params.id, status
      );
      return NextResponse.json({ success: true, status });
    }

    // ── Update fields ─────────────────────────────────────────────────────
    const allowed: Record<string, string> = {
      clientName: 'client_name', clientEmail: 'client_email', clientPhone: 'client_phone',
      clientAddress: 'client_address', serviceType: 'service_type', module: 'module',
      description: 'description', dueDate: 'due_date', notes: 'notes',
    };
    const setClauses = ['updated_at = NOW()'];
    const values: unknown[] = [params.id];

    for (const [jsKey, col] of Object.entries(allowed)) {
      if (body[jsKey] !== undefined) {
        values.push(body[jsKey]);
        setClauses.push(`${col} = $${values.length}`);
      }
    }

    if (setClauses.length === 1) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    await prisma.$executeRawUnsafe(
      `UPDATE finance_invoices SET ${setClauses.join(', ')} WHERE id = $1::uuid`,
      ...values
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[finance/invoices PATCH]', err);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_invoices SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
      params.id
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[finance/invoices DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
