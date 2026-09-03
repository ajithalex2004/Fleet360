/**
 * GET /api/leasing-portal/invoices
 * Lists the authenticated lessee's own invoices, each with its most
 * recent payment intent (if any) so the portal can show "payment
 * pending confirmation" state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { listPaymentIntentsForLessee } from '@/lib/leasing/payment-intents-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  const [invoices, intents] = await Promise.all([
    prisma.leaseInvoice.findMany({
      where: { tenantId: ctx.tenantId, lesseeId: ctx.lesseeId },
      include: { lines: true },
      orderBy: { issueDate: 'desc' },
    }),
    listPaymentIntentsForLessee(ctx.tenantId, ctx.lesseeId),
  ]);

  const latestIntentByInvoice = new Map<string, (typeof intents)[number]>();
  for (const intent of intents) {
    if (!latestIntentByInvoice.has(intent.invoiceId)) {
      latestIntentByInvoice.set(intent.invoiceId, intent);
    }
  }

  const withIntents = invoices.map(inv => ({
    ...inv,
    pendingPayment: (() => {
      const intent = latestIntentByInvoice.get(inv.id);
      return intent && intent.status === 'PENDING' ? intent : null;
    })(),
  }));

  return NextResponse.json(withIntents);
}
