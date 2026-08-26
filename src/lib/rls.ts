/**
 * Row-level security helpers — the canonical four.
 *
 * The DB has RLS policies on every tenant-scoped table:
 *   USING (
 *     tenant_id IS NULL
 *     OR current_setting('app.tenant_id', true) = '*'
 *     OR tenant_id::text = current_setting('app.tenant_id', true)
 *   )
 *
 * These four helpers cover every cross-tenant / per-tenant pattern in the
 * codebase. Don't add a fifth — if you need a new pattern, the right answer
 * is one of these composed differently, not a new helper.
 *
 *   withTenantRls(prisma, tenantId, fn)         — fn runs with app.tenant_id = tenantId
 *   withPlatformAdmin(prisma, fn)                — fn runs with app.tenant_id = '*'
 *   withSystemJob(prisma, fn)                    — iterates active tenants, fn runs per tenant with that id
 *   withWebhookTenant(prisma, identifyFn, fn)    — identify tenant from inbound request, then run fn in that tenant
 *
 * Pair this lib with prisma/migrations/20260803000000_rls_tenant_isolation_all_tables
 * which applies the policy to every tenant-scoped table.
 */

import type { PrismaClient } from '@prisma/client';
import { runWithRlsScope } from '@/lib/rls-scope';

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// ── withTenantRls ────────────────────────────────────────────────────────────
//
// Run `fn` inside a transaction with `app.tenant_id` set to `tenantId`.
// Inside `fn`, RLS policies filter rows to that tenant (plus NULL rows and
// the '*' wildcard match for super-admin).
//
// Use this for: any request handler or job that operates on a known
// single tenant. The middleware already verified the session; this is
// the DB-layer enforcement.

export async function withTenantRls<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TxClient) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  if (!tenantId || typeof tenantId !== 'string' || !String(tenantId).trim()) {
    throw new Error('withTenantRls: tenantId is required');
  }
  if (/[^a-zA-Z0-9_-]/.test(tenantId)) {
    throw new Error('withTenantRls: invalid tenantId format');
  }
  const timeout = opts.timeoutMs ?? 30_000;
  return prisma.$transaction(async (tx) => {
    // set_config returns the new value — use that as the source of truth.
    // (Avoid separate current_setting() round-trip; some drivers mishandle it.)
    const safeId = String(tenantId).replace(/'/g, "''");
    const _set = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
      `SELECT set_config('app.tenant_id', '${safeId}', true) AS v`,
    );
    if (!_set[0]?.v || _set[0].v !== tenantId) {
      throw new Error(
        `withTenantRls: set_config returned '${_set[0]?.v ?? 'null'}' (expected '${tenantId}'). ` +
          `Check DATABASE_URL is direct (no -pooler), role is fleet360_app, and not Prisma Accelerate.`,
      );
    }
    return runWithRlsScope({ tenantId, mode: 'tenant', tx }, () => fn(tx));
  }, { timeout, maxWait: 5_000 });
}

// ── withPlatformAdmin ────────────────────────────────────────────────────────
//
// Run `fn` inside a transaction with `app.tenant_id = '*'` so the
// RLS policy lets all rows through. This is the platform-admin escape
// hatch for cross-tenant reads and writes.
//
// Use this for:
//   - System jobs that intentionally iterate every tenant (but for that,
//     prefer withSystemJob below).
//   - Admin / platform routes that genuinely need to read across tenants.
//   - Webhook handlers that need to identify the tenant from an external
//     identifier (but for that, prefer withWebhookTenant below).
//   - Anywhere a single tx must span multiple tenants in one statement.
//
// DO NOT use this from a regular tenant request handler. The wrap here
// would let the request see every tenant's data. If you find yourself
// reaching for it from a route, you almost certainly want withTenantRls
// or withWebhookTenant instead.

