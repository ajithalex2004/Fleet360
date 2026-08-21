/**
 * Rate-limit scope routing — the shared logic for deciding WHICH bucket
 * a request should count against.
 *
 * Two consumers today:
 *   1. src/middleware.ts — for the normal tenant/session-authenticated
 *      API surface. Every request there passes through computeRateLimit()
 *      to derive the per-tenant/path bucket (or per-driver telemetry
 *      bucket, if the path is in TELEMETRY_CATEGORIES).
 *
 *   2. Driver-app telemetry route handlers (heartbeat, behavior-events)
 *      — these live under /api/driver-app/ which is a PUBLIC_PREFIX,
 *      i.e. middleware skips them. They call applyDriverTelemetryLimit()
 *      directly, which uses the same TELEMETRY_CATEGORIES map, so the
 *      per-driver bucket definitions stay in ONE place.
 *
 * ── R2 (2026-08-14): why separate accounting for driver telemetry ────────────
 *
 * Old design: every authenticated request shared a `${tenantId}:${pathname}`
 * bucket sized to the plan's requests/minute limit. Driver telemetry
 * (heartbeat, behavior-events) fires every few seconds from every
 * on-shift driver device, so at ~17 concurrent drivers a single tenant
 * exhausted its ENTERPRISE 1000/min bucket for /api/driver-app/heartbeat
 * and every OTHER API for that tenant (including login) failed until the
 * window rolled over.
 *
 * New design: telemetry paths route to their own bucket keyed on
 * driverId + category:
 *     `telemetry:${tenantId}:${driverId}:${category}`
 * with per-category limits tuned to the actual device cadence. A single
 * flooding device only blocks itself for its category; other drivers,
 * other categories, and normal APIs are unaffected.
 */

import { NextResponse } from 'next/server';
import { RateLimiter } from '@/lib/rate-limiter';

// ── Shared limiter singleton ─────────────────────────────────────────────────
//
// This is the SAME limiter instance middleware.ts owns — importing the
// singleton keeps counters shared across both call sites. If a Redis
// backend is configured, counting is global across all serverless
// instances; without Redis, in-process counters apply per-instance.
const _rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1_000 });
export function getRateLimiter(): RateLimiter {
  return _rateLimiter;
}

// ── Telemetry category registry ──────────────────────────────────────────────

export interface TelemetryCategory {
  category:    string;   // logical bucket name (also part of the key)
  limitPerMin: number;   // per-driver, per-minute request cap
}

/**
 * Every path prefix that should route to a per-driver telemetry bucket.
 * Adding a new telemetry endpoint = one row here and one line in the
 * route handler to call applyDriverTelemetryLimit().
 */
export const TELEMETRY_CATEGORIES: Readonly<Record<string, TelemetryCategory>> = {
  // Heartbeat: driver-app pings every 15s baseline = 4/min. 60/min gives
  // ~4× headroom for network retries and burst re-connects, still
  // catches a flood loop within a minute.
  '/api/driver-app/heartbeat':       { category: 'heartbeat',       limitPerMin:  60 },
  // Behaviour events: harsh brake / rapid accel / GPS anomaly. Sparse
  // in steady state; can burst when a driver enters heavy traffic.
  // 120/min covers ~2 events/sec with room to spare.
  '/api/driver-app/behavior-events': { category: 'behavior-events', limitPerMin: 120 },
};

export function telemetryConfigFor(pathname: string): TelemetryCategory | null {
  for (const [prefix, cfg] of Object.entries(TELEMETRY_CATEGORIES)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return cfg;
  }
  return null;
}

// ── Key + limit derivation ───────────────────────────────────────────────────

export interface RateLimitScope {
  key:   string;
  limit: number;
  scope: 'telemetry' | 'tenant-path';
}

/**
 * Compute the rate-limit key + limit for a request going through the
 * normal middleware path (tenant/session-authenticated). Not used for
 * driver-app telemetry paths — those are PUBLIC in middleware and use
 * applyDriverTelemetryLimit() from their route handlers instead.
 */
export function computeRateLimit(
  pathname: string,
  session: { tenantId: string; userId: string; plan: string },
): RateLimitScope {
  const telemetry = telemetryConfigFor(pathname);
  if (telemetry) {
    return {
      key:   `telemetry:${session.tenantId}:${session.userId}:${telemetry.category}`,
      limit: telemetry.limitPerMin,
      scope: 'telemetry',
    };
  }
  return {
    key:   `${session.tenantId}:${pathname}`,
    limit: RateLimiter.getLimitForPlan(session.plan),
    scope: 'tenant-path',
  };
}

// ── Route-handler helper for driver-app telemetry ────────────────────────────

/**
 * Apply the per-driver telemetry rate-limit inside a route handler.
 *
 * Returns a 429 NextResponse when the driver's category bucket is
 * exhausted, or null when the request should continue. Call at the top
 * of the handler, right after driver-session verification.
 *
 * The rate-limit key includes tenant + driver + category so:
 *   - Driver A flooding heartbeat can't block Driver B (per-driver)
 *   - Driver A flooding heartbeat can't block their own behavior-events
 *     (per-category)
 *   - No consumption of the tenant's plan budget (this is a device
 *     operational limit, not a billing metric)
 */
export async function applyDriverTelemetryLimit(
  pathname: string,
  driverCtx: { tenantId: string; userId: string },
): Promise<NextResponse | null> {
  const telemetry = telemetryConfigFor(pathname);
  if (!telemetry) return null;   // caller mis-invoked; be permissive

  const key = `telemetry:${driverCtx.tenantId}:${driverCtx.userId}:${telemetry.category}`;
  const { allowed, remaining, resetMs } = await _rateLimiter.check(key, telemetry.limitPerMin);
  if (allowed) return null;

  const retryAfterSec = Math.ceil((resetMs - Date.now()) / 1000);
  return NextResponse.json(
    {
      error:      'Too Many Requests',
      message:    `Telemetry rate limit exceeded for driver ${driverCtx.userId}. Retry after ${retryAfterSec}s`,
      retryAfter: retryAfterSec,
      scope:      'telemetry',
    },
    {
      status: 429,
      headers: {
        'Retry-After':          String(retryAfterSec),
        'X-RateLimit-Limit':    String(telemetry.limitPerMin),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset':    String(Math.ceil(resetMs / 1000)),
        'X-RateLimit-Scope':    'telemetry',
      },
    },
  );
}
