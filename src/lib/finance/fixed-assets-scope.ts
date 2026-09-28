/**
 * Whether finance_fixed_assets has a tenant_id column.
 *
 * The fixed asset register was created at runtime without one, so where it
 * still has none it is shared by every tenant and has no row level security.
 * Reports then leave its amounts out rather than show other tenants' assets:
 * a tenant-filtered query would fail instead, and inside a transaction abort
 * every query after it. Reads the catalog only, so it never fails that way.
 */
export async function fixedAssetsTenantScoped(db: {
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}): Promise<boolean> {
  const rows = (await db.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('finance_fixed_assets')
          AND attname = 'tenant_id' AND NOT attisdropped
     ) AS scoped`,
  ).catch(() => [])) as Array<{ scoped: boolean }>;
  return Boolean(rows[0]?.scoped);
}
