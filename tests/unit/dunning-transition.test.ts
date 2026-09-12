import { describe, it, expect } from 'vitest';
import {
  resolveDunningTransition,
  LEGAL_REFERRAL_THRESHOLD_DAYS,
  LEGAL_REFERRAL_WAIT_DAYS,
  type DunningTransitionInput,
} from '@/lib/finance/dunning-transition';

const ASOF = new Date('2026-01-01T00:00:00.000Z');

function daysAgo(n: number): Date {
  return new Date(ASOF.getTime() - n * 86400000);
}

function baseInput(overrides: Partial<DunningTransitionInput> = {}): DunningTransitionInput {
  return {
    invoice: { id: 'inv-1', dueDate: daysAgo(0), status: 'SENT' },
    canonicalOutstanding: 1000,
    currentStage: null,
    isDisputed: false,
    hasActiveSuppression: false,
    hasApprovedLegalReferral: false,
    priorFinalNoticeAcceptedAt: null,
    asOf: ASOF,
    ...overrides,
  };
}

describe('resolveDunningTransition', () => {
  describe('settlement — highest priority', () => {
    it('returns settled when the canonical balance has reached zero', () => {
      const r = resolveDunningTransition(baseInput({ canonicalOutstanding: 0, currentStage: 'FINAL_NOTICE' }));
      expect(r).toEqual({ action: 'settled' });
    });

    it('treats a sub-cent residual as settled', () => {
      const r = resolveDunningTransition(baseInput({ canonicalOutstanding: 0.004, currentStage: 'REMINDER' }));
      expect(r).toEqual({ action: 'settled' });
    });

    it('returns settled when invoice status is PAID even with a nonzero balance field', () => {
      const r = resolveDunningTransition(baseInput({
        canonicalOutstanding: 50,
        invoice: { id: 'inv-1', dueDate: daysAgo(0), status: 'PAID' },
        currentStage: 'OVERDUE',
      }));
      expect(r).toEqual({ action: 'settled' });
    });

    it('returns settled for a CANCELLED invoice', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: { id: 'inv-1', dueDate: daysAgo(0), status: 'CANCELLED' },
        currentStage: 'REMINDER',
      }));
      expect(r).toEqual({ action: 'settled' });
    });

    it('is a no-op once already recorded as SETTLED — the transition is written only when the stage actually changes', () => {
      const r = resolveDunningTransition(baseInput({ canonicalOutstanding: 0, currentStage: 'SETTLED' }));
      expect(r).toEqual({ action: 'none' });
    });

    it('takes priority over an active dispute (both conditions true at once)', () => {
      const r = resolveDunningTransition(baseInput({ canonicalOutstanding: 0, isDisputed: true, currentStage: 'FINAL_NOTICE' }));
      expect(r).toEqual({ action: 'settled' });
    });

    it('takes priority over an active suppression', () => {
      const r = resolveDunningTransition(baseInput({ canonicalOutstanding: 0, hasActiveSuppression: true, currentStage: 'FINAL_NOTICE' }));
      expect(r).toEqual({ action: 'settled' });
    });
  });

  describe('dispute / suppression freeze', () => {
    it('freezes to FROZEN_DISPUTE when disputed', () => {
      const r = resolveDunningTransition(baseInput({ isDisputed: true, currentStage: 'OVERDUE' }));
      expect(r).toEqual({ action: 'frozen', stage: 'FROZEN_DISPUTE', reason: 'invoice_disputed' });
    });

    it('is a no-op once already FROZEN_DISPUTE', () => {
      const r = resolveDunningTransition(baseInput({ isDisputed: true, currentStage: 'FROZEN_DISPUTE' }));
      expect(r).toEqual({ action: 'none' });
    });

    it('freezes to FROZEN_SUPPRESSED when an active suppression applies', () => {
      const r = resolveDunningTransition(baseInput({ hasActiveSuppression: true, currentStage: 'REMINDER' }));
      expect(r).toEqual({ action: 'frozen', stage: 'FROZEN_SUPPRESSED', reason: 'active_suppression' });
    });

    it('is a no-op once already FROZEN_SUPPRESSED', () => {
      const r = resolveDunningTransition(baseInput({ hasActiveSuppression: true, currentStage: 'FROZEN_SUPPRESSED' }));
      expect(r).toEqual({ action: 'none' });
    });

    it('dispute takes priority over an active suppression', () => {
      const r = resolveDunningTransition(baseInput({ isDisputed: true, hasActiveSuppression: true, currentStage: null }));
      expect(r).toEqual({ action: 'frozen', stage: 'FROZEN_DISPUTE', reason: 'invoice_disputed' });
    });
  });

  describe('day-bucket progression (not yet disputed/suppressed/settled)', () => {
    it('not yet due → none', () => {
      const r = resolveDunningTransition(baseInput({ invoice: { id: 'inv-1', dueDate: daysAgo(-5), status: 'SENT' } }));
      expect(r).toEqual({ action: 'none' });
    });

    it('within grace (1-14 days) and not yet marked OVERDUE → mark_overdue', () => {
      const r = resolveDunningTransition(baseInput({ invoice: { id: 'inv-1', dueDate: daysAgo(5), status: 'SENT' } }));
      expect(r).toEqual({ action: 'mark_overdue' });
    });

    it('within grace and already OVERDUE → none', () => {
      const r = resolveDunningTransition(baseInput({ invoice: { id: 'inv-1', dueDate: daysAgo(5), status: 'OVERDUE' } }));
      expect(r).toEqual({ action: 'none' });
    });

    it('15-44 days overdue, no prior contact → queue REMINDER', () => {
      const r = resolveDunningTransition(baseInput({ invoice: { id: 'inv-1', dueDate: daysAgo(20), status: 'OVERDUE' } }));
      expect(r).toEqual({ action: 'queue', stage: 'REMINDER' });
    });

    it('already at REMINDER for this bucket → none (re-confirmation writes nothing)', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: { id: 'inv-1', dueDate: daysAgo(20), status: 'OVERDUE' }, currentStage: 'REMINDER',
      }));
      expect(r).toEqual({ action: 'none' });
    });

    it('45-74 days overdue → queue OVERDUE', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: { id: 'inv-1', dueDate: daysAgo(50), status: 'OVERDUE' }, currentStage: 'REMINDER',
      }));
      expect(r).toEqual({ action: 'queue', stage: 'OVERDUE' });
    });

    it('75-119 days overdue → queue FINAL_NOTICE', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: { id: 'inv-1', dueDate: daysAgo(90), status: 'OVERDUE' }, currentStage: 'OVERDUE',
      }));
      expect(r).toEqual({ action: 'queue', stage: 'FINAL_NOTICE' });
    });
  });

  describe('120+ days — legal-referral gating', () => {
    const overdueInvoice = { id: 'inv-1', dueDate: daysAgo(LEGAL_REFERRAL_THRESHOLD_DAYS + 10), status: 'OVERDUE' };

    it('first-ever contact at 130 days overdue climbs the ladder to FINAL_NOTICE, not straight to legal review', () => {
      const r = resolveDunningTransition(baseInput({ invoice: overdueInvoice, currentStage: null, priorFinalNoticeAcceptedAt: null }));
      expect(r).toEqual({ action: 'queue', stage: 'FINAL_NOTICE' });
    });

    it('already at FINAL_NOTICE with no accepted submission yet → none (waiting)', () => {
      const r = resolveDunningTransition(baseInput({ invoice: overdueInvoice, currentStage: 'FINAL_NOTICE', priorFinalNoticeAcceptedAt: null }));
      expect(r).toEqual({ action: 'none' });
    });

    it('FINAL_NOTICE accepted less than the wait period ago → still none, not yet review-eligible', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: overdueInvoice, currentStage: 'FINAL_NOTICE',
        priorFinalNoticeAcceptedAt: daysAgo(LEGAL_REFERRAL_WAIT_DAYS - 1),
      }));
      expect(r).toEqual({ action: 'none' });
    });

    it('FINAL_NOTICE accepted exactly at the wait boundary, not yet approved → create_review_task', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: overdueInvoice, currentStage: 'FINAL_NOTICE',
        priorFinalNoticeAcceptedAt: daysAgo(LEGAL_REFERRAL_WAIT_DAYS),
      }));
      expect(r).toEqual({ action: 'create_review_task' });
    });

    it('review task is not recreated once already at LEGAL_REFERRAL, pending approval', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: overdueInvoice, currentStage: 'LEGAL_REFERRAL',
        priorFinalNoticeAcceptedAt: daysAgo(LEGAL_REFERRAL_WAIT_DAYS + 5), hasApprovedLegalReferral: false,
      }));
      expect(r).toEqual({ action: 'none' });
    });

    it('wait elapsed and approved → queue LEGAL_REFERRAL', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: overdueInvoice, currentStage: 'FINAL_NOTICE',
        priorFinalNoticeAcceptedAt: daysAgo(LEGAL_REFERRAL_WAIT_DAYS + 5), hasApprovedLegalReferral: true,
      }));
      expect(r).toEqual({ action: 'queue', stage: 'LEGAL_REFERRAL' });
    });

    it('already at LEGAL_REFERRAL and approved → none', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: overdueInvoice, currentStage: 'LEGAL_REFERRAL',
        priorFinalNoticeAcceptedAt: daysAgo(LEGAL_REFERRAL_WAIT_DAYS + 5), hasApprovedLegalReferral: true,
      }));
      expect(r).toEqual({ action: 'none' });
    });

    it('a manually-confirmed submission (resolvedAt path) counts the same as an automated outcomeAt', () => {
      // Caller is responsible for resolving outcomeAt vs resolvedAt into one
      // timestamp before calling in — this only asserts the function treats
      // whatever timestamp it's given as authoritative.
      const r = resolveDunningTransition(baseInput({
        invoice: overdueInvoice, currentStage: 'FINAL_NOTICE',
        priorFinalNoticeAcceptedAt: daysAgo(LEGAL_REFERRAL_WAIT_DAYS + 1), hasApprovedLegalReferral: false,
      }));
      expect(r).toEqual({ action: 'create_review_task' });
    });
  });

  describe('reopening — a terminal stage does not block reclassification once overdue again', () => {
    it('a SETTLED invoice that is overdue again resolves to queue, not none', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: { id: 'inv-1', dueDate: daysAgo(20), status: 'OVERDUE' },
        currentStage: 'SETTLED',
        canonicalOutstanding: 500,
      }));
      expect(r).toEqual({ action: 'queue', stage: 'REMINDER' });
    });

    it('a FROZEN_SUPPRESSED invoice with the suppression now lifted resolves to queue, not none', () => {
      const r = resolveDunningTransition(baseInput({
        invoice: { id: 'inv-1', dueDate: daysAgo(50), status: 'OVERDUE' },
        currentStage: 'FROZEN_SUPPRESSED',
        hasActiveSuppression: false,
        canonicalOutstanding: 500,
      }));
      expect(r).toEqual({ action: 'queue', stage: 'OVERDUE' });
    });
  });
});
