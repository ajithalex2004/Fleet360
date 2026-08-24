/**
 * POST /api/jobs/run?job=<name>
 * GET  /api/jobs          — list all registered jobs
 *
 * Single secured entry point for all background sweep / cron jobs.
 * Auth: CRON_SECRET Bearer OR authenticated operator session.
 *
 * Vercel cron entries in vercel.json should point here:
 *   { "path": "/api/jobs/run?job=dunning-sweep", "schedule": "0 2 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { JOB_MAP, JOB_REGISTRY, isJobAuthorized, type JobContext } from '@/lib/jobs/registry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const dynamic     = 'force-dynamic';
export const maxDuration = 300; // seconds — Vercel Pro plan max

// ── GET /api/jobs — list registered jobs (authenticated) ─────────────────────

export async function GET(request: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  if (!isJobAuthorized(request)) {
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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const start = Date.now();

  if (!isJobAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobName = request.nextUrl.searchParams.get('job');
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
    tenantId:     request.headers.get('x-tenant-id'),
    userId:       request.headers.get('x-user-id') ?? 'system:cron',
    searchParams: request.nextUrl.searchParams,
    request,
  };

  try {
    const result = await jobDef.handler(ctx);

    const durationMs = Date.now() - start;
    console.info(`[jobs] ${jobName} → ${result.status} in ${durationMs}ms — ${result.summary}`);

    return NextResponse.json({
      job:        jobName,
      runAt:      new Date().toISOString(),
      durationMs,
      ...result,
    });
    } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[jobs] ${jobName} threw after ${durationMs}ms:`, err);

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
