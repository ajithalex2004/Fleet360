/**
 * Transactional event consumers and the finance consumers that use them.
 *
 * A consumer that writes two things (an AP payable, then its journal entry)
 * committed each on its own. When the second failed the retry found the
 * first, took the event as done, and the journal entry was never written.
 * Other consumers caught both failures and returned normally, so the event
 * was marked processed with nothing written at all.
 *
 * Transactional consumers run handle() and the PROCESSED mark in one tenant
 * transaction; FAILED is written outside it, after the rollback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  log: [] as string[],
  inTx: false,
  failOn: null as RegExp | null,
  existingPayable: false,
}));

function run(kind: string, q: string): unknown {
  db.log.push(`${db.inTx ? 'tx' : 'auto'}:${kind}:${q.replace(/\s+/g, ' ').trim().slice(0, 60)}`);
  if (db.failOn?.test(q)) throw new Error(`failed: ${q.slice(0, 40)}`);
  if (q.includes('INSERT INTO event_consumer_inbox')) return [{ status: 'PROCESSING' }];
  if (q.includes('FROM finance.finance_payables') && q.includes('source_type')) return db.existingPayable ? [{ id: 'ap-old' }] : [];
  if (q.includes('COUNT(*)')) return [{ count: 3 }];
  if (q.includes('INSERT INTO finance.finance_payables')) return [{ id: 'ap-new' }];
  return [];
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (q: string) => run('query', q),
    $executeRawUnsafe: async (q: string) => { run('exec', q); return 1; },
  },
}));
vi.mock('@/lib/rls-scope', () => ({ runWithTenantContext: (_t: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/rls', () => ({
  // A transaction: everything inside is logged as `tx:`; a throw is a rollback.
  withTenantRls: async (_p: unknown, _t: string, fn: () => Promise<unknown>) => {
    db.inTx = true;
    try { return await fn(); } finally { db.inTx = false; }
  },
}));
vi.mock('@/lib/finance/journal-service', () => ({
  createDraftJournalEntry: vi.fn(async () => {
    run('je', 'createDraftJournalEntry');
    return { id: 'je-1', number: 'JE-1', created: true };
  }),
}));

import { BaseEventConsumer } from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { FinanceQuotationConsumer } from '@/events/consumers/finance-quotation.consumer';
import { FinanceEstimationConsumer } from '@/events/consumers/finance-estimation.consumer';

const envelope = <T>(data: T, eventType = 'test.event'): DomainEventEnvelope<T> => ({
  eventId: '11111111-1111-4111-8111-111111111111', eventType, eventVersion: '1',
  occurredAt: new Date().toISOString(), tenantId: 'tenant-a', aggregateType: 'X', aggregateId: 'x',
  actor: 'tester', data,
} as DomainEventEnvelope<T>);

beforeEach(() => {
  db.log.length = 0;
  db.inTx = false;
  db.failOn = null;
  db.existingPayable = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('BaseEventConsumer transactional mode', () => {
  class Writes extends BaseEventConsumer {
    readonly consumerName = 'writes';
    readonly eventType = 'test.event';
    protected readonly transactional = true;
    constructor(private readonly fail = false) { super(); }
    protected async handle() {
      const { prisma } = await import('@/lib/prisma');
      await prisma.$executeRawUnsafe('INSERT first');
      if (this.fail) throw new Error('second write failed');
      await prisma.$executeRawUnsafe('INSERT second');
    }
  }

  it('runs the handler and the PROCESSED mark in one transaction', async () => {
    expect(await new Writes().process(envelope({}))).toBe(true);
    const inTx = db.log.filter((l) => l.startsWith('tx:'));
    expect(inTx.map((l) => l.split(':')[2])).toEqual(['INSERT first', 'INSERT second', expect.stringContaining("SET status = 'PROCESSED'")]);
  });

  it('records FAILED outside the rolled-back transaction', async () => {
    expect(await new Writes(true).process(envelope({}))).toBe(false);
    const failed = db.log.find((l) => l.includes("'FAILED'"));
    expect(failed?.startsWith('auto:')).toBe(true);
    expect(db.log.some((l) => l.includes("'PROCESSED'"))).toBe(false);
  });
});

describe('finance consumers surface failures instead of acknowledging them', () => {
  // Only the fields the handlers read; cast to the full payload types.
  const quotation = { quotationId: 'q1', garageId: 'g1', garageName: 'G', amount: 100, currency: 'AED', approvedAt: '2026-10-21T00:00:00Z' } as never;
  const estimation = { requestId: 'mr1', vehicleId: 'v1', estimatedCost: 100, currency: 'AED', garageId: 'g1', garageName: 'G', approvedBy: 'x' } as never;

  it('quotation: a failed journal entry fails the event, inside the transaction', async () => {
    const { createDraftJournalEntry } = await import('@/lib/finance/journal-service');
    vi.mocked(createDraftJournalEntry).mockRejectedValueOnce(new Error('period locked'));
    expect(await new FinanceQuotationConsumer().process(envelope(quotation))).toBe(false);
    // The payable was written in the transaction that rolled back.
    expect(db.log.some((l) => l.startsWith('tx:') && l.includes('INSERT INTO finance.finance_payables'))).toBe(true);
    expect(db.log.some((l) => l.includes("'PROCESSED'"))).toBe(false);
  });

  it('quotation: numbers the payable under a transaction lock', async () => {
    await new FinanceQuotationConsumer().process(envelope(quotation));
    const lock = db.log.findIndex((l) => l.includes('pg_advisory_xact_lock'));
    const count = db.log.findIndex((l) => l.includes('COUNT(*)'));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(count);
    expect(db.log[lock].startsWith('tx:')).toBe(true);
  });

  it('estimation: a failed payable insert fails the event (it used to be caught)', async () => {
    db.failOn = /INSERT INTO finance\.finance_payables/;
    expect(await new FinanceEstimationConsumer().process(envelope(estimation))).toBe(false);
    expect(db.log.some((l) => l.includes("'PROCESSED'"))).toBe(false);
  });

  it('estimation: a failed journal entry fails the event (it used to be caught)', async () => {
    const { createDraftJournalEntry } = await import('@/lib/finance/journal-service');
    vi.mocked(createDraftJournalEntry).mockRejectedValueOnce(new Error('period locked'));
    expect(await new FinanceEstimationConsumer().process(envelope(estimation))).toBe(false);
  });

  it('estimation: succeeds and marks processed when both writes succeed', async () => {
    expect(await new FinanceEstimationConsumer().process(envelope(estimation))).toBe(true);
    expect(db.log.some((l) => l.startsWith('tx:') && l.includes("'PROCESSED'"))).toBe(true);
  });
});
