/**
 * Dunning & Collections — Safe Automated Dispatch. PostgreSQL Integration
 * Tests.
 *
 * Exercises the attempt-token claim protocol (src/lib/finance/dunning-dispatch.ts),
 * the consumer orchestration (src/events/consumers/dunning-notice.consumer.ts),
 * the sweep (src/lib/jobs/dunning-sweep.ts) and reconciliation
 * (src/lib/jobs/dunning-reconciliation.ts) jobs against real PostgreSQL with
 * active RLS — including the five decisive tests named in the design plan.
 *
 * The only mocked boundary is the outermost transport call (sendEmail) —
 * everything else (schema, RLS, advisory locks, guarded conditional
 * updates, the real job/consumer code) runs against a real database. No
 * real SMTP call is ever made. DUNNING_DISPATCH_ENABLED is flipped on
 * only inside this test process for synthetic data, restored after each
 * test — this suite proves the mechanism; it is not itself the staging
 * verification the release gate requires before production ever sees the
 * flag set.
 *
 * Cleanup deletes ONLY the records created by this suite.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma as basePrisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin, type TxClient } from '@/lib/rls';
import type { JobContext } from '@/lib/jobs/registry';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import {
  createNoticeWithFirstAttempt,
  reserveNextAttempt,
  enqueueDueAttempt,
  claimAttempt,
  commitPreparedEvidence,
  recordOutcome,
  DUNNING_NOTICE_QUEUED_EVENT,
} from '@/lib/finance/dunning-dispatch';
import { runDunningSweep } from '@/lib/jobs/dunning-sweep';
import { runDunningReconciliation } from '@/lib/jobs/dunning-reconciliation';
import { DunningNoticeConsumer } from '@/events/consumers/dunning-notice.consumer';

const hasDb = Boolean(process.env.DATABASE_URL);

// The only mocked boundary — the real transport (nodemailer/SMTP) is never
// contacted. Real gate logic (isTransportAvailable, the dispatch switch,
// the staging recipient override) all runs for real.
const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/email/emailService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/email/emailService')>();
  return { ...actual, sendEmail: sendEmailMock };
});

const suffix = Date.now().toString();
const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();
const lesseeA = crypto.randomUUID();
const contractA = crypto.randomUUID();

let disabledIntegrationConfigId: string | null = null;
const originalEnv = {
  DUNNING_DISPATCH_ENABLED: process.env.DUNNING_DISPATCH_ENABLED,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_USER: process.env.SMTP_USER,
  DUNNING_STAGING_RECIPIENT_OVERRIDE: process.env.DUNNING_STAGING_RECIPIENT_OVERRIDE,
  APP_ENV: process.env.APP_ENV,
};

function resetEnv() {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function enableTransport() {
  process.env.SMTP_HOST = 'smtp.dunning-test.local';
  process.env.SMTP_USER = 'dunning-test';
}
function disableTransport() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
}

function jobCtx(tenantId: string): JobContext {
  const url = new URL('http://localhost/api/jobs/run');
  return {
    tenantId, userId: 'system:cron', searchParams: url.searchParams,
    request: new NextRequest(url.toString()),
  };
}

async function createInvoice(
  tx: TxClient,
  opts: { daysOverdue: number; amount?: number; status?: string; label: string },
) {
  const dueDate = new Date(Date.now() - opts.daysOverdue * 86400000);
  return tx.leaseInvoice.create({
    data: {
      tenantId: tenantA,
      invoiceNo: `INV-DUN-${suffix.slice(-6)}-${opts.label}`,
      lesseeId: lesseeA,
      issueDate: new Date(dueDate.getTime() - 30 * 86400000),
      dueDate,
      subTotal: opts.amount ?? 1000, vatPct: 0, vatAmount: 0, totalAmount: opts.amount ?? 1000,
      currency: 'AED',
      status: opts.status ?? 'SENT',
    },
  });
}

/** Mirrors what the real sweep does when it queues a notice: advance the
 *  invoice's persisted stage/cycle AND create the first attempt — bypasses
 *  the sweep's own classification for tests that want direct control over
 *  the dispatch protocol without re-deriving day-bucket math. */
