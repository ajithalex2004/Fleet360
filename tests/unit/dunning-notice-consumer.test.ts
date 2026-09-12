import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import type { DunningNoticeQueuedPayload } from '@/events/consumers/dunning-notice.consumer';

// ── Mocks ────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted above these declarations, so anything they
// reference must itself be created via vi.hoisted().

const mockTx = vi.hoisted(() => ({
  leaseDunningDispatchAttempt: { findFirst: vi.fn() },
  leaseDunningNotice: { findFirst: vi.fn() },
  leaseDunningActivity: { create: vi.fn() },
}));

const dispatch = vi.hoisted(() => ({
  claimAttempt: vi.fn(),
  preDispatchRecheck: vi.fn(),
  resolveDispatchRecipients: vi.fn(),
  commitPreparedEvidence: vi.fn(),
  recordOutcome: vi.fn(async () => ({ applied: true })),
  getSendAttemptState: vi.fn(async () => ({ sendAttemptCount: 1, maxSendAttempts: 3 })),
  isTransportAvailable: vi.fn(async () => true),
}));

const email = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  classifyEmailError: vi.fn(() => 'DEFINITE_FAILURE'),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn(async (_prisma: unknown, _tenantId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

vi.mock('@/lib/sentry', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/lib/finance/dunning-templates', () => ({
  renderDunningEmail: vi.fn(() => ({
    subject: 'Test subject', htmlBody: '<p>body</p>', textBody: 'body',
  })),
}));

vi.mock('@/lib/finance/dunning-dispatch', () => dispatch);

vi.mock('@/services/email/emailService', () => email);

// Imported after the mocks above are registered (vi.mock calls are hoisted).
import { DunningNoticeConsumer } from '@/events/consumers/dunning-notice.consumer';

function makeEnvelope(overrides: Partial<DunningNoticeQueuedPayload> = {}): DomainEventEnvelope<DunningNoticeQueuedPayload> {
  return {
    eventId: 'evt-1',
    eventType: 'finance.dunningNoticeQueued',
    eventVersion: '1',
    occurredAt: new Date().toISOString(),
    tenantId: 'tenant-1',
    aggregateType: 'LeaseDunningNotice',
    aggregateId: 'notice-1',
    sourceModule: 'finance',
    correlationId: null,
    causationId: null,
    actor: null,
    data: { noticeId: 'notice-1', attemptToken: 'token-1', ...overrides },
  };
}

const READY_ATTEMPT = { id: 'attempt-1' };
const READY_NOTICE = { collectionStage: 'REMINDER', lesseeId: 'lessee-1', contractId: 'contract-1' };
const READY_RECHECK = {
  ok: true as const,
  invoiceId: 'inv-1',
  invoiceNo: 'INV-001',
  dueDate: new Date('2026-01-01'),
  amount: 500,
  currency: 'AED',
  recipientEmail: 'customer@example.com',
  recipientName: 'Customer Co',
};
const READY_RECIPIENTS = { to: { email: 'customer@example.com', name: 'Customer Co' } };

async function callHandle(env = makeEnvelope()) {
  const consumer = new DunningNoticeConsumer();
  await (consumer as unknown as { handle(e: typeof env): Promise<void> }).handle(env);
}

