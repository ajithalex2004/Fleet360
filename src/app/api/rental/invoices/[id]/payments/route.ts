/**
 * POST /api/rental/invoices/:id/payments
 * Record a payment receipt against an invoice.
 * Automatically updates paid_amount / balance_due and transitions status.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoice_payments WHERE invoice_id = $1 ORDER BY payment_date DESC",
      params.id
    );
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { amount, paymentMethod, paymentDate, referenceNo, notes, receivedBy } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    // Fetch current invoice
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1 AND deleted_at IS NULL", params.id
    );
    if (!rows.length) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const inv = rows[0];
    if (['VOID', 'CANCELLED'].includes(inv.status)) {
      return NextResponse.json({ error: 'Cannot record payment on a ' + inv.status + ' invoice' }, { status: 422 });
    }

    const paymentId  = crypto.randomUUID();
    const receiptNo  = 'RRCPT-' + String(Math.floor(Math.random() * 999999)).padStart(6, '0');
    const now        = new Date().toISOString();
    const paidDate   = paymentDate ?? now;
    const paidAmt    = Number(amount);

    // Insert payment record
    await prisma.$executeRawUnsafe(
      "INSERT INTO rental_invoice_payments " +
      "(id, invoice_id, receipt_no, payment_date, amount, payment_method, reference_no, notes, received_by, created_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      paymentId, params.id, receiptNo, paidDate,
      paidAmt,
      paymentMethod ?? 'CASH',
      referenceNo  ?? null,
      notes        ?? null,
      receivedBy   ?? null,
      now,
    );

    // Update invoice paid_amount and balance_due
    const newPaid    = parseFloat((Number(inv.paid_amount ?? 0) + paidAmt).toFixed(2));
    const newBalance = parseFloat((Number(inv.total_amount) - newPaid).toFixed(2));
    const newStatus  = newBalance <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIALLY_PAID' : inv.status);

    await prisma.$executeRawUnsafe(
      "UPDATE rental_invoices SET paid_amount=$1, balance_due=$2, status=$3, updated_at=$4 WHERE id=$5",
      newPaid, newBalance, newStatus, now, params.id
    );

    const updated = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1", params.id
    );

    return NextResponse.json({
      payment: { id: paymentId, receiptNo, amount: paidAmt, paymentDate: paidDate },
      invoice: updated[0],
    }, { status: 201 });
  } catch (e: any) {
    console.error('Invoice payment error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to record payment' }, { status: 500 });
  }
}
