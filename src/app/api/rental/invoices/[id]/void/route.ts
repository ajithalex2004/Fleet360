/**
 * POST /api/rental/invoices/:id/void
 * Void an invoice (cannot be undone). Reason is required.
 * Creates a reversal credit note if the invoice had payments.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { reason, voidedBy } = body;

    if (!reason?.trim()) {
      return NextResponse.json({ error: 'reason is required to void an invoice' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1 AND deleted_at IS NULL", params.id
    );
    if (!rows.length) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const inv = rows[0];
    if (inv.status === 'VOID') {
      return NextResponse.json({ error: 'Invoice is already void' }, { status: 422 });
    }
    if (inv.status === 'PAID') {
      return NextResponse.json({ error: 'Paid invoices cannot be voided. Create a credit note instead.' }, { status: 422 });
    }

    const now = new Date().toISOString();
    const voidNote = '[VOID ' + now.split('T')[0] + '] ' + reason + (voidedBy ? ' — by ' + voidedBy : '');
    const existingNotes = inv.internal_notes ? inv.internal_notes + '\n' + voidNote : voidNote;

    await prisma.$executeRawUnsafe(
      "UPDATE rental_invoices SET status='VOID', internal_notes=$1, updated_at=$2 WHERE id=$3",
      existingNotes, now, params.id
    );

    // If there were partial payments, auto-generate a credit note to zero them out
    let creditNote = null;
    if (Number(inv.paid_amount ?? 0) > 0) {
      const cnId  = crypto.randomUUID();
      const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        "SELECT COUNT(*) AS count FROM rental_invoices"
      );
      const seq   = Number(countRows[0]?.count ?? 0) + 1;
      const cnNo  = 'RCN-' + String(seq).padStart(6, '0');
      const paidAmt = Number(inv.paid_amount);

      await prisma.$executeRawUnsafe(
        "INSERT INTO rental_invoices " +
        "(id,created_at,updated_at,invoice_no,agreement_id,customer_id,invoice_type,invoice_date," +
        "due_date,currency,subtotal,discount_amount,taxable_amount,tax_rate,tax_amount," +
        "total_amount,paid_amount,balance_due,status,notes) " +
        "VALUES ($1,$2,$3,$4,$5,$6,'CREDIT_NOTE',$7,$8,$9,$10,0,$10,0,0,$11,0,$11,'DRAFT',$12)",
        cnId, now, now, cnNo,
        inv.agreement_id, inv.customer_id,
        now, now,
        inv.currency ?? 'AED',
        -paidAmt,
        -paidAmt,
        'Credit note for voided invoice ' + inv.invoice_no,
      );

      creditNote = { id: cnId, invoiceNo: cnNo, amount: -paidAmt };
    }

    const updated = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1", params.id
    );

    return NextResponse.json({ invoice: updated[0], creditNote });
  } catch (e: any) {
    console.error('Invoice void error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to void invoice' }, { status: 500 });
  }
}
