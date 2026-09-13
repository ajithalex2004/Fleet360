/**
 * Dunning dispatch mechanics — the attempt-token claim protocol.
 *
 * See the design plan (dunning revision 7) for the full reasoning. Summary
 * of the invariants this file exists to hold:
 *
 *  - Exactly one "current" occurrence per notice at a time
 *    (LeaseDunningNotice.currentAttemptToken). Reservation eligibility is
 *    always "does the CURRENT attempt's own outcome match the state that
 *    justifies replacing it" — never a token-equality tautology (which is
 *    trivially true under sequential row locking) and never a separate
 *    "is anything open" scan (which self-blocks recovery of the exact
 *    DEFERRED/FAILED record it's meant to replace).
 *  - Occurrence sequencing (LeaseDunningDispatchAttempt.attemptSeq) and
 *    send-attempt counting (LeaseDunningNotice.sendAttemptCount) are
 *    deliberately different numbers: only an actual transport commitment
 *    increments the latter, so pausing/resuming a notice indefinitely
 *    never exhausts its retry allowance.
 *  - A dispatch event is only ever placed on the outbox once due — there
 *    is no "too early" case for the consumer to interpret, because one
 *    structurally cannot exist yet.
 *  - Every write that could race a concurrent worker is a guarded
 *    conditional UPDATE, not a plain transaction boundary.
 */

import crypto from 'crypto';
import type { TxClient } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { captureMessage } from '@/lib/sentry';
import { getInvoiceOutstandingBalance } from '@/lib/leasing/invoice-balance';

export const DUNNING_NOTICE_QUEUED_EVENT = 'finance.dunningNoticeQueued';

export type DunningNoticeStatus =
  | 'PENDING' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED' | 'FAILED_EXHAUSTED'
  | 'DELIVERY_UNKNOWN' | 'SUPPRESSED';

/** Stored attempt outcomes. 'UNCERTAIN' from the classifier is written as DELIVERY_UNKNOWN — not a separate stored value. */
export type DunningAttemptOutcome =
  | 'PENDING' | 'DEFERRED' | 'SUBMITTED' | 'FAILED' | 'SUPPRESSED' | 'DELIVERY_UNKNOWN';

function newAttemptToken(): string {
  return crypto.randomUUID();
}

// ============================================================
// Notice + first attempt creation (sweep's initial queue, and the
// legal-referral approval route's own queueing) — always immediate.
// ============================================================

export async function createNoticeWithFirstAttempt(
  tx: TxClient,
  tenantId: string,
  args: {
    invoiceId: string;
    contractId: string | null;
    lesseeId: string;
    collectionCycle: number;
    collectionStage: string;
    occurrenceSeq?: number;
    policyVersion?: string;
    outstandingAmountAtQueue: number;
    currency: string;
  },
): Promise<{ noticeId: string; attemptId: string; attemptToken: string }> {
  const token = newAttemptToken();
  const now = new Date();

  const notice = await tx.leaseDunningNotice.create({
    data: {
      tenantId,
      invoiceId: args.invoiceId,
      contractId: args.contractId,
      lesseeId: args.lesseeId,
      collectionCycle: args.collectionCycle,
      collectionStage: args.collectionStage,
      occurrenceSeq: args.occurrenceSeq ?? 1,
      policyVersion: args.policyVersion ?? 'v1',
      outstandingAmountAtQueue: args.outstandingAmountAtQueue,
      currency: args.currency,
      queuedAt: now,
      dispatchStatus: 'PENDING',
      currentAttemptToken: token,
      nextAttemptAt: now,
    },
  });

  const attempt = await tx.leaseDunningDispatchAttempt.create({
    data: {
      tenantId,
      noticeId: notice.id,
      attemptToken: token,
      attemptSeq: 1,
      reservedAt: now,
      enqueuedAt: now,
      outcome: 'PENDING',
    },
  });

  await enqueueOutboxEvent(tx, tenantId, notice.id, token);

  return { noticeId: notice.id, attemptId: attempt.id, attemptToken: token };
}

