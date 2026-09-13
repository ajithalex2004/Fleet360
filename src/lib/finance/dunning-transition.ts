/**
 * Collection-stage transition logic — layered on top of dunning-engine.ts's
 * pure days-overdue bucketing. dunning-engine.ts stays unchanged; this
 * module adds the persisted-stage, settlement/dispute/suppression, and
 * legal-referral-gating policy described in the design plan (dunning
 * revision 7).
 *
 * Pure function — no DB/SMTP dependencies, same design principle as
 * dunning-engine.ts. The caller supplies canonical outstanding balance
 * (from src/lib/leasing/invoice-balance.ts) and current dunning state;
 * this only decides what should happen next.
 */

import { classify, type InvoiceForDunning, type DunningBucket } from '@/lib/finance/dunning-engine';

export const LEGAL_REFERRAL_THRESHOLD_DAYS = 120;
export const LEGAL_REFERRAL_WAIT_DAYS = 14;

export type CollectionStage = 'REMINDER' | 'OVERDUE' | 'FINAL_NOTICE' | 'LEGAL_REFERRAL';
export type TerminalStage = 'SETTLED' | 'FROZEN_DISPUTE' | 'FROZEN_SUPPRESSED';

export type DunningTransitionResult =
  | { action: 'none' }
  | { action: 'mark_overdue' }
  | { action: 'settled' }
  | { action: 'frozen'; stage: TerminalStage; reason: string }
  | { action: 'create_review_task' }
  | { action: 'queue'; stage: CollectionStage };

export interface DunningTransitionInput {
  invoice: Pick<InvoiceForDunning, 'id' | 'dueDate' | 'status'>;
  /** Canonical, from getInvoiceOutstandingBalance — not derived here. */
  canonicalOutstanding: number;
  /** LeaseInvoice.currentDunningStage — a CollectionStage, a TerminalStage, or null (never contacted yet). */
  currentStage: string | null;
  isDisputed: boolean;
  hasActiveSuppression: boolean;
  hasApprovedLegalReferral: boolean;
  /** Timestamp a FINAL_NOTICE-stage notice in this same cycle actually reached
   *  SUBMITTED (via its attempt's outcomeAt) or was manually confirmed
   *  (resolvedAt) — whichever applies. Null if neither has happened. */
  priorFinalNoticeAcceptedAt: Date | null;
  asOf?: Date;
}

const BUCKET_TO_STAGE: Partial<Record<DunningBucket, CollectionStage>> = {
  REMINDER_30: 'REMINDER',
  NOTICE_60: 'OVERDUE',
  FINAL_90: 'FINAL_NOTICE',
};

export function resolveDunningTransition(input: DunningTransitionInput): DunningTransitionResult {
  const asOf = input.asOf ?? new Date();

  // Settlement takes priority over everything else.
  if (input.canonicalOutstanding <= 0.005 || input.invoice.status === 'PAID' || input.invoice.status === 'CANCELLED') {
    if (input.currentStage !== 'SETTLED') {
      return { action: 'settled' };
    }
    return { action: 'none' };
  }

  // Dispute/suppression freeze — also takes priority over bucket progression.
  if (input.isDisputed) {
    if (input.currentStage !== 'FROZEN_DISPUTE') {
      return { action: 'frozen', stage: 'FROZEN_DISPUTE', reason: 'invoice_disputed' };
    }
    return { action: 'none' };
  }
  if (input.hasActiveSuppression) {
    if (input.currentStage !== 'FROZEN_SUPPRESSED') {
      return { action: 'frozen', stage: 'FROZEN_SUPPRESSED', reason: 'active_suppression' };
    }
    return { action: 'none' };
  }

  // Reopening: a previously terminal invoice is overdue again.
  const wasTerminal = input.currentStage === 'SETTLED' || input.currentStage === 'FROZEN_DISPUTE' || input.currentStage === 'FROZEN_SUPPRESSED';

  const c = classify(
    { id: input.invoice.id, invoiceNo: null, lesseeId: '', totalAmount: input.canonicalOutstanding, paidAmount: 0, currency: 'AED', dueDate: input.invoice.dueDate, status: input.invoice.status },
    asOf,
  );

  if (c.bucket === 'CURRENT') {
    return { action: 'none' };
  }
  if (c.bucket === 'GRACE') {
    return c.action === 'mark_overdue' ? { action: 'mark_overdue' } : { action: 'none' };
  }

  const days = c.daysOverdue;

  if (days >= LEGAL_REFERRAL_THRESHOLD_DAYS) {
    const finalNoticeReady =
      input.priorFinalNoticeAcceptedAt !== null &&
      asOf.getTime() - input.priorFinalNoticeAcceptedAt.getTime() >= LEGAL_REFERRAL_WAIT_DAYS * 86400000;

    if (!finalNoticeReady) {
      // First contact at 130+ days, or the wait period hasn't elapsed yet
      // since the final notice actually went out — climb the ladder
      // properly rather than jumping straight to legal review.
      return input.currentStage === 'FINAL_NOTICE' ? { action: 'none' } : { action: 'queue', stage: 'FINAL_NOTICE' };
    }
    if (input.hasApprovedLegalReferral) {
      return input.currentStage === 'LEGAL_REFERRAL' ? { action: 'none' } : { action: 'queue', stage: 'LEGAL_REFERRAL' };
    }
    return input.currentStage === 'LEGAL_REFERRAL' ? { action: 'none' } : { action: 'create_review_task' };
  }

  const targetStage = BUCKET_TO_STAGE[c.bucket];
  if (!targetStage) {
    return { action: 'none' };
  }
  if (!wasTerminal && input.currentStage === targetStage) {
    return { action: 'none' };
  }
  return { action: 'queue', stage: targetStage };
}
