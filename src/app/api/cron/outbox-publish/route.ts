/**
 * GET/POST /api/cron/outbox-publish
 *
 * One run of THE event_outbox publisher (src/lib/jobs/outbox-publisher.ts),
 * for external schedulers (k8s CronJob, etc). It is the same function the
 * in-process scheduler runs as the `outbox-publisher` job, so both entry
 * points deliver with the same consumers, claims and acknowledgement rules.
 * (It used to run a second publisher with its own two-consumer registry,
 * which acknowledged every other event type without running its consumers —
 * architecture audit A3.)
 *
 * Auth: CRON_SECRET Bearer OR verified SUPER_ADMIN session (global drain).
 * Query params: ?dryRun=true — report what would be claimed, deliver nothing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeJobRequest } from '@/lib/jobs/request-auth';
import { runOutboxPublisher } from '@/lib/jobs/outbox-publisher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const auth = await authorizeJobRequest(request, { secretName: 'CRON_SECRET', global: true });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const start = Date.now();
  try {
    const result = await runOutboxPublisher({
      tenantId: null,
      userId: 'system:cron',
      searchParams: request.nextUrl.searchParams,
      request,
    });
    return NextResponse.json({
      ok: result.status === 'ok',
      runAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      ...result,
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[outbox-publish] run threw after ${durationMs}ms:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), runAt: new Date().toISOString(), durationMs },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
