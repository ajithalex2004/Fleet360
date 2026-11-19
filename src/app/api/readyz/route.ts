import { NextResponse } from 'next/server';
import { prisma, ensureDbConnected } from '@/lib/prisma';
import { withPlatformAdmin, type TxClient } from '@/lib/rls';
import { schemaReport } from '@/lib/db/schema-registry';

export const dynamic = 'force-dynamic';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

export async function GET() {
  // 1. Database connectivity check: Next.js readiness requires active DB connectivity
  try {
    await ensureDbConnected({ force: true, retries: 2, timeoutMs: 2_500 });
    await withPlatformAdmin(prisma, async (tx: TxClient) => {
      await tx.$queryRaw`SELECT 1`;
    });
  } catch (err) {
    console.error('[api/readyz] database check failed:', err);
    return NextResponse.json(
      { status: 'not_ready', error: 'database unreachable' },
      { status: 503 },
    );
  }

  // 2. Database schema completeness check: pending migrations make Next.js not ready
  const schema = await schemaReport({ fresh: true });
  if (schema.status === 'incomplete') {
    console.error('[api/readyz] schema incomplete:', JSON.stringify(schema.missing));
    return NextResponse.json(
      { status: 'not_ready', error: 'database schema incomplete — apply pending migrations', missingObjects: schema.missingCount },
      { status: 503 },
    );
  }

  // 3. Optional Go backend version discovery: decoupled from readiness
  // (unreachability or degraded Go service does NOT cause 503)
  let version: string | undefined;
  try {
    const upstreamUrl = new URL('/readyz', GO_BACKEND_URL);
    const res = await fetch(upstreamUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
      headers: {
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (typeof data?.version === 'string') {
        version = data.version;
      }
    }
  } catch (err) {
    // Upstream Go check failure is logged server-side only. Next.js readiness is decoupled.
    console.warn('[api/readyz] optional Go backend probe skipped/unreachable:', err);
  }

  return NextResponse.json(
    {
      status: 'ready',
      ...(version ? { version } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
