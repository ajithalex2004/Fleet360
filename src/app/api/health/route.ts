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
import { prisma } from '@/lib/prisma';

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
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'error';
    dbError = err instanceof Error ? err.message : String(err);
  }
  const dbLatencyMs = Date.now() - t0;

  if (dbStatus === 'error') {
    return NextResponse.json(
      {
        status: 'unhealthy',
        db: { status: 'error', latencyMs: dbLatencyMs, error: dbError },
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
  const status  = missing.length > 0 ? 'degraded' : 'ok';

  return NextResponse.json({
    status,
    db: { status: dbStatus, latencyMs: dbLatencyMs },
    integrations,
    missingConfig: missing,
    release: RELEASE,
    timestamp: new Date().toISOString(),
  });
}
