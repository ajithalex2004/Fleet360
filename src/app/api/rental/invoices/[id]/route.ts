import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ── GET /api/rental/invoices/:id ─────────────────────────────────────────────
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [rows, lineItems, payments] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        "SELECT ri.*, ra.agreement_no, ra.customer_name, " +
        "COALESCE(ri.total_amount - ri.paid_amount, 0) AS balance_due " +
        "FROM rental_invoices ri " +
        "LEFT JOIN rental_agreements ra ON ra.id = ri.agreement_id " +
        "WHERE ri.id = $1 AND ri.deleted_at IS NULL",
        params.id
      ),
      prisma.$queryRawUnsafe<any[]>(
        "SELECT * FROM rental_invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order ASC",
        params.id
      ),
      prisma.$queryRawUnsafe<any[]>(
        "SELECT * FROM rental_invoice_payments WHERE invoice_id = $1 ORDER BY payment_date DESC",
        params.id
      ),
    ]);

    if (!rows.length) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    return NextResponse.json({ ...rows[0], lineItems, payments });
  } catch (e: any) {
    console.error('Invoice GET error:', e);
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 });
  }
}

// ── PUT /api/rental/invoices/:id ─────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const now  = new Date().toISOString();

    // Build SET clause dynamically from allowed updatable fields
    const allowed = [
      'invoice_type','invoice_date','due_date','period_from','period_to',
      'currency','subtotal','discount_amount','taxable_amount','tax_rate',
      'tax_amount','total_amount','paid_amount','status','is_corporate',
      'corporate_account_id','billing_mode','payment_terms_days','notes','internal_notes',
    ] as const;

    const toSnake = (s: string) => s.replace(/([A-Z])/g, '_$1').toLowerCase();

    const setClauses: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    for (const key of Object.keys(body)) {
      const snake = toSnake(key);
      if (allowed.includes(snake as any)) {
        setClauses.push(snake + ' = $' + idx);
        values.push(body[key]);
        idx++;
      }
    }

    values.push(params.id); // last param for WHERE

    await prisma.$executeRawUnsafe(
      "UPDATE rental_invoices SET " + setClauses.join(', ') +
      " WHERE id = $" + idx + " AND deleted_at IS NULL",
      ...values
    );

    const updated = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1", params.id
    );
    return NextResponse.json(updated[0]);
  } catch (e: any) {
    console.error('Invoice PUT error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to update invoice' }, { status: 500 });
  }
}

// ── DELETE /api/rental/invoices/:id  (soft delete) ───────────────────────────
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Only DRAFT or VOID invoices can be soft-deleted
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT status FROM rental_invoices WHERE id = $1 AND deleted_at IS NULL", params.id
    );
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['DRAFT', 'VOID'].includes(rows[0].status)) {
      return NextResponse.json({ error: 'Only DRAFT or VOID invoices can be deleted' }, { status: 422 });
    }

    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      "UPDATE rental_invoices SET deleted_at = $1, updated_at = $1 WHERE id = $2",
      now, params.id
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Invoice DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
