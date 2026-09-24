/**
 * Next.js Edge Middleware — Multi-tenant auth + rate limiting for Fleet360.
 *
 * Responsibilities:
 *  1. Verify xl-session cookie and set x-tenant-id / x-user-id / x-tenant-plan headers
 *  2. Apply per-tenant sliding-window rate limiting
 *  3. Guard API routes (return 401 JSON) and UI routes (redirect to /login)
 *  4. Allow public routes to pass through without verification
 *  5. Remove client-sent identity headers from every request that isn't
 *     from the platform's own scheduler (src/lib/identity-headers.ts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/tenant-session';
import { proxyToGoBackend } from '@/lib/api-shim';
import { API_VERSION_HEADER, CURRENT_API_VERSION } from '@/lib/api-version';
import {
  PUBLIC_EXACT,
  PUBLIC_PREFIXES,
  PROTECTED_UI_PREFIXES,
} from '@/lib/auth-route-policies';
import { computeRateLimit, getRateLimiter } from '@/lib/rate-limit-scope';
import { stripIdentityHeaders, withVerifiedIdentity } from '@/lib/identity-headers';
import { isAdminApiPath, requiredAdminLevel, roleSatisfies } from '@/lib/admin-access';
import { canServeResidency } from '@/lib/data-residency';

// ── Rate limiter singleton (shared with driver-app telemetry handlers) ───────
// Owned by @/lib/rate-limit-scope so both middleware and the route-handler
// helper count against the same bucket instance.
const rateLimiter = getRateLimiter();

// Cleanup every 5 minutes to prevent unbounded memory growth.
//
// Why the .unref() guard: module-scope setInterval in Next.js Edge middleware
// keeps a strong reference to the timer, which prevents the Node event loop
// from exiting cleanly in tests and on hot-reload. Edge runtime doesn't have
// process.unref, but the Node runtime (used in tests / dev) does. Calling
// `interval.unref?.()` opts out of keeping the loop alive, so the cleanup
// tick runs but doesn't pin the process open.
if (typeof setInterval !== 'undefined') {
  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);
  // Edge runtime's setInterval doesn't return an object with .unref(); guard
  // so this stays portable across runtimes.
  const maybeUnrefable = cleanupInterval as { unref?: () => void };
  maybeUnrefable.unref?.();
}

// ── Public routes — bypass auth entirely ─────────────────────────────────────
// Lists imported from src/lib/auth-route-policies.ts. Adding a route?
// Update the lists there so the architectural test stays in sync.

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// Rate-limit routing (per-tenant/path for normal APIs, per-driver
// telemetry buckets for the fixed telemetry paths) lives in
// @/lib/rate-limit-scope. See that file for the full design rationale.
//
// Middleware only applies computeRateLimit() to the tenant/session
// path here — driver-app telemetry paths are in PUBLIC_PREFIXES so
// they bypass middleware entirely; the route handlers themselves call
// applyDriverTelemetryLimit() from rate-limit-scope, using the SAME
// TELEMETRY_CATEGORIES table so the two accounting paths never drift.

/**
 * True when the request carries `Authorization: Bearer <CRON_SECRET>`.
 * Such a request bypasses the session requirement on API routes: the job
 * scheduler (/api/jobs/run → sweep-adapters.ts forwardToRoute()) calls
 * routes like /api/leasing/documents/sweep-expiry with an internal fetch()
 * that carries no session cookie, so without this they would be 401'd
 * before the route's own CRON_SECRET check ran. Never matches when
 * CRON_SECRET is unset, so there is no bypass-by-absence.
 */
function hasValidCronSecret(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return got === cronSecret;
}

