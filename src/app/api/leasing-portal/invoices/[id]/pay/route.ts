/**
 * POST /api/leasing-portal/invoices/[id]/pay
 *
 * Lessee-facing "Pay now". Creates a PENDING payment intent via the
 * configured payment provider (stub today — see payment-provider.ts) and
 * returns instructions. Does not mark the invoice paid; staff (or a real
 * gateway webhook once one exists) confirms via
 * POST /api/leasing/invoices/[id]/record-payment.
 *
 * Body: { method?: 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getPaymentProvider } from '@/lib/leasing/payment-provider';
import { createPaymentIntent, listPaymentIntentsForInvoice } from '@/lib/leasing/payment-intents-store';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    // A bare prisma call here never sets app.tenant_id, so RLS on
    // lease_invoices silently returned no row for an invoice that
    // genuinely belongs to this lessee -- "Pay now" 404'd on every real
    // invoice. Same bug found across every other leasing-portal route
    // that used a bare `prisma.X` call instead of withTenantRls.
    const invoice = await withTenantRls(prisma, ctx.tenantId, (tx) =>
      tx.leaseInvoice.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, lesseeId: ctx.lesseeId },
      }),
    );
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status === 'PAID') {
      return NextResponse.json({ error: 'This invoice is already paid' }, { status: 409 });
    }

    const existing = await listPaymentIntentsForInvoice(ctx.tenantId, invoice.id);
    const alreadyPending = existing.find(i => i.status === 'PENDING');
    if (alreadyPending) {
      return NextResponse.json({ ok: true, intent: alreadyPending, alreadyExisted: true });
    }

    const body = await req.json().catch(() => ({})) as { method?: 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' };
    const method = body.method ?? 'BANK_TRANSFER';

    const provider = getPaymentProvider();
    const result = await provider.initiatePayment({
      tenantId: ctx.tenantId,
      invoiceId: invoice.id,
      lesseeId: ctx.lesseeId,
      amount: Number(invoice.totalAmount),
      currency: invoice.currency ?? 'AED',
      method,
      initiatedBy: 'LESSEE',
      initiatedByUser: ctx.userId,
    });

    const intent = await createPaymentIntent({
      tenantId: ctx.tenantId,
      invoiceId: invoice.id,
      lesseeId: ctx.lesseeId,
      amount: Number(invoice.totalAmount),
      currency: invoice.currency ?? 'AED',
      provider: result.provider,
      providerRef: result.providerRef,
      method,
      initiatedBy: 'LESSEE',
      initiatedByUser: ctx.userId,
      referenceCode: result.referenceCode,
    });

    return NextResponse.json({ ok: true, intent, instructions: result.instructions, checkoutUrl: result.checkoutUrl });
  } catch (e) {
    console.error('[leasing-portal/invoices/pay]', e);
    return NextResponse.json({ error: 'Failed to initiate payment' }, { status: 500 });
  }
}
