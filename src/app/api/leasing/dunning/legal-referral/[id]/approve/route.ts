export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/dunning/legal-referral/[id]/approve
 *
 * [id] is the LeaseInvoice id. Approves the pending legal-referral review
 * (raised by the dunning sweep's create_review_task action) and, only if
 * every underlying condition still holds, immediately queues the
 * LEGAL_REFERRAL notice itself — approval is the trigger, not a flag a
 * later sweep has to notice.
 *
 * The caller must pass the collectionCycle they saw on the review task —
 * rechecked against the invoice's CURRENT cycle so an intervening reopen
 * or settlement can't approve into a cycle that no longer applies.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { canApprove, buildPermissionKey, SYSTEM_ROLES } from '@/lib/permissions';
import { withDunningLock } from '@/lib/leasing/dunning-lock';
import { getInvoiceOutstandingBalance } from '@/lib/leasing/invoice-balance';
import { createNoticeWithFirstAttempt } from '@/lib/finance/dunning-dispatch';
import { LEGAL_REFERRAL_WAIT_DAYS } from '@/lib/finance/dunning-transition';

function permsFor(req: NextRequest): string[] {
  const roleCode = req.headers.get('x-user-role') ?? '';
  return (SYSTEM_ROLES.find(r => r.code === roleCode)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  if (!canApprove(permsFor(req), 'leasing', 'legal_referral')) {
    return NextResponse.json({ error: 'You do not have permission to approve legal referrals.' }, { status: 403 });
  }

  const approverId = req.headers.get('x-user-id') ?? 'system';

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(bodyRaw);
    const expectedCycle = Number(body.collectionCycle);
    if (!Number.isInteger(expectedCycle)) {
      return NextResponse.json({ error: 'collectionCycle is required (the cycle shown on the review task)' }, { status: 400 });
    }

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const invoice = await tx.leaseInvoice.findFirst({ where: { id: params.id, tenantId } });
      if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

      if (invoice.dunningCollectionCycle !== expectedCycle) {
        throw Object.assign(new Error(`Stale review task — invoice is now on collection cycle ${invoice.dunningCollectionCycle}`), { status: 409 });
      }
      if (invoice.status === 'DISPUTED' || invoice.status === 'CANCELLED') {
        throw Object.assign(new Error(`Invoice is ${invoice.status} — cannot refer to legal`), { status: 400 });
      }

      const outstanding = await getInvoiceOutstandingBalance(tx, tenantId, invoice.id);
      if (outstanding <= 0.005) {
        throw Object.assign(new Error('Invoice is already settled'), { status: 400 });
      }

      const activeSuppression = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM lease_dunning_suppressions
          WHERE tenant_id = $1 AND active = true
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (invoice_id = $2 OR lessee_id = $3)
          LIMIT 1`,
        tenantId, invoice.id, invoice.lesseeId,
      );
      if (activeSuppression.length > 0) {
        throw Object.assign(new Error('An active dunning suppression applies to this invoice'), { status: 400 });
      }

      const [priorFinalNotice] = await tx.$queryRawUnsafe<Array<{ accepted_at: Date | null }>>(
        `SELECT COALESCE(a.outcome_at, a.resolved_at) AS accepted_at
           FROM lease_dunning_notices n
           JOIN lease_dunning_dispatch_attempts a ON a.notice_id = n.id AND a.tenant_id = n.tenant_id
          WHERE n.tenant_id = $1 AND n.invoice_id = $2 AND n.collection_cycle = $3 AND n.collection_stage = 'FINAL_NOTICE'
            AND (a.outcome = 'SUBMITTED' OR a.resolution = 'CONFIRMED_SUBMITTED')
          ORDER BY COALESCE(a.outcome_at, a.resolved_at) ASC
          LIMIT 1`,
        tenantId, invoice.id, expectedCycle,
      );
      const acceptedAt = priorFinalNotice?.accepted_at ?? null;
      const waitElapsed = acceptedAt !== null && Date.now() - acceptedAt.getTime() >= LEGAL_REFERRAL_WAIT_DAYS * 86400000;
      if (!waitElapsed) {
        throw Object.assign(
          new Error(acceptedAt === null
            ? 'No accepted FINAL_NOTICE found in this cycle — cannot refer to legal yet'
            : `FINAL_NOTICE was accepted less than ${LEGAL_REFERRAL_WAIT_DAYS} days ago`),
          { status: 400 },
        );
      }

      const existingApproval = await tx.leaseDunningLegalApproval.findFirst({
        where: { tenantId, invoiceId: invoice.id, collectionCycle: expectedCycle },
      });
      if (existingApproval?.approvedAt) {
        throw Object.assign(new Error('Already approved'), { status: 409 });
      }

      const approval = existingApproval
        ? await tx.leaseDunningLegalApproval.update({
            where: { id: existingApproval.id },
            data: { approvedBy: approverId, approvedAt: new Date(), notes: body.notes ?? existingApproval.notes },
          })
        : await tx.leaseDunningLegalApproval.create({
            data: {
              tenantId, invoiceId: invoice.id, collectionCycle: expectedCycle,
              approvedBy: approverId, approvedAt: new Date(), notes: body.notes ?? null,
            },
          });

      const notice = await withDunningLock(tx, tenantId, invoice.id, async () => {
        if (invoice.currentDunningStage) {
          await tx.leaseDunningNotice.updateMany({
            where: {
              tenantId, invoiceId: invoice.id, collectionCycle: expectedCycle,
              collectionStage: invoice.currentDunningStage, dispatchStatus: { in: ['PENDING', 'FAILED'] },
            },
            data: { dispatchStatus: 'SUPPRESSED', suppressedReason: 'SUPERSEDED' },
          });
        }

        await tx.leaseDunningStageTransition.create({
          data: {
            tenantId, invoiceId: invoice.id, collectionCycle: expectedCycle,
            previousStage: invoice.currentDunningStage, newStage: 'LEGAL_REFERRAL',
            reason: 'legal_referral_approved', transitionedBy: approverId,
          },
        });
        await tx.leaseInvoice.update({
          where: { id: invoice.id },
          data: { currentDunningStage: 'LEGAL_REFERRAL', dunningStageUpdatedAt: new Date() },
        });

        const contract = await tx.leaseContract2.findFirst({ where: { tenantId, lesseeId: invoice.lesseeId }, select: { id: true } });

        return createNoticeWithFirstAttempt(tx, tenantId, {
          invoiceId: invoice.id,
          contractId: contract?.id ?? null,
          lesseeId: invoice.lesseeId,
          collectionCycle: expectedCycle,
          collectionStage: 'LEGAL_REFERRAL',
          outstandingAmountAtQueue: outstanding,
          currency: invoice.currency ?? 'AED',
        });
      });

      const fingerprint = `dunning-legal-referral:${invoice.id}:${expectedCycle}`;
      await tx.leaseAlert.updateMany({
        where: { tenantId, alertType: 'LEGAL_REFERRAL_REVIEW', status: 'OPEN', message: { contains: fingerprint } },
        data: { status: 'RESOLVED', resolvedAt: new Date(), acknowledgedBy: approverId },
      });

      return { approval, notice };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status });
  }
}
