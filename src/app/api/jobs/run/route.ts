/**
 * POST /api/jobs/run?job=<name>
 * GET  /api/jobs          — list all registered jobs
 *
 * Single secured entry point for all background sweep / cron jobs.
 * Auth: CRON_SECRET Bearer OR authenticated operator session.
 *
 * The in-process scheduler (src/lib/jobs/scheduler.ts) POSTs here:
 *   { "path": "/api/jobs/run?job=dunning-sweep", "schedule": "0 2 * * *" }
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { claimRun, finishRun, leaseSecondsFor } from '@/lib/jobs/job-runs';
import { JOB_MAP, JOB_REGISTRY, isJobAuthorized, verifyJobAuthorization, type JobContext } from '@/lib/jobs/registry';

export const dynamic     = 'force-dynamic';
export const maxDuration = 300; // seconds

// ── GET /api/jobs — list registered jobs (authenticated) ─────────────────────
//
// Auth is isJobAuthorized alone (CRON_SECRET Bearer OR an operator session)
// — this is a system-wide cron endpoint, not a tenant-scoped one, so it must
// not also require requireAuthorizedTenant's x-tenant-id. That extra gate
// used to run first and fail closed with 401 for every secret-only caller
// (its resolved tenantId was never even used afterward), which meant this
// endpoint was never actually reachable by CRON_SECRET alone despite the
// docstring above promising exactly that — including the one real cron
// entry an external cron (formerly vercel.json, removed) ever pointed here.

export async function GET(request: NextRequest) {
  if (!await isJobAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    jobs: JOB_REGISTRY.map(j => ({
      name:           j.name,
      description:    j.description,
      maxDurationSec: j.maxDurationSec ?? 60,
    })),
  });
}

// ── POST /api/jobs/run?job=<name> — run a job ─────────────────────────────────

export async function POST(request: NextRequest) {
  const start = Date.now();

  const jobName = request.nextUrl.searchParams.get('job');
  const auth = await verifyJobAuthorization(request, jobName);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error ?? 'Unauthorized' },
      { status: auth.status ?? 401 }
    );
  }
  if (!jobName) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: 'Missing required query param: ?job=<name>',
        available: JOB_REGISTRY.map(j => j.name),
      },
      { status: 400 },
    );
  }

  const jobDef = JOB_MAP.get(jobName);
  if (!jobDef) {
    return NextResponse.json(
      {
        error: 'Not Found',
        message: `Job "${jobName}" is not registered`,
        available: JOB_REGISTRY.map(j => j.name),
      },
      { status: 404 },
    );
  }

  const ctx: JobContext = {
    tenantId:     auth.tenantId,
    userId:       auth.userId,
    searchParams: request.nextUrl.searchParams,
    request,
  };

  // Claim the run (src/lib/jobs/job-runs.ts): one run per scheduled
  // occurrence across every web replica, and never two of the same job at
  // once. The scheduler names the minute it fired for; any other caller's
  // run is its own occurrence.
  // If the claim cannot be recorded, the job does not run: an unrecorded run
  // is exactly what could overlap or double up.
  const scheduled = request.nextUrl.searchParams.get('occurrence');
  let claim: Awaited<ReturnType<typeof claimRun>>;
  try {
    claim = await claimRun({
      jobName,
      scope:        auth.tenantId ?? '*',
      occurrence:   scheduled ?? `manual:${randomUUID()}`,
      trigger:      scheduled ? 'scheduler' : 'manual',
      leaseSeconds: leaseSecondsFor(jobDef.maxDurationSec),
    });
  } catch (err) {
    console.error(`[jobs] ${jobName} not run: could not claim the run:`, err);
    return NextResponse.json(
      { job: jobName, status: 'error', summary: 'could not claim the run (database unavailable?); not run' },
      { status: 503 },
    );
  }
  if (!claim.claimed) {
    const summary = claim.reason === 'running'
      ? `skipped: a run of ${jobName} is still in progress${claim.runId ? ` (run ${claim.runId})` : ''}`
      : `skipped: occurrence ${scheduled} already ran`;
    console.info(`[jobs] ${jobName} ${summary}`);
    return NextResponse.json({ job: jobName, runAt: new Date().toISOString(), durationMs: Date.now() - start, status: 'skipped', summary });
  }

  try {
    const result = await jobDef.handler(ctx);

    const durationMs = Date.now() - start;
    console.info(`[jobs] ${jobName} → ${result.status} in ${durationMs}ms — ${result.summary}`);
    await finishRun(claim.runId, {
      status: result.status === 'error' ? 'FAILED' : 'SUCCEEDED',
      durationMs,
      summary: result.summary,
    });

    return NextResponse.json({
      job:        jobName,
      runId:      claim.runId,
      runAt:      new Date().toISOString(),
      durationMs,
      ...result,
    });
    } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[jobs] ${jobName} threw after ${durationMs}ms:`, err);
    await finishRun(claim.runId, {
      status: 'FAILED',
      durationMs,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });

    return NextResponse.json(
      {
        job:        jobName,
        runAt:      new Date().toISOString(),
        durationMs,
        status:     'error',
        summary:    err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
