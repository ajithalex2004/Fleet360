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

import { cpus } from 'node:os';

import type { PrismaClient } from '@prisma/client';
import { runWithRlsScope } from '@/lib/rls-scope';

/**
 * The transaction client the wrappers hand to their callbacks.
 *
 * Exported because handlers need to type their own callbacks against it.
 * It was previously imported from '@/lib/prisma', which does not export it —
 * a TS2305 that only surfaced on a full typecheck.
 */
export type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

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
    return runWithRlsScope({ tenantId, mode: 'tenant', tx }, async () => {
      // set_config returns the new value — use that as the source of truth.
      // (Avoid separate current_setting() round-trip; some drivers mishandle it.)
      const safeId = String(tenantId).replace(/'/g, "''");
      const _set = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
        `SELECT set_config('app.tenant_id', '${safeId}', true) AS v`,
      );
      if (!_set[0]?.v || _set[0].v !== tenantId) {
        throw new Error(
          `withTenantRls: set_config returned '${_set[0]?.v ?? 'null'}' (expected '${tenantId}'). ` +
            `The cause is a connection layer that does not keep a transaction pinned to one ` +
            `backend: Prisma Accelerate / Data Proxy, or a pooler in statement or session mode. ` +
            `Neon's transaction-mode pooler is NOT a cause — run scripts/prove-pooled-rls.ts.`,
        );
      }
      return fn(tx);
    });
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
    return runWithRlsScope({ tenantId: '*', mode: 'platform', tx }, async () => {
      const _set = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
        `SELECT set_config('app.tenant_id', '*', true) AS v`,
      );
      if (!_set[0]?.v || _set[0].v !== '*') {
        throw new Error(`withPlatformAdmin: set_config returned '${_set[0]?.v ?? 'null'}' (expected '*')`);
      }
      return fn(tx);
    });
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
// TRANSACTION SHAPE: one short platform-admin transaction to read the tenant
// list, then one independent transaction per tenant. Nothing is nested. The
// job is NOT atomic as a whole and never was — if tenant 50 throws, tenants
// 1-49 have already committed. That is the right shape for a sweep, but it
// does mean a caller wanting resumability should record its own progress.
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
  /**
   * How many tenants to process at once. Defaults to one less than the Prisma
   * connection pool, capped at 10. Set 1 to force the old serial behaviour.
   */
  concurrency?: number;
}

/**
 * Tenants to process concurrently by default.
 *
 * The limit that matters is the PRISMA CLIENT POOL, not the server. Neon
 * reports max_connections = 901; Prisma opens `num_cpus * 2 + 1` unless
 * connection_limit says otherwise, which is 9 on a 4-core box and 3 on a
 * single-core serverless instance. Exceeding it does not fail loudly — requests
 * queue and then time out fetching a connection, which reads like a database
 * problem rather than a configuration one.
 *
 * So the pool size is derived the same way Prisma derives it, one connection is
 * left for whatever else the process is doing, and the whole thing is capped so
 * a large box does not hammer the pooler.
 */
function defaultSweepConcurrency(): number {
  const url = process.env.DATABASE_URL ?? '';

  // A POOLED endpoint cannot do this. Measured against
  // ep-...-pooler.ap-southeast-1.aws.neon.tech, 179 tenants, no-op callback:
  //
  //   pooled,  concurrency 1   71-125s   works
  //   pooled,  concurrency 2   FAILS     P1001 "Can't reach database server"
  //   pooled,  concurrency 4   FAILS     P1001
  //   direct,  concurrency 4   35s       works, 196ms/tenant
  //
  // Reproducible on a warm connection, so it is the concurrency and not a cold
  // start. Two concurrent interactive transactions are enough to break it.
  //
  // This does NOT contradict scripts/prove-pooled-rls.ts, which showed
  // withTenantRls is correct over the pooler. That measured SEQUENTIAL
  // transactions, including eight overlapping ones that each completed. Long-
  // running concurrent interactive transactions are a different load, and the
  // pooler does not survive it.
  //
  // So: serial on a pooled URL, concurrent on a direct one. A sweep that wants
  // the speedup points DATABASE_URL at DIRECT_URL for its own process rather
  // than having this guess.
  if (/-pooler\./.test(url)) return 1;

  const m = /[?&]connection_limit=(\d+)/.exec(url);
  const pool = m ? Number(m[1]) : cpus().length * 2 + 1;
  return Math.max(1, Math.min(pool - 1, 3));
}

