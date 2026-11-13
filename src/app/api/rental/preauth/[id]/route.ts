export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/preauth/[id]
 *
 * Staff endpoint to capture (`{ action: 'capture', amount?: number, invoiceId?: string }`,
 * gated by `rental:create:preauth`) or release (`{ action: 'release', notes?: string }`,
 * gated by `rental:approve:deposits`) a `rac_card_preauths` card hold.
 *
 * Executes in 3 lock-safe phases so no PostgreSQL `FOR UPDATE` row lock or DB
 * connection is ever held across external payment gateway HTTP I/O.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import { postRacInvoicePaymentGl } from '@/lib/finance/rac-gl-posting';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { nextRentalSerial, withInvoicePaymentLock } from '@/lib/rental/locks';
import { RentalSecurityError, isRentalSecurityError } from '@/lib/rental/security-guards';
import { getRacPreAuthProvider } from '@/lib/rac-portal/preauth-provider';
import {
  finalizeCapturedPreAuthInTx,
  finalizeReleasedPreAuthInTx,
  incrementRacCardPreAuth,
  lockAndClaimPreAuthInTx,
  revertPreAuthClaim,
  toPublicRacPreAuth,
} from '@/lib/rac-portal/preauth-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const preauthActionSchema = z.object({
  action: z
    .enum(['capture', 'release', 'increment', 'CAPTURE', 'RELEASE', 'INCREMENT'])
    .transform((v) => v.toLowerCase() as 'capture' | 'release' | 'increment'),
  amount: z.coerce.number().positive().optional(),
  additionalAmount: z.coerce.number().positive().optional(),
  invoiceId: z.string().trim().min(1).optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  if (!UUID_RE.test(params.id ?? '')) {
    return NextResponse.json({ error: 'Invalid pre-authorization ID' }, { status: 400 });
  }

  const jsonRaw = await req.json().catch(() => null);
  const json = stripTenantOwnershipFields(
    (jsonRaw && typeof jsonRaw === 'object' ? jsonRaw : {}) as Record<string, unknown>,
  );
  const parsed = preauthActionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (data.action === 'release') {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'deposits',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  } else {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'create',
      'preauth',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  }

  const actorId = req.headers.get('x-user-id')?.trim() || 'staff';

  try {
    // ── INCREMENT (3-phase lock-safe incremental hold authorization) ──────────
    if (data.action === 'increment') {
      const incrementAmt = Number(data.additionalAmount ?? data.amount ?? 0);
      if (!(incrementAmt > 0)) {
        return NextResponse.json(
          { error: 'additionalAmount (or amount) must be greater than zero for INCREMENT' },
          { status: 400 },
        );
      }

      const { preauth, increment } = await incrementRacCardPreAuth({
        tenantId,
        preauthId: params.id,
        additionalAmount: incrementAmt,
        reason: data.reason ?? data.notes ?? null,
        initiatedByUser: actorId,
      });

      void logAudit({
        tenantId,
        userId: req.headers.get('x-user-id') ?? undefined,
        userRole: req.headers.get('x-user-role') ?? undefined,
        entityType: 'RacCardPreAuth',
        entityId: preauth.id,
        entityName: preauth.authorizationCode,
        action: 'UPDATE',
        details: `Incremented card pre-authorization hold ${preauth.authorizationCode} by ${preauth.currency} ${increment.additionalAmount.toFixed(2)} to ${preauth.currency} ${preauth.amount.toFixed(2)}.`,
      });

      return NextResponse.json({
        ok: true,
        preauth: toPublicRacPreAuth(preauth),
        increment,
      });
    }

    // ── RELEASE (3-phase lock-safe execution) ─────────────────────────────────
    if (data.action === 'release') {
      // Phase 1 (Short RLS tx): SELECT ... FOR UPDATE, validate AUTHORIZED, claim RELEASING & commit
      const hold = await withTenantRls(prisma, tenantId, async (tx) => {
        const claimed = await lockAndClaimPreAuthInTx(tx, {
          tenantId,
          preauthId: params.id,
          claimStatus: 'RELEASING',
        });
        if (!claimed) {
          throw new RentalSecurityError(
            404,
            'PREAUTH_NOT_FOUND',
            'Pre-authorization hold not found',
          );
        }
        if (claimed.status !== 'AUTHORIZED') {
          throw new RentalSecurityError(
            409,
            'INVALID_PREAUTH_STATUS',
            `Cannot release hold in status ${claimed.status}`,
          );
        }
        return claimed;
      });

      // Phase 2 (Outside DB tx): execute external gateway HTTP call with zero DB locks held
      const releaseGateway = getRacPreAuthProvider(hold.provider);
      try {
        await releaseGateway.releaseHold({
          providerIntentId: hold.providerIntentId ?? hold.id,
        });
      } catch (gatewayErr) {
        await revertPreAuthClaim(tenantId, params.id, 'RELEASING');
        const msg =
          gatewayErr instanceof Error
            ? gatewayErr.message
            : 'Gateway failed to release pre-authorization hold';
        return NextResponse.json({ error: msg, code: 'GATEWAY_RELEASE_FAILED' }, { status: 502 });
      }

      // Phase 3 (Short RLS tx): finalize RELEASED status & refund agreement deposit status
      const preauth = await withTenantRls(prisma, tenantId, (tx) =>
        finalizeReleasedPreAuthInTx(tx, {
          tenantId,
          preauthId: params.id,
          notes: data.notes ?? null,
          agreementId: hold.agreementId,
        }),
      );

      void logAudit({
        tenantId,
        userId: req.headers.get('x-user-id') ?? undefined,
        userRole: req.headers.get('x-user-role') ?? undefined,
        entityType: 'RacCardPreAuth',
        entityId: preauth.id,
        entityName: preauth.authorizationCode,
        action: 'UPDATE',
        details: `Released card pre-authorization hold ${preauth.authorizationCode} (${preauth.currency} ${preauth.amount}).`,
      });

      return NextResponse.json({ ok: true, preauth: toPublicRacPreAuth(preauth) });
    }

    // ── CAPTURE (3-phase lock-safe execution) ─────────────────────────────────
    // Phase 1 (Short RLS tx): SELECT ... FOR UPDATE, validate hold + invoice, claim CAPTURING & commit
    const { hold, requestedCapture, targetInvoiceId } = await withTenantRls(
      prisma,
      tenantId,
      async (tx) => {
        const claimed = await lockAndClaimPreAuthInTx(tx, {
          tenantId,
          preauthId: params.id,
          claimStatus: 'CAPTURING',
        });
        if (!claimed) {
          throw new RentalSecurityError(
            404,
            'PREAUTH_NOT_FOUND',
            'Pre-authorization hold not found',
          );
        }
        if (claimed.status !== 'AUTHORIZED') {
          throw new RentalSecurityError(
            409,
            'INVALID_PREAUTH_STATUS',
            `Cannot capture hold in status ${claimed.status}`,
          );
        }

        const remainingHoldAmount = Math.max(
          0,
          Number((Number(claimed.amount ?? 0) - Number(claimed.capturedAmount ?? 0)).toFixed(2)),
        );
        const amountToCapture =
          data.amount != null ? Number(data.amount) : remainingHoldAmount;

        if (!(amountToCapture > 0) || amountToCapture > remainingHoldAmount + 0.0001) {
          throw new RentalSecurityError(
            422,
            'INVALID_CAPTURE_AMOUNT',
            `Capture amount must be between 0.01 and ${remainingHoldAmount.toFixed(2)}`,
          );
        }

        const resolvedInvoiceId = data.invoiceId ?? claimed.invoiceId ?? null;
        if (resolvedInvoiceId) {
          await withInvoicePaymentLock(tx, tenantId, resolvedInvoiceId, async () => {
            const invRows = await tx.$queryRawUnsafe<
              Array<{
                id: string;
                customer_id: string | null;
                corporate_account_id: string | null;
                status: string;
                invoice_type: string | null;
                currency: string | null;
                total_amount: string;
                paid_amount: string | null;
                balance_due: string | null;
              }>
            >(
              `SELECT id,
                      customer_id,
                      corporate_account_id,
                      status,
                      invoice_type,
                      currency,
                      total_amount::text AS total_amount,
                      paid_amount::text AS paid_amount,
                      balance_due::text AS balance_due
                 FROM rental_invoices
                WHERE id = $1
                  AND tenant_id::text = $2
                  AND deleted_at IS NULL
                LIMIT 1
                FOR UPDATE`,
              resolvedInvoiceId,
              tenantId,
            );
            const inv = invRows[0];
            if (
              !inv ||
              (inv.customer_id !== claimed.customerId &&
                inv.corporate_account_id !== claimed.customerId)
            ) {
              throw new RentalSecurityError(
                404,
                'INVOICE_NOT_FOUND',
                'Target invoice not found for pre-authorization customer',
              );
            }

            const invStatusUpper = String(inv.status ?? '').toUpperCase();
            const invTypeUpper = String(inv.invoice_type ?? 'STANDARD').toUpperCase();
            if (
              ['DRAFT', 'PAID', 'VOID', 'CANCELLED', 'CREDIT_NOTE'].includes(invStatusUpper) ||
              invTypeUpper === 'CREDIT_NOTE'
            ) {
              throw new RentalSecurityError(
                409,
                'INVOICE_NOT_PAYABLE',
                `Cannot capture pre-authorization against ${invTypeUpper === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : invStatusUpper} invoice`,
              );
            }

            const totalAmt = Number(inv.total_amount ?? 0);
            const paidAmt = Number(inv.paid_amount ?? 0);
            const currentBalance =
              inv.balance_due != null
                ? Number(inv.balance_due)
                : Math.max(0, Number((totalAmt - paidAmt).toFixed(2)));

            if (amountToCapture > currentBalance + 0.01) {
              throw new RentalSecurityError(
                422,
                'CAPTURE_EXCEEDS_BALANCE',
                `Capture amount (${amountToCapture.toFixed(2)}) exceeds invoice balance due (${currentBalance.toFixed(2)})`,
              );
            }
          });
        }

        return {
          hold: claimed,
          requestedCapture: amountToCapture,
          targetInvoiceId: resolvedInvoiceId,
        };
      },
    );

    // Phase 2 (Outside DB tx): execute external gateway captureHold with zero DB locks held
    const captureGateway = getRacPreAuthProvider(hold.provider);
    try {
      await captureGateway.captureHold({
        providerIntentId: hold.providerIntentId ?? hold.id,
        amount: requestedCapture,
        currency: hold.currency,
      });
    } catch (gatewayErr) {
      await revertPreAuthClaim(tenantId, params.id, 'CAPTURING');
      const msg =
        gatewayErr instanceof Error
          ? gatewayErr.message
          : 'Gateway failed to capture pre-authorization hold';
      return NextResponse.json({ error: msg, code: 'GATEWAY_CAPTURE_FAILED' }, { status: 402 });
    }

    // Phase 3 (Short RLS tx): finalize CAPTURED, settle invoice under withInvoicePaymentLock & post GL
    const { preauth, reconciledInvoiceId } = await withTenantRls(
      prisma,
      tenantId,
      async (tx) => {
        const finalizeAndSettle = async () => {
          const capturedPreauth = await finalizeCapturedPreAuthInTx(tx, {
            tenantId,
            preauthId: params.id,
            customerId: hold.customerId,
            capturedAmount: requestedCapture,
            invoiceId: targetInvoiceId,
          });

          if (targetInvoiceId && capturedPreauth.capturedAmount > 0) {
            const invRows = await tx.$queryRawUnsafe<
              Array<{
                id: string;
                invoice_no: string;
                currency: string | null;
              }>
            >(
              `SELECT id, invoice_no, currency
                 FROM rental_invoices
                WHERE id = $1
                  AND tenant_id::text = $2
                  AND deleted_at IS NULL
                LIMIT 1
                FOR UPDATE`,
              targetInvoiceId,
              tenantId,
            );
            const liveInv = invRows[0];

            if (liveInv) {
              const receiptNo = await nextRentalSerial(tx, {
                tenantId,
                series: 'rental-receipt',
                prefix: 'RRCPT-',
                table: 'rental_invoice_payments',
                column: 'receipt_no',
                padWidth: 6,
              });
              const paymentId = crypto.randomUUID();
              const nowIso = new Date().toISOString();
              const effectiveCurrency = liveInv.currency ?? capturedPreauth.currency ?? 'AED';

              await tx.$executeRawUnsafe(
                `INSERT INTO rental_invoice_payments
                   (id, tenant_id, invoice_id, receipt_no, paid_at, payment_date,
                    amount, currency, payment_method, reference_no, notes, received_by, created_at)
                 VALUES
                   ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz,
                    $6, $7, 'CARD', $8, $9, $10, $5::timestamptz)`,
                paymentId,
                tenantId,
                targetInvoiceId,
                receiptNo,
                nowIso,
                capturedPreauth.capturedAmount,
                effectiveCurrency,
                capturedPreauth.authorizationCode,
                data.notes ?? 'Captured from card pre-authorization hold',
                actorId,
              );

              await tx.$executeRawUnsafe(
                `UPDATE rental_invoices
                    SET paid_amount = ROUND((COALESCE(paid_amount, 0) + $1::numeric)::numeric, 2),
                        balance_due = GREATEST(0, ROUND((total_amount - (COALESCE(paid_amount, 0) + $1::numeric))::numeric, 2)),
                        status = CASE
                          WHEN GREATEST(0, ROUND((total_amount - (COALESCE(paid_amount, 0) + $1::numeric))::numeric, 2)) <= 0
                            THEN 'PAID'
                          ELSE 'PARTIALLY_PAID'
                        END,
                        paid_at = CASE
                          WHEN GREATEST(0, ROUND((total_amount - (COALESCE(paid_amount, 0) + $1::numeric))::numeric, 2)) <= 0
                            THEN $2::timestamptz
                          ELSE paid_at
                        END,
                        updated_at = $2::timestamptz
                  WHERE id = $3
                    AND tenant_id::text = $4
                    AND deleted_at IS NULL`,
                capturedPreauth.capturedAmount,
                nowIso,
                targetInvoiceId,
                tenantId,
              );

              await postRacInvoicePaymentGl(tx, {
                tenantId,
                paymentId,
                receiptNo,
                invoiceNo: liveInv.invoice_no,
                amount: capturedPreauth.capturedAmount,
                paymentMethod: 'PREAUTH_CAPTURE',
                paidAt: nowIso,
                currency: effectiveCurrency,
                preparedBy: actorId,
              });

              return { preauth: capturedPreauth, reconciledInvoiceId: targetInvoiceId };
            }
          }

          return { preauth: capturedPreauth, reconciledInvoiceId: null as string | null };
        };

        if (targetInvoiceId) {
          return withInvoicePaymentLock(tx, tenantId, targetInvoiceId, finalizeAndSettle);
        }
        return finalizeAndSettle();
      },
    );

    if (reconciledInvoiceId) {
      await mirrorRentalInvoiceToFinance(
        reconciledInvoiceId,
        tenantId,
        'rental-preauth-capture',
      ).catch((err) => console.warn('[preauth capture] finance mirror failed:', err));
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RacCardPreAuth',
      entityId: preauth.id,
      entityName: preauth.authorizationCode,
      action: 'UPDATE',
      details: `Captured ${preauth.currency} ${preauth.capturedAmount} from card pre-authorization ${preauth.authorizationCode}${reconciledInvoiceId ? ` against invoice ${reconciledInvoiceId}` : ''}.`,
    });

    return NextResponse.json({ ok: true, preauth: toPublicRacPreAuth(preauth) });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : '';
    if (message.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: 'Pre-authorization hold not found' }, { status: 404 });
    }
    if (
      message.toLowerCase().includes('cannot capture') ||
      message.toLowerCase().includes('cannot release') ||
      message.toLowerCase().includes('cannot increment')
    ) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (
      message.toLowerCase().includes('capture amount must be') ||
      message.toLowerCase().includes('incremental') ||
      message.toLowerCase().includes('declined') ||
      message.toLowerCase().includes('rejected')
    ) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    console.error('POST /api/rental/preauth/[id] error:', err);
    return NextResponse.json({ error: 'Pre-authorization action failed' }, { status: 500 });
  }
}
