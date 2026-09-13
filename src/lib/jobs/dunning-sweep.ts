/**
 * Job: dunning-sweep
 *
 * Per-invoice collection-stage classification and transition. Never sends
 * email and never fabricates a LeaseContract2 — this job only decides
 * what should happen (mark_overdue / queue / settled / frozen /
 * create_review_task) via resolveDunningTransition, and persists that
 * decision. Actual dispatch is the DunningNoticeConsumer's job, driven by
 * the EventOutbox row createNoticeWithFirstAttempt writes on 'queue'.
 *
 * Dry-run (`?dryRun=1`) never writes a LeaseDunningNotice/transition row
 * and never advances LeaseInvoice.currentDunningStage — it only counts
 * what the sweep would do.
 */
import type { JobContext, JobResult } from '@/lib/jobs/registry';
import { runSweep } from '@/lib/prisma-sweep';
import { captureException, captureMessage } from '@/lib/sentry';

import { getInvoiceOutstandingBalance } from '@/lib/leasing/invoice-balance';
import { withDunningLock } from '@/lib/leasing/dunning-lock';
import { createNoticeWithFirstAttempt } from '@/lib/finance/dunning-dispatch';
import {
  resolveDunningTransition,
  type CollectionStage,
  type DunningTransitionInput,
} from '@/lib/finance/dunning-transition';

const TERMINAL_STAGES = new Set(['SETTLED', 'FROZEN_DISPUTE', 'FROZEN_SUPPRESSED']);