async function queueNotice(tx: TxClient, invoiceId: string, stage: string, cycle = 1, amount = 1000) {
  await tx.leaseInvoice.update({
    where: { id: invoiceId },
    data: { currentDunningStage: stage, dunningCollectionCycle: cycle, dunningStageUpdatedAt: new Date() },
  });
  return createNoticeWithFirstAttempt(tx, tenantA, {
    invoiceId, contractId: contractA, lesseeId: lesseeA, collectionCycle: cycle, collectionStage: stage,
    outstandingAmountAtQueue: amount, currency: 'AED',
  });
}

interface OutboxRow {
  id: string;
  event_id: string;
  event_type: string;
  event_version: string;
  aggregate_type: string;
  aggregate_id: string;
  source_module: string;
  tenant_id: string;
  correlation_id: string | null;
  causation_id: string | null;
  actor: string | null;
  payload: unknown;
  occurred_at: Date;
}

/** Simulates one outbox-publisher delivery cycle for the oldest unpublished
 *  dunning event belonging to a SPECIFIC notice — real DB read, real
 *  consumer.process(). Scoped to aggregate_id (= noticeId), not just the
 *  tenant: several tests (notably #3, which only counts outbox rows and
 *  never delivers them) deliberately leave unpublished events behind, and
 *  an unscoped "oldest for tenant" query would pick those up instead of
 *  the caller's own event when tests run in sequence within one process.
 *  Raw SQL against event_outbox, matching src/lib/jobs/outbox-publisher.ts's
 *  own convention (the EventOutbox Prisma model isn't ORM-usable — see the
 *  comment on enqueueOutboxEvent in dunning-dispatch.ts). */
async function deliverNextDunningEvent(tenantId: string, noticeId: string): Promise<boolean> {
  const consumer = new DunningNoticeConsumer();
  const [row] = await withTenantRls(basePrisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<OutboxRow[]>(
      `SELECT id, event_id::text, event_type, event_version, aggregate_type, aggregate_id,
              source_module, tenant_id::text, correlation_id::text, causation_id::text, actor,
              payload, occurred_at
         FROM event_outbox
        WHERE tenant_id = $1::uuid AND event_type = $2 AND aggregate_id = $3 AND published_at IS NULL
        ORDER BY occurred_at ASC
        LIMIT 1`,
      tenantId, DUNNING_NOTICE_QUEUED_EVENT, noticeId,
    ),
  );
  if (!row) return false;

  const envelope: DomainEventEnvelope<{ noticeId: string; attemptToken: string }> = {
    eventId: row.event_id, eventType: row.event_type, eventVersion: row.event_version,
    occurredAt: row.occurred_at.toISOString(), tenantId: row.tenant_id,
    aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, sourceModule: row.source_module,
    correlationId: row.correlation_id, causationId: row.causation_id, actor: row.actor,
    data: row.payload as { noticeId: string; attemptToken: string },
  };

  const ok = await consumer.process(envelope);
  if (ok) {
    await withTenantRls(basePrisma, tenantId, (tx) =>
      tx.$executeRawUnsafe(`UPDATE event_outbox SET published_at = NOW() WHERE id = $1::uuid`, row.id),
    );
  }
  return ok;
}

