export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/invoices/[id]/record-payment
 *
 * Staff-facing manual reconciliation (G4 plumbing — no live payment
 * gateway is configured, see src/lib/leasing/payment-provider.ts).
 *
 * Two modes:
 *   { intentId }                       — confirm an existing pending
 *                                         payment intent (e.g. one the
 *                                         lessee created via "Pay now"
 *                                         in the portal).
 *   { amount, method, bankRef, notes } — record a payment staff took
 *                                         directly (no portal intent),
 *                                         creating + immediately
 *                                         confirming a new intent.
 *
 * Either way this writes a real LeaseReceipt and marks the invoice PAID.
 *
 * Tenant scoping: requires x-tenant-id. Verifies the invoice belongs to
 * the caller's tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { createPaymentIntent, confirmPaymentIntent } from '@/lib/leasing/payment-intents-store';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const invoice = await prisma.leaseInvoice.findFirst({
      where: { id: params.id, tenantId },
    });
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status === 'PAID') {
      return NextResponse.json({ error: 'Invoice is already marked paid' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({})) as {
      intentId?: string;
      amount?: number;
      method?: string;
      bankRef?: string;
      notes?: string;
    };
    const confirmedBy = req.headers.get('x-user-id') ?? 'staff';

    let intentId = body.intentId;
    if (!intentId) {
      const amount = Number(body.amount ?? invoice.totalAmount);
      if (!(amount > 0)) {
        return NextResponse.json({ error: 'amount must be positive' }, { status: 400 });
      }
      const intent = await createPaymentIntent({
        tenantId,
        invoiceId: invoice.id,
        lesseeId: invoice.lesseeId,
        amount,
        currency: invoice.currency ?? 'AED',
        provider: 'stub',
        providerRef: null,
        method: body.method ?? 'BANK_TRANSFER',
        initiatedBy: 'STAFF',
        initiatedByUser: confirmedBy,
        referenceCode: body.bankRef ?? `MANUAL-${Date.now().toString().slice(-6)}`,
        notes: body.notes ?? null,
      });
      intentId = intent.id;
    }

    const result = await confirmPaymentIntent({
      tenantId,
      intentId,
      confirmedBy,
      paymentMethod: body.method,
      bankRef: body.bankRef,
    });
    if (!result) {
      return NextResponse.json({ error: 'Payment intent not found or already confirmed' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, intent: result.intent, receiptId: result.receiptId || null });
  } catch (e) {
    console.error('[leasing/invoices/record-payment]', e);
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 });
  }
}
