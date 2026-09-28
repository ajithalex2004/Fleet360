export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * GET   /api/finance/invoices/:id  — full detail with payment history
 * PATCH /api/finance/invoices/:id  — update status / fields
 * DELETE /api/finance/invoices/:id — soft delete
 */

const VALID_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'];

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      // finance_invoices.tenant_id is NOT NULL: every invoice belongs to a tenant.
      type InvRow = Record<string, unknown>;
      const [invoice] = await tx.$queryRawUnsafe<InvRow[]>(
        `SELECT * FROM finance_invoices WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
        params.id, tenantId
      );
      if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      type PayRow = { id: string; amount: number; payment_date: string; payment_method: string; reference: string | null; notes: string | null; created_at: string };
      const payments = await tx.$queryRawUnsafe<PayRow[]>(
        `SELECT id, amount, payment_date, payment_method, reference, notes, created_at
           FROM finance_payments WHERE invoice_id = $1::uuid AND tenant_id = $2 ORDER BY payment_date ASC`,
        params.id, tenantId
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
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { action } = body;

        // ── Record a payment ──────────────────────────────────────────────────
        if (action === 'record_payment') {
          const { amount, paymentDate, paymentMethod = 'BANK_TRANSFER', reference, notes } = body;
          if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });

          // Get current invoice
          type InvRow = { total_amount: number; paid_amount: number; payment_status: string };
          const [inv] = await tx.$queryRawUnsafe<InvRow[]>(
            `SELECT total_amount, paid_amount, payment_status FROM finance_invoices WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
            params.id, tenantId
          );
          if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

          const newPaid = Math.round((Number(inv.paid_amount) + Number(amount)) * 100) / 100;
          const newStatus = newPaid >= Number(inv.total_amount) ? 'PAID' : 'PARTIAL';

          await tx.$executeRawUnsafe(
            `INSERT INTO finance_payments (tenant_id, invoice_id, amount, payment_date, payment_method, reference, notes)
             VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
            tenantId, params.id, Number(amount),
            paymentDate ?? new Date().toISOString().split('T')[0],
            paymentMethod, reference ?? null, notes ?? null
          );

          await tx.$executeRawUnsafe(
            `UPDATE finance_invoices SET paid_amount = $2, payment_status = $3, updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $4`,
            params.id, newPaid, newStatus, tenantId
          );

          return NextResponse.json({ success: true, newPaidAmount: newPaid, newStatus });
        }

        // ── Update status ─────────────────────────────────────────────────────
        if (action === 'update_status' || body.paymentStatus) {
          const status = body.paymentStatus ?? body.status;
          if (!VALID_STATUSES.includes(status)) {
            return NextResponse.json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
          }
          await tx.$executeRawUnsafe(
            `UPDATE finance_invoices SET payment_status = $2, updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $3`,
            params.id, status, tenantId
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

        values.push(tenantId);
        await tx.$executeRawUnsafe(
          `UPDATE finance_invoices SET ${setClauses.join(', ')} WHERE id = $1::uuid AND tenant_id = $${values.length}`,
          ...values
        );
        return NextResponse.json({ success: true });
        } catch (err) {
        console.error('[finance/invoices PATCH]', err);
        return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
      }
  });
}


export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        await tx.$executeRawUnsafe(
          `UPDATE finance_invoices SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
          params.id, tenantId
        );
        return NextResponse.json({ success: true });
        } catch (err) {
        console.error('[finance/invoices DELETE]', err);
        return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
      }
  });
}

