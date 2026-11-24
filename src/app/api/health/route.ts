/**
 * GET /api/health
 *
 * Public operational probe for external monitoring and load balancers.
 *
 *   200 { status: 'ok' | 'degraded', db, schema, storage, services, backend, timestamp }
 *   503 { status: 'unhealthy', db, timestamp }
 *
 * Security boundary (M1-P0-1):
 * This endpoint is intentionally public and MUST NEVER expose privileged
 * operational diagnostics (security/MFA/brute-force metrics, DB pool /
 * pg_stat_activity query details, AI or Google Maps spending, partial API keys,
 * enterprise bridge logs, job queues, or secret-integration configuration lists).
 * Full diagnostics are served exclusively on SUPER_ADMIN-gated GET /api/admin/health.
 */

import { NextResponse } from 'next/server';
import { ensureDbConnected, prisma } from '@/lib/prisma';
import { schemaReport } from '@/lib/db/schema-registry';
import { storageStatus } from '@/lib/storage/health';

export const dynamic = 'force-dynamic'; // never cache

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

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
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const [schema, storage] = await Promise.all([
    schemaReport(),
    storageStatus(),
  ]);

  // Optional Go backend readiness probe: surface connectivity status without
  // leaking internal URLs, error strings, or deployment metadata.
  let backendInfo: { status: 'ready' | 'not_ready' | 'unreachable' } | undefined;
  let goBackendServiceStatus: 'ok' | 'degraded' = 'ok';
  const goBackendUrl = process.env.GO_BACKEND_URL;
  if (goBackendUrl) {
    try {
      const bRes = await fetch(new URL('/readyz', goBackendUrl), {
        cache: 'no-store',
        signal: AbortSignal.timeout(2000),
      });
      const bData = await bRes.json().catch(() => null) as Record<string, unknown> | null;
      const isReady = bRes.ok && bData?.status === 'ready';
      backendInfo = { status: isReady ? 'ready' : 'not_ready' };
      if (!isReady) {
        goBackendServiceStatus = 'degraded';
      }
    } catch (bErr) {
      console.error('[api/health] backend readiness check failed:', bErr);
      backendInfo = { status: 'unreachable' };
      goBackendServiceStatus = 'degraded';
    }
  }

  const status: 'ok' | 'degraded' =
    schema.status === 'incomplete' ||
    !storage.durable ||
    !storage.ok ||
    goBackendServiceStatus === 'degraded'
      ? 'degraded'
      : 'ok';

  return NextResponse.json(
    {
      status,
      db: { status: dbStatus, latencyMs: dbLatencyMs },
      schema: { status: schema.status, missing: schema.missingCount },
      storage: { backend: storage.backend, durable: storage.durable, ok: storage.ok },
      services: {
        goBackend: goBackendServiceStatus,
      },
      ...(backendInfo ? { backend: backendInfo } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
