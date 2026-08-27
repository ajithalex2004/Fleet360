import 'server-only';

import { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withSystemJob, type SystemJobContext, type SystemJobOptions } from '@/lib/rls';

/**
 * The connection sweeps run on, and why it is not the shared one.
 *
 * A sweep opens one transaction per tenant. With 179 active tenants and a
 * callback that does nothing, that measured 125s on the pooled endpoint —
 * roughly 700ms each, almost entirely round-trips (BEGIN, set_config with its
 * read-back, COMMIT). That is the floor before any real work, and it exceeds
 * the 60s timeout common to serverless cron runners, so a sweep gets killed
 * part-way through having committed an arbitrary prefix of the tenants.
 *
 * Overlapping the per-tenant transactions fixes it — they were always
 * independent. But NOT on a pooled connection:
 *
 *     pooled,  concurrency 1    71-125s   works
 *     pooled,  concurrency 2    FAILS     P1001 "Can't reach database server"
 *     pooled,  concurrency 4    FAILS     P1001
 *     direct,  concurrency 4    35s       works, 196ms/tenant
 *
 * Two concurrent interactive transactions are enough to break Neon's pooler,
 * reproducibly, on a warm connection. So sweeps get their own client bound to
 * DIRECT_URL, where concurrency is available.
 *
 * This does not contradict scripts/prove-pooled-rls.ts. That proved
 * withTenantRls is correct over the pooler, and it is — for SEQUENTIAL
 * transactions, which is what every request path does. Sustained concurrent
 * interactive transactions are a different load.
 *
 * WHY A SEPARATE CLIENT RATHER THAN SWITCHING THE SHARED ONE: request handlers
 * should keep using the pooler. That is what it is for, and a few hundred
 * short-lived requests are exactly the shape it handles well. Only sweeps have
 * the long-transaction, high-concurrency profile that needs a direct
 * connection.
 */

let sweepClient: PrismaClient | null = null;

/** True when a usable DIRECT_URL is configured. */
function hasDirectUrl(): boolean {
  const u = process.env.DIRECT_URL ?? '';
  return u.length > 0 && !/-pooler\./.test(u);
}

/**
 * The client sweeps should use.
 *
 * Falls back to the shared pooled client when DIRECT_URL is absent or is itself
 * pooled — a sweep that runs slowly is better than one that cannot run, and
 * sweepConcurrency() drops to 1 in that case so the fallback is safe rather
 * than merely functional.
 *
 * Lazily created, then reused. Sweeps are cron-invoked and infrequent, so the
 * cost of the extra pool is only paid when one actually runs.
 */
let warnedNoDirect = false;

export function getSweepPrisma(): PrismaClient {
  if (!hasDirectUrl()) {
    // Say so, once. A silent fallback here costs roughly 4x on every sweep and
    // leaves no trace — the deployment looks healthy, the cron still finishes,
    // and nobody learns that DIRECT_URL was never set in this environment.
    if (!warnedNoDirect) {
      warnedNoDirect = true;
      const why = process.env.DIRECT_URL
        ? 'DIRECT_URL is itself a -pooler endpoint'
        : 'DIRECT_URL is not set';
      console.warn(
        `[sweep] ${why}; falling back to the pooled client at concurrency 1. ` +
          `Sweeps will take roughly 4x longer (measured: 33s vs 125s across 179 tenants). ` +
          `Set DIRECT_URL to the non-pooled endpoint for this environment.`,
      );
    }
    return prisma;
  }
  if (sweepClient) return sweepClient;

  sweepClient = new PrismaClient({
    datasourceUrl: process.env.DIRECT_URL,
    log: [{ level: 'error', emit: 'stdout' }],
  });
  return sweepClient;
}

/**
 * How many tenants a sweep may process at once.
 *
 * Deliberately computed HERE rather than left to withSystemJob's own default.
 * That default inspects process.env.DATABASE_URL, which stays pooled even when
 * the sweep is running on a direct client — it would return 1 and the speedup
 * would silently not happen. The concurrency has to be decided by whoever knows
 * which connection is actually in use.
 *
 * The ceiling is the PRISMA CLIENT POOL, not the server. Neon reports
 * max_connections = 901; Prisma opens num_cpus * 2 + 1 unless connection_limit
 * says otherwise — 9 on a 4-core box, 3 on a single-core serverless instance.
 * Exceeding it does not fail loudly; requests queue and then time out fetching
 * a connection, which reads like a database fault rather than a configuration
 * one. One connection is left spare and the whole thing is capped.
 */
export function sweepConcurrency(): number {
  if (!hasDirectUrl()) return 1;

  const m = /[?&]connection_limit=(\d+)/.exec(process.env.DIRECT_URL ?? '');
  // os.cpus() is not imported here — this module is also loaded in edge-ish
  // contexts during build. 4 is the conservative floor that works on a
  // single-core instance (pool 3) without needing to know the host.
  const pool = m ? Number(m[1]) : 9;
  return Math.max(1, Math.min(pool - 1, 8));
}

/**
 * Run a per-tenant sweep on the sweep connection.
 *
 * Prefer this over calling withSystemJob(prisma, ...) directly from a cron
 * route: it binds the right client AND the right concurrency together, which
 * is the pairing that is easy to get half-right.
 *
 * This is not a sixth tenancy pattern — the isolation semantics are exactly
 * withSystemJob's, one tenant-scoped transaction per tenant. Only the
 * connection and the batch size differ.
 */
export async function runSweep<T>(
  fn: (ctx: SystemJobContext) => Promise<T>,
  opts: SystemJobOptions = {},
): Promise<Array<{ tenantId: string; result: T }>> {
  return withSystemJob(getSweepPrisma(), fn, {
    concurrency: sweepConcurrency(),
    ...opts,
  });
}

/** Close the sweep client. For tests and one-shot scripts. */
export async function disconnectSweepPrisma(): Promise<void> {
  if (sweepClient) {
    await sweepClient.$disconnect();
    sweepClient = null;
  }
}
