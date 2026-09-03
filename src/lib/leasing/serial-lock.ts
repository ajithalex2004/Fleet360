import type { TxClient } from '@/lib/rls';

/**
 * Serialize concurrent serial-number generation (invoice/quotation/renewal/
 * etc. numbers) per (tenant, series) using a transaction-scoped Postgres
 * advisory lock.
 *
 * G13: every leasing serial number was generated via an unlocked
 * `count()` → `+1`, so two concurrent creates for the same tenant could
 * compute the same number. Must be called from inside the same
 * withTenantRls/withSystemJob transaction that performs the count()+create()
 * — pg_advisory_xact_lock releases automatically at commit/rollback, so a
 * second concurrent call for the same tenant+series simply blocks until the
 * first transaction finishes and its number is taken.
 *
 * `series` should be the same string for every code path that generates the
 * same kind of number (e.g. all four invoice-number generators use
 * 'invoice') so they serialize against each other too, not just against
 * themselves.
 */
export async function lockSerialSeries(tx: TxClient, tenantId: string, series: string): Promise<void> {
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `${tenantId}:${series}`,
  );
}
