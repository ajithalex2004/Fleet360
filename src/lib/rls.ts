/**
 * Row-level security helpers.
 *
 * The DB has RLS policies on every multi-tenant table:
 *   USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true))
 *
 * Use these helpers to wrap any block of queries in a transaction with the
 * correct app.tenant_id GUC set, so the policies actually filter results.
 *
 *   await withTenantRls(prisma, ctx.tenantId, async (tx) => {
 *     return tx.$queryRawUnsafe(`SELECT * FROM vehicles WHERE ...`);
 *   });
 *
 * Super-admin (cross-tenant) queries:
 *   await withSuperAdminRls(prisma, async (tx) => { ... });
 *
 * Pair this lib with rls_super_admin.sql which adds the '*' wildcard
 * exemption to the policy.
 */

import type { PrismaClient } from '@prisma/client';

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Run `fn` inside a transaction with `app.tenant_id` set to `tenantId`.
 * Inside `fn`, RLS policies will filter rows to that tenant (plus NULL).
 */
export async function withTenantRls<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  if (!tenantId || /[^a-zA-Z0-9_-]/.test(tenantId)) {
    throw new Error('withTenantRls: tenantId must be a non-empty alphanumeric/uuid string');
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return fn(tx);
  });
}

/**
 * Run `fn` inside a transaction with `app.tenant_id = '*'` so that the
 * super-admin RLS policy lets all rows through.
 *
 * Only use this from server code that has confirmed role === 'SUPER_ADMIN'.
 */
export async function withSuperAdminRls<T>(
  prisma: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '*', true)`);
    return fn(tx);
  });
}

/**
 * Ad-hoc setter for unusual cases (e.g. inside a long-running cron job).
 * Prefer the `with*` helpers above — they ensure the GUC is scoped to a
 * transaction and cleared at COMMIT.
 */
export async function setRlsContext(
  tx: TxClient,
  tenantIdOrWildcard: string,
): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantIdOrWildcard);
}
