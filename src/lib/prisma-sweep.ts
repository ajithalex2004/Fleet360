import 'server-only';

import { randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { claimRun, finishRun, leaseSecondsFor } from '@/lib/jobs/job-runs';
import { withSystemJob, type SystemJobContext, type SystemJobOptions } from '@/lib/rls';

/**
 * Upper bound on tenants processed at once during direct sweeps.
 *
 * 2, measured rather than reasoned. Against RUNTIME_DIRECT_DATABASE_URL as
 * fleet360_app on the Neon direct endpoint:
 *
 *     1 concurrent transaction    OK
 *     2 concurrent transactions   OK
 *     3 concurrent transactions   FAIL - "Unable to start a transaction"
 *
 * That error is Prisma's maxWait expiring while acquiring a pool connection,
 * not a network fault: fleet360_app has rolconnlimit = -1 and only one active
 * connection at the time. So the ceiling is client-side, and the previous
 * value of 3 sat exactly on it.
 *
 * The URL sets no connection_limit, so Prisma sizes the pool from the host's
 * core count. Setting ?connection_limit=10 on RUNTIME_DIRECT_DATABASE_URL would
 * make the pool explicit and allow a higher cap; until then 2 is what the
 * connection actually supports, and it is the same on a single-core serverless
 * instance where the pool is 3.
 *
 * MUST STAY IN STEP WITH defaultSweepConcurrency() in src/lib/rls.ts. Those two
 * were briefly out of step at 3 and 8, and because runSweep() passes this value
 * explicitly, the rls.ts figure had no effect on any real sweep.
 */
const SWEEP_CONCURRENCY_CAP = 2;

let sweepClient: PrismaClient | null = null;
let sweepClientVerified = false;

interface RoleVerificationRow {
  current_user: string;
  rolcanlogin: boolean;
  rolbypassrls: boolean;
  rolsuper: boolean;
}

/**
 * Returns the unpooled direct database URL configured specifically for
 * runtime sweeps and background jobs.
 *
 * Enforces runtime secret boundary:
 *   - Only RUNTIME_DIRECT_DATABASE_URL is accepted for application sweeps.
 *   - DIRECT_URL and MIGRATION_DATABASE_URL are forbidden in application runtime.
 */
function getDirectSweepUrl(): string | null {
  const candidate = process.env.RUNTIME_DIRECT_DATABASE_URL || '';
  if (!candidate || /-pooler\./.test(candidate)) return null;
  return candidate;
}

/** True when a usable direct endpoint URL is configured. */
function hasDirectUrl(): boolean {
  return getDirectSweepUrl() !== null;
}

let warnedFallback = false;

function emitFallbackWarning(reason: string) {
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[sweep] ${reason}; falling back to the pooled application client at concurrency 1. ` +
        `Sweeps will take roughly 4x longer (measured: 33s vs 125s across 179 tenants). ` +
        `Configure RUNTIME_DIRECT_DATABASE_URL with a direct non-bypass role (fleet360_app) for full performance.`,
    );
  }
}

/**
 * Initializes and independently verifies the direct sweep connection against pg_roles.
 *
 * Security Invariant:
 * The direct sweep connection MUST connect as exact role "fleet360_app" with
 * rolbypassrls = false and rolsuper = false. If the connection resolves to neondb_owner
 * or any role holding BYPASSRLS, the credential is rejected and we fall back to the
 * pooled application client at concurrency 1 to ensure tenant isolation is never compromised.
 */
export async function getVerifiedSweepPrisma(): Promise<{ client: PrismaClient; concurrency: number }> {
  const directUrl = getDirectSweepUrl();
  if (!directUrl) {
    const why = process.env.RUNTIME_DIRECT_DATABASE_URL
      ? 'RUNTIME_DIRECT_DATABASE_URL is configured as a -pooler endpoint'
      : 'RUNTIME_DIRECT_DATABASE_URL is not set';
    emitFallbackWarning(why);
    return { client: prisma, concurrency: 1 };
  }

  if (sweepClient && sweepClientVerified) {
    return { client: sweepClient, concurrency: sweepConcurrency() };
  }

  const client = new PrismaClient({
    datasourceUrl: directUrl,
    log: [{ level: 'error', emit: 'stdout' }],
  });

  try {
    let roles: RoleVerificationRow[] = [];
    let lastErr: unknown = null;

    // Retry direct connection query up to 4 times to handle Neon compute wakeups
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        roles = await client.$queryRawUnsafe<RoleVerificationRow[]>(`
          SELECT
            current_user,
            rolcanlogin,
            rolbypassrls,
            rolsuper
          FROM pg_roles
          WHERE rolname = current_user
        `);
        if (roles.length > 0) break;
      } catch (err) {
        lastErr = err;
        if (attempt < 4) {
          await new Promise((r) => setTimeout(r, 750 * attempt));
        }
      }
    }

    const role = roles[0];
    if (!role) {
      throw lastErr || new Error('Unable to resolve current_user from pg_roles');
    }

    if (role.current_user !== 'fleet360_app' || !role.rolcanlogin || role.rolbypassrls || role.rolsuper) {
      await client.$disconnect();
      console.error(
        `[sweep] 🚨 SECURITY ALARM: RUNTIME_DIRECT_DATABASE_URL connected as role "${role.current_user}" (canlogin=${role.rolcanlogin}, bypassrls=${role.rolbypassrls}, super=${role.rolsuper}). ` +
          `Direct sweep client REJECTED because it must connect strictly as "fleet360_app" with bypassrls=false, super=false, canlogin=true. ` +
          `Falling back to pooled DATABASE_URL at concurrency 1 to preserve tenant boundary.`,
      );
      return { client: prisma, concurrency: 1 };
    }

    sweepClient = client;
    sweepClientVerified = true;
    return { client: sweepClient, concurrency: sweepConcurrency() };
  } catch (err) {
    try {
      await client.$disconnect();
    } catch {
      // ignore
    }
    console.warn(
      `[sweep] Direct sweep role verification failed (${err instanceof Error ? err.message : String(err)}); falling back to pooled client at concurrency 1.`,
    );
    return { client: prisma, concurrency: 1 };
  }
}

/**
 * Returns the client sweeps should use.
 * Synchronous getter for backwards compatibility.
 */
export function getSweepPrisma(): PrismaClient {
  return (sweepClient && sweepClientVerified) ? sweepClient : prisma;
}

/**
 * How many tenants a sweep may process at once.
 */
export function sweepConcurrency(): number {
  if (!hasDirectUrl() || !sweepClientVerified) return 1;

  const directUrl = getDirectSweepUrl();
  const m = /[?&]connection_limit=(\d+)/.exec(directUrl ?? '');
  const pool = m ? Number(m[1]) : 9;
  return Math.max(1, Math.min(pool - 1, SWEEP_CONCURRENCY_CAP));
}

export interface RunSweepOptions extends SystemJobOptions {
  /**
   * Name under which the sweep claims a run in job_runs, so two runs never
   * overlap: a second one starting while the first holds its lease is skipped.
   */
  advisoryLockKey?: number | string;
  /** Seconds before a claimed run counts as abandoned. Default 10 minutes. */
  leaseSeconds?: number;
}

/**
 * Hash string or number to a deterministic 32-bit positive integer for PostgreSQL advisory locks.
 */
export function getAdvisoryLockId(key: number | string): number {
  if (typeof key === 'number') {
    return Math.abs(Math.floor(key));
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Run a per-tenant sweep on the verified sweep connection, optionally claimed
 * so that runs never overlap.
 *
 * Binds the verified non-bypass client AND the bounded concurrency together.
 *
 * Overlap used to be prevented with a session-level pg_try_advisory_lock.
 * Prisma gives no way to keep one connection outside a transaction, so the
 * unlock could run on a different pooled connection than the lock: it
 * returned false (unchecked), the lock stayed on the first connection, and
 * every later run of the sweep was skipped until that connection closed —
 * through a transaction-mode pooler, possibly never. A failure to take the
 * lock also ran the sweep anyway. The job_runs claim (src/lib/jobs/job-runs.ts)
 * is a row with a lease: it does not depend on a connection, a crashed run's
 * claim expires, and a claim that cannot be made stops the sweep.
 */
export async function runSweep<T>(
  fn: (ctx: SystemJobContext) => Promise<T>,
  opts: RunSweepOptions = {},
): Promise<Array<{ tenantId: string; result: T }>> {
  const { client, concurrency } = await getVerifiedSweepPrisma();
  const { advisoryLockKey, leaseSeconds, ...jobOpts } = opts;

  // Spread FIRST, then apply the resolved concurrency. The reverse order —
  // which this was — lets `...opts` overwrite the computed value with
  // `undefined` whenever a caller passes the key explicitly but unset, e.g.
  // `runSweep(fn, { tenantHeader, concurrency: someMaybeUndefined })`.
  // withSystemJob then falls back to its own default, discarding the
  // concurrency getVerifiedSweepPrisma just decided. The dangerous case is
  // the fallback path: verification failed, concurrency is 1 because we are
  // on the POOLED client, and the spread throws that 1 away.
  const run = () => withSystemJob(client, fn, {
    ...jobOpts,
    concurrency: jobOpts.concurrency ?? concurrency,
  });

  if (advisoryLockKey === undefined) return run();

  // One claim per sweep whatever tenantHeader says, as with the lock it
  // replaces: a single-tenant run and a full run do not overlap either.
  const jobName = `sweep:${advisoryLockKey}`;
  const claim = await claimRun({
    jobName,
    scope: '*',
    occurrence: randomUUID(),
    trigger: 'manual',
    leaseSeconds: leaseSeconds ?? leaseSecondsFor(undefined),
  });
  if (!claim.claimed) {
    console.warn(`[sweep] Sweep "${advisoryLockKey}" skipped: run ${claim.runId ?? '(unknown)'} is still in progress.`);
    return [];
  }

  const started = Date.now();
  try {
    const results = await run();
    await finishRun(claim.runId, {
      status: 'SUCCEEDED',
      durationMs: Date.now() - started,
      summary: `${results.length} tenant(s)`,
    });
    return results;
  } catch (err) {
    await finishRun(claim.runId, {
      status: 'FAILED',
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Close the sweep client. For tests and one-shot scripts. */
export async function disconnectSweepPrisma(): Promise<void> {
  if (sweepClient) {
    await sweepClient.$disconnect();
    sweepClient = null;
    sweepClientVerified = false;
  }
}