describe('DunningNoticeConsumer', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, DUNNING_DISPATCH_ENABLED: 'true' };
    dispatch.isTransportAvailable.mockResolvedValue(true);
    dispatch.recordOutcome.mockResolvedValue({ applied: true });
    dispatch.getSendAttemptState.mockResolvedValue({ sendAttemptCount: 1, maxSendAttempts: 3 });
    mockTx.leaseDunningDispatchAttempt.findFirst.mockResolvedValue(READY_ATTEMPT);
    mockTx.leaseDunningNotice.findFirst.mockResolvedValue(READY_NOTICE);
    mockTx.leaseDunningActivity.create.mockResolvedValue({});
  });

  it('defers without claiming when the dispatch switch is off', async () => {
    process.env.DUNNING_DISPATCH_ENABLED = 'false';
    await callHandle();

    expect(dispatch.claimAttempt).not.toHaveBeenCalled();
    expect(dispatch.recordOutcome).toHaveBeenCalledWith(
      mockTx, 'tenant-1',
      { attemptId: 'attempt-1', attemptToken: 'token-1', noticeId: 'notice-1' },
      'DEFERRED',
    );
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('defers without claiming when no transport is resolvable', async () => {
    dispatch.isTransportAvailable.mockResolvedValue(false);
    await callHandle();

    expect(dispatch.claimAttempt).not.toHaveBeenCalled();
    expect(dispatch.recordOutcome).toHaveBeenCalledWith(
      mockTx, 'tenant-1',
      { attemptId: 'attempt-1', attemptToken: 'token-1', noticeId: 'notice-1' },
      'DEFERRED',
    );
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('does nothing further when the claim is stale (already superseded)', async () => {
    dispatch.claimAttempt.mockResolvedValue(false);
    await callHandle();

    expect(dispatch.recordOutcome).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('suppresses without sending when the pre-dispatch recheck fails', async () => {
    dispatch.claimAttempt.mockResolvedValue(true);
    dispatch.preDispatchRecheck.mockResolvedValue({ ok: false, reason: 'invoice_settled' });
    await callHandle();

    expect(dispatch.recordOutcome).toHaveBeenCalledWith(
      mockTx, 'tenant-1',
      { attemptId: 'attempt-1', attemptToken: 'token-1', noticeId: 'notice-1' },
      'SUPPRESSED',
      { errorMessage: 'invoice_settled' },
    );
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('defers (fail-closed) without sending when the staging recipient override is required but missing', async () => {
    dispatch.claimAttempt.mockResolvedValue(true);
    dispatch.preDispatchRecheck.mockResolvedValue(READY_RECHECK);
    dispatch.resolveDispatchRecipients.mockReturnValue(null);
    await callHandle();

    expect(dispatch.commitPreparedEvidence).not.toHaveBeenCalled();
    expect(dispatch.recordOutcome).toHaveBeenCalledWith(
      mockTx, 'tenant-1',
      { attemptId: 'attempt-1', attemptToken: 'token-1', noticeId: 'notice-1' },
      'DEFERRED',
    );
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('suppresses without sending when the prepared-evidence commit is invalidated', async () => {
    dispatch.claimAttempt.mockResolvedValue(true);
    dispatch.preDispatchRecheck.mockResolvedValue(READY_RECHECK);
    dispatch.resolveDispatchRecipients.mockReturnValue(READY_RECIPIENTS);
    dispatch.commitPreparedEvidence.mockResolvedValue({ ok: false, reason: 'cap_reached_or_notice_invalidated' });
    await callHandle();

    expect(dispatch.recordOutcome).toHaveBeenCalledWith(
      mockTx, 'tenant-1',
      { attemptId: 'attempt-1', attemptToken: 'token-1', noticeId: 'notice-1' },
      'SUPPRESSED',
      { errorMessage: 'cap_reached_or_notice_invalidated' },
    );
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  describe('once claimed, rechecked, and prepared-evidence committed', () => {
    beforeEach(() => {
      dispatch.claimAttempt.mockResolvedValue(true);
      dispatch.preDispatchRecheck.mockResolvedValue(READY_RECHECK);
      dispatch.resolveDispatchRecipients.mockReturnValue(READY_RECIPIENTS);
      dispatch.commitPreparedEvidence.mockResolvedValue({ ok: true });
    });

    it('calls sendEmail exactly once, outside the claim transaction, with the resolved recipient', async () => {
      email.sendEmail.mockResolvedValue({ status: 'SENT', id: 'msg-1' });
      await callHandle();

      expect(email.sendEmail).toHaveBeenCalledTimes(1);
      expect(email.sendEmail).toHaveBeenCalledWith({
        to: [READY_RECIPIENTS.to],
        subject: 'Test subject',
        htmlBody: '<p>body</p>',
        textBody: 'body',
      });
    });

    it('a SENT result records SUBMITTED and writes the audit activity row', async () => {
      email.sendEmail.mockResolvedValue({ status: 'SENT', id: 'msg-1' });
      await callHandle();

      expect(dispatch.recordOutcome).toHaveBeenCalledWith(
        mockTx, 'tenant-1',
        { attemptId: 'attempt-1', attemptToken: 'token-1', noticeId: 'notice-1' },
        'SUBMITTED',
        { errorClass: undefined, errorMessage: undefined, providerResponseRef: 'msg-1' },
        { capReached: false },
      );
      expect(mockTx.leaseDunningActivity.create).toHaveBeenCalledTimes(1);
      expect(mockTx.leaseDunningActivity.create.mock.calls[0][0].data).toMatchObject({
        tenantId: 'tenant-1', contractId: 'contract-1', lesseeId: 'lessee-1', activityType: 'EMAIL',
      });
    });

    it('a FAILED result below the send-attempt cap records FAILED, not FAILED_EXHAUSTED', async () => {
      email.sendEmail.mockResolvedValue({ status: 'FAILED', errorClass: 'DEFINITE_FAILURE', errorMessage: 'RCPT rejected' });
      dispatch.getSendAttemptState.mockResolvedValue({ sendAttemptCount: 1, maxSendAttempts: 3 });
      await callHandle();

      expect(dispatch.recordOutcome).toHaveBeenCalledWith(
        mockTx, 'tenant-1',
        { attemptId: 'attempt-1', attemptToken: 'token-1', noticeId: 'notice-1' },
        'FAILED',
        { errorClass: 'DEFINITE_FAILURE', errorMessage: 'RCPT rejected', providerResponseRef: undefined },
        { capReached: false },
      );
      expect(mockTx.leaseDunningActivity.create).not.toHaveBeenCalled();
    });

    it('a FAILED result at the send-attempt cap passes capReached: true', async () => {
      email.sendEmail.mockResolvedValue({ status: 'FAILED', errorClass: 'DEFINITE_FAILURE', errorMessage: 'RCPT rejected' });
      dispatch.getSendAttemptState.mockResolvedValue({ sendAttemptCount: 3, maxSendAttempts: 3 });
      await callHandle();

      expect(dispatch.recordOutcome).toHaveBeenCalledWith(
        mockTx, 'tenant-1', expect.anything(), 'FAILED',
        expect.anything(), { capReached: true },
      );
    });

    it('an UNCERTAIN result records DELIVERY_UNKNOWN, never FAILED', async () => {
      email.sendEmail.mockResolvedValue({ status: 'UNCERTAIN', errorClass: 'UNCERTAIN', errorMessage: 'DATA timeout' });
      await callHandle();

      expect(dispatch.recordOutcome).toHaveBeenCalledWith(
        mockTx, 'tenant-1', expect.anything(), 'DELIVERY_UNKNOWN', expect.anything(), { capReached: false },
      );
    });

    it('a synchronously thrown sendEmail error is caught, classified, and recorded — never propagated', async () => {
      email.sendEmail.mockRejectedValue(Object.assign(new Error('socket hang up'), { command: 'DATA' }));
      email.classifyEmailError.mockReturnValue('UNCERTAIN');

      await expect(callHandle()).resolves.toBeUndefined();

      expect(dispatch.recordOutcome).toHaveBeenCalledWith(
        mockTx, 'tenant-1', expect.anything(), 'DELIVERY_UNKNOWN',
        expect.objectContaining({ errorMessage: 'socket hang up' }),
        { capReached: false },
      );
    });

    it('a MOCK_SENT status (transport gate raced away underneath) never maps to SUBMITTED', async () => {
      email.sendEmail.mockResolvedValue({ status: 'MOCK_SENT' });
      await callHandle();

      const outcome = (dispatch.recordOutcome.mock.calls[0] as unknown as unknown[] | undefined)?.[3];
      expect(outcome).not.toBe('SUBMITTED');
    });

    it('an audit-row failure is swallowed, not thrown', async () => {
      email.sendEmail.mockResolvedValue({ status: 'SENT', id: 'msg-1' });
      mockTx.leaseDunningActivity.create.mockRejectedValue(new Error('constraint violation'));

      await expect(callHandle()).resolves.toBeUndefined();
    });
  });
});