/**
 * Raw SQL, not tx.eventOutbox.create() — the EventOutbox Prisma model has
 * no @map() on its fields (a pre-existing drift: the real event_outbox
 * table is snake_case), so the ORM path throws P2022 "column eventId does
 * not exist". Every other caller in this codebase already works around
 * this the same way (see src/lib/jobs/outbox-publisher.ts,
 * src/events/consumer-base.ts) — matching that convention here rather
 * than fixing the shared schema model, which is out of this file's scope.
 */
async function enqueueOutboxEvent(tx: TxClient, tenantId: string, noticeId: string, attemptToken: string): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO event_outbox (tenant_id, event_type, aggregate_type, aggregate_id, source_module, payload)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)`,
    tenantId,
    DUNNING_NOTICE_QUEUED_EVENT,
    'LeaseDunningNotice',
    noticeId,
    'finance',
    JSON.stringify({ noticeId, attemptToken }),
  );
}

// ============================================================
// Reservation — the one operation used for a retry-after-failure, a
// deferred-work recovery, and a manual CONFIRMED_NOT_SUBMITTED
// resolution. Locked, and eligibility-checked against the CURRENT
// attempt's own outcome, not a separate "is anything open" scan.
// ============================================================

export type ReserveNextAttemptResult =
  | { noOp: true; reason: string }
  | { noOp: false; attemptId: string; attemptToken: string; enqueuedImmediately: boolean };

export async function reserveNextAttempt(
  tx: TxClient,
  tenantId: string,
  noticeId: string,
  expectedCurrentOutcome: DunningAttemptOutcome,
  opts: { immediate: boolean; backoffMs?: number } = { immediate: true },
): Promise<ReserveNextAttemptResult> {
  const [notice] = await tx.$queryRawUnsafe<
    Array<{ id: string; current_attempt_token: string | null; dispatch_status: string }>
  >(
    `SELECT id, current_attempt_token, dispatch_status FROM lease_dunning_notices
      WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    noticeId,
    tenantId,
  );
  if (!notice) {
    return { noOp: true, reason: 'notice_not_found' };
  }
  if (!notice.current_attempt_token) {
    return { noOp: true, reason: 'no_current_attempt' };
  }

  const [current] = await tx.$queryRawUnsafe<Array<{ id: string; outcome: string; attempt_seq: number }>>(
    `SELECT id, outcome, attempt_seq FROM lease_dunning_dispatch_attempts
      WHERE tenant_id = $1 AND attempt_token = $2`,
    tenantId,
    notice.current_attempt_token,
  );
  if (!current) {
    return { noOp: true, reason: 'current_attempt_missing' };
  }
  if (current.outcome !== expectedCurrentOutcome) {
    // Business eligibility check, evaluated under the lock — someone else
    // already handled this (e.g. a concurrent worker already reserved a
    // replacement, or the notice moved on for an unrelated reason).
    return { noOp: true, reason: `current_outcome_is_${current.outcome}_not_${expectedCurrentOutcome}` };
  }

  const token = newAttemptToken();
  const now = new Date();
  const dueAt = opts.immediate ? now : new Date(now.getTime() + (opts.backoffMs ?? 0));

  const [newAttempt] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO lease_dunning_dispatch_attempts
       (id, tenant_id, notice_id, attempt_token, attempt_seq, reserved_at, enqueued_at, outcome)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW(), $5, 'PENDING')
     RETURNING id`,
    tenantId,
    noticeId,
    token,
    current.attempt_seq + 1,
    opts.immediate ? now : null,
  );

  await tx.$executeRawUnsafe(
    `UPDATE lease_dunning_notices
        SET current_attempt_token = $1, dispatch_status = 'PENDING', next_attempt_at = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    token,
    dueAt,
    noticeId,
    tenantId,
  );

  if (opts.immediate) {
    await enqueueOutboxEvent(tx, tenantId, noticeId, token);
  }

  return { noOp: false, attemptId: newAttempt.id, attemptToken: token, enqueuedImmediately: opts.immediate };
}