export async function runDunningSweep(ctx: JobContext): Promise<JobResult> {
  const dryRun = ctx.searchParams.get('dryRun') === '1';
  const lesseeFilter = ctx.searchParams.get('lesseeId') ?? undefined;

  type SweepResult = {
    scanned: number;
    markedOverdue: number;
    queued: Record<CollectionStage, number>;
    settled: number;
    frozen: number;
    reviewTasksCreated: number;
    skipped: number;
    errors: { invoiceId: string; message: string }[];
  };

  const perTenant = await runSweep<SweepResult>(async ({ tx, tenantId }) => {
    const invoices = await tx.leaseInvoice.findMany({
      where: {
        tenantId,
        ...(lesseeFilter ? { lesseeId: lesseeFilter } : {}),
        OR: [
          { status: { notIn: ['PAID', 'CANCELLED'] } },
          // A just-settled invoice still needs exactly one more visit to
          // write the SETTLED transition and suppress any still-pending
          // notice — otherwise the status:notIn filter above would exclude
          // it forever the moment it's paid, and resolveDunningTransition's
          // settlement branch would never get a chance to run.
          { status: { in: ['PAID', 'CANCELLED'] }, currentDunningStage: { not: null, notIn: ['SETTLED'] } },
        ],
      },
    });

    const result: SweepResult = {
      scanned: invoices.length,
      markedOverdue: 0,
      queued: { REMINDER: 0, OVERDUE: 0, FINAL_NOTICE: 0, LEGAL_REFERRAL: 0 },
      settled: 0,
      frozen: 0,
      reviewTasksCreated: 0,
      skipped: 0,
      errors: [],
    };

    for (const invoice of invoices) {
      try {
        const canonicalOutstanding = await getInvoiceOutstandingBalance(tx, tenantId, invoice.id);
        const isDisputed = invoice.status === 'DISPUTED';
        const currentStage = invoice.currentDunningStage;

        const activeSuppression = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM lease_dunning_suppressions
            WHERE tenant_id = $1 AND active = true
              AND (expires_at IS NULL OR expires_at > NOW())
              AND (invoice_id = $2 OR lessee_id = $3)
            LIMIT 1`,
          tenantId,
          invoice.id,
          invoice.lesseeId,
        );
        const hasActiveSuppression = activeSuppression.length > 0;

        const approval = await tx.leaseDunningLegalApproval.findFirst({
          where: { tenantId, invoiceId: invoice.id, collectionCycle: invoice.dunningCollectionCycle },
          select: { approvedAt: true },
        });
        const hasApprovedLegalReferral = Boolean(approval?.approvedAt);

        const [priorFinalNotice] = await tx.$queryRawUnsafe<Array<{ accepted_at: Date | null }>>(
          `SELECT COALESCE(a.outcome_at, a.resolved_at) AS accepted_at
             FROM lease_dunning_notices n
             JOIN lease_dunning_dispatch_attempts a ON a.notice_id = n.id AND a.tenant_id = n.tenant_id
            WHERE n.tenant_id = $1 AND n.invoice_id = $2 AND n.collection_cycle = $3 AND n.collection_stage = 'FINAL_NOTICE'
              AND (a.outcome = 'SUBMITTED' OR a.resolution = 'CONFIRMED_SUBMITTED')
            ORDER BY COALESCE(a.outcome_at, a.resolved_at) ASC
            LIMIT 1`,
          tenantId,
          invoice.id,
          invoice.dunningCollectionCycle,
        );

        const input: DunningTransitionInput = {
          invoice: { id: invoice.id, dueDate: invoice.dueDate, status: invoice.status ?? 'SENT' },
          canonicalOutstanding,
          currentStage,
          isDisputed,
          hasActiveSuppression,
          hasApprovedLegalReferral,
          priorFinalNoticeAcceptedAt: priorFinalNotice?.accepted_at ?? null,
        };
        const transition = resolveDunningTransition(input);

        switch (transition.action) {
          case 'none': {
            result.skipped++;
            break;
          }

          case 'mark_overdue': {
            if (!dryRun) {
              await tx.leaseInvoice.update({ where: { id: invoice.id }, data: { status: 'OVERDUE' } });
            }
            result.markedOverdue++;
            break;
          }

          case 'settled':
          case 'frozen': {
            const newStage = transition.action === 'settled' ? 'SETTLED' : transition.stage;
            if (!dryRun) {
              await withDunningLock(tx, tenantId, invoice.id, async () => {
                await tx.leaseDunningStageTransition.create({
                  data: {
                    tenantId, invoiceId: invoice.id, collectionCycle: invoice.dunningCollectionCycle,
                    previousStage: currentStage, newStage,
                    reason: transition.action === 'settled' ? 'settled' : transition.reason,
                    transitionedBy: 'system:dunning',
                  },
                });
                await tx.leaseInvoice.update({
                  where: { id: invoice.id },
                  data: { currentDunningStage: newStage, dunningStageUpdatedAt: new Date() },
                });
                await tx.leaseDunningNotice.updateMany({
                  where: {
                    tenantId, invoiceId: invoice.id, collectionCycle: invoice.dunningCollectionCycle,
                    dispatchStatus: { in: ['PENDING', 'FAILED'] },
                  },
                  data: { dispatchStatus: 'SUPPRESSED', suppressedReason: newStage },
                });
              });
            }
            if (transition.action === 'settled') result.settled++; else result.frozen++;
            break;
          }

          case 'create_review_task': {
            const fingerprint = `dunning-legal-referral:${invoice.id}:${invoice.dunningCollectionCycle}`;
            const existing = await tx.leaseAlert.findFirst({
              where: { tenantId, alertType: 'LEGAL_REFERRAL_REVIEW', status: 'OPEN', message: { contains: fingerprint } },
              select: { id: true },
            });
            if (!existing) {
              if (!dryRun) {
                const contractId = await resolveContractId(tx, tenantId, invoice.lesseeId);
                await tx.leaseAlert.create({
                  data: {
                    tenantId,
                    contractId,
                    alertType: 'LEGAL_REFERRAL_REVIEW',
                    severity: 'ERROR',
                    title: 'Legal referral review required',
                    message: `${fingerprint}\nInvoice ${invoice.invoiceNo ?? invoice.id} is ${LEGAL_REFERRAL_THRESHOLD_LABEL}+ days overdue with an accepted final notice — approve to send the legal-referral notice.`,
                    status: 'OPEN',
                  },
                });
              }
              result.reviewTasksCreated++;
            } else {
              result.skipped++;
            }
            break;
          }

          case 'queue': {
            const wasTerminal = currentStage !== null && TERMINAL_STAGES.has(currentStage);
            const cycle = wasTerminal ? invoice.dunningCollectionCycle + 1 : invoice.dunningCollectionCycle;
            const reason = wasTerminal ? 'reopened' : currentStage === null ? 'initial_contact' : 'stage_advance';

            if (!dryRun) {
              await withDunningLock(tx, tenantId, invoice.id, async () => {
                if (reason === 'stage_advance' && currentStage) {
                  await tx.leaseDunningNotice.updateMany({
                    where: {
                      tenantId, invoiceId: invoice.id, collectionCycle: cycle, collectionStage: currentStage,
                      dispatchStatus: { in: ['PENDING', 'FAILED'] },
                    },
                    data: { dispatchStatus: 'SUPPRESSED', suppressedReason: 'SUPERSEDED' },
                  });
                }

                await tx.leaseDunningStageTransition.create({
                  data: {
                    tenantId, invoiceId: invoice.id, collectionCycle: cycle,
                    previousStage: currentStage, newStage: transition.stage, reason,
                    transitionedBy: 'system:dunning',
                  },
                });
                await tx.leaseInvoice.update({
                  where: { id: invoice.id },
                  data: { currentDunningStage: transition.stage, dunningStageUpdatedAt: new Date(), dunningCollectionCycle: cycle },
                });

                const contractId = await resolveContractId(tx, tenantId, invoice.lesseeId);
                if (!contractId) {
                  captureMessage('Dunning: no resolvable contract for invoice — queueing with null contractId', {
                    level: 'warning', context: 'jobs.dunning-sweep',
                    extra: { invoiceId: invoice.id, tenantId },
                  });
                }

                await createNoticeWithFirstAttempt(tx, tenantId, {
                  invoiceId: invoice.id,
                  contractId,
                  lesseeId: invoice.lesseeId,
                  collectionCycle: cycle,
                  collectionStage: transition.stage,
                  outstandingAmountAtQueue: canonicalOutstanding,
                  currency: invoice.currency ?? 'AED',
                });
              });
            }
            result.queued[transition.stage]++;
            break;
          }
        }
      } catch (err) {
        captureException(err, { context: 'jobs.dunning-sweep', tags: { invoiceId: invoice.id, tenantId } });
        result.errors.push({ invoiceId: invoice.id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    return result;
  }, { tenantHeader: ctx.tenantId ?? undefined });

  const total = perTenant.reduce((acc, r) => {
    acc.scanned += r.result.scanned;
    acc.markedOverdue += r.result.markedOverdue;
    acc.queued.REMINDER += r.result.queued.REMINDER;
    acc.queued.OVERDUE += r.result.queued.OVERDUE;
    acc.queued.FINAL_NOTICE += r.result.queued.FINAL_NOTICE;
    acc.queued.LEGAL_REFERRAL += r.result.queued.LEGAL_REFERRAL;
    acc.settled += r.result.settled;
    acc.frozen += r.result.frozen;
    acc.reviewTasksCreated += r.result.reviewTasksCreated;
    acc.skipped += r.result.skipped;
    acc.errors.push(...r.result.errors);
    return acc;
  }, {
    scanned: 0, markedOverdue: 0,
    queued: { REMINDER: 0, OVERDUE: 0, FINAL_NOTICE: 0, LEGAL_REFERRAL: 0 } as Record<CollectionStage, number>,
    settled: 0, frozen: 0, reviewTasksCreated: 0, skipped: 0,
    errors: [] as { invoiceId: string; message: string }[],
  });

  return {
    status: total.errors.length > 0 && total.scanned === total.errors.length ? 'error' : 'ok',
    summary: `Scanned ${total.scanned} invoices across ${perTenant.length} tenant(s); queued ${total.queued.REMINDER}r/${total.queued.OVERDUE}o/${total.queued.FINAL_NOTICE}f/${total.queued.LEGAL_REFERRAL}l; settled ${total.settled}; frozen ${total.frozen}; ${total.reviewTasksCreated} legal-referral review task(s); marked ${total.markedOverdue} OVERDUE`,
    data: { dryRun, tenantsScanned: perTenant.length, ...total },
  };
}

const LEGAL_REFERRAL_THRESHOLD_LABEL = 120;

/** Best-effort association only — never fabricates a LeaseContract2 row. */
async function resolveContractId(
  tx: Parameters<typeof getInvoiceOutstandingBalance>[0],
  tenantId: string,
  lesseeId: string,
): Promise<string | null> {
  const contract = await tx.leaseContract2.findFirst({ where: { tenantId, lesseeId }, select: { id: true } });
  return contract?.id ?? null;
}