export async function withSystemJob<T>(
  prisma: PrismaClient,
  fn: (ctx: SystemJobContext) => Promise<T>,
  opts: SystemJobOptions = {},
): Promise<Array<{ tenantId: string; result: T }>> {
  // Resolve the tenant list inside a SHORT platform-admin transaction, then
  // let it close before any per-tenant work starts.
  //
  // This used to wrap the whole loop: withPlatformAdmin opened a transaction,
  // and every per-tenant withTenantRls opened another one on the base client
  // from inside that callback. Two problems, both fatal at scale.
  //
  //   1. The outer transaction has a 60s timeout. With 187 active tenants at
  //      up to 30s each, the loop cannot possibly finish inside it. The outer
  //      transaction times out and closes part-way through, and every
  //      subsequent statement on that client fails with
  //      "Transaction not found. Transaction ID is invalid, refers to an old
  //      closed transaction". The job does not report a timeout — it reports
  //      an unrelated-looking error from wherever it happened to be.
  //
  //   2. Opening a transaction on `prisma` while another is open on `prisma`
  //      takes a second connection from the pool and holds both. Under a
  //      bounded pool that is a way to deadlock a sweep against itself.
  //
  // Found because the RLS isolation suite's afterAll started failing on its
  // FIRST statement — the withSystemJob tests had already poisoned the client,
  // so cleanup never ran and test tenants accumulated in the database.
  //
  // Atomicity is unchanged. The per-tenant transactions were always separate
  // and always committed independently; the outer one only ever wrapped the
  // tenant-list query and the loop control. Callers already document the
  // intended semantics as "iterates each tenant in its own transaction", which
  // is what this now actually does.
  //
  // A single-tenant run opens no platform-admin transaction at all.
  const tenants = opts.tenantHeader
    ? [{ id: opts.tenantHeader }]
    : await withPlatformAdmin(
        prisma,
        (tx) =>
          tx.tenant.findMany({
            where: { isActive: { not: false } },
            select: { id: true },
          }),
        { timeoutMs: 15_000 },
      );

  // One transaction per tenant, none nested, processed in bounded batches.
  //
  // Serially this took 125s across 179 tenants with a callback that did NOTHING
  // — 700ms each, almost all of it round-trips: BEGIN, set_config with its
  // read-back, COMMIT. That is the floor before a sweep does any real work, and
  // it exceeds the 60s timeout common to serverless cron runners, so the sweeps
  // would be killed mid-iteration having committed an arbitrary prefix of the
  // tenants.
  //
  // The per-tenant transactions are independent — that was already true and is
  // why this is safe to overlap. Batching preserves the result order.
  //
  // ERROR SEMANTICS, which do shift slightly: a throw still fails the whole job
  // fast, but the other members of the in-flight batch have already started and
  // will run to completion. So up to `concurrency - 1` more tenants may commit
  // after the failing one than would have serially. For a sweep, where each
  // tenant was always independently committed, that is a difference of degree
  // rather than of kind — but a caller needing exact resumability must record
  // its own progress, as the docblock above says.
  const concurrency = Math.max(1, opts.concurrency ?? defaultSweepConcurrency());
  const results: Array<{ tenantId: string; result: T }> = new Array(tenants.length);

  for (let i = 0; i < tenants.length; i += concurrency) {
    const batch = tenants.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (t, j) => ({
        idx: i + j,
        entry: {
          tenantId: t.id,
          result: await withTenantRls(
            prisma,
            t.id,
            async (tenantTx) => fn({ tx: tenantTx, tenantId: t.id }),
            { timeoutMs: opts.timeoutMs ?? 30_000 },
          ),
        },
      })),
    );
    for (const s of settled) results[s.idx] = s.entry;
  }
  return results;
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