// ============================================================
// Enqueue-when-due — separately guarded from reservation, since
// reservation and enqueueing can happen at different times for a
// backoff-scheduled retry.
// ============================================================

export async function enqueueDueAttempt(tx: TxClient, tenantId: string, attemptId: string): Promise<boolean> {
  const [claimed] = await tx.$queryRawUnsafe<Array<{ id: string; notice_id: string; attempt_token: string }>>(
    `UPDATE lease_dunning_dispatch_attempts a
        SET enqueued_at = NOW()
       FROM lease_dunning_notices n
      WHERE a.id = $1 AND a.tenant_id = $2
        AND a.enqueued_at IS NULL AND a.outcome = 'PENDING' AND a.resolution IS NULL
        AND n.id = a.notice_id AND n.current_attempt_token = a.attempt_token
        AND n.next_attempt_at <= NOW()
      RETURNING a.id, a.notice_id, a.attempt_token`,
    attemptId,
    tenantId,
  );
  if (!claimed) return false;
  await enqueueOutboxEvent(tx, tenantId, claimed.notice_id, claimed.attempt_token);
  return true;
}

// ============================================================
// Claim — atomic, identity-checked. Only a PENDING notice under the
// exact expected token can be claimed; no next_attempt_at check needed
// here since an event only exists on the outbox once due.
// ============================================================

export async function claimAttempt(
  tx: TxClient,
  tenantId: string,
  noticeId: string,
  attemptToken: string,
): Promise<boolean> {
  const [claimed] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE lease_dunning_notices
        SET dispatch_status = 'SUBMITTING', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
        AND current_attempt_token = $3 AND dispatch_status = 'PENDING'
      RETURNING id`,
    noticeId,
    tenantId,
    attemptToken,
  );
  return Boolean(claimed);
}

// ============================================================
// Prepared-evidence commit — ownership- and cap-guarded, in one
// transaction. Both statements must succeed or nothing durable happens.
// ============================================================

export type CommitPreparedEvidenceResult =
  | { ok: true }
  | { ok: false; reason: 'attempt_invalidated' | 'cap_reached_or_notice_invalidated' };

export async function commitPreparedEvidence(
  tx: TxClient,
  tenantId: string,
  ids: { attemptId: string; attemptToken: string; noticeId: string },
  prepared: { amount: number; currency: string; recipients: unknown },
): Promise<CommitPreparedEvidenceResult> {
  const [attemptRow] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE lease_dunning_dispatch_attempts
        SET prepared_amount = $1, prepared_currency = $2, prepared_recipients = $3::jsonb, claimed_at = NOW()
      WHERE id = $4 AND tenant_id = $5 AND attempt_token = $6
        AND outcome = 'PENDING' AND resolution IS NULL AND claimed_at IS NULL
      RETURNING id`,
    prepared.amount,
    prepared.currency,
    JSON.stringify(prepared.recipients),
    ids.attemptId,
    tenantId,
    ids.attemptToken,
  );
  if (!attemptRow) {
    return { ok: false, reason: 'attempt_invalidated' };
  }

  const [noticeRow] = await tx.$queryRawUnsafe<Array<{ send_attempt_count: number }>>(
    `UPDATE lease_dunning_notices
        SET send_attempt_count = send_attempt_count + 1
      WHERE id = $1 AND tenant_id = $2
        AND current_attempt_token = $3 AND dispatch_status = 'SUBMITTING'
        AND send_attempt_count < max_send_attempts
      RETURNING send_attempt_count`,
    ids.noticeId,
    tenantId,
    ids.attemptToken,
  );
  if (!noticeRow) {
    return { ok: false, reason: 'cap_reached_or_notice_invalidated' };
  }

  return { ok: true };
}

