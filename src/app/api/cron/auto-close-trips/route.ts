/**
 * GET /api/cron/auto-close-trips
 *
 * Legacy entry point kept for backwards-compat with any existing Vercel cron
 * config or external schedulers that hit this path. All logic now lives in
 * the centralized job dispatcher — this route simply delegates.
 *
 * New cron entries should point to: POST /api/jobs/run?job=auto-close-trips
 */
import { NextRequest, NextResponse } from 'next/server';
import { isJobAuthorized, JOB_MAP, type JobContext } from '@/lib/jobs/registry';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isJobAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const jobDef = JOB_MAP.get('auto-close-trips')!;
  const ctx: JobContext = {
    tenantId:     request.headers.get('x-tenant-id'),
    userId:       request.headers.get('x-user-id') ?? 'system:cron',
    searchParams: request.nextUrl.searchParams,
    request,
  };

  const result = await jobDef.handler(ctx);
  return NextResponse.json({ ok: result.status === 'ok', ...result.data });
}