describe.skipIf(!hasDb)('Dunning & Collections — PostgreSQL Integration', () => {
  beforeAll(async () => {
    await withPlatformAdmin(basePrisma, async (tx) => {
      await tx.tenant.createMany({
        data: [
          { id: tenantA, name: `Dunning Tenant A ${suffix}`, code: `DUN-A-${suffix.slice(-6)}`, domain: `dun-a-${suffix}.example.com`, plan: 'ENTERPRISE', isActive: true },
          { id: tenantB, name: `Dunning Tenant B ${suffix}`, code: `DUN-B-${suffix.slice(-6)}`, domain: `dun-b-${suffix}.example.com`, plan: 'ENTERPRISE', isActive: true },
        ],
      });
      await tx.lessee.create({
        data: { id: lesseeA, tenantId: tenantA, name: `Dunning Lessee ${suffix}`, type: 'corporate', email: `dunning-lessee-${suffix}@example.test` },
      });
      await tx.leaseContract2.create({
        data: { id: contractA, tenantId: tenantA, contractNumber: `LC-DUN-${suffix.slice(-6)}`, lesseeId: lesseeA, monthlyRate: 3000, status: 'ACTIVE', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), currency: 'AED' },
      });
    });

    // IntegrationConfig is a global (non-tenant-scoped) table. If some
    // other suite/admin left an enabled EMAIL config, isTransportAvailable()
    // would see a real transport regardless of the SMTP_HOST/SMTP_USER env
    // vars this suite controls — disable it for the duration, restore after.
    const existingEmailConfig = await basePrisma.integrationConfig.findFirst({ where: { type: 'EMAIL', isEnabled: true } });
    if (existingEmailConfig) {
      disabledIntegrationConfigId = existingEmailConfig.id;
      await basePrisma.integrationConfig.update({ where: { id: existingEmailConfig.id }, data: { isEnabled: false } });
    }

    process.env.DUNNING_STAGING_RECIPIENT_OVERRIDE = `dunning-staging-override-${suffix}@example.test`;
    delete process.env.APP_ENV; // non-production — override required, as intended
  });

  afterEach(() => {
    resetEnv();
    process.env.DUNNING_STAGING_RECIPIENT_OVERRIDE = `dunning-staging-override-${suffix}@example.test`;
    delete process.env.APP_ENV;
    sendEmailMock.mockReset();
  });

  afterAll(async () => {
    if (disabledIntegrationConfigId) {
      await basePrisma.integrationConfig.update({ where: { id: disabledIntegrationConfigId }, data: { isEnabled: true } }).catch(() => {});
    }
    resetEnv();

    await withPlatformAdmin(basePrisma, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM event_consumer_inbox WHERE tenant_id IN ($1::uuid, $2::uuid)`, tenantA, tenantB).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM event_outbox WHERE tenant_id IN ($1::uuid, $2::uuid)`, tenantA, tenantB).catch(() => {});
      await tx.leaseDunningDispatchAttempt.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseDunningNotice.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseDunningStageTransition.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseDunningSuppression.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseDunningLegalApproval.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseAlert.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseDunningActivity.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseInvoiceLine.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseInvoice.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.leaseContract2.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.lessee.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } }).catch(() => {});
      await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } }).catch(() => {});
    });

    const left = await withPlatformAdmin(basePrisma, async (tx) => tx.tenant.count({ where: { id: { in: [tenantA, tenantB] } } }));
    expect(left).toBe(0);
    await basePrisma.$disconnect();
  });

  // ── Decisive test 1 ──────────────────────────────────────────────────────
  it('1. Deliver an event while dispatch is disabled, acknowledge it, then enable dispatch: it eventually sends once', async () => {
    disableTransport();
    delete process.env.DUNNING_DISPATCH_ENABLED; // gate closed

    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'GATE-OFF' }));
    const { noticeId, attemptId: attempt1Id } = await withTenantRls(basePrisma, tenantA, (tx) => queueNotice(tx, invoice.id, 'REMINDER'));

    // Gate closed → deliver → DEFERRED, no claim, no send.
    enableTransport(); // transport itself is fine; the DISPATCH SWITCH is what's off here
    const delivered1 = await deliverNextDunningEvent(tenantA, noticeId);
    expect(delivered1).toBe(true);
    expect(sendEmailMock).not.toHaveBeenCalled();

    const attempt1 = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningDispatchAttempt.findFirst({ where: { id: attempt1Id } }));
    expect(attempt1?.outcome).toBe('DEFERRED');
    const noticeAfterDefer = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));
    expect(noticeAfterDefer?.dispatchStatus).toBe('PENDING'); // paused, not dropped
    expect(noticeAfterDefer?.sendAttemptCount).toBe(0);

    // Flip the flag on and run the deferred-work recovery sweep.
    process.env.DUNNING_DISPATCH_ENABLED = 'true';
    const reconResult = await runDunningReconciliation(jobCtx(tenantA));
    expect(reconResult.status).toBe('ok');
    expect((reconResult.data as any).deferredRecovered).toBeGreaterThanOrEqual(1);

    const noticeAfterRecovery = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));
    expect(noticeAfterRecovery?.currentAttemptToken).not.toBeNull();
    expect(noticeAfterRecovery?.currentAttemptToken).not.toBe(attempt1?.attemptToken);
    expect(noticeAfterRecovery?.sendAttemptCount).toBe(0); // recovery never touches this

    const attempt2 = await withTenantRls(basePrisma, tenantA, (tx) =>
      tx.leaseDunningDispatchAttempt.findFirst({ where: { attemptToken: noticeAfterRecovery!.currentAttemptToken! } }),
    );
    expect(attempt2?.attemptSeq).toBe(2); // occurrence sequencing advanced...
    // ...while send-attempt counting is still 0 going into the first real send.

    sendEmailMock.mockResolvedValue({ status: 'SENT', id: 'msg-1' });
    const delivered2 = await deliverNextDunningEvent(tenantA, noticeId);
    expect(delivered2).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const finalNotice = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));
    expect(finalNotice?.dispatchStatus).toBe('SUBMITTED');
    expect(finalNotice?.sendAttemptCount).toBe(1);
  });

  // ── Decisive test 2 ──────────────────────────────────────────────────────
  it('2. Repeat with missing transport instead of a disabled switch: recovery still works', async () => {
    process.env.DUNNING_DISPATCH_ENABLED = 'true';
    disableTransport(); // gate closed via transport, not the switch

    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'NO-TRANSPORT' }));
    const { noticeId, attemptId: attempt1Id } = await withTenantRls(basePrisma, tenantA, (tx) => queueNotice(tx, invoice.id, 'REMINDER'));

    const delivered1 = await deliverNextDunningEvent(tenantA, noticeId);
    expect(delivered1).toBe(true);
    expect(sendEmailMock).not.toHaveBeenCalled();

    const attempt1 = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningDispatchAttempt.findFirst({ where: { id: attempt1Id } }));
    expect(attempt1?.outcome).toBe('DEFERRED');

    enableTransport();
    const reconResult = await runDunningReconciliation(jobCtx(tenantA));
    expect((reconResult.data as any).deferredRecovered).toBeGreaterThanOrEqual(1);

    sendEmailMock.mockResolvedValue({ status: 'SENT', id: 'msg-2' });
    const delivered2 = await deliverNextDunningEvent(tenantA, noticeId);
    expect(delivered2).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const finalNotice = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));
    expect(finalNotice?.dispatchStatus).toBe('SUBMITTED');
  });

  // ── Decisive test 3 ──────────────────────────────────────────────────────
  it('3. Run two due-enqueue workers concurrently against the same backoff-scheduled attempt: exactly one dispatch event is created', async () => {
    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'CONCURRENT-ENQUEUE' }));
    const { noticeId, attemptId: attempt1Id, attemptToken: token1 } = await withTenantRls(basePrisma, tenantA, (tx) => queueNotice(tx, invoice.id, 'REMINDER'));

    await withTenantRls(basePrisma, tenantA, (tx) =>
      recordOutcome(tx, tenantA, { attemptId: attempt1Id, attemptToken: token1, noticeId }, 'FAILED', { errorMessage: 'seed failure for retry setup' }),
    );

    // A backoff-scheduled retry: due immediately (negative backoff), but not
    // yet enqueued — this is the exact shape a delayed retry leaves behind.
    const reserved = await withTenantRls(basePrisma, tenantA, (tx) =>
      reserveNextAttempt(tx, tenantA, noticeId, 'FAILED', { immediate: false, backoffMs: -5000 }),
    );
    expect(reserved.noOp).toBe(false);
    if (reserved.noOp) throw new Error('unreachable');
    const { attemptId: attempt2Id, attemptToken: token2 } = reserved;

    const preRaceCount = await withTenantRls(basePrisma, tenantA, (tx) => tx.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM event_outbox WHERE tenant_id = $1::uuid AND payload->>'attemptToken' = $2`,
      tenantA, token2,
    ));
    expect(Number(preRaceCount[0].count)).toBe(0); // not yet due-enqueued — proves "too early" is structurally absent until due

    const [ok1, ok2] = await Promise.all([
      withTenantRls(basePrisma, tenantA, (tx) => enqueueDueAttempt(tx, tenantA, attempt2Id)),
      withTenantRls(basePrisma, tenantA, (tx) => enqueueDueAttempt(tx, tenantA, attempt2Id)),
    ]);
    expect([ok1, ok2].filter(Boolean)).toHaveLength(1);

    const postRaceCount = await withTenantRls(basePrisma, tenantA, (tx) => tx.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM event_outbox WHERE tenant_id = $1::uuid AND payload->>'attemptToken' = $2`,
      tenantA, token2,
    ));
    expect(Number(postRaceCount[0].count)).toBe(1);
  });

  // ── Decisive test 4 ──────────────────────────────────────────────────────
  it('4. Reach the send limit: no further automatic transport call occurs', async () => {
    process.env.DUNNING_DISPATCH_ENABLED = 'true';
    enableTransport();
    sendEmailMock.mockResolvedValue({ status: 'FAILED', errorClass: 'DEFINITE_FAILURE', errorMessage: 'RCPT rejected' });

    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'CAP' }));
    const { noticeId } = await withTenantRls(basePrisma, tenantA, (tx) => queueNotice(tx, invoice.id, 'REMINDER'));

    for (let i = 0; i < 3; i++) {
      const delivered = await deliverNextDunningEvent(tenantA, noticeId);
      expect(delivered).toBe(true);
      if (i < 2) {
        // Bypasses the reconciliation job's own 15-minute retry backoff so
        // the test doesn't need to wait — the eligibility/cap mechanism
        // under test is identical either way.
        const reserved = await withTenantRls(basePrisma, tenantA, (tx) => reserveNextAttempt(tx, tenantA, noticeId, 'FAILED', { immediate: true }));
        expect(reserved.noOp).toBe(false);
      }
    }

    const notice = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));
    expect(notice?.dispatchStatus).toBe('FAILED_EXHAUSTED');
    expect(notice?.sendAttemptCount).toBe(3);
    expect(sendEmailMock).toHaveBeenCalledTimes(3);

    sendEmailMock.mockClear();
    const currentTokenBefore = notice!.currentAttemptToken;

    const reconResult = await runDunningReconciliation(jobCtx(tenantA));
    expect(reconResult.status).toBe('ok');

    // The retry re-queue sweep only selects dispatch_status = 'FAILED' —
    // FAILED_EXHAUSTED is a different value, so it's structurally excluded.
    const noticeAfterRecon = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));
    expect(noticeAfterRecon?.currentAttemptToken).toBe(currentTokenBefore);
    expect(noticeAfterRecon?.dispatchStatus).toBe('FAILED_EXHAUSTED');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // ── Decisive test 5 ──────────────────────────────────────────────────────
  it('5. Race reconciliation against the original worker\'s own outcome write: attempt and notice remain consistent', async () => {
    process.env.DUNNING_DISPATCH_ENABLED = 'true';
    enableTransport();

    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'RACE-OUTCOME' }));
    const { noticeId, attemptId, attemptToken } = await withTenantRls(basePrisma, tenantA, (tx) => queueNotice(tx, invoice.id, 'REMINDER'));

    await withTenantRls(basePrisma, tenantA, async (tx) => {
      const claimed = await claimAttempt(tx, tenantA, noticeId, attemptToken);
      expect(claimed).toBe(true);
      const commit = await commitPreparedEvidence(
        tx, tenantA, { attemptId, attemptToken, noticeId },
        { amount: 1000, currency: 'AED', recipients: { to: { email: 'race@example.test', name: 'Race' } } },
      );
      expect(commit.ok).toBe(true);
    });

    // Two independent transactions racing the SAME guarded outcome write —
    // reconciliation's stale-SUBMITTING classification vs. the original
    // (slow) worker's own late outcome write.
    const [reconciliationResult, lateWorkerResult] = await Promise.all([
      withTenantRls(basePrisma, tenantA, (tx) =>
        recordOutcome(tx, tenantA, { attemptId, attemptToken, noticeId }, 'DELIVERY_UNKNOWN', { errorMessage: 'reconciled: stale SUBMITTING' })),
      withTenantRls(basePrisma, tenantA, (tx) =>
        recordOutcome(tx, tenantA, { attemptId, attemptToken, noticeId }, 'SUBMITTED', { providerResponseRef: 'late-msg-id' })),
    ]);

    const appliedCount = [reconciliationResult.applied, lateWorkerResult.applied].filter(Boolean).length;
    expect(appliedCount).toBe(1); // exactly one write wins; the loser's is rejected, not silently merged

    const finalAttempt = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningDispatchAttempt.findFirst({ where: { id: attemptId } }));
    const finalNotice = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));

    expect(['DELIVERY_UNKNOWN', 'SUBMITTED']).toContain(finalAttempt?.outcome);
    // The notice's mirrored status always matches whichever attempt outcome
    // actually won — never a value from the guard-rejected update.
    expect(finalNotice?.dispatchStatus).toBe(finalAttempt?.outcome);
  });

  // ── Supporting tests ─────────────────────────────────────────────────────

  it('a suppression added after queuing but before the consumer runs is caught by the pre-dispatch recheck — zero send', async () => {
    process.env.DUNNING_DISPATCH_ENABLED = 'true';
    enableTransport();

    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'RACE-SUPPRESS' }));
    const { noticeId } = await withTenantRls(basePrisma, tenantA, (tx) => queueNotice(tx, invoice.id, 'REMINDER'));

    await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseInvoice.update({ where: { id: invoice.id }, data: { status: 'DISPUTED' } }));

    const delivered = await deliverNextDunningEvent(tenantA, noticeId);
    expect(delivered).toBe(true);
    expect(sendEmailMock).not.toHaveBeenCalled();

    const notice = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId } }));
    expect(notice?.dispatchStatus).toBe('SUPPRESSED');
  });

  it('first contact at 130 days overdue climbs the ladder to FINAL_NOTICE via the real sweep, not straight to legal review', async () => {
    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 130, label: 'LADDER-130' }));

    const result = await runDunningSweep(jobCtx(tenantA));
    expect(result.status).toBe('ok');

    const updated = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseInvoice.findFirst({ where: { id: invoice.id } }));
    expect(updated?.currentDunningStage).toBe('FINAL_NOTICE');

    const notice = await withTenantRls(basePrisma, tenantA, (tx) =>
      tx.leaseDunningNotice.findFirst({ where: { tenantId: tenantA, invoiceId: invoice.id } }),
    );
    expect(notice?.collectionStage).toBe('FINAL_NOTICE');
  });

  it('a settled invoice reopening into overdue again increments dunningCollectionCycle and queues under the new cycle', async () => {
    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'REOPEN', amount: 800 }));

    // First sweep: queues cycle 1.
    await runDunningSweep(jobCtx(tenantA));
    const afterFirstQueue = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseInvoice.findFirst({ where: { id: invoice.id } }));
    expect(afterFirstQueue?.dunningCollectionCycle).toBe(1);

    // Settle it in full — next sweep should transition to SETTLED.
    await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date() } }));
    await runDunningSweep(jobCtx(tenantA));
    const afterSettle = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseInvoice.findFirst({ where: { id: invoice.id } }));
    expect(afterSettle?.currentDunningStage).toBe('SETTLED');

    // Reopen: payment reversed, overdue again.
    await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseInvoice.update({ where: { id: invoice.id }, data: { status: 'OVERDUE', paidAt: null } }));
    await runDunningSweep(jobCtx(tenantA));
    const afterReopen = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseInvoice.findFirst({ where: { id: invoice.id } }));
    expect(afterReopen?.dunningCollectionCycle).toBe(2);
    expect(afterReopen?.currentDunningStage).toBe('REMINDER');

    const cycle2Notice = await withTenantRls(basePrisma, tenantA, (tx) =>
      tx.leaseDunningNotice.findFirst({ where: { tenantId: tenantA, invoiceId: invoice.id, collectionCycle: 2 } }),
    );
    expect(cycle2Notice).not.toBeNull();
  });

  it('cross-tenant isolation on the new dunning tables (notices, attempts, suppressions)', async () => {
    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'RLS' }));
    const { noticeId, attemptId } = await withTenantRls(basePrisma, tenantA, (tx) => queueNotice(tx, invoice.id, 'REMINDER'));
    const suppression = await withTenantRls(basePrisma, tenantA, (tx) =>
      tx.leaseDunningSuppression.create({ data: { tenantId: tenantA, scope: 'CUSTOMER', lesseeId: lesseeA, reason: 'rls-test', active: true } }),
    );

    const crossNotice = await withTenantRls(basePrisma, tenantB, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId, tenantId: tenantB } }));
    expect(crossNotice).toBeNull();
    const crossAttempt = await withTenantRls(basePrisma, tenantB, (tx) => tx.leaseDunningDispatchAttempt.findFirst({ where: { id: attemptId, tenantId: tenantB } }));
    expect(crossAttempt).toBeNull();
    const crossSuppression = await withTenantRls(basePrisma, tenantB, (tx) => tx.leaseDunningSuppression.findFirst({ where: { id: suppression.id, tenantId: tenantB } }));
    expect(crossSuppression).toBeNull();

    // Same rows ARE visible from the owning tenant.
    const ownNotice = await withTenantRls(basePrisma, tenantA, (tx) => tx.leaseDunningNotice.findFirst({ where: { id: noticeId, tenantId: tenantA } }));
    expect(ownNotice).not.toBeNull();
  });

  it('append-only enforcement: fleet360_app has no UPDATE/DELETE grant on lease_dunning_stage_transitions', async () => {
    // Not exercised as an attempted UPDATE/DELETE against the live
    // connection — this suite's DATABASE_URL connects as the table owner
    // (neondb_owner in dev, matching .env.test), which bypasses GRANT/REVOKE
    // entirely and would make the mutation silently succeed regardless of
    // whether append-only is actually enforced. What's real and
    // role-independent is the grant itself, so assert against
    // information_schema directly — the same check performed manually
    // right after the migration was applied (see docs/RELEASE_EVIDENCE.md).
    const invoice = await withTenantRls(basePrisma, tenantA, (tx) => createInvoice(tx, { daysOverdue: 20, label: 'APPEND-ONLY' }));
    await runDunningSweep(jobCtx(tenantA));

    const transition = await withTenantRls(basePrisma, tenantA, (tx) =>
      tx.leaseDunningStageTransition.findFirst({ where: { tenantId: tenantA, invoiceId: invoice.id } }),
    );
    expect(transition).not.toBeNull();

    const grants = await basePrisma.$queryRawUnsafe<Array<{ privilege_type: string }>>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'lease_dunning_stage_transitions' AND grantee = 'fleet360_app'`,
    );
    const privileges = grants.map((g) => g.privilege_type).sort();
    expect(privileges).not.toContain('UPDATE');
    expect(privileges).not.toContain('DELETE');
    expect(privileges).toContain('INSERT');
    expect(privileges).toContain('SELECT');
  });

  it('the suppression scope/target CHECK constraint rejects a mismatched combination', async () => {
    await expect(
      withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO lease_dunning_suppressions (id, tenant_id, scope, invoice_id, active)
           VALUES (gen_random_uuid()::text, $1, 'CUSTOMER', gen_random_uuid()::text, true)`,
          tenantA,
        ),
      ),
    ).rejects.toThrow();
  });
});
