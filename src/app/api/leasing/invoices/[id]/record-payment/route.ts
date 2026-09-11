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
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { createPaymentIntent, confirmPaymentIntent } from '@/lib/leasing/payment-intents-store';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      // Concurrency lock for payments in this tenant
      const { lockSerialSeries } = await import('@/lib/leasing/serial-lock');
      await lockSerialSeries(tx, tenantId, 'payment');

      const invoice = await tx.leaseInvoice.findFirst({
        where: { id: params.id, tenantId },
        include: { lines: true },
      });
      if (!invoice) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
      if (invoice.status === 'PAID') {
        return NextResponse.json({ error: 'Invoice is already marked paid' }, { status: 409 });
      }
      if (invoice.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Cannot record payment on cancelled invoice' }, { status: 400 });
      }

      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(bodyRaw) as {
        intentId?: string;
        amount?: number;
        method?: string;
        bankRef?: string;
        notes?: string;
      };
      const confirmedBy = req.headers.get('x-user-id') ?? 'staff';

      // Outstanding balance calculation
      const paidRows = await tx.$queryRawUnsafe<Array<{ total_paid: string | null }>>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total_paid
         FROM lease_payment_intents
         WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'RECEIVED'`,
        tenantId,
        invoice.id,
      );
      const currentPaid = Number(paidRows[0]?.total_paid || 0);
      const invoiceTotal = Number(invoice.totalAmount);
      const outstandingBalance = Math.round((invoiceTotal - currentPaid + Number.EPSILON) * 100) / 100;

      // Payment amount validation
      const amount = body.amount != null ? Number(body.amount) : outstandingBalance;
      if (isNaN(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Payment amount must be a positive number' }, { status: 400 });
      }

      // Overpayment policy: reject payment exceeding outstanding balance
      if (amount > outstandingBalance + 0.005) {
        return NextResponse.json({
          error: `Payment amount (${amount}) exceeds outstanding balance (${outstandingBalance})`,
          outstandingBalance,
        }, { status: 400 });
      }

      // Duplicate payment submission guard by bankRef
      const bankRef = body.bankRef ? String(body.bankRef).trim() : null;
      if (bankRef) {
        const dupRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text FROM lease_payment_intents
           WHERE tenant_id = $1 AND invoice_id = $2 AND (reference_code = $3 OR provider_ref = $3) AND status = 'RECEIVED'
           LIMIT 1`,
          tenantId,
          invoice.id,
          bankRef,
        );
        if (dupRows.length > 0) {
          return NextResponse.json({
            error: `Payment with reference '${bankRef}' has already been recorded for this invoice`,
          }, { status: 409 });
        }
      }

      const referenceCode = bankRef || `MANUAL-${Date.now().toString().slice(-6)}`;

      // Create LeaseReceipt if tied to a contract
      const contractLine = invoice.lines.find((l) => l.contractId);
      const contractId = contractLine?.contractId;

      let receiptId: string | null = null;
      if (contractId) {
        const receipt = await tx.leaseReceipt.create({
          data: {
            receiptNumber: `RCP-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
            contractId,
            paymentType: 'MONTHLY',
            amount,
            currency: invoice.currency ?? 'AED',
            receivedDate: new Date(),
            paymentMethod: body.method ?? 'BANK_TRANSFER',
            bankRef: bankRef ?? referenceCode,
            receivedBy: confirmedBy,
            notes: body.notes ?? `Payment recorded against invoice ${invoice.invoiceNo}`,
            tenantId,
          },
        });
        receiptId = receipt.id;
      }

      // Record payment intent atomically
      const intentRows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO lease_payment_intents
           (tenant_id, invoice_id, lessee_id, amount, currency, provider, provider_ref,
            method, status, initiated_by, initiated_by_user, reference_code, notes,
            confirmed_at, confirmed_by, receipt_id)
         VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, 'RECEIVED', 'STAFF', $8, $9, $10, NOW(), $8, $11)
         RETURNING id::text, status, amount::text, currency, reference_code`,
        tenantId,
        invoice.id,
        invoice.lesseeId,
        amount,
        invoice.currency ?? 'AED',
        bankRef,
        body.method ?? 'BANK_TRANSFER',
        confirmedBy,
        referenceCode,
        body.notes ?? null,
        receiptId,
      );
      const intent = intentRows[0];

      // Update invoice status based on remaining balance
      const newTotalPaid = Math.round((currentPaid + amount + Number.EPSILON) * 100) / 100;
      const newOutstanding = Math.max(0, Math.round((invoiceTotal - newTotalPaid + Number.EPSILON) * 100) / 100);
      const isFullyPaid = newOutstanding <= 0.005;

      await tx.leaseInvoice.update({
        where: { id: invoice.id },
        data: {
          status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
          paidAt: isFullyPaid ? new Date() : invoice.paidAt,
          paymentRef: referenceCode,
        },
      });

      return NextResponse.json({
        ok: true,
        intent: {
          id: intent?.id,
          status: intent?.status ?? 'RECEIVED',
          referenceCode: intent?.reference_code ?? referenceCode,
        },
        receiptId,
        amountPaid: amount,
        totalPaid: newTotalPaid,
        outstandingBalance: newOutstanding,
        status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
        invoice: {
          id: invoice.id,
          status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
          outstandingBalance: newOutstanding,
          totalPaid: newTotalPaid,
        },
      }, { status: 200 });
    } catch (e: any) {
      console.error('[leasing/invoices/record-payment]', e);
      return NextResponse.json({ error: e?.message || 'Failed to record payment' }, { status: 500 });
    }
  });
}
