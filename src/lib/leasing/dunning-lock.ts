import type { TxClient } from '@/lib/rls';

/**
 * Serializes concurrent dunning operations on a single invoice, same
 * primitive as src/lib/leasing/contract-lock.ts's withContractLock.
 */
export async function withDunningLock<T>(
  tx: TxClient,
  tenantId: string,
  invoiceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `dunning:${tenantId}:${invoiceId}`,
  );
  return fn();
}
