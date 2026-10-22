/**
 * Next AP payable number for a prefix, e.g. `AP-202610` → `AP-202610-00042`.
 *
 * Numbers are "count of existing + 1". Two deliveries counting at the same
 * time got the same number. The transaction-scoped advisory lock makes
 * concurrent callers for the same tenant and prefix take turns; it is held
 * until the caller's transaction ends, so the caller must be inside one
 * (a transactional event consumer, withTenantRls) and insert before it
 * commits.
 */
type RawDb = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export async function nextPayableNumber(db: RawDb, tenantId: string, prefix: string): Promise<string> {
  await db.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    `payable-number:${tenantId}:${prefix}`,
  );
  const [row] = await db.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*) AS count FROM finance.finance_payables WHERE payable_number LIKE $1`,
    `${prefix}-%`,
  );
  return `${prefix}-${String(Number(row?.count ?? 0) + 1).padStart(5, '0')}`;
}
