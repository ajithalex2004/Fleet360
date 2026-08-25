/**
 * POST /api/push/run-scheduler
 *
 * Manually triggers the trip-reminder scheduler. For production this
 * endpoint should be hit by a cron (Vercel Cron, GitHub Actions, or an
 * external scheduler) every 1-2 minutes. The reminder window is
 * [lead-2, lead+2] minutes around the configured lead time, so a 1-min
 * cron catches every trip.
 *
 * AUTH — fails closed in production.
 *
 * Accepted, in order of preference:
 *   Authorization: Bearer <PUSH_CRON_SECRET>   (matches every other cron
 *                                               route in this codebase)
 *   x-push-cron-secret: <PUSH_CRON_SECRET>
 *   ?secret=<PUSH_CRON_SECRET>                 (discouraged — see below)
 *   an operator session (x-tenant-id set by middleware)
 *
 * If PUSH_CRON_SECRET is unset the endpoint refuses to run in production
 * and returns 503. It previously wrapped the whole check in `if (secret)`,
 * so an unset secret meant NO authentication at all: any caller who could
 * reach the server could fan push notifications out to every tenant, since
 * a null tenantId makes runTripReminders() iterate all of them. The secret
 * is not set in .env, .env.local or .env.example, so that was the live
 * configuration rather than a hypothetical.
 *
 * Outside production an unset secret still allows the call, matching
 * api/cron/outbox-publish and keeping the "just POST it in dev" workflow
 * below intact.
 *
 * The ?secret= form is kept for compatibility with any cron already
 * configured that way, but query strings land in access logs, proxy logs
 * and Referer headers. Prefer the Authorization header.
 *
 * Use this in dev too — no point standing up a real cron when you can
 * just POST it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTripReminders } from '@/lib/push/scheduler';

type AuthResult = { ok: true } | { ok: false; status: number; error: string };

function authorize(req: NextRequest): AuthResult {
  // Operator session — middleware has already validated the token.
  if (req.headers.get('x-tenant-id')) return { ok: true };

  const expected = process.env.PUSH_CRON_SECRET;

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      // Fail closed. Returning 503 rather than 401/403 is deliberate: the
      // caller's credentials aren't the problem, the deployment is
      // misconfigured, and that should look like an outage to whoever is
      // watching rather than a routine auth rejection.
      return {
        ok: false,
        status: 503,
        error: 'Scheduler is not configured: PUSH_CRON_SECRET is unset.',
      };
    }
    return { ok: true };
  }

  const supplied =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? req.headers.get('x-push-cron-secret')
    ?? req.nextUrl.searchParams.get('secret');

  if (supplied !== expected) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const auth = authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Null tenantId is intentional — the system job helper then iterates every
  // active tenant. That breadth is exactly why the auth above must fail closed.
  const tenantId =
    req.headers.get('x-tenant-id')
    ?? req.nextUrl.searchParams.get('tenantId')
    ?? null;

  const result = await runTripReminders(tenantId);
  return NextResponse.json({ ok: true, ...result });
}
