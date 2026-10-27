/**
 * Sweep concurrency: the cap value, and that the cap survives the call into
 * withSystemJob.
 *
 * Separate from prisma-sweep.test.ts because these tests mock @prisma/client
 * and @/lib/rls at module scope, which would break that file's advisory-lock
 * test — it constructs real PrismaClients against a live database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.hoisted, because vi.mock factories are lifted above ordinary top-level
// declarations — referencing a plain `const` from one is a TDZ error at collect
// time, and the file reports "no tests" rather than a failure you can read.
const { VERIFIED_ROLE, pooledClient, withSystemJobCalls, jobRuns } = vi.hoisted(() => ({
  VERIFIED_ROLE: {
    current_user: 'fleet360_app',
    rolcanlogin: true,
    rolbypassrls: false,
    rolsuper: false,
  },
  pooledClient: { __pooled: true },
  withSystemJobCalls: [] as Array<{ client: unknown; opts: Record<string, unknown> }>,
  jobRuns: {
    claimed: true,
    claims: [] as Array<Record<string, unknown>>,
    finishes: [] as Array<{ runId: string; outcome: Record<string, unknown> }>,
  },
}));

// Stands in for a direct connection that verifies as the non-bypass app role,
// so sweepConcurrency() reaches the capped branch instead of returning the
// unverified default of 1.
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    async $queryRawUnsafe() {
      return [VERIFIED_ROLE];
    }
    async $disconnect() {}
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: pooledClient }));

vi.mock('@/lib/rls', () => ({
  withSystemJob: vi.fn(async (client: unknown, _fn: unknown, opts: Record<string, unknown>) => {
    withSystemJobCalls.push({ client, opts });
    return [];
  }),
}));

vi.mock('@/lib/jobs/job-runs', () => ({
  leaseSecondsFor: () => 600,
  claimRun: vi.fn(async (input: Record<string, unknown>) => {
    jobRuns.claims.push(input);
    return jobRuns.claimed
      ? { claimed: true, runId: 'run-1' }
      : { claimed: false, reason: 'running', runId: 'run-0' };
  }),
  finishRun: vi.fn(async (runId: string, outcome: Record<string, unknown>) => {
    jobRuns.finishes.push({ runId, outcome });
  }),
}));

import { withSystemJob } from '@/lib/rls';
import { claimRun } from '@/lib/jobs/job-runs';
import {
  getVerifiedSweepPrisma,
  sweepConcurrency,
  disconnectSweepPrisma,
  runSweep,
} from '@/lib/prisma-sweep';

const DIRECT = 'postgresql://user:pass@ep-demo.ap-southeast-1.aws.neon.tech/neondb';

describe('sweep concurrency cap', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    await disconnectSweepPrisma();
    withSystemJobCalls.length = 0;
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    await disconnectSweepPrisma();
    process.env = { ...originalEnv };
  });

  // The cap is 2 because 3 concurrent transactions fail against this connection
  // with "Unable to start a transaction". See the comment on
  // SWEEP_CONCURRENCY_CAP for the measurement.
  it('caps a verified direct connection at 2 even though the default pool would allow 8', async () => {
    process.env.RUNTIME_DIRECT_DATABASE_URL = DIRECT;

    const { concurrency } = await getVerifiedSweepPrisma();
    expect(concurrency).toBe(2);
    expect(sweepConcurrency()).toBe(2);
  });

  // The cap is an upper bound, not a floor: a small explicit pool still wins.
  it('lets an explicit connection_limit constrain below the cap', async () => {
    process.env.RUNTIME_DIRECT_DATABASE_URL = `${DIRECT}?connection_limit=2`;

    const { concurrency } = await getVerifiedSweepPrisma();
    expect(concurrency).toBe(1); // min(2 - 1, 2)
  });

  it('never exceeds the cap however large the declared pool is', async () => {
    process.env.RUNTIME_DIRECT_DATABASE_URL = `${DIRECT}?connection_limit=50`;

    const { concurrency } = await getVerifiedSweepPrisma();
    expect(concurrency).toBe(2);
  });
});

describe('runSweep passes the resolved concurrency through to withSystemJob', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    await disconnectSweepPrisma();
    withSystemJobCalls.length = 0;
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    await disconnectSweepPrisma();
    process.env = { ...originalEnv };
  });

  it('forwards the verified direct concurrency', async () => {
    process.env.RUNTIME_DIRECT_DATABASE_URL = DIRECT;

    await runSweep(async () => 'ok');

    expect(withSystemJobCalls).toHaveLength(1);
    expect(withSystemJobCalls[0].opts.concurrency).toBe(2);
  });

  it('honours an explicit caller override', async () => {
    process.env.RUNTIME_DIRECT_DATABASE_URL = DIRECT;

    await runSweep(async () => 'ok', { concurrency: 1 });

    expect(withSystemJobCalls[0].opts.concurrency).toBe(1);
  });

  /**
   * Regression: options were spread AFTER the computed concurrency, so an
   * explicitly-passed-but-undefined `concurrency` key overwrote it with
   * undefined and withSystemJob fell back to its own default.
   *
   * This is the case that matters. Direct verification has failed, so we are on
   * the POOLED client where only one transaction is safe — and the discarded
   * value is exactly that 1.
   */
  it('keeps the pooled fallback at 1 when the caller passes concurrency: undefined', async () => {
    delete process.env.RUNTIME_DIRECT_DATABASE_URL;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runSweep(async () => 'ok', {
      tenantHeader: null,
      concurrency: undefined,
    });

    expect(withSystemJobCalls[0].client).toBe(pooledClient);
    expect(withSystemJobCalls[0].opts.concurrency).toBe(1);
    warnSpy.mockRestore();
  });

  it('preserves the other options alongside the resolved concurrency', async () => {
    process.env.RUNTIME_DIRECT_DATABASE_URL = DIRECT;

    await runSweep(async () => 'ok', { tenantHeader: 'tenant-a', timeoutMs: 45_000 });

    expect(withSystemJobCalls[0].opts).toMatchObject({
      tenantHeader: 'tenant-a',
      timeoutMs: 45_000,
      concurrency: 2,
    });
  });
});

