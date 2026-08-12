/**
 * GET/POST /api/cron/outbox-publish
 *
 * One-shot tick of the domain event outbox. Drains event_outbox for
 * up to ?batchSize rows (default 50) and dispatches each to its
 * registered consumer. Returns the tick summary.
 *
 * Intended for external schedulers (Vercel cron, k8s CronJob, etc).
 * For a long-lived dev worker, see scripts/outbox-publisher-dev.ts.
 *
 * Auth: CRON_SECRET Bearer OR authenticated operator session
 *       (see isJobAuthorized in @/lib/jobs/registry).
 *
 * Query params:
 *   ?batchSize=N  — override default 50 rows per tick
 *   ?maxRetries=N — override default 10 retry cap
 *
 * This route uses the new in-process outbox publisher
 * (src/lib/outbox/publisher.ts) which is decoupled from Next.js and
 * verified by scripts/test-outbox-flow.ts. The legacy
 * /api/jobs/run?job=outbox-publisher handler (EventBus + dynamic
 * consumer classes) is kept for backwards-compat — the two will be
 * merged once the legacy consumer classes are migrated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { tick } from '@/lib/outbox/publisher';
// Side-effect import: registers all in-process consumers with the
// outbox registry. Must be present for tick() to find handlers.
import '@/lib/finance/consumers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  // Operator session — middleware has already validated the token.
  if (request.headers.get('x-tenant-id')) return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // In dev, allow unauthenticated when no secret is set.
    return process.env.NODE_ENV !== 'production';
  }
  const got = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '');
  return got === expected;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const batchSizeRaw = sp.get('batchSize');
  const maxRetriesRaw = sp.get('maxRetries');
  const batchSize = batchSizeRaw ? Math.max(1, Math.min(500, Number(batchSizeRaw))) : undefined;
  const maxRetries = maxRetriesRaw ? Math.max(0, Math.min(100, Number(maxRetriesRaw))) : undefined;

  if (batchSizeRaw && Number.isNaN(batchSize)) {
    return NextResponse.json({ error: 'batchSize must be a number' }, { status: 400 });
  }
  if (maxRetriesRaw && Number.isNaN(maxRetries)) {
    return NextResponse.json({ error: 'maxRetries must be a number' }, { status: 400 });
  }

  // Fresh client — not the Next.js-coupled singleton. Safe to run
  // inside the Vercel serverless process without pulling in
  // next/headers.
  const prisma = new PrismaClient();
  const start = Date.now();
  try {
    const result = await tick(prisma, { batchSize, maxRetries });
    const durationMs = Date.now() - start;
    return NextResponse.json({
      ok: result.failed === 0,
      runAt: new Date().toISOString(),
      durationMs,
      ...result,
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[outbox-publish] tick threw after ${durationMs}ms:`, err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        runAt: new Date().toISOString(),
        durationMs,
      },
      { status: 500 },
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
