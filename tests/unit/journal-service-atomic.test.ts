/**
 * tests/unit/journal-service-atomic.test.ts
 *
 * Architecture audit A4/A5: createDraftJournalEntry inserted the header and
 * its lines as separate statements (a line failure left a header without
 * lines), asserted is_balanced=true, and posted again for the same source on
 * every retry; the trip consumer therefore acknowledged revenue failures.
 *
 * The fake below commits a transaction's writes only when its callback
 * resolves, and refuses statements issued outside a transaction, so a
 * service that is not atomic fails these tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Entry = { id: string; je_number: string; tenant: string; key: string | null; source_type: string; source_id: string; balanced: boolean; deleted: boolean; status: string };
type Line = { entry: string; debit: number; credit: number };
const db = vi.hoisted(() => ({
  entries: [] as Entry[], lines: [] as Line[], failLines: false, outside: 0, seq: 0,
}));

vi.mock('@/lib/prisma', () => {
  const makeTx = (entries: Entry[], lines: Line[]) => ({
    $queryRawUnsafe: async (q: string, ...a: unknown[]) => {
      if (q.includes('SELECT COUNT(*)')) return [{ count: entries.length }];
      if (q.includes('SELECT id::text, je_number')) {
        const [tenant, key, st, sid] = a as string[];
        const e = entries.find((x) => x.tenant === tenant && !x.deleted && x.status !== 'REVERSED'
          && (x.key === key || (x.key === null && x.source_type === st && x.source_id === sid)));
        return e ? [{ id: e.id, je_number: e.je_number }] : [];
      }
      if (q.includes('INSERT INTO finance_journal_entries')) {
        expect(q).toContain('ON CONFLICT (tenant_id, idempotency_key)');
        expect(q).toMatch(/'DRAFT',0,0,false/);
        const tenant = a[11] as string; const key = a[12] as string;
        if (entries.some((x) => x.tenant === tenant && x.key === key && !x.deleted && x.status !== 'REVERSED')) return [];
        const e: Entry = { id: `je-${++db.seq}`, je_number: String(a[0]), tenant, key, source_type: String(a[6]), source_id: String(a[7]), balanced: false, deleted: false, status: 'DRAFT' };
        entries.push(e);
        return [{ id: e.id, je_number: e.je_number }];
      }
      throw new Error(`unexpected query: ${q.slice(0, 60)}`);
    },
    $executeRawUnsafe: async (q: string, ...a: unknown[]) => {
      if (q.includes('INSERT INTO finance_journal_lines')) {
        if (db.failLines) throw new Error('line insert failed');
        lines.push({ entry: String(a[0]), debit: Number(a[4]), credit: 0 }, { entry: String(a[0]), debit: 0, credit: Number(a[4]) });
        return 2;
      }
      if (q.includes('UPDATE finance_journal_entries je')) {
        const mine = lines.filter((l) => l.entry === a[0]);
        const d = mine.reduce((s, l) => s + l.debit, 0); const c = mine.reduce((s, l) => s + l.credit, 0);
        const e = entries.find((x) => x.id === a[0])!; e.balanced = mine.length > 0 && d === c;
        return 1;
      }
      throw new Error(`unexpected statement: ${q.slice(0, 60)}`);
    },
  });
  const outside = async () => { db.outside++; throw new Error('statement outside a transaction'); };
  return {
    prisma: {
      $queryRawUnsafe: outside,
      $executeRawUnsafe: outside,
      // Work on copies; commit only if the callback resolves.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const entries = db.entries.map((e) => ({ ...e })); const lines = [...db.lines];
        const out = await fn(makeTx(entries, lines));
        db.entries = entries; db.lines = lines;
        return out;
      },
    },
  };
});

const bridge = vi.hoisted(() => ({ cost: vi.fn(), revenue: vi.fn() }));
vi.mock('@/lib/bus-ops/finance-bridge', () => ({
  postTripOperatingCostsToFinance: bridge.cost,
  mirrorBusTripRevenueToFinance: bridge.revenue,
}));

import { createDraftJournalEntry } from '@/lib/finance/journal-service';

beforeEach(() => {
  db.entries = []; db.lines = []; db.failLines = false; db.outside = 0; db.seq = 0;
  bridge.cost.mockReset(); bridge.revenue.mockReset();
});

const params = (sourceId = 'trip-1') => ({
  tenantId: 'tenant-a', narration: 'Trip costs', reference: 'BUS-1',
  sourceType: 'BUS_TRIP_COMPLETION', sourceId, amount: 120, currency: 'AED',
  debit: { code: '5145', name: 'Bus Ops', description: 'cost' },
  credit: { code: '2100', name: 'Accrued', description: 'accrual' },
});

describe('createDraftJournalEntry', () => {
  it('writes header and lines in one transaction, with balance derived from the lines', async () => {
    const r = await createDraftJournalEntry(params());
    expect(r.created).toBe(true);
    expect(db.outside).toBe(0);
    expect(db.entries).toHaveLength(1);
    expect(db.lines).toHaveLength(2);
    expect(db.entries[0]).toMatchObject({ key: 'BUS_TRIP_COMPLETION:trip-1', balanced: true });
  });

  it('leaves no header behind when the line insert fails', async () => {
    db.failLines = true;
    await expect(createDraftJournalEntry(params())).rejects.toThrow('line insert failed');
    expect(db.entries).toHaveLength(0);
    expect(db.lines).toHaveLength(0);
  });

  it('returns the existing entry when the same source is delivered again', async () => {
    const first = await createDraftJournalEntry(params());
    const again = await createDraftJournalEntry(params());
    expect(again).toEqual({ ...first, created: false });
    expect(db.entries).toHaveLength(1);
    expect(db.lines).toHaveLength(2);
    expect((await createDraftJournalEntry(params('trip-2'))).created).toBe(true);
  });

  it('recognises an entry created before idempotency keys existed', async () => {
    db.entries.push({ id: 'legacy', je_number: 'JE-OLD', tenant: 'tenant-a', key: null, source_type: 'BUS_TRIP_COMPLETION', source_id: 'trip-1', balanced: true, deleted: false, status: 'POSTED' });
    expect(await createDraftJournalEntry(params())).toEqual({ id: 'legacy', number: 'JE-OLD', created: false });
  });

  it('posts again after the earlier entry was reversed', async () => {
    db.entries.push({ id: 'old', je_number: 'JE-OLD', tenant: 'tenant-a', key: 'BUS_TRIP_COMPLETION:trip-1', source_type: 'BUS_TRIP_COMPLETION', source_id: 'trip-1', balanced: true, deleted: false, status: 'REVERSED' });
    expect((await createDraftJournalEntry(params())).created).toBe(true);
  });
});

describe('finance-trip consumer', () => {
  it('fails the delivery when the revenue mirror fails, so it is retried', async () => {
    const { FinanceTripConsumer } = await import('@/events/consumers/finance-trip.consumer');
    bridge.cost.mockResolvedValue({ jeId: 'je-1' });
    bridge.revenue.mockRejectedValue(new Error('AR down'));
    const consumer = new FinanceTripConsumer() as unknown as { handle: (e: unknown) => Promise<void> };
    await expect(consumer.handle({
      eventId: 'e', eventType: 'trip.completed', tenantId: 'tenant-a',
      data: { scheduleId: 'trip-1', tripLogId: 'log-1', farePerHead: 5, passengersBoarded: 10 },
    })).rejects.toThrow('mirrorBusTripRevenueToFinance failed');
  });
});
