/**
 * Job: dunning-reconciliation
 *
 * Four narrow, independently-guarded sub-jobs — none of them ordinary
 * outbox redelivery, since that has no concept of "wait indefinitely for
 * an operational pause to end":
 *
 *   (a) stale-SUBMITTING recovery — a claim that never resolved (worker
 *       crashed after the prepared-evidence commit, before recording an
 *       outcome) is reconciled to DELIVERY_UNKNOWN, never assumed sent
 *       or failed.
 *   (b) enqueue-when-due — attempts reserved for a backoff-delayed retry
 *       get their EventOutbox row created once actually due.
 *   (c) retry re-queue — notices genuinely FAILED (below their send-
 *       attempt cap) get a fresh attempt reserved.
 *   (d) deferred-work recovery — notices paused by the dispatch gate
 *       (DEFERRED, not FAILED) get a fresh attempt reserved once the
 *       gate is open again, without touching sendAttemptCount.
 *
 * Each sub-job processes a bounded batch per tenant per run so a single
 * invocation stays time-bounded; a large backlog just takes more runs.
 */
import type { JobContext, JobResult } from '@/lib/jobs/registry';
import { runSweep } from '@/lib/prisma-sweep';
import { captureException } from '@/lib/sentry';
import {
  reserveNextAttempt,
  enqueueDueAttempt,
  recordOutcome,
  isTransportAvailable,
} from '@/lib/finance/dunning-dispatch';

const BATCH_LIMIT = 200;

// nodemailer defaults — src/services/email/emailService.ts does not
// override connectionTimeout/socketTimeout, so these are the actual
// worst-case bounds a single sendMail() call can take before nodemailer
// itself gives up. One named computation, not two numbers that can
// silently drift apart from whatever the transport is really configured
// with.
const SMTP_CONNECTION_TIMEOUT_MS = 120_000;
const SMTP_SEND_TIMEOUT_MS = 600_000;
const RECONCILIATION_SAFETY_MARGIN_MS = 120_000;
const STALE_SUBMITTING_THRESHOLD_MS =
  SMTP_CONNECTION_TIMEOUT_MS + SMTP_SEND_TIMEOUT_MS + RECONCILIATION_SAFETY_MARGIN_MS;

const RETRY_BACKOFF_MS = 15 * 60 * 1000;

function isDispatchEnabled(): boolean {
  return process.env.DUNNING_DISPATCH_ENABLED === 'true';
}

