import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance, rentalEntityVisible } from '@/lib/rental-governance';

const UPDATABLE_FIELDS = new Set([
  'invoice_type',
  'invoice_date',
  'due_date',
  'period_from',
  'period_to',
  'currency',
  'subtotal',
  'discount_amount',
  'taxable_amount',
  'tax_rate',
  'tax_amount',
  'total_amount',
  'paid_amount',
  'status',
  'is_corporate',
  'corporate_account_id',
  'billing_mode',
  'payment_terms_days',
  'notes',
  'internal_notes',
]);

function toSnakeCase(value: string) {
  return value.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('rental_invoices', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const [rows, lineItems, payments] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT ri.*, ra.agreement_no, rc.full_name AS customer_name,
                COALESCE(ri.total_amount - ri.paid_amount, 0) AS balance_due
           FROM rental_invoices ri
           LEFT JOIN rental_agreements ra ON ra.id = ri.agreement_id
           LEFT JOIN rental_customers rc ON rc.id = ri.customer_id
          WHERE ri.id = $1
            AND ri.tenant_id::text = $2
            AND ri.deleted_at IS NULL
          LIMIT 1`,
        params.id,
        ctx.tenantId,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT *
           FROM rental_invoice_line_items
          WHERE invoice_id = $1
          ORDER BY sort_order ASC`,
        params.id,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT *
           FROM rental_invoice_payments
          WHERE invoice_id = $1
          ORDER BY payment_date DESC`,
        params.id,
      ),
    ]);

    if (!rows.length) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    return NextResponse.json({ ...rows[0], lineItems, payments });
  } catch (error) {
    console.error('[rental/invoices/:id] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('rental_invoices', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const body = await req.json();
    const beforeRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM rental_invoices
        WHERE id = $1
          AND tenant_id::text = $2
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    const before = beforeRows[0] ?? null;

    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = $1::timestamptz'];
    const values: unknown[] = [now];
    let index = 2;

    for (const [key, rawValue] of Object.entries(body as Record<string, unknown>)) {
      const column = toSnakeCase(key);
      if (!UPDATABLE_FIELDS.has(column)) continue;
      setClauses.push(`${column} = $${index}`);
      values.push(rawValue);
      index += 1;
    }

    values.push(params.id, ctx.tenantId);
    await prisma.$executeRawUnsafe(
      `UPDATE rental_invoices
          SET ${setClauses.join(', ')}
        WHERE id = $${index}
          AND tenant_id::text = $${index + 1}
          AND deleted_at IS NULL`,
      ...values,
    );

    const updatedRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM rental_invoices
        WHERE id = $1
          AND tenant_id::text = $2
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    const updated = updatedRows[0] ?? null;
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalInvoice',
      entityId: params.id,
      action: 'UPDATE',
      before,
      after: updated,
      summary: `Updated rental invoice ${String((updated ?? before)?.invoice_no ?? params.id)}.`,
      sourceEntityType: 'RentalAgreement',
      sourceEntityId: String((updated ?? before)?.agreement_id ?? ''),
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[rental/invoices/:id] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('rental_invoices', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const rows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status
         FROM rental_invoices
        WHERE id = $1
          AND tenant_id::text = $2
          AND deleted_at IS NULL
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['DRAFT', 'VOID'].includes(rows[0].status)) {
      return NextResponse.json({ error: 'Only DRAFT or VOID invoices can be deleted' }, { status: 422 });
    }

    const beforeRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM rental_invoices
        WHERE id = $1
          AND tenant_id::text = $2
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    const before = beforeRows[0] ?? null;

    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `UPDATE rental_invoices
          SET deleted_at = $1::timestamptz,
              updated_at = $1::timestamptz
        WHERE id = $2
          AND tenant_id::text = $3`,
      now,
      params.id,
      ctx.tenantId,
    );
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalInvoice',
      entityId: params.id,
      action: 'DELETE',
      before,
      summary: `Deleted rental invoice ${String(before?.invoice_no ?? params.id)}.`,
      sourceEntityType: 'RentalAgreement',
      sourceEntityId: String(before?.agreement_id ?? ''),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rental/invoices/:id] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