/** Fetch sendAttemptCount/maxSendAttempts for the FAILED-vs-FAILED_EXHAUSTED decision. */
export async function getSendAttemptState(
  tx: TxClient,
  tenantId: string,
  noticeId: string,
): Promise<{ sendAttemptCount: number; maxSendAttempts: number }> {
  const [row] = await tx.$queryRawUnsafe<Array<{ send_attempt_count: number; max_send_attempts: number }>>(
    `SELECT send_attempt_count, max_send_attempts FROM lease_dunning_notices WHERE id = $1 AND tenant_id = $2`,
    noticeId,
    tenantId,
  );
  return { sendAttemptCount: row?.send_attempt_count ?? 0, maxSendAttempts: row?.max_send_attempts ?? 3 };
}

// ============================================================
// Outcome recording — the one explicit mapping table, applied
// uniformly. The mirror runs only if the attempt-level guard succeeded,
// in the same transaction.
// ============================================================

export function mapOutcomeToNoticeStatus(
  outcome: DunningAttemptOutcome,
  opts: { capReached?: boolean } = {},
): DunningNoticeStatus | null {
  switch (outcome) {
    case 'SUBMITTED': return 'SUBMITTED';
    case 'FAILED': return opts.capReached ? 'FAILED_EXHAUSTED' : 'FAILED';
    case 'DELIVERY_UNKNOWN': return 'DELIVERY_UNKNOWN';
    case 'SUPPRESSED': return 'SUPPRESSED';
    case 'DEFERRED': return null; // not mirrored — notice remains PENDING
    default: return null;
  }
}

// ============================================================
// Gates and prechecks used by the consumer.
// ============================================================

/** Mirrors emailService.ts's own resolution order — a real transport must
 *  actually be resolvable before the consumer ever attempts a claim. */
