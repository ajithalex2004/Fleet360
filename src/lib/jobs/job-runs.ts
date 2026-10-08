/**
 * Durable job-run claims and records (architecture audit A8).
 *
 * The in-process scheduler (src/lib/jobs/scheduler.ts) runs in every web
 * process, and its "already ran this minute" state is local memory, so with
 * two replicas both fire every job, and a run longer than its interval
 * overlaps itself. POST /api/jobs/run therefore claims each run here first,
 * in one transaction serialised per job and scope by an advisory lock:
 *
 *   1. a RUNNING row whose lease has expired (its worker crashed or was
 *      redeployed) is closed as FAILED;
 *   2. if a RUNNING row with a live lease remains, the run is skipped
 *      ('running') — a job never overlaps itself;
 *   3. a row is inserted for (job, scope, occurrence); if that occurrence was
 *      already claimed, the run is skipped ('duplicate'). The scheduler's
 *      occurrence is the minute it fired for, so replicas firing the same
 *      tick produce one run. Manual and external runs get a unique one.
 *
 * finishRun records the outcome on the claimed row. Catch-up policy: a tick
 * missed while no process was running is not replayed; each job's next
 * occurrence runs as scheduled.
 */
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { prisma } from '@/lib/prisma';
import { runOutsideRlsScope } from '@/lib/rls-scope';

/** This process, as the owner recorded on the runs it claims. */
export const JOB_RUN_OWNER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export type ClaimResult =
  | { claimed: true; runId: string }
  | { claimed: false; reason: 'running' | 'duplicate'; runId?: string };

export interface ClaimInput {
  jobName: string;
  /** The tenant the run is for, or '*' for a platform-wide run. */
  scope: string;
  /** Dedupe key: the scheduled minute, or a unique id for an ad-hoc run. */
  occurrence: string;
  trigger: 'scheduler' | 'manual';
  /** Seconds before a RUNNING claim counts as abandoned. */
  leaseSeconds: number;
}

type Tx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

/** Lease for a job: twice its expected duration, at least 10 minutes. */
export function leaseSecondsFor(maxDurationSec: number | undefined): number {
  return Math.max((maxDurationSec ?? 300) * 2, 600);
}

/** The scheduler's occurrence key: the UTC minute it fired for. */
export function scheduledOccurrence(at: Date): string {
  return at.toISOString().slice(0, 16) + 'Z';
}

export async function claimRun(input: ClaimInput): Promise<ClaimResult> {
  return runOutsideRlsScope(() => prisma.$transaction(async (raw) => {
    const tx = raw as unknown as Tx;
    // A statement, not a query: the function returns void, which a query cannot read.
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `job-run:${input.jobName}:${input.scope}`);

    await tx.$executeRawUnsafe(
      `UPDATE job_runs
          SET status = 'FAILED', finished_at = NOW(),
              error = 'lease expired: the run was abandoned (process stopped or redeployed)'
        WHERE job_name = $1 AND scope = $2 AND status = 'RUNNING' AND lease_expires_at < NOW()`,
      input.jobName, input.scope,
    );

    const [live] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM job_runs
        WHERE job_name = $1 AND scope = $2 AND status = 'RUNNING'
        LIMIT 1`,
      input.jobName, input.scope,
    );
    if (live) return { claimed: false, reason: 'running', runId: live.id } as const;

    const [row] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO job_runs (job_name, scope, occurrence, trigger, owner, status, lease_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', NOW() + make_interval(secs => $6::double precision))
       ON CONFLICT (job_name, scope, occurrence) DO NOTHING
       RETURNING id::text`,
      input.jobName, input.scope, input.occurrence, input.trigger, JOB_RUN_OWNER, input.leaseSeconds,
    );
    return row ? { claimed: true, runId: row.id } as const : { claimed: false, reason: 'duplicate' } as const;
  }, { timeout: 15_000, maxWait: 10_000 }));
}

export async function finishRun(
  runId: string,
  outcome: { status: 'SUCCEEDED' | 'FAILED'; durationMs: number; summary?: string; error?: string },
): Promise<void> {
  await runOutsideRlsScope(async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE job_runs
          SET status = $2, finished_at = NOW(), duration_ms = $3,
              summary = $4, error = $5
        WHERE id = $1::uuid AND owner = $6 AND status = 'RUNNING'`,
      runId, outcome.status, Math.round(outcome.durationMs),
      outcome.summary?.slice(0, 2000) ?? null, outcome.error?.slice(0, 4000) ?? null, JOB_RUN_OWNER,
    );
    // Keep 30 days of history; trimmed now and then, not on every run.
    if (Math.random() < 0.02) {
      await prisma.$executeRawUnsafe(`DELETE FROM job_runs WHERE started_at < NOW() - INTERVAL '30 days'`);
    }
  }).catch((e) => console.error(`[job-runs] could not record the outcome of run ${runId}:`, e));
}

export interface JobRunRow {
  id: string; jobName: string; scope: string; occurrence: string; trigger: string; owner: string;
  status: string; startedAt: string; finishedAt: string | null; durationMs: number | null;
  summary: string | null; error: string | null;
}

/** Recent runs, newest first (Admin > Job runs). */
export async function recentRuns(opts: { jobName?: string; limit?: number } = {}): Promise<JobRunRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  return runOutsideRlsScope(() => prisma.$queryRawUnsafe<JobRunRow[]>(
    `SELECT id::text, job_name AS "jobName", scope, occurrence, trigger, owner, status,
            started_at::text AS "startedAt", finished_at::text AS "finishedAt",
            duration_ms AS "durationMs", summary, error
       FROM job_runs
      WHERE ($1::text IS NULL OR job_name = $1)
      ORDER BY started_at DESC
      LIMIT $2`,
    opts.jobName ?? null, limit,
  ));
}
