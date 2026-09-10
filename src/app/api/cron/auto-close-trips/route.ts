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

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await verifyJobAuthorization(request, 'auto-close-trips');
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error ?? 'unauthorized' }, { status: auth.status ?? 401 });
  }

  const jobDef = JOB_MAP.get('auto-close-trips')!;
  const ctx: JobContext = {
    tenantId:     auth.tenantId,
    userId:       auth.userId ?? 'system:cron',
    searchParams: request.nextUrl.searchParams,
    request,
  };

  const result = await jobDef.handler(ctx);
  return NextResponse.json({ ok: result.status === 'ok', ...result.data });
}