function isProtectedUiRoute(pathname: string): boolean {
  return PROTECTED_UI_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

/**
 * Fail closed for browser document navigations. This protects a newly added
 * UI page even if its prefix was accidentally omitted from the explicit route
 * policy. Public pages return before this check; APIs, RSC requests and static
 * assets retain their existing handling below.
 */
function isDocumentNavigation(request: NextRequest): boolean {
  if (request.headers.get('sec-fetch-dest') === 'document') return true;
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('text/x-component');
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Driver-app routes are public (device and biometric login flows run before
 * any session exists), so middleware does not require a session for them.
 * When the request does carry a valid driver or operator session cookie,
 * inject that verified identity so requireAuthorizedTenant() in the handler
 * resolves the caller's real tenant. Same cookie precedence as
 * getDriverTenantContext() in src/lib/driver-session.ts.
 */
async function verifyDriverAppSession(request: NextRequest) {
  for (const name of ['xl-driver-session', 'xl-session']) {
    const token = request.cookies.get(name)?.value;
    if (!token) continue;
    const session = await verifySession(token).catch(() => null);
    if (session) return session;
  }
  return null;
}

/**
 * Refuses a session whose tenant's data must stay in a region this deployment
 * does not serve (see src/lib/data-residency.ts). Route handlers read and
 * write the primary database, so serving such a tenant here would put its
 * data in the wrong region. Fail closed with 503 instead.
 */
function residencyRefusal(pathname: string, dataResidency: string | undefined): NextResponse | null {
  if (canServeResidency(dataResidency)) return null;
  const message =
    `This organisation's data must be kept in the ${dataResidency} region, which this ` +
    'deployment does not serve. Please use your region-specific address or contact support.';
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Data residency region unavailable', code: 'DATA_RESIDENCY_UNAVAILABLE', message },
      { status: 503 },
    );
  }
  return new NextResponse(message, { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Identity headers (x-tenant-id, x-user-id, x-user-role, …) are only
  // trustworthy when middleware sets them from a verified credential. Every
  // branch below forwards either these sanitized headers or headers rebuilt
  // from a verified session, never the client's copies. See
  // src/lib/identity-headers.ts.
  const sanitizedHeaders = stripIdentityHeaders(request.headers);

  // 0. System cron — a caller holding CRON_SECRET is the platform itself
  // (the job scheduler forwards x-tenant-id to scope a run to one tenant,
  // see src/lib/jobs/sweep-adapters.ts), so its headers pass unchanged.
  // Checked before the public-route branch so that trust also applies to
  // public cron/job routes. Scoped to /api/ and to an exact match against
  // the server's own CRON_SECRET; if that env var is unset this never
  // matches.
  if (pathname.startsWith('/api/') && hasValidCronSecret(request)) {
    return NextResponse.next();
  }

  // 1. Public routes — no session required. Client-sent identity headers
  // are removed; driver-app requests get the identity of their verified
  // session cookie, if they have one.
  if (isPublicRoute(pathname)) {
    if (pathname.startsWith('/api/driver-app/')) {
      const driverSession = await verifyDriverAppSession(request);
      if (driverSession) {
        const refusal = residencyRefusal(pathname, driverSession.dataResidency);
        if (refusal) return refusal;
        return NextResponse.next({
          request: { headers: withVerifiedIdentity(request.headers, driverSession) },
        });
      }
    }
    return NextResponse.next({ request: { headers: sanitizedHeaders } });
  }

  // 2. Verify session cookie
  const token = request.cookies.get('xl-session')?.value;
  const session = token ? await verifySession(token) : null;

  // 3. Handle unauthenticated requests
  if (!session) {
    // API routes → 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Valid session required' },
        { status: 401 }
      );
    }

    // Protected UI routes → redirect to /login
    if (isProtectedUiRoute(pathname) || isDocumentNavigation(request)) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      return NextResponse.redirect(url);
    }

    // Unknown route — allow through (handles static paths, _next, etc.)
    return NextResponse.next({ request: { headers: sanitizedHeaders } });
  }

  // 3b. Data residency — refuse tenants whose region this deployment does
  // not serve, before anything touches the database on their behalf.
  const residencyBlock = residencyRefusal(pathname, session.dataResidency);
  if (residencyBlock) return residencyBlock;

  // 4. Rate limiting — routed to per-tenant/path OR per-driver-telemetry
  //    bucket depending on the path. See TELEMETRY_CATEGORIES above.
  const { key: rateLimitKey, limit: effectiveLimit, scope: rateLimitScope } =
    computeRateLimit(pathname, session);
  const { allowed, remaining, resetMs } = await rateLimiter.check(rateLimitKey, effectiveLimit);

  if (!allowed) {
    const retryAfterSec = Math.ceil((resetMs - Date.now()) / 1000);
    return NextResponse.json(
      {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        retryAfter: retryAfterSec,
        scope: rateLimitScope,   // 'telemetry' | 'tenant-path' — helps clients diagnose
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(effectiveLimit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(resetMs / 1000)),
          'X-RateLimit-Scope': rateLimitScope,
        },
      }
    );
  }

  // 4b. Admin API role policy — see src/lib/admin-access.ts. Checked here so
  // an admin handler that forgets its own role check is still protected;
  // unlisted admin routes require SUPER_ADMIN.
  if (isAdminApiPath(pathname)) {
    const level = requiredAdminLevel(pathname, request.method);
    if (level && !roleSatisfies(session.role, level)) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          message: level === 'platform'
            ? 'This action requires a platform administrator.'
            : 'This action requires a tenant administrator.',
        },
        { status: 403 },
      );
    }
  }

  // 5. Inject tenant headers for downstream route handlers. Built on top of
  // the stripped headers so optional ones (x-impersonated-by,
  // x-data-residency) can't be supplied by the client when the session
  // doesn't set them. Only sessions whose residency this deployment serves
  // get here (step 3b).
  const requestHeaders = withVerifiedIdentity(request.headers, session);

  // 5b. Backwards-compat shim — proxy /api/<migrated-module>/* to the
  // Go backend (/api/v1/<migrated-module>/*). See src/lib/api-shim.ts
  // for the matching rules. Runs AFTER auth so unauthenticated shim
  // requests 401 here without a wasted upstream hop.
  //
  // Pass the rewritten headers so the upstream gets x-tenant-id / etc.
  const shim = await proxyToGoBackend(request, requestHeaders);
  if (shim.proxied && shim.response) {
    // Surface shim identity + rate-limit info on the response too.
    shim.response.headers.set('X-RateLimit-Limit',     String(effectiveLimit));
    shim.response.headers.set('X-RateLimit-Remaining', String(remaining));
    shim.response.headers.set('X-RateLimit-Reset',     String(Math.ceil(resetMs / 1000)));
    shim.response.headers.set('X-RateLimit-Scope',     rateLimitScope);
    return shim.response;
  }

  // 6. Not shimmed — fall through to the Next.js route handler.
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Expose rate limit + API version info in response headers
  response.headers.set('X-RateLimit-Limit',     String(effectiveLimit));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Reset',     String(Math.ceil(resetMs / 1000)));
  response.headers.set('X-RateLimit-Scope',     rateLimitScope);
  response.headers.set(API_VERSION_HEADER,       String(CURRENT_API_VERSION));

  return response;
}

// ── Matcher config — exclude Next.js internals ───────────────────────────────
export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     *  - _next/static (static files)
     *  - _next/image  (image optimisation)
     *  - favicon.ico
     *  - /static/* (public static assets)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|static/).*)',
  ],
};
