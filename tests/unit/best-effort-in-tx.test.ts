/**
 * bestEffortInTx: an optional write inside someone else's transaction.
 *
 * A failed statement aborts a PostgreSQL transaction, and catching the error
 * in JS does not un-abort it: later statements fail with 25P02 and the COMMIT
 * runs as a ROLLBACK. The write has to be bracketed by a savepoint so that its
 * failure undoes only itself.
 */
import { describe, it, expect, vi } from 'vitest';

const { globalClient } = vi.hoisted(() => ({
  globalClient: { $executeRawUnsafe: vi.fn<[string], Promise<number>>(async () => 0) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: globalClient }));

import { bestEffortInTx } from '@/lib/db/best-effort';
import { runWithRlsScope } from '@/lib/rls-scope';

function makeTx(failOn?: RegExp) {
  const statements: string[] = [];
  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      statements.push(sql);
      if (failOn?.test(sql)) throw new Error('statement failed');
      return 1;
    }),
  };
  return { tx, statements };
}

describe('bestEffortInTx', () => {
  it('releases the savepoint after a successful write', async () => {
    const { tx, statements } = makeTx();
    const out = await bestEffortInTx(tx, 'test', () => tx.$executeRawUnsafe('INSERT ok'));
    expect(out).toBe(1);
    expect(statements).toEqual([
      'SAVEPOINT fleet360_best_effort',
      'INSERT ok',
      'RELEASE SAVEPOINT fleet360_best_effort',
    ]);
  });

  it('rolls back to the savepoint when the write fails, leaving the transaction usable', async () => {
    const { tx, statements } = makeTx(/INSERT bad/);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await bestEffortInTx(tx, 'test', () => tx.$executeRawUnsafe('INSERT bad'));
    err.mockRestore();
    expect(out).toBeUndefined();
    expect(statements).toEqual([
      'SAVEPOINT fleet360_best_effort',
      'INSERT bad',
      'ROLLBACK TO SAVEPOINT fleet360_best_effort',
      'RELEASE SAVEPOINT fleet360_best_effort',
    ]);
  });

  it('throws when the transaction was already aborted before the write', async () => {
    const { tx } = makeTx(/^SAVEPOINT/);
    await expect(bestEffortInTx(tx, 'test', async () => 1)).rejects.toThrow('statement failed');
  });

  it('uses no savepoint on the global client outside any RLS transaction', async () => {
    globalClient.$executeRawUnsafe.mockClear();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await bestEffortInTx(globalClient, 'test', async () => { throw new Error('nope'); });
    err.mockRestore();
    expect(out).toBeUndefined();
    expect(globalClient.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('uses a savepoint on the global client inside an RLS transaction (its statements join it)', async () => {
    globalClient.$executeRawUnsafe.mockClear();
    const { tx } = makeTx();
    await runWithRlsScope({ tenantId: 'tenant-a', mode: 'tenant', tx: tx as never }, () =>
      bestEffortInTx(globalClient, 'test', async () => 1),
    );
    expect(globalClient.$executeRawUnsafe).toHaveBeenCalledWith('SAVEPOINT fleet360_best_effort');
  });
});
