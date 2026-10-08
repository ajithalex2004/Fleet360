export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/job-runs?job=<name>&limit=<n> — platform admins only.
 *
 * Recent background-job runs from job_runs (src/lib/jobs/job-runs.ts),
 * newest first: who ran each, when, for how long, and the outcome; runs
 * skipped because one was already in progress are not recorded as rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { recentRuns } from '@/lib/jobs/job-runs';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const runs = await recentRuns({ jobName: sp.get('job') ?? undefined, limit: Number(sp.get('limit') ?? 200) || 200 });
  return NextResponse.json({ runs }, { headers: { 'Cache-Control': 'no-store' } });
}