export async function runDunningReconciliation(ctx: JobContext): Promise<JobResult> {
  const dryRun = ctx.searchParams.get('dryRun') === '1';

  type SubJobResult = {
    staleReconciled: number;
    enqueuedDue: number;
    retriesReserved: number;
    deferredRecovered: number;
    errors: { stage: string; id: string; message: string }[];
  };

  const gateOpen = isDispatchEnabled() && (await isTransportAvailable());

  const perTenant = await runSweep<SubJobResult>(async ({ tx, tenantId }) => {
    const result: SubJobResult = {
      staleReconciled: 0, enqueuedDue: 0, retriesReserved: 0, deferredRecovered: 0, errors: [],
    };

    // ── (a) Stale-SUBMITTING recovery ──────────────────────────────────
    const stale = await tx.$queryRawUnsafe<Array<{ notice_id: string; attempt_id: string; attempt_token: string }>>(
      `SELECT n.id AS notice_id, a.id AS attempt_id, a.attempt_token
         FROM lease_dunning_notices n
         JOIN lease_dunning_dispatch_attempts a
           ON a.notice_id = n.id AND a.tenant_id = n.tenant_id AND a.attempt_token = n.current_attempt_token
        WHERE n.tenant_id = $1 AND n.dispatch_status = 'SUBMITTING'
          AND COALESCE(a.claimed_at, n.updated_at) <= NOW() - ($2 || ' milliseconds')::interval
        LIMIT $3`,
      tenantId,
      String(STALE_SUBMITTING_THRESHOLD_MS),
      BATCH_LIMIT,
    );
    for (const row of stale) {
      try {
        if (!dryRun) {
          const { applied } = await recordOutcome(
            tx, tenantId,
            { attemptId: row.attempt_id, attemptToken: row.attempt_token, noticeId: row.notice_id },
            'DELIVERY_UNKNOWN',
            { errorMessage: 'Reconciled: SUBMITTING exceeded the transport timeout window without an outcome' },
          );
          if (applied) {
            await tx.leaseAlert.create({
              data: {
                tenantId,
                alertType: 'DUNNING_DELIVERY_UNKNOWN',
                severity: 'WARNING',
                title: 'Dunning notice delivery unknown',
                message: `notice=${row.notice_id} — reconciled from a stale SUBMITTING state; delivery could not be confirmed.`,
                status: 'OPEN',
              },
            }).catch(() => {});
          }
        }
        result.staleReconciled++;
      } catch (err) {
        captureException(err, { context: 'jobs.dunning-reconciliation.stale', tags: { noticeId: row.notice_id, tenantId } });
        result.errors.push({ stage: 'stale', id: row.notice_id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── (b) Enqueue-when-due ────────────────────────────────────────────
    const due = await tx.$queryRawUnsafe<Array<{ attempt_id: string }>>(
      `SELECT a.id AS attempt_id
         FROM lease_dunning_dispatch_attempts a
         JOIN lease_dunning_notices n ON n.id = a.notice_id AND n.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.enqueued_at IS NULL AND a.outcome = 'PENDING' AND a.resolution IS NULL
          AND n.current_attempt_token = a.attempt_token AND n.next_attempt_at <= NOW()
        LIMIT $2`,
      tenantId,
      BATCH_LIMIT,
    );
    for (const row of due) {
      try {
        if (!dryRun) {
          const enqueued = await enqueueDueAttempt(tx, tenantId, row.attempt_id);
          if (enqueued) result.enqueuedDue++;
        } else {
          result.enqueuedDue++;
        }
      } catch (err) {
        captureException(err, { context: 'jobs.dunning-reconciliation.enqueue-due', tags: { attemptId: row.attempt_id, tenantId } });
        result.errors.push({ stage: 'enqueue-due', id: row.attempt_id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── (c) Retry re-queue — genuinely FAILED, below cap (FAILED_EXHAUSTED
    // is a different dispatch_status and is never selected here). ────────
    const failed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM lease_dunning_notices WHERE tenant_id = $1 AND dispatch_status = 'FAILED' LIMIT $2`,
      tenantId,
      BATCH_LIMIT,
    );
    for (const row of failed) {
      try {
        if (!dryRun) {
          const reserved = await reserveNextAttempt(tx, tenantId, row.id, 'FAILED', { immediate: false, backoffMs: RETRY_BACKOFF_MS });
          if (!reserved.noOp) result.retriesReserved++;
        } else {
          result.retriesReserved++;
        }
      } catch (err) {
        captureException(err, { context: 'jobs.dunning-reconciliation.retry', tags: { noticeId: row.id, tenantId } });
        result.errors.push({ stage: 'retry', id: row.id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── (d) Deferred-work recovery — only when the gate is actually open;
    // never touches sendAttemptCount (reserveNextAttempt doesn't either). ─
    if (gateOpen) {
      const deferred = await tx.$queryRawUnsafe<Array<{ notice_id: string }>>(
        `SELECT n.id AS notice_id
           FROM lease_dunning_notices n
           JOIN lease_dunning_dispatch_attempts a
             ON a.notice_id = n.id AND a.tenant_id = n.tenant_id AND a.attempt_token = n.current_attempt_token
          WHERE n.tenant_id = $1 AND a.outcome = 'DEFERRED'
          LIMIT $2`,
        tenantId,
        BATCH_LIMIT,
      );
      for (const row of deferred) {
        try {
          if (!dryRun) {
            const reserved = await reserveNextAttempt(tx, tenantId, row.notice_id, 'DEFERRED', { immediate: true });
            if (!reserved.noOp) result.deferredRecovered++;
          } else {
            result.deferredRecovered++;
          }
        } catch (err) {
          captureException(err, { context: 'jobs.dunning-reconciliation.deferred', tags: { noticeId: row.notice_id, tenantId } });
          result.errors.push({ stage: 'deferred', id: row.notice_id, message: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    return result;
  }, { tenantHeader: ctx.tenantId ?? undefined });

  const total = perTenant.reduce((acc, r) => {
    acc.staleReconciled += r.result.staleReconciled;
    acc.enqueuedDue += r.result.enqueuedDue;
    acc.retriesReserved += r.result.retriesReserved;
    acc.deferredRecovered += r.result.deferredRecovered;
    acc.errors.push(...r.result.errors);
    return acc;
  }, { staleReconciled: 0, enqueuedDue: 0, retriesReserved: 0, deferredRecovered: 0, errors: [] as { stage: string; id: string; message: string }[] });

  return {
    status: 'ok',
    summary: `Reconciled ${total.staleReconciled} stale SUBMITTING; enqueued ${total.enqueuedDue} due; reserved ${total.retriesReserved} retries; recovered ${total.deferredRecovered} deferred (gate ${gateOpen ? 'open' : 'closed'})`,
    data: { dryRun, gateOpen, tenantsScanned: perTenant.length, ...total },
  };
}
