/**
 * GET /api/health
 *
 * Operational probe for monitoring + dev warm-up.
 *
 *   200 { status: 'ok',       db, integrations, release }   — fully healthy
 *   200 { status: 'degraded', db, integrations, release }   — DB ok, optional service missing
 *   503 { status: 'unhealthy', db, release }                — DB unreachable
 *
 * `schema` reports whether every table/column the app checks at runtime
 * exists (src/lib/db/schema-registry.ts); a missing one makes the status
 * "degraded". Names are on Admin > Schema status, not here (public probe).
 * `storage` reports whether uploads are durable and working; local disk in
 * production (lost on every redeploy) makes the status "degraded".
 *
 * Hit this once after `npm run dev` to warm the Neon pool.
 */

import { NextResponse } from 'next/server';
import { ensureDbConnected, prisma } from '@/lib/prisma';
import { schemaReport } from '@/lib/db/schema-registry';
import { storageStatus } from '@/lib/storage/health';
import { getBackgroundJobsAndOutboxHealth } from '@/lib/jobs/health';
import {
  getDbPoolMetrics,
  getEnterpriseBridgeMetrics,
  getSecurityHealthMetrics,
  getAiHealthAndSpendingMetrics,
  getGoogleMapsAndApisSpendingMetrics,
} from '@/lib/health/extended-metrics';

export const dynamic = 'force-dynamic'; // never cache

const RELEASE =
  process.env.GIT_COMMIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  'unknown';

export async function GET() {
  const t0 = Date.now();

  let dbStatus: 'connected' | 'error' = 'connected';
  try {
    await ensureDbConnected({ force: true, retries: 2, timeoutMs: 2_500 });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'error';
    // Log the real error server-side only — never expose internals (DSNs, hostnames,
    // stack traces) to an unauthenticated caller of this endpoint.
    console.error('[api/health] database check failed:', err);
  }
  const dbLatencyMs = Date.now() - t0;

  if (dbStatus === 'error') {
    return NextResponse.json(
      {
        status: 'unhealthy',
        db: { status: 'error', latencyMs: dbLatencyMs, error: 'database unreachable' },
        release: RELEASE,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  // Optional integration checks — missing keys make us "degraded", not failed.
  const integrations = {
    stripe:        !!process.env.STRIPE_SECRET_KEY,
    sendgrid:      !!process.env.SENDGRID_API_KEY && !!(process.env.EMAIL_FROM ?? process.env.SMTP_FROM),
    sentry:        !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),
    ssoEncryption: !!process.env.SSO_ENCRYPTION_KEY,
    appUrl:        !!process.env.NEXT_PUBLIC_APP_URL,
    sessionSecret: !!process.env.SESSION_SECRET,
  };
  const missing = Object.entries(integrations).filter(([, v]) => !v).map(([k]) => k);
  const schema  = await schemaReport();
  const storage = await storageStatus();

  // Background jobs & outbox status
  let jobsAndOutbox: Awaited<ReturnType<typeof getBackgroundJobsAndOutboxHealth>> | null = null;
  try {
    jobsAndOutbox = await getBackgroundJobsAndOutboxHealth();
  } catch (err) {
    console.error('[api/health] jobs/outbox health check failed:', err);
  }

  // Extended Metrics: DB Pool, Enterprise Bridge, Security, AI & Maps Spending
  let dbPoolData: Awaited<ReturnType<typeof getDbPoolMetrics>> | null = null;
  let enterpriseData: Awaited<ReturnType<typeof getEnterpriseBridgeMetrics>> | null = null;
  let securityData: Awaited<ReturnType<typeof getSecurityHealthMetrics>> | null = null;
  let aiData: Awaited<ReturnType<typeof getAiHealthAndSpendingMetrics>> | null = null;
  let mapsData: Awaited<ReturnType<typeof getGoogleMapsAndApisSpendingMetrics>> | null = null;
  try {
    [dbPoolData, enterpriseData, securityData, aiData, mapsData] = await Promise.all([
      getDbPoolMetrics(),
      getEnterpriseBridgeMetrics(),
      getSecurityHealthMetrics(),
      getAiHealthAndSpendingMetrics(),
      getGoogleMapsAndApisSpendingMetrics(),
    ]);
  } catch (err) {
    console.error('[api/health] extended metrics failed:', err);
  }

  const jobsDegraded =
    jobsAndOutbox?.jobRuns24h.status === 'critical' ||
    jobsAndOutbox?.outbox.status === 'critical' ||
    dbPoolData?.status === 'critical' ||
    securityData?.status === 'critical';

  const status =
    missing.length > 0 ||
    schema.status === 'incomplete' ||
    !storage.durable ||
    !storage.ok ||
    jobsDegraded
      ? 'degraded'
      : 'ok';

  // Optional Go backend readiness probe
  let backendInfo: { status: string; version?: string; error?: string } | undefined;
  const goBackendUrl = process.env.GO_BACKEND_URL;
  if (goBackendUrl) {
    try {
      const bRes = await fetch(new URL('/readyz', goBackendUrl), {
        cache: 'no-store',
        signal: AbortSignal.timeout(2000),
      });
      const bData = await bRes.json();
      backendInfo = {
        status: bData.status ?? (bRes.ok ? 'ready' : 'not_ready'),
        version: bData.version,
      };
    } catch (bErr) {
      console.error('[api/health] backend readiness check failed:', bErr);
      backendInfo = { status: 'unreachable' };
    }
  }

  return NextResponse.json({
    status,
    db: { status: dbStatus, latencyMs: dbLatencyMs },
    integrations,
    missingConfig: missing,
    schema: { status: schema.status, missing: schema.missingCount },
    storage: { backend: storage.backend, durable: storage.durable, ok: storage.ok },
    release: RELEASE,
    backend: backendInfo,
    jobs: jobsAndOutbox
      ? {
          scheduler: jobsAndOutbox.scheduler.status,
          isTicking: jobsAndOutbox.scheduler.isTicking,
          failures24h: jobsAndOutbox.jobRuns24h.failed24h,
          pendingOutbox: jobsAndOutbox.outbox.pendingCount,
          outboxLagMs: jobsAndOutbox.outbox.lagMs,
        }
      : undefined,
    dbPool: dbPoolData ?? undefined,
    enterpriseBridge: enterpriseData ?? undefined,
    security: securityData ?? undefined,
    aiSpending: aiData ?? undefined,
    googleApisSpending: mapsData ?? undefined,
    timestamp: new Date().toISOString(),
  });
}
