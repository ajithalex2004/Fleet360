import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { nextJournalNumber } from '@/lib/finance/journal-service';

const fakeDb = (count: number) => {
  const calls: unknown[][] = [];
  return {
    calls,
    $queryRawUnsafe: async <T,>(...args: unknown[]) => {
      calls.push(args);
      return [{ count: BigInt(count) }] as T;
    },
  };
};

describe('nextJournalNumber', () => {
  const at = new Date(2026, 8, 15); // September 2026

  it('numbers from the tenant’s own count for the month, with a random suffix', async () => {
    const db = fakeDb(11);
    const n = await nextJournalNumber(db, 'tenant-a', at);
    expect(n).toMatch(/^JE-202609-00012-[A-Z2-9]{4}$/);
    expect(db.calls[0].slice(1)).toEqual(['tenant-a', 'JE-202609-%']);
  });

  it('keeps two tenants at the same sequence from colliding', async () => {
    // Under RLS each tenant sees only its own rows, so both compute seq 1.
    const numbers = new Set<string>();
    for (let i = 0; i < 200; i++) numbers.add(await nextJournalNumber(fakeDb(0), `t${i}`, at));
    expect(numbers.size).toBe(200);
  });
});
