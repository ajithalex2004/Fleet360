export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import { getRacPreAuthProvider, type CardPreAuthResult } from '@/lib/rac-portal/preauth-provider';
import {
  authorizeGatewayHold,
  bestEffortReleaseGatewayHold,
  finalizeCapturedPreAuthInTx,
  lockAndClaimPreAuthInTx,
  recordAuthorizedPreAuthInTx,
  revertPreAuthClaim,
  toPublicRacPreAuth,
  type RacCardPreAuth,
} from '@/lib/rac-portal/preauth-store';
import { nextRentalSerial, withInvoicePaymentLock } from '@/lib/rental/locks';
import { postRacInvoicePaymentGl } from '@/lib/finance/rac-gl-posting';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import {
  enforceRacPortalPaymentRateLimit,
  FINANCE_SIGN_RAC_PORTAL_ROLES,
  requireRacPortalRole,
} from '../../../_helpers';

const PayInvoiceSchema = z
  .object({
    amount: z.number().positive().max(500_000).optional(),
    preauthId: z.string().uuid().optional(),
    cardToken: z.string().trim().min(3).max(160).optional(),
    cardBrand: z.string().trim().min(2).max(32).optional(),
    cardLast4: z.string().regex(/^\d{4}$/).optional(),
    cardholderName: z.string().trim().min(2).max(120).optional(),
    expiryMonth: z.number().int().min(1).max(12).optional(),
    expiryYear: z.number().int().min(2024).max(2099).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

class PortalInvoicePayError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'PortalInvoicePayError';
    this.statusCode = statusCode;
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireRacPortalRole(
    req,
    FINANCE_SIGN_RAC_PORTAL_ROLES,
    'Corporate Finance (RAC_B2B_FINANCE) or B2B Admin (RAC_B2B_ADMIN) role is required to pay corporate invoices.',
  );
  if (ctx instanceof NextResponse) return ctx;

  const paymentRl = await enforceRacPortalPaymentRateLimit(ctx.customerId);
  if (paymentRl) return paymentRl;

  try {
    const { id } = await context.params;
    const rawBody = await req.json().catch(() => null);
    if (
      rawBody &&
      typeof rawBody === 'object' &&
      ('cardNumber' in rawBody || 'pan' in rawBody || 'cvv' in rawBody || 'cvc' in rawBody)
    ) {
      return NextResponse.json(
        { error: 'PCI-DSS violation blocked: raw card numbers and CVV must never be transmitted.' },
        { status: 400 },
      );
    }

    const sanitizedBody =
      rawBody && typeof rawBody === 'object'
        ? stripTenantOwnershipFields(rawBody as Record<string, unknown>)
        : rawBody;
    const parsed = PayInvoiceSchema.safeParse(sanitizedBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payment payload' },
        { status: 400 },
      );
    }

    const body = parsed.data;
    if (!body.preauthId && !body.cardholderName) {
      return NextResponse.json(
        { error: 'Select an existing AUTHORIZED card hold or provide tokenized card details.' },
        { status: 400 },
      );
    }

    const actorEmail = (ctx as { email?: string }).email ?? ctx.user.email;

    // ── Phase 1 (Short RLS tx + withInvoicePaymentLock): validate invoice & claim CAPTURING ──
    const phase1 = await withTenantRls(prisma, ctx.tenantId, async (tx) =>
      withInvoicePaymentLock(tx, ctx.tenantId, id, async () => {
        const invRows = await tx.$queryRawUnsafe<
          Array<{
            id: string;
            invoice_no: string;
            agreement_id: string | null;
            invoice_type: string | null;
            currency: string | null;
            total_amount: string | number;
            paid_amount: string | number | null;
            balance_due: string | number | null;
            status: string | null;
          }>
        >(
          `SELECT id, invoice_no, agreement_id, invoice_type, currency, total_amount, paid_amount, balance_due, status
             FROM rental_invoices
            WHERE id = $1
              AND tenant_id::text = $2
              AND customer_id = $3
              AND deleted_at IS NULL
            LIMIT 1
            FOR UPDATE`,
          id,
          ctx.tenantId,
          ctx.customerId,
        );
        const inv = invRows[0];
        if (!inv) {
          throw new PortalInvoicePayError('Invoice not found', 404);
        }

        const invStatus = String(inv.status ?? '').trim().toUpperCase();
        const invType = String(inv.invoice_type ?? 'STANDARD').trim().toUpperCase();
        if (
          ['DRAFT', 'PAID', 'VOID', 'CANCELLED', 'CREDIT_NOTE'].includes(invStatus) ||
          invType === 'CREDIT_NOTE' ||
          Number(inv.total_amount ?? 0) < 0
        ) {
          throw new PortalInvoicePayError(
            `Cannot pay an invoice in status ${invType === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : inv.status}`,
            409,
          );
        }

        const totalAmount = Number(inv.total_amount ?? 0);
        const paidAmount = Number(inv.paid_amount ?? 0);
        const balanceDue = Math.max(
          0,
          Number(
            (
              inv.balance_due != null
                ? Number(inv.balance_due)
                : totalAmount - paidAmount
            ).toFixed(2),
          ),
        );

        if (balanceDue <= 0.009) {
          throw new PortalInvoicePayError('Invoice already has zero balance due', 409);
        }

        if (body.amount != null && body.amount > balanceDue + 0.01) {
          throw new PortalInvoicePayError(
            `Payment amount (AED ${body.amount.toFixed(2)}) exceeds open balance due (AED ${balanceDue.toFixed(2)})`,
            400,
          );
        }

        let claimedPreauth: RacCardPreAuth | null = null;
        let remainingHoldAmount: number | null = null;

        if (body.preauthId) {
          const claimed = await lockAndClaimPreAuthInTx(tx, {
            tenantId: ctx.tenantId,
            preauthId: body.preauthId,
            customerId: ctx.customerId,
            claimStatus: 'CAPTURING',
          });
          if (!claimed) {
            throw new PortalInvoicePayError('Card pre-authorization hold not found', 404);
          }
          if (claimed.status !== 'AUTHORIZED') {
            throw new PortalInvoicePayError(
              `Selected pre-authorization hold is in status ${claimed.status} (must be AUTHORIZED)`,
              409,
            );
          }
          if (claimed.expiresAt && new Date(claimed.expiresAt).getTime() <= Date.now()) {
            throw new PortalInvoicePayError(
              'Selected card pre-authorization hold has expired and cannot be captured',
              409,
            );
          }
          if (
            (claimed.agreementId && claimed.agreementId !== inv.agreement_id) ||
            (claimed.bookingId && !claimed.agreementId)
          ) {
            throw new PortalInvoicePayError(
              'Selected card pre-authorization hold is tied to a different agreement or active reservation and cannot be captured for this invoice',
              409,
            );
          }
          remainingHoldAmount = Math.max(
            0,
            Number((claimed.amount - claimed.capturedAmount).toFixed(2)),
          );
          if (remainingHoldAmount <= 0.009) {
            throw new PortalInvoicePayError(
              'Selected card pre-authorization hold has zero remaining capturable balance',
              409,
            );
          }
          if (body.amount != null && body.amount > remainingHoldAmount + 0.01) {
            throw new PortalInvoicePayError(
              `Requested capture amount (AED ${body.amount.toFixed(2)}) exceeds authorized hold amount (AED ${remainingHoldAmount.toFixed(2)})`,
              400,
            );
          }
          claimedPreauth = claimed;
        }

        const requestedAmount = body.amount != null ? Number(body.amount) : balanceDue;
        const payAmount = Number(
          Math.min(
            balanceDue,
            remainingHoldAmount != null
              ? Math.min(requestedAmount, remainingHoldAmount)
              : requestedAmount,
          ).toFixed(2),
        );

        if (!(payAmount > 0)) {
          throw new PortalInvoicePayError('Payment amount must be greater than zero', 400);
        }

        return {
          invoiceId: inv.id,
          invoiceNo: inv.invoice_no,
          agreementId: inv.agreement_id,
          currency: inv.currency ?? 'AED',
          payAmount,
          claimedPreauth,
        };
      }),
    );

    // ── Phase 2 (Outside DB tx): perform external gateway authorize/capture with zero DB locks ──
    const gateway = getRacPreAuthProvider();
    let newGatewayHold: CardPreAuthResult | null = null;

    if (phase1.claimedPreauth) {
      try {
        await gateway.captureHold({
          providerIntentId: phase1.claimedPreauth.providerIntentId ?? phase1.claimedPreauth.id,
          amount: phase1.payAmount,
          currency: phase1.claimedPreauth.currency,
        });
      } catch (gatewayErr) {
        await revertPreAuthClaim(ctx.tenantId, phase1.claimedPreauth.id, 'CAPTURING');
        const msg =
          gatewayErr instanceof Error ? gatewayErr.message : 'Card payment declined by issuer';
        throw new PortalInvoicePayError(msg, 402);
      }
    } else {
      try {
        newGatewayHold = await authorizeGatewayHold({
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
          amount: phase1.payAmount,
          currency: phase1.currency,
          cardToken: body.cardToken ?? null,
          cardBrand: body.cardBrand ?? 'VISA',
          cardLast4: body.cardLast4 ?? '4242',
          cardholderName: body.cardholderName ?? ctx.user.fullName ?? actorEmail,
          expiryMonth: body.expiryMonth ?? null,
          expiryYear: body.expiryYear ?? null,
          notes: `Online B2B Invoice Payment for ${phase1.invoiceNo}`,
        });
      } catch (gatewayErr) {
        const msg =
          gatewayErr instanceof Error ? gatewayErr.message : 'Card payment declined by issuer';
        throw new PortalInvoicePayError(msg, 402);
      }

      try {
        await gateway.captureHold({
          providerIntentId: newGatewayHold.providerIntentId,
          amount: phase1.payAmount,
          currency: phase1.currency,
        });
      } catch (captureErr) {
        await bestEffortReleaseGatewayHold(newGatewayHold.providerIntentId);
        const msg =
          captureErr instanceof Error ? captureErr.message : 'Card capture declined by issuer';
        throw new PortalInvoicePayError(msg, 402);
      }
    }

    // ── Phase 3 (Short RLS tx + withInvoicePaymentLock): settle invoice, record receipt & post GL ──
    const result = await withTenantRls(prisma, ctx.tenantId, async (tx) =>
      withInvoicePaymentLock(tx, ctx.tenantId, id, async () => {
        const liveRows = await tx.$queryRawUnsafe<
          Array<{
            id: string;
            invoice_no: string;
            agreement_id: string | null;
            currency: string | null;
            total_amount: string | number;
            paid_amount: string | number | null;
            balance_due: string | number | null;
            status: string | null;
          }>
        >(
          `SELECT id, invoice_no, agreement_id, currency, total_amount, paid_amount, balance_due, status
             FROM rental_invoices
            WHERE id = $1
              AND tenant_id::text = $2
              AND customer_id = $3
              AND deleted_at IS NULL
            LIMIT 1
            FOR UPDATE`,
          id,
          ctx.tenantId,
          ctx.customerId,
        );
        const liveInv = liveRows[0];
        if (!liveInv) {
          throw new PortalInvoicePayError('Invoice not found during settlement', 404);
        }

        const totalAmount = Number(liveInv.total_amount ?? 0);
        const paidAmount = Number(liveInv.paid_amount ?? 0);
        const payAmount = phase1.payAmount;
        const effectiveCurrency = liveInv.currency ?? phase1.currency ?? 'AED';

        let capturedPreAuth: RacCardPreAuth;
        if (phase1.claimedPreauth) {
          capturedPreAuth = await finalizeCapturedPreAuthInTx(tx, {
            tenantId: ctx.tenantId,
            preauthId: phase1.claimedPreauth.id,
            customerId: ctx.customerId,
            capturedAmount: payAmount,
            invoiceId: liveInv.id,
          });
        } else {
          capturedPreAuth = await recordAuthorizedPreAuthInTx(
            tx,
            {
              tenantId: ctx.tenantId,
              customerId: ctx.customerId,
              agreementId: liveInv.agreement_id ?? null,
              invoiceId: liveInv.id,
              amount: payAmount,
              capturedAmount: payAmount,
              currency: effectiveCurrency,
              cardholderName: body.cardholderName ?? ctx.user.fullName ?? actorEmail,
              initiatedBy: 'PORTAL_USER',
              initiatedByUser: actorEmail,
              notes: `Online B2B Invoice Payment for ${liveInv.invoice_no}`,
              statusOverride: 'CAPTURED',
            },
            newGatewayHold!,
          );
        }

        const receiptNo = await nextRentalSerial(tx, {
          tenantId: ctx.tenantId,
          series: 'rental-receipt',
          prefix: 'RRCPT-',
          table: 'rental_invoice_payments',
          column: 'receipt_no',
          padWidth: 6,
        });
        const paymentId = crypto.randomUUID();
        const now = new Date();

        const payment = await tx.rentalInvoicePayment.create({
          data: {
            id: paymentId,
            tenantId: ctx.tenantId,
            invoiceId: liveInv.id,
            amount: payAmount,
            currency: effectiveCurrency,
            paymentMethod: 'ONLINE',
            referenceNo: capturedPreAuth.authorizationCode,
            receiptNo,
            paidAt: now,
            receivedBy: `B2B Portal (${actorEmail})`,
            notes:
              body.notes ??
              `Captured ${capturedPreAuth.cardBrand ?? 'CARD'} **** ${capturedPreAuth.cardLast4 ?? '0000'} (${capturedPreAuth.authorizationCode})`,
          },
        });

        const updatedInvRows = await tx.$queryRawUnsafe<
          Array<{
            total_amount: string;
            paid_amount: string;
            balance_due: string;
            status: string;
          }>
        >(
          `UPDATE rental_invoices
              SET paid_amount = ROUND((COALESCE(paid_amount, 0) + $1::numeric)::numeric, 2),
                  balance_due = ROUND(GREATEST(total_amount - (COALESCE(paid_amount, 0) + $1::numeric), 0)::numeric, 2),
                  status = CASE
                    WHEN (COALESCE(paid_amount, 0) + $1::numeric) >= total_amount - 0.01 THEN 'PAID'
                    ELSE 'PARTIAL'
                  END,
                  paid_at = CASE
                    WHEN (COALESCE(paid_amount, 0) + $1::numeric) >= total_amount - 0.01 THEN NOW()
                    ELSE paid_at
                  END,
                  updated_at = NOW()
            WHERE id = $2
              AND tenant_id::text = $3
              AND customer_id = $4
          RETURNING total_amount::text, paid_amount::text, balance_due::text, status`,
          payAmount,
          liveInv.id,
          ctx.tenantId,
          ctx.customerId,
        );
        const updatedInv = updatedInvRows[0];

        // Post balanced GL receipt entry: DR 1120 Cash at Bank / CR 1131 Trade Receivables — RAC
        await postRacInvoicePaymentGl(tx, {
          tenantId: ctx.tenantId,
          paymentId: payment.id,
          receiptNo: payment.receiptNo ?? receiptNo,
          invoiceNo: liveInv.invoice_no,
          amount: payAmount,
          paymentMethod: 'ONLINE',
          paidAt: now,
          currency: effectiveCurrency,
          preparedBy: actorEmail,
        });

        return {
          payment: {
            id: payment.id,
            receiptNo: payment.receiptNo,
            amount: Number(payment.amount),
            currency: payment.currency ?? 'AED',
            paymentMethod: payment.paymentMethod,
            referenceNo: payment.referenceNo,
            paidAt: payment.paidAt.toISOString(),
          },
          invoice: {
            id: liveInv.id,
            invoiceNo: liveInv.invoice_no,
            totalAmount: Number(updatedInv?.total_amount ?? totalAmount),
            paidAmount: Number(updatedInv?.paid_amount ?? (paidAmount + payAmount).toFixed(2)),
            balanceDue: Number(
              updatedInv?.balance_due ??
                Math.max(0, Number((totalAmount - paidAmount - payAmount).toFixed(2))),
            ),
            status: updatedInv?.status ?? 'PAID',
          },
          publicPreauth: toPublicRacPreAuth(capturedPreAuth),
        };
      }),
    );

    // Mirror updated invoice & receipt state to the Finance Ledger post-commit
    await mirrorRentalInvoiceToFinance(
      id,
      ctx.tenantId,
      actorEmail,
    ).catch((mirrorErr) => {
      console.warn('[rac-portal/invoices/[id]/pay] Finance ledger mirror failed:', mirrorErr);
    });

    return NextResponse.json({
      ok: true,
      payment: result.payment,
      invoice: result.invoice,
      preauth: result.publicPreauth,
    });
  } catch (err) {
    if (err instanceof PortalInvoicePayError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[rac-portal/invoices/[id]/pay] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to process online invoice payment' },
      { status: 500 },
    );
  }
}
