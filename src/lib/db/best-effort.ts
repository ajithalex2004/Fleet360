/**
 * Best-effort writes inside a transaction someone else owns.
 *
 * PostgreSQL aborts the whole transaction when any statement in it fails
 * (25P02): every later statement fails with "current transaction is
 * aborted", and the COMMIT runs as a ROLLBACK without raising an error. So
 * `await tx.$executeRawUnsafe(...).catch(() => {})` does not make a write
 * optional — it hides the error that has just doomed the caller's
 * transaction, and the request can answer success for work that was never
 * saved.
 *
 * bestEffortInTx brackets the write in a SAVEPOINT: on failure it rolls back
 * to the savepoint, which undoes only the failed write and leaves the
 * transaction usable.
 *
 * Statements on one transaction must not overlap a best-effort write. A
 * ROLLBACK TO SAVEPOINT undoes everything issued since the SAVEPOINT, so a
 * statement the caller fires concurrently (Promise.all / allSettled on the
 * same tx) could be rolled back with it. Await it on its own.
 */
import { prisma } from '@/lib/prisma';
import { activeRlsScope } from '@/lib/rls-scope';

type RawDb = { $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number> };

const SAVEPOINT = 'fleet360_best_effort';

/**
 * Run `write` (which must issue its statements on `db`) so that its failure
 * is logged and does not abort the surrounding transaction. Returns
 * undefined when the write failed.
 *
 * `db` is either a transaction client or the global client. The global
 * client's statements run on the active RLS transaction when there is one
 * (src/lib/prisma.ts), so they need the savepoint too; without one, each
 * statement is its own transaction and a failure cannot affect any other.
 */
export async function bestEffortInTx<T>(
  db: RawDb,
  label: string,
  write: () => Promise<T>,
): Promise<T | undefined> {
  const inTransaction = db !== (prisma as unknown) || Boolean(activeRlsScope()?.tx);
  if (!inTransaction) {
    try {
      return await write();
    } catch (err) {
      console.error(`[${label}] best-effort write failed:`, err);
      return undefined;
    }
  }

  // If this throws, the transaction was already aborted before we got here:
  // let the caller see that rather than report an optional write as skipped.
  await db.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
  try {
    const result = await write();
    await db.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return result;
  } catch (err) {
    console.error(`[${label}] best-effort write failed:`, err);
    await db.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    await db.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return undefined;
  }
}
