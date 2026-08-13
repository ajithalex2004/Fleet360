/**
 * POST /api/push/run-scheduler
 *
 * Manually triggers the trip-reminder scheduler. For production this
 * endpoint should be hit by a cron (Vercel Cron, GitHub Actions, or an
 * external scheduler) every 1-2 minutes. The reminder window is
 * [lead-2, lead+2] minutes around the configured lead time, so a 1-min
 * cron catches every trip.
 *
 * Auth: requires the x-tenant-id header (the system job helper iterates
 * all tenants when tenantId is absent). A shared-secret header
 * (`PUSH_CRON_SECRET`) protects the endpoint from public hits.
 *
 * Use this in dev too — no point standing up a real cron when you can
 * just POST it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTripReminders } from '@/lib/push/scheduler';

export async function POST(req: NextRequest) {
  const secret = process.env.PUSH_CRON_SECRET;
  if (secret) {
    const supplied = req.headers.get('x-push-cron-secret') ?? new URL(req.url).searchParams.get('secret');
    if (supplied !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const tenantId = req.headers.get('x-tenant-id') ?? new URL(req.url).searchParams.get('tenantId') ?? null;
  const result = await runTripReminders(tenantId);
  return NextResponse.json({ ok: true, ...result });
}