// ── Overlap guard ───────────────────────────────────────────────────────────
//
// runSweep used a session-level pg_try_advisory_lock whose unlock could land
// on a different pooled connection, stranding the lock and skipping the sweep
// from then on. It now claims a run in job_runs, which has a lease.

describe('runSweep overlap guard (job_runs claim)', () => {
  beforeEach(() => {
    withSystemJobCalls.length = 0;
    jobRuns.claimed = true;
    jobRuns.claims.length = 0;
    jobRuns.finishes.length = 0;
  });

  it('claims no run when no key is given', async () => {
    await runSweep(async () => 'ok');
    expect(jobRuns.claims).toHaveLength(0);
    expect(withSystemJobCalls).toHaveLength(1);
  });

  it('claims a platform-wide run, sweeps, and records success', async () => {
    await runSweep(async () => 'ok', { advisoryLockKey: 'demo-sweep', tenantHeader: 'tenant-a' });

    expect(jobRuns.claims).toEqual([expect.objectContaining({
      jobName: 'sweep:demo-sweep', scope: '*', trigger: 'manual', leaseSeconds: 600,
    })]);
    expect(withSystemJobCalls).toHaveLength(1);
    // The claim key is runSweep's business, not withSystemJob's.
    expect(withSystemJobCalls[0].opts).not.toHaveProperty('advisoryLockKey');
    expect(jobRuns.finishes).toEqual([
      { runId: 'run-1', outcome: expect.objectContaining({ status: 'SUCCEEDED' }) },
    ]);
  });

  it('skips the sweep while another run holds the claim', async () => {
    jobRuns.claimed = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = await runSweep(async () => 'ok', { advisoryLockKey: 'demo-sweep' });

    warn.mockRestore();
    expect(out).toEqual([]);
    expect(withSystemJobCalls).toHaveLength(0);
    expect(jobRuns.finishes).toHaveLength(0);
  });

  it('records a failed run and rethrows', async () => {
    vi.mocked(withSystemJob).mockRejectedValueOnce(new Error('tenant 7 failed'));

    await expect(runSweep(async () => 'ok', { advisoryLockKey: 'demo-sweep' })).rejects.toThrow('tenant 7 failed');
    expect(jobRuns.finishes).toEqual([
      { runId: 'run-1', outcome: expect.objectContaining({ status: 'FAILED', error: 'tenant 7 failed' }) },
    ]);
  });

  it('does not sweep when the claim itself cannot be made', async () => {
    vi.mocked(claimRun).mockRejectedValueOnce(new Error('db unreachable'));

    await expect(runSweep(async () => 'ok', { advisoryLockKey: 'demo-sweep' })).rejects.toThrow('db unreachable');
    expect(withSystemJobCalls).toHaveLength(0);
  });
});
