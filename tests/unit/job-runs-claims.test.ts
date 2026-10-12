/**
 * tests/unit/job-runs-claims.test.ts
 *
 * Architecture audit A8: every web process ran its own scheduler with
 * in-memory state, so two replicas ran every job twice and a long run could
 * overlap itself. claimRun (src/lib/jobs/job-runs.ts) decides in the
 * database. Runs against a real PostgreSQL when JOB_RUNS_TEST_DATABASE_URL is
 * set (it creates the job_runs table there); skipped otherwise.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.JOB_RUNS_TEST_DATABASE_URL;

// Only ever the test database — never the .env DATABASE_URL.
vi.mock('@/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client');
  return { prisma: new PrismaClient({ datasourceUrl: process.env.JOB_RUNS_TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:1/unused' }) };
});
vi.mock('@/lib/rls-scope', () => ({ runOutsideRlsScope: (fn: () => unknown) => fn() }));

import { prisma } from '@/lib/prisma';
import { claimRun, finishRun, recentRuns, scheduledOccurrence } from '@/lib/jobs/job-runs';

const suite = url ? describe : describe.skip;

suite('job run claims (PostgreSQL)', () => {
  beforeAll(async () => {
    const sql = readFileSync(join(process.cwd(), 'prisma/migrations/20261025090000_job_runs/migration.sql'), 'utf8')
      .replace(/^GRANT .*$/m, '');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public.job_runs`);
    for (const stmt of sql.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
  });
  beforeEach(async () => { await prisma.$executeRawUnsafe(`DELETE FROM job_runs`); });
  afterAll(async () => { await prisma.$disconnect(); });

  const input = (occurrence: string) => ({
    jobName: 'dunning-sweep', scope: '*', occurrence, trigger: 'scheduler' as const, leaseSeconds: 600,
  });

  it('runs a scheduled tick once when several replicas fire it at the same time', async () => {
    const tick = scheduledOccurrence(new Date('2026-10-08T02:00:30Z'));
    expect(tick).toBe('2026-10-08T02:00Z');
    const results = await Promise.all(Array.from({ length: 5 }, () => claimRun(input(tick))));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed).map((r) => (r as { reason: string }).reason).sort())
      .toEqual(['running', 'running', 'running', 'running']);
  });

  it('does not start a run while another of the same job is in progress', async () => {
    const first = await claimRun(input('2026-10-08T02:00Z'));
    expect(first.claimed).toBe(true);
    expect(await claimRun(input('2026-10-08T02:05Z'))).toMatchObject({ claimed: false, reason: 'running' });
    // A different job, or the same job for another tenant, is independent.
    expect((await claimRun({ ...input('2026-10-08T02:05Z'), jobName: 'outbox-publisher' })).claimed).toBe(true);
    expect((await claimRun({ ...input('2026-10-08T02:05Z'), scope: 'tenant-a' })).claimed).toBe(true);
  });

  it('records the outcome, and does not repeat an occurrence that already ran', async () => {
    const c = await claimRun(input('2026-10-08T02:00Z'));
    if (!c.claimed) throw new Error('not claimed');
    await finishRun(c.runId, { status: 'SUCCEEDED', durationMs: 1234.4, summary: '3 notices queued' });
    const [run] = await recentRuns({ jobName: 'dunning-sweep' });
    expect(run).toMatchObject({ status: 'SUCCEEDED', durationMs: 1234, summary: '3 notices queued', trigger: 'scheduler' });
    expect(await claimRun(input('2026-10-08T02:00Z'))).toMatchObject({ claimed: false, reason: 'duplicate' });
    expect((await claimRun(input('2026-10-08T02:01Z'))).claimed).toBe(true);
  });

  it('closes an abandoned run whose lease expired, so the job can run again', async () => {
    const c = await claimRun(input('2026-10-08T02:00Z'));
    if (!c.claimed) throw new Error('not claimed');
    await prisma.$executeRawUnsafe(`UPDATE job_runs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1::uuid`, c.runId);
    expect((await claimRun(input('2026-10-08T02:30Z'))).claimed).toBe(true);
    const runs = await recentRuns({ jobName: 'dunning-sweep' });
    const abandoned = runs.find((r) => r.id === c.runId)!;
    expect(abandoned.status).toBe('FAILED');
    expect(abandoned.error).toContain('lease expired');
  });
});
