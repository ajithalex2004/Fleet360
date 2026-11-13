export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/agreements/[id]/refund-deposit
 *
 * Enforces strict post-closure deposit settlement guards:
 *   1. Blocks `DRAFT`, `ACTIVE`, AND `COMPLETED` (un-invoiced counter return) agreements
 *      with `422` — only `CLOSED` (or `CANCELLED` with zero balance) agreements may settle deposits.
 *   2. Guards against unsettled liabilities (`422 UNSETTLED_LIABILITIES`) across:
 *        - Unpaid / partial `rental_invoices` (`balance_due > 0.01`)
 *        - Unbilled `traffic_fines` (`COALESCE(is_billed_to_customer, FALSE) = FALSE` & `status NOT IN ('PAID', 'WAIVED')`)
 *        - Unbilled `toll_transactions` (`is_billed_to_customer = FALSE`)
 *        - Uninvoiced `damage_claims` (`billed_to_customer = FALSE` & `status NOT IN ('CLOSED', 'WAIVED')`)
 *      unless `allowManagerOverride: true` is supplied with `rental:approve:agreements` + explicit `overrideReason`.
 *   3. Distinguishes off-balance-sheet card pre-authorization holds (`rac_card_preauths` `AUTHORIZED`)
 *      from collected cash/bank deposits (`2150`):
 *        - Uncaptured card pre-auth hold -> 3-phase `releaseRacCardPreAuth` outside RLS + `deposit_status = 'RELEASED'`
 *          (ZERO negative `rental_payments` row, ZERO `DR 2150 / CR 1120` GL cash outflow).
 *        - Collected cash/card deposit -> `startRefundRequest` + `postRacSecurityDepositRefundGl` + negative `DEPOSIT_REFUND` payment.
 */
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { nextDocumentNumber } from '@/lib/finance/document-number';
import {
  postRacSecurityDepositRefundGl,
  recordRacSecurityDepositCollected,
} from '@/lib/finance/rac-gl-posting';
import { startRefundRequest, SecurityDepositError } from '@/lib/finance/security-deposit';
import { approvalRequired, withApprovalStart } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import {
  releaseRacCardPreAuth,
  toPublicRacPreAuth,
} from '@/lib/rac-portal/preauth-store';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'deposits',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const body = stripTenantOwnershipFields(
    await req.json().catch(() => ({})),
  ) as Record<string, unknown>;

  const allowManagerOverride =
    body.allowManagerOverride === true || body.forceOverride === true;
  const overrideReason =
    typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '';

  if (allowManagerOverride) {
    const agrOverrideDenied = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'agreements',
      req.nextUrl.pathname,
    );
    if (agrOverrideDenied) return agrOverrideDenied;
    if (!overrideReason) {
      return NextResponse.json(
        {
          error: 'Explicit overrideReason is required when allowManagerOverride is enabled',
          code: 'OVERRIDE_REASON_REQUIRED',
        },
        { status: 400 },
      );
    }
  }

  const needsApproval = await approvalRequired(tenantId, 'finance_deposit_refund');
  const actor =
    (await sessionUser(req.headers).catch(() => null))?.email ??
    req.headers.get('x-user-id') ??
    'staff';

  type Phase1Result =
    | { kind: 'http'; response: NextResponse; depositId: string | null }
    | {
        kind: 'preauth_release';
        preauthId: string;
        agreementId: string;
        agreementNo: string | null;
      };

  const phase1 = await withTenantRls<Phase1Result>(prisma, tenantId, async (tx) => {
    try {
      const agreement = await tx.rentalAgreement.findFirst({
        where: { id: params.id, tenantId },
      });
      if (!agreement) {
        return {
          kind: 'http',
          response: NextResponse.json({ error: 'Agreement not found' }, { status: 404 }),
          depositId: null,
        };
      }

      const agrStatus = (agreement.status ?? 'DRAFT').toUpperCase();
      if (agrStatus !== 'CLOSED' && agrStatus !== 'CANCELLED') {
        return {
          kind: 'http',
          response: NextResponse.json(
            {
              error: 'Security deposit can only be refunded after the agreement is CLOSED and settled',
              code: 'AGREEMENT_NOT_CLOSED',
              currentStatus: agrStatus,
            },
            { status: 422 },
          ),
          depositId: null,
        };
      }

      const currentDepStatus = (agreement.depositStatus ?? 'PENDING').toUpperCase();
      if (currentDepStatus !== 'PAID' && currentDepStatus !== 'HELD' && currentDepStatus !== 'AUTHORIZED') {
        return {
          kind: 'http',
          response: NextResponse.json(
            {
              error:
                currentDepStatus === 'REFUND_REQUESTED'
                  ? 'A refund is already requested for this deposit'
                  : `The deposit is ${agreement.depositStatus ?? 'PENDING'}: only a paid or held deposit can be refunded`,
            },
            { status: 409 },
          ),
          depositId: null,
        };
      }

      const collected = Number(agreement.securityDeposit ?? 0);
      if (!(collected > 0)) {
        return {
          kind: 'http',
          response: NextResponse.json(
            { error: 'This agreement has no security deposit' },
            { status: 400 },
          ),
          depositId: null,
        };
      }

      const hasRawSql = typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function';

      // ── Unsettled Liabilities Guard (Invoices, Traffic Fines, Tolls, Damage Claims) ──
      if (hasRawSql) {
        // 1. Unpaid / partially paid rental invoices
        const invAgg = await withSavepoint(
          tx,
          'refund_chk_unpaid_inv',
          () =>
            tx.$queryRawUnsafe<Array<{ cnt: number; due: number | string }>>(
              `SELECT COUNT(*)::int AS cnt,
                      COALESCE(SUM(COALESCE(balance_due, total_amount - COALESCE(paid_amount, 0), 0)), 0) AS due
                 FROM rental_invoices
                WHERE agreement_id = $1
                  AND tenant_id::text = $2
                  AND deleted_at IS NULL
                  AND UPPER(COALESCE(status, '')) NOT IN ('PAID', 'VOID', 'CANCELLED', 'CREDITED')
                  AND COALESCE(balance_due, total_amount - COALESCE(paid_amount, 0), 0) > 0.01`,
              agreement.id,
              tenantId,
            ),
          [{ cnt: 0, due: 0 }],
        );
        const unpaidInvoicesCount = Number(invAgg[0]?.cnt ?? 0);
        const unpaidInvoicesAmount = round2(Number(invAgg[0]?.due ?? 0));

        if (agrStatus === 'CANCELLED' && unpaidInvoicesAmount > 0.01) {
          return {
            kind: 'http',
            response: NextResponse.json(
              {
                error: 'Security deposit can only be refunded after the agreement is CLOSED and settled',
                code: 'CANCELLED_AGREEMENT_HAS_BALANCE',
                balanceDue: unpaidInvoicesAmount,
              },
              { status: 422 },
            ),
            depositId: null,
          };
        }

        // 2. Unbilled traffic fines (with fallback if is_billed_to_customer column not yet migrated)
        let fineAgg = await withSavepoint<Array<{ cnt: number; amt: number | string }> | null>(
          tx,
          'refund_chk_unbilled_fines_v2',
          () =>
            tx.$queryRawUnsafe<Array<{ cnt: number; amt: number | string }>>(
              `SELECT COUNT(*)::int AS cnt,
                      COALESCE(SUM(COALESCE(fine_amount, 0) + COALESCE(knowledge_fee, 0) + COALESCE(admin_fee, 0)), 0) AS amt
                 FROM traffic_fines
                WHERE tenant_id::text = $1
                  AND rental_agreement_id = $2
                  AND COALESCE(is_billed_to_customer, FALSE) = FALSE
                  AND UPPER(COALESCE(status, 'UNPAID')) NOT IN ('PAID', 'WAIVED')`,
              tenantId,
              agreement.id,
            ),
          null,
        );
        if (fineAgg === null) {
          fineAgg = await withSavepoint(
            tx,
            'refund_chk_unbilled_fines_v1',
            () =>
              tx.$queryRawUnsafe<Array<{ cnt: number; amt: number | string }>>(
                `SELECT COUNT(*)::int AS cnt,
                        COALESCE(SUM(COALESCE(fine_amount, 0)), 0) AS amt
                   FROM traffic_fines
                  WHERE tenant_id::text = $1
                    AND rental_agreement_id = $2
                    AND UPPER(COALESCE(status, 'UNPAID')) NOT IN ('PAID', 'WAIVED')`,
                tenantId,
                agreement.id,
              ),
            [{ cnt: 0, amt: 0 }],
          );
        }
        const unbilledFinesCount = Number(fineAgg[0]?.cnt ?? 0);
        const unbilledFinesAmount = round2(Number(fineAgg[0]?.amt ?? 0));

        // 3. Unbilled Salik / Darb toll crossings
        const tollAgg = await withSavepoint(
          tx,
          'refund_chk_unbilled_tolls',
          () =>
            tx.$queryRawUnsafe<Array<{ cnt: number; amt: number | string }>>(
              `SELECT COUNT(*)::int AS cnt,
                      COALESCE(SUM(COALESCE(amount, 0) + COALESCE(admin_fee, 0)), 0) AS amt
                 FROM toll_transactions
                WHERE tenant_id::text = $1
                  AND rental_agreement_id = $2
                  AND COALESCE(is_billed_to_customer, FALSE) = FALSE`,
              tenantId,
              agreement.id,
            ),
          [{ cnt: 0, amt: 0 }],
        );
        const unbilledTollsCount = Number(tollAgg[0]?.cnt ?? 0);
        const unbilledTollsAmount = round2(Number(tollAgg[0]?.amt ?? 0));

        // 4. Uninvoiced damage claims
        let dmgAgg = await withSavepoint<Array<{ cnt: number; amt: number | string }> | null>(
          tx,
          'refund_chk_damage_v2',
          () =>
            tx.$queryRawUnsafe<Array<{ cnt: number; amt: number | string }>>(
              `SELECT COUNT(*)::int AS cnt,
                      COALESCE(SUM(COALESCE(actual_cost, estimated_cost, 0)), 0) AS amt
                 FROM damage_claims
                WHERE tenant_id::text = $1
                  AND (agreement_id = $2 OR ($3::text IS NOT NULL AND booking_id = $3))
                  AND COALESCE(billed_to_customer, FALSE) = FALSE
                  AND UPPER(COALESCE(status, 'OPEN')) NOT IN ('CLOSED', 'WAIVED', 'SETTLED', 'REJECTED', 'PAID')`,
              tenantId,
              agreement.id,
              agreement.bookingId ?? null,
            ),
          null,
        );
        if (dmgAgg === null && agreement.bookingId) {
          dmgAgg = await withSavepoint(
            tx,
            'refund_chk_damage_v1',
            () =>
              tx.$queryRawUnsafe<Array<{ cnt: number; amt: number | string }>>(
                `SELECT COUNT(*)::int AS cnt,
                        COALESCE(SUM(COALESCE(actual_cost, estimated_cost, 0)), 0) AS amt
                   FROM damage_claims
                  WHERE tenant_id::text = $1
                    AND booking_id = $2
                    AND UPPER(COALESCE(status, 'OPEN')) NOT IN ('CLOSED', 'WAIVED', 'SETTLED', 'REJECTED', 'PAID')`,
                tenantId,
                agreement.bookingId,
              ),
            [{ cnt: 0, amt: 0 }],
          );
        }
        const uninvoicedDamageCount = Number(dmgAgg?.[0]?.cnt ?? 0);
        const uninvoicedDamageAmount = round2(Number(dmgAgg?.[0]?.amt ?? 0));

        const hasUnsettledLiabilities =
          unpaidInvoicesCount > 0 ||
          unbilledFinesCount > 0 ||
          unbilledTollsCount > 0 ||
          uninvoicedDamageCount > 0;

        if (hasUnsettledLiabilities && !allowManagerOverride) {
          const totalUnsettledAed = round2(
            unpaidInvoicesAmount + unbilledFinesAmount + unbilledTollsAmount + uninvoicedDamageAmount,
          );
          return {
            kind: 'http',
            response: NextResponse.json(
              {
                error: `Cannot refund or release security deposit: AED ${totalUnsettledAed.toFixed(2)} in unsettled invoices, traffic fines, tolls, or damage claims remain open`,
                code: 'UNSETTLED_LIABILITIES',
                liabilities: {
                  unpaidInvoices: { count: unpaidInvoicesCount, amount: unpaidInvoicesAmount },
                  unbilledTrafficFines: { count: unbilledFinesCount, amount: unbilledFinesAmount },
                  unbilledTolls: { count: unbilledTollsCount, amount: unbilledTollsAmount },
                  uninvoicedDamageClaims: { count: uninvoicedDamageCount, amount: uninvoicedDamageAmount },
                  totalUnsettledAed,
                },
              },
              { status: 422 },
            ),
            depositId: null,
          };
        }
      }

      // ── Distinguish Off-Balance-Sheet Card Pre-Auth Hold vs Collected Cash/Bank Deposit ──
      if (hasRawSql) {
        const activePreauthRows = await withSavepoint(
          tx,
          'refund_chk_active_preauth',
          () =>
            tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id::text AS id
                 FROM rac_card_preauths
                WHERE tenant_id = $1
                  AND status = 'AUTHORIZED'
                  AND (
                    agreement_id = $2
                    OR ($3::text IS NOT NULL AND booking_id = $3)
                  )
                ORDER BY created_at DESC
                LIMIT 1`,
              tenantId,
              agreement.id,
              agreement.bookingId ?? null,
            ),
          [],
        );
        const activePreauth = activePreauthRows[0];

        if (activePreauth?.id) {
          // Verify no real cash/card deposit was collected into 2150
          const cashDepInFinance = await withSavepoint(
            tx,
            'refund_chk_fin_sec_dep',
            () =>
              tx.$queryRawUnsafe<Array<{ id: string; collection_method: string | null }>>(
                `SELECT id::text AS id, collection_method
                   FROM finance_security_deposits
                  WHERE tenant_id = $1
                    AND (contract_id = $2 OR ($3 <> '' AND contract_id = $3))
                    AND UPPER(COALESCE(collection_method, '')) NOT IN ('PREAUTH', 'CARD_PREAUTH', 'HOLD')
                  LIMIT 1`,
                tenantId,
                agreement.id,
                agreement.agreementNo ?? '',
              ),
            [],
          );

          const cashDepPayments = await withSavepoint<Array<Record<string, unknown>>>(
            tx,
            'refund_chk_rental_payments_dep',
            () =>
              tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                `SELECT *
                   FROM rental_payments
                  WHERE tenant_id::text = $1
                    AND agreement_id = $2`,
                tenantId,
                agreement.id,
              ),
            [],
          );
          const hasCollectedDepositPayment = cashDepPayments.some((p) => {
            const pType = String(
              p.payment_type ?? p.type ?? p.category ?? p.purpose ?? '',
            ).toUpperCase();
            const pMethod = String(p.payment_method ?? p.method ?? '').toUpperCase();
            const amt = Number(p.amount ?? 0);
            return (
              amt > 0 &&
              pType.includes('DEPOSIT') &&
              !pType.includes('REFUND') &&
              pMethod !== 'PREAUTH' &&
              pMethod !== 'CARD_PREAUTH' &&
              pMethod !== 'HOLD'
            );
          });

          if (cashDepInFinance.length === 0 && !hasCollectedDepositPayment) {
            return {
              kind: 'preauth_release',
              preauthId: activePreauth.id,
              agreementId: agreement.id,
              agreementNo: agreement.agreementNo ?? null,
            };
          }
        }
      }

      // ── Collected Cash / Card Deposit Refund Path (Account 2150 -> 1110/1120) ──
      const found = await tx.$queryRawUnsafe<{ id: string; collection_method?: string | null }[]>(
        `SELECT id::text AS id, collection_method FROM finance_security_deposits
          WHERE tenant_id = $1 AND (contract_id = $2 OR contract_id = $3)
          ORDER BY created_at DESC LIMIT 1`,
        tenantId,
        agreement.id,
        agreement.agreementNo ?? '',
      );
      let depositId: string | null = found[0]?.id ?? null;
      const collectionMethod =
        (found[0]?.collection_method as string | null | undefined) ??
        (body.collection_method as string | undefined) ??
        'CARD';

      if (!depositId) {
        const customer = await tx.rentalCustomer.findFirst({
          where: { id: agreement.customerId, tenantId },
          select: { fullName: true },
        });
        const vehicle = agreement.vehicleId
          ? await tx.vehicle.findFirst({
              where: { id: agreement.vehicleId, tenantId },
              select: { licensePlate: true, type: true },
            })
          : null;

        // Backfill both finance_security_deposits AND idempotent collection GL (DR 1110/1120, CR 2150)
        const recorded = await recordRacSecurityDepositCollected(tx, {
          tenantId,
          agreementId: agreement.id,
          agreementNo: agreement.agreementNo,
          customerName: customer?.fullName ?? 'Rental customer',
          vehiclePlate: vehicle?.licensePlate ?? '—',
          vehicleType: vehicle?.type ?? null,
          branch: String(body.branch ?? 'Dubai'),
          amount: collected,
          collectionMethod,
          collectionDate: agreement.startDate.toISOString().slice(0, 10),
          currency: agreement.currency ?? 'AED',
          preparedBy: actor,
        });
        depositId = recorded.depositId;

        if (!depositId) {
          const depositNo = await nextDocumentNumber(tx, tenantId, 'FSD');
          const created = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO finance_security_deposits
               (tenant_id, deposit_no, contract_id, contract_type, customer_name, vehicle_no, vehicle_type, branch,
                collected_amount, collection_date, collection_method, notes)
             VALUES ($1,$2,$3,'RENTAL',$4,$5,$6,$7,$8::numeric,$9::date,$10,$11)
             RETURNING id::text AS id`,
            tenantId,
            depositNo,
            agreement.agreementNo ?? agreement.id,
            customer?.fullName ?? 'Rental customer',
            vehicle?.licensePlate ?? '—',
            vehicle?.type ?? null,
            String(body.branch ?? 'Dubai'),
            collected,
            agreement.startDate.toISOString().slice(0, 10),
            collectionMethod,
            `Recorded from rental agreement ${agreement.agreementNo ?? agreement.id} when its refund was requested`,
          );
          depositId = created[0].id;
        }
      }

      const amount =
        body.refund_amount != null && body.refund_amount !== ''
          ? Number(body.refund_amount)
          : null;
      const refundMethod =
        (body.refund_method as string | undefined) ?? collectionMethod ?? 'CARD';

      const deposit = await startRefundRequest(tx, tenantId, depositId, {
        amount,
        method: refundMethod,
        reference: body.refund_reference as string | undefined,
        date: body.refund_date as string | undefined,
        actor,
        payNow: !needsApproval,
      });

      if (needsApproval) {
        await tx.rentalAgreement.updateMany({
          where: { id: agreement.id, tenantId },
          data: { depositStatus: 'REFUND_REQUESTED', updatedAt: new Date() },
        });
      } else {
        const refundedAmt = Number(amount ?? deposit.refund_requested_amount ?? collected);
        if (refundedAmt > 0) {
          await postRacSecurityDepositRefundGl(tx, {
            tenantId,
            agreementId: agreement.id,
            agreementNo: agreement.agreementNo,
            refundAmount: refundedAmt,
            refundMethod,
            refundDate: (body.refund_date as string | undefined) ?? new Date().toISOString(),
            idempotencySuffix: depositId,
            currency: agreement.currency ?? 'AED',
            preparedBy: actor,
          });

          // Record negative DEPOSIT_REFUND row on rental_payments for real collected deposit payout
          await withSavepoint(
            tx,
            'refund_rec_neg_rental_payment',
            () =>
              tx.$executeRawUnsafe(
                `INSERT INTO rental_payments
                   (id, tenant_id, agreement_id, customer_id, amount, currency, payment_method, payment_type, status, notes, created_at)
                 VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, 'DEPOSIT_REFUND', 'COMPLETED', $8, NOW())`,
                crypto.randomUUID(),
                tenantId,
                agreement.id,
                agreement.customerId,
                -Math.abs(refundedAmt),
                agreement.currency ?? 'AED',
                refundMethod,
                overrideReason
                  ? `Security deposit refund (Manager Override: ${overrideReason})`
                  : `Security deposit refund for ${agreement.agreementNo ?? agreement.id}`,
              ),
            0,
          );
        }
        const nextDepositStatus =
          refundedAmt + 0.01 >= collected ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await tx.rentalAgreement.updateMany({
          where: { id: agreement.id, tenantId },
          data: { depositStatus: nextDepositStatus, updatedAt: new Date() },
        });
      }

      const updated = await tx.rentalAgreement.findFirst({
        where: { id: agreement.id, tenantId },
      });

      if (allowManagerOverride) {
        void logAudit({
          tenantId,
          userId: req.headers.get('x-user-id') ?? undefined,
          userRole: req.headers.get('x-user-role') ?? undefined,
          entityType: 'RentalAgreement',
          entityId: agreement.id,
          entityName: agreement.agreementNo ?? agreement.id,
          action: 'UPDATE',
          details: `Security deposit refunded with manager override: ${overrideReason}`,
        });
      }

      return {
        kind: 'http',
        depositId,
        response: NextResponse.json({
          agreement: updated,
          settlementMode: 'CASH_DEPOSIT_REFUND',
          deposit: {
            id: depositId,
            deposit_no: deposit.deposit_no,
            refund_status: deposit.refund_status,
            refund_requested_amount: Number(deposit.refund_requested_amount ?? 0),
          },
        }),
      };
    } catch (e) {
      if (e instanceof SecurityDepositError) {
        return {
          kind: 'http',
          depositId: null,
          response: NextResponse.json({ error: e.message }, { status: 400 }),
        };
      }
      console.error(
        'POST /api/rental/agreements/[id]/refund-deposit error:',
        e instanceof Error ? e.message : e,
      );
      return {
        kind: 'http',
        depositId: null,
        response: NextResponse.json({ error: 'Failed to request the refund' }, { status: 500 }),
      };
    }
  });

  // ── 3-Phase Off-Balance-Sheet Card Pre-Auth Release (strictly outside RLS) ──
  if (phase1.kind === 'preauth_release') {
    try {
      const releaseNotes = overrideReason
        ? `Released on agreement close (Manager Override: ${overrideReason})`
        : `Released on closure of rental agreement ${phase1.agreementNo ?? phase1.agreementId}`;

      const releasedPreauth = await releaseRacCardPreAuth({
        tenantId,
        preauthId: phase1.preauthId,
        notes: releaseNotes,
        depositStatus: 'RELEASED',
      });

      const updatedAgreement = await withTenantRls(prisma, tenantId, async (tx) => {
        await tx.rentalAgreement.updateMany({
          where: { id: phase1.agreementId, tenantId },
          data: { depositStatus: 'RELEASED', updatedAt: new Date() },
        });
        return tx.rentalAgreement.findFirst({
          where: { id: phase1.agreementId, tenantId },
        });
      });

      void logAudit({
        tenantId,
        userId: req.headers.get('x-user-id') ?? undefined,
        userRole: req.headers.get('x-user-role') ?? undefined,
        entityType: 'RentalAgreement',
        entityId: phase1.agreementId,
        entityName: phase1.agreementNo ?? phase1.agreementId,
        action: 'UPDATE',
        details: `Released off-balance-sheet card pre-authorization hold ${releasedPreauth.authorizationCode} (${releasedPreauth.currency} ${releasedPreauth.amount}).`,
      });

      return NextResponse.json({
        agreement: updatedAgreement,
        settlementMode: 'PREAUTH_RELEASE',
        glPosted: false,
        preauth: toPublicRacPreAuth(releasedPreauth),
      });
    } catch (gatewayErr) {
      const msg =
        gatewayErr instanceof Error
          ? gatewayErr.message
          : 'Failed to release card pre-authorization hold';
      return NextResponse.json({ error: msg, code: 'PREAUTH_RELEASE_FAILED' }, { status: 502 });
    }
  }

  return needsApproval && phase1.depositId && phase1.response.ok
    ? withApprovalStart(phase1.response, {
        headers: req.headers,
        tenantId,
        referenceType: 'finance_deposit_refund',
        referenceId: phase1.depositId,
      })
    : phase1.response;
}