export async function isTransportAvailable(): Promise<boolean> {
  const dbConfig = await prisma.integrationConfig
    .findFirst({ where: { type: 'EMAIL', isEnabled: true } })
    .catch(() => null);
  if (dbConfig && dbConfig.host && dbConfig.username) return true;
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

/** APP_ENV, not NODE_ENV — a production-built Next.js app runs
 *  NODE_ENV=production in staging too. Fails safe: unset/unrecognized
 *  values are treated as non-production. */
export function isNonProductionEnvironment(): boolean {
  return process.env.APP_ENV !== 'production';
}

export type PreDispatchRecheckResult =
  | {
      ok: true;
      invoiceId: string;
      invoiceNo: string | null;
      dueDate: Date;
      amount: number;
      currency: string;
      recipientEmail: string;
      recipientName: string;
    }
  | { ok: false; reason: string };

/** Balance, suppression, dispute, cycle/stage currency, and (for
 *  LEGAL_REFERRAL) approval — all rechecked fresh, immediately before
 *  dispatch, as the last step before calling sendEmail. */
export async function preDispatchRecheck(
  tx: TxClient,
  tenantId: string,
  noticeId: string,
): Promise<PreDispatchRecheckResult> {
  const notice = await tx.leaseDunningNotice.findFirst({ where: { id: noticeId, tenantId } });
  if (!notice) return { ok: false, reason: 'notice_not_found' };

  const invoice = await tx.leaseInvoice.findFirst({
    where: { id: notice.invoiceId, tenantId },
    include: { lessee: { select: { name: true, email: true } } },
  });
  if (!invoice) return { ok: false, reason: 'invoice_not_found' };
  if (invoice.status === 'DISPUTED' || invoice.status === 'CANCELLED') {
    return { ok: false, reason: `invoice_status_${invoice.status}` };
  }

  const outstanding = await getInvoiceOutstandingBalance(tx, tenantId, invoice.id);
  if (outstanding <= 0.005) {
    return { ok: false, reason: 'invoice_settled' };
  }

  const activeSuppression = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM lease_dunning_suppressions
      WHERE tenant_id = $1 AND active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (invoice_id = $2 OR lessee_id = $3 OR ($4::text IS NOT NULL AND contract_id = $4))
      LIMIT 1`,
    tenantId,
    invoice.id,
    invoice.lesseeId,
    notice.contractId,
  );
  if (activeSuppression.length > 0) {
    return { ok: false, reason: 'active_suppression' };
  }

  // Cycle/stage currency — a stage advance or reopen since this notice was
  // queued makes it superseded. (invoice was fetched with no `select`
  // above, so its full scalar columns — including these — are already here.)
  if (notice.collectionCycle !== invoice.dunningCollectionCycle) {
    return { ok: false, reason: 'superseded_cycle' };
  }
  if (invoice.currentDunningStage !== notice.collectionStage) {
    return { ok: false, reason: 'superseded_stage' };
  }

  if (notice.collectionStage === 'LEGAL_REFERRAL') {
    const approval = await tx.leaseDunningLegalApproval.findFirst({
      where: { tenantId, invoiceId: invoice.id, collectionCycle: notice.collectionCycle },
    });
    if (!approval?.approvedAt) {
      return { ok: false, reason: 'legal_referral_not_approved' };
    }
  }

  const email = invoice.lessee?.email;
  if (!email) return { ok: false, reason: 'no_recipient_email' };

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    dueDate: invoice.dueDate,
    amount: outstanding,
    currency: invoice.currency ?? 'AED',
    recipientEmail: email,
    recipientName: invoice.lessee?.name ?? 'Customer',
  };
}

/**
 * Required, not optional, whenever dispatch is enabled outside
 * production: returns null (fail closed — caller must not proceed) if
 * the override is missing. Applies to every recipient field.
 */
export function resolveDispatchRecipients(
  real: { email: string; name: string },
): { to: { email: string; name: string }; noteForBody?: string } | null {
  if (!isNonProductionEnvironment()) {
    return { to: real };
  }
  const override = process.env.DUNNING_STAGING_RECIPIENT_OVERRIDE;
  if (!override) {
    return null; // fail closed
  }
  return {
    to: { email: override, name: 'Staging Override' },
    noteForBody: `[staging — intended recipient: ${real.name} <${real.email}>]`,
  };
}

export async function recordOutcome(
  tx: TxClient,
  tenantId: string,
  ids: { attemptId: string; attemptToken: string; noticeId: string },
  outcome: DunningAttemptOutcome,
  details: { errorClass?: string; errorMessage?: string; providerResponseRef?: string } = {},
  opts: { capReached?: boolean } = {},
): Promise<{ applied: boolean }> {
  const [attemptRow] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE lease_dunning_dispatch_attempts
        SET outcome = $1, outcome_at = NOW(), error_class = $2, error_message = $3, provider_response_ref = $4
      WHERE id = $5 AND tenant_id = $6
        AND outcome = 'PENDING' AND resolution IS NULL
      RETURNING id`,
    outcome,
    details.errorClass ?? null,
    details.errorMessage ?? null,
    details.providerResponseRef ?? null,
    ids.attemptId,
    tenantId,
  );
  if (!attemptRow) {
    // Rejected — reconciliation or a newer attempt already finalized this
    // one. Not silently dropped: captured for manual review.
    captureMessage('Dunning: late outcome write rejected — attempt already finalized', {
      level: 'warning',
      context: 'finance.dunning-dispatch.recordOutcome',
      extra: { ...ids, lateOutcome: outcome, ...details },
    });
    return { applied: false };
  }

  const mapped = mapOutcomeToNoticeStatus(outcome, opts);
  if (mapped !== null) {
    await tx.$executeRawUnsafe(
      `UPDATE lease_dunning_notices
          SET dispatch_status = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3 AND current_attempt_token = $4`,
      mapped,
      ids.noticeId,
      tenantId,
      ids.attemptToken,
    );
  }

  return { applied: true };
}