export async function withPlatformAdmin<T>(
  prisma: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  // Default 60s — Prisma's built-in 5s is too tight for multi-pass FK deletes
  // (161 tables) and bulk creates (hundreds of rows).
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '*', true)`);
    return runWithRlsScope({ tenantId: '*', mode: 'platform', tx }, () => fn(tx));
  }, { timeout: opts.timeoutMs ?? 60_000, maxWait: 10_000 });
}

// ── withSystemJob ────────────────────────────────────────────────────────────
//
// The canonical sweep / cron helper. Iterates every active tenant and
// calls `fn` once per tenant. Inside `fn`, the callback receives a
// tenant-scoped tx (i.e. the same as withTenantRls — not '*' wildcard).
//
// Use this for: any background job that needs to do per-tenant work.
// Examples: expiry sweeps, billing sweeps, dunning sweeps.
//
// Returns an array of `{ tenantId, result }` so the caller can aggregate
// or report per-tenant outcomes. Pass an optional `tenantHeader` to
// limit the iteration to a single tenant (e.g. when a logged-in user
// triggers a sweep manually for their own tenant).
//
// Do NOT call `tx.$transaction(...)` inside `fn`. Prisma removes it from a
// TransactionClient at runtime — the denylist is
// ["$connect","$disconnect","$on","$transaction","$use","$extends"] — so the
// call throws "tx.$transaction is not a function", which handlers typically
// catch and report as a generic 500. (An earlier version of this comment
// claimed savepoints worked here; that was wrong, and several handlers were
// written against it.)
//
// You don't need one: everything `fn` does already runs inside the single
// transaction this wrapper opened, so it is atomic as a whole. If you need a
// genuine savepoint for per-record recovery, issue SAVEPOINT / ROLLBACK TO
// via tx.$executeRawUnsafe.

export interface SystemJobContext {
  tx: TxClient;
  tenantId: string;
}

export interface SystemJobOptions {
  /** Limit the job to a single tenant. Null/omitted = all active tenants. */
  tenantHeader?: string | null;
  /** Per-tenant transaction timeout in ms. Default 30s. */
  timeoutMs?: number;
}

export async function withSystemJob<T>(
  prisma: PrismaClient,
  fn: (ctx: SystemJobContext) => Promise<T>,
  opts: SystemJobOptions = {},
): Promise<Array<{ tenantId: string; result: T }>> {
  return withPlatformAdmin(prisma, async (tx) => {
    const tenants = opts.tenantHeader
      ? [{ id: opts.tenantHeader }]
      : await tx.tenant.findMany({
          where: { isActive: { not: false } },
          select: { id: true },
        });

    const results: Array<{ tenantId: string; result: T }> = [];
    for (const t of tenants) {
      const result = await withTenantRls(
        prisma,
        t.id,
        async (tenantTx) => fn({ tx: tenantTx, tenantId: t.id }),
        { timeoutMs: opts.timeoutMs ?? 30_000 },
      );
      results.push({ tenantId: t.id, result });
    }
    return results;
  });
}

// ── withWebhookTenant ────────────────────────────────────────────────────────
//
// The canonical webhook helper. Webhooks arrive without `x-tenant-id`,
// so we need to identify the tenant from the inbound payload first
// (Stripe customer ID, lead-channel config, phone number, etc.) and
// THEN run the actual handler in a tenant-scoped transaction.
//
// Pattern:
//   withWebhookTenant(
//     prisma,
//     async (tx) => tenantIdForStripeCustomer(tx, customerId),  // identify
//     async ({ tx, tenantId }) => handleInvoice(tx, invoiceData), // act
//   )
//
// The `identifyFn` runs with the '*' wildcard (cross-tenant read of the
// tenants table). If it returns null, withWebhookTenant returns null
// and the caller should 503 / 4xx (no tenant to attribute to).
//
// The `handleFn` runs in a tenant-scoped transaction (same as
// withTenantRls). All DB writes inside are tenant-isolated.

export interface WebhookTenantContext {
  tx: TxClient;
  tenantId: string;
}

export async function withWebhookTenant<T>(
  prisma: PrismaClient,
  identifyFn: (tx: TxClient) => Promise<string | null>,
  handleFn: (ctx: WebhookTenantContext) => Promise<T>,
): Promise<T | null> {
  const tenantId = await withPlatformAdmin(prisma, identifyFn);
  if (!tenantId) return null;
  return withTenantRls(prisma, tenantId, async (tx) =>
    handleFn({ tx, tenantId }),
  );
}

/**
 * Run an array of Prisma operations sequentially inside the transaction the
 * caller already holds.
 *
 * Replaces `tx.$transaction([...])` / `tx.$transaction(ops)`. Prisma removes
 * $transaction from a TransactionClient at runtime — the denylist is
 * ["$connect","$disconnect","$on","$transaction","$use","$extends"] — so those
 * calls threw "tx.$transaction is not a function" and took their whole handler
 * with them. Several endpoints were failing outright rather than merely
 * lacking atomicity.
 *
 * Atomicity is not lost by removing the inner transaction: everything inside a
 * withTenantRls / withSystemJob / withPlatformAdmin callback already runs in
 * one transaction, and that is what rolls back.
 *
 * Sequential, not Promise.all: these share a single connection, and firing
 * them concurrently on it is not something Prisma supports. Prisma promises
 * are lazy, so building the array does not execute anything — the awaits here
 * are what run them, in the order given.
 *
 * The mapped return type preserves tuple positions so existing destructuring
 * (`const [a, b] = await ...`) keeps its types.
 */
export async function runSequential<T extends readonly PromiseLike<unknown>[]>(
  ops: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const out: unknown[] = [];
  for (const op of ops) out.push(await op);
  return out as { -readonly [K in keyof T]: Awaited<T[K]> };
}
