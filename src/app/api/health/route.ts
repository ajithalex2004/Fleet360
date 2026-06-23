/**
 * GET /api/health
 *
 * Operational probe for monitoring + dev warm-up.
 *
 *   200 { status: 'ok',       db, integrations, release }   — fully healthy
 *   200 { status: 'degraded', db, integrations, release }   — DB ok, optional service missing
 *   503 { status: 'unhealthy', db, release }                — DB unreachable
 *
 * Hit this once after `npm run dev` to warm the Neon pool.
 */

import { NextResponse } from 'next/server';
import { getDatabaseTarget, prisma } from '@/lib/prisma';
import { retryDb } from '@/lib/db-retry';
import { getProductionReadiness } from '@/lib/production-readiness';

export const dynamic = 'force-dynamic'; // never cache

const RELEASE =
  process.env.GIT_COMMIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  'unknown';

export async function GET() {
  const t0 = Date.now();

  let dbStatus: 'connected' | 'error' = 'connected';
  let dbError: string | undefined;
  try {
    await retryDb(() => prisma.$queryRaw`SELECT 1`, { attempts: 3, delayMs: 750 });
  } catch (err) {
    dbStatus = 'error';
    dbError = err instanceof Error ? err.message : String(err);
  }
  const dbLatencyMs = Date.now() - t0;

  if (dbStatus === 'error') {
    return NextResponse.json(
      {
        status: 'unhealthy',
        db: { status: 'error', latencyMs: dbLatencyMs, error: dbError, target: getDatabaseTarget() },
        release: RELEASE,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  // Required readiness gaps make health degraded; recommended gaps remain visible.
  const readiness = getProductionReadiness();
  const status = readiness.status === 'ready' ? 'ok' : 'degraded';

  return NextResponse.json({
    status,
    db: { status: dbStatus, latencyMs: dbLatencyMs, target: getDatabaseTarget() },
    integrations: readiness.integrations,
    readiness: {
      status: readiness.status,
      missingRequired: readiness.missingRequired,
      missingRecommended: readiness.missingRecommended,
      missingOptional: readiness.missingOptional,
      checks: readiness.checks,
    },
    missingConfig: [
      ...readiness.missingRequired,
      ...readiness.missingRecommended,
      ...readiness.missingOptional,
    ],
    release: RELEASE,
    timestamp: new Date().toISOString(),
  });
}
