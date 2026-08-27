import 'server-only';

import { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withSystemJob, type SystemJobContext, type SystemJobOptions } from '@/lib/rls';

/**
 * Upper bound on tenants processed at once during direct sweeps.
 *
 * 3, not 8, to survive single-core serverless compute where Prisma's pool is
 * num_cpus * 2 + 1 = 3. Exceeding the pool does not fail loudly — requests
 * queue and then time out fetching a connection, which reads like a database
 * fault rather than a configuration one.
 *
 * MUST STAY IN STEP WITH defaultSweepConcurrency() in src/lib/rls.ts.
 */
const SWEEP_CONCURRENCY_CAP = 3;

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
 * Credential precedence:
 *   1. RUNTIME_DIRECT_DATABASE_URL (dedicated fleet360_app direct compute)
 *   2. DIRECT_URL (legacy / fallback, only if not pooled)
 */
function getDirectSweepUrl(): string | null {
  const candidate = process.env.RUNTIME_DIRECT_DATABASE_URL || process.env.DIRECT_URL || '';
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
 * The direct sweep connection MUST connect as a non-bypass role (fleet360_app with
 * rolbypassrls = false and rolsuper = false). If the connection resolves to neondb_owner
 * or any role holding BYPASSRLS, the credential is rejected and we fall back to the
 * pooled application client at concurrency 1 to ensure tenant isolation is never compromised.
 */
export async function getVerifiedSweepPrisma(): Promise<{ client: PrismaClient; concurrency: number }> {
  const directUrl = getDirectSweepUrl();
  if (!directUrl) {
    const why = (process.env.RUNTIME_DIRECT_DATABASE_URL || process.env.DIRECT_URL)
      ? 'Direct sweep URL is configured as a -pooler endpoint'
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
    const roles = await client.$queryRawUnsafe<RoleVerificationRow[]>(`
      SELECT
        current_user,
        rolcanlogin,
        rolbypassrls,
        rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);

    const role = roles[0];
    if (!role) {
      throw new Error('Unable to resolve current_user from pg_roles');
    }

    if (role.rolbypassrls || role.rolsuper) {
      await client.$disconnect();
      console.error(
        `[sweep] 🚨 SECURITY ALARM: RUNTIME_DIRECT_DATABASE_URL connected as role "${role.current_user}" with ` +
          `bypassrls=${role.rolbypassrls}, super=${role.rolsuper}. Direct sweep client REJECTED because it ` +
          `would bypass PostgreSQL RLS. Falling back to pooled DATABASE_URL at concurrency 1 to preserve tenant boundary.`,
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

/**
 * Run a per-tenant sweep on the verified sweep connection.
 *
 * Binds the verified non-bypass client AND the bounded concurrency together.
 */
export async function runSweep<T>(
  fn: (ctx: SystemJobContext) => Promise<T>,
  opts: SystemJobOptions = {},
): Promise<Array<{ tenantId: string; result: T }>> {
  const { client, concurrency } = await getVerifiedSweepPrisma();
  return withSystemJob(client, fn, {
    concurrency: opts.concurrency ?? concurrency,
    ...opts,
  });
}

/** Close the sweep client. For tests and one-shot scripts. */
export async function disconnectSweepPrisma(): Promise<void> {
  if (sweepClient) {
    await sweepClient.$disconnect();
    sweepClient = null;
    sweepClientVerified = false;
  }
}
