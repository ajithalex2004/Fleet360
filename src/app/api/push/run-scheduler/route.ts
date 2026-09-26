import { NextRequest, NextResponse } from 'next/server';
import { runTripReminders } from '@/lib/push/scheduler';
import { authorizeJobRequest } from '@/lib/jobs/request-auth';

/** Scheduler credentials may sweep all tenants; verified tenant admins may
 * only run their own tenant. No anonymous development-mode bypass.
 * Legacy x-push-cron-secret and ?secret= credentials remain supported.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeJobRequest(req, { secretName: 'PUSH_CRON_SECRET' });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const result = await runTripReminders(auth.tenantId);
  return NextResponse.json({ ok: true, ...result });
}
