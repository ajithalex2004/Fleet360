/**
 * Next.js Edge Middleware — Multi-tenant auth + rate limiting for Fleet360.
 *
 * Responsibilities:
 *  1. Verify xl-session cookie and set x-tenant-id / x-user-id / x-tenant-plan headers
 *  2. Apply per-tenant sliding-window rate limiting
 *  3. Guard API routes (return 401 JSON) and UI routes (redirect to /login)
 *  4. Allow public routes to pass through without verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { RateLimiter } from '@/lib/rate-limiter';
import { verifySession } from '@/lib/tenant-session';
import { proxyToGoBackend } from '@/lib/api-shim';
import { API_VERSION_HEADER, CURRENT_API_VERSION } from '@/lib/api-version';
import {
  PUBLIC_EXACT,
  PUBLIC_PREFIXES,
  PROTECTED_UI_PREFIXES,
} from '@/lib/auth-route-policies';

// ── Rate limiter singleton (module scope = shared across requests) ────────────
const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1_000 });

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

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // 1. Public routes — pass through without any checks
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
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
    return NextResponse.next();
  }

  // 4. Rate limiting — per-tenant + per-path
  const rateLimitKey = `${session.tenantId}:${pathname}`;
  const planLimit = RateLimiter.getLimitForPlan(session.plan);
  const { allowed, remaining, resetMs } = await rateLimiter.check(rateLimitKey, planLimit);

  if (!allowed) {
    const retryAfterSec = Math.ceil((resetMs - Date.now()) / 1000);
    return NextResponse.json(
      {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        retryAfter: retryAfterSec,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(planLimit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(resetMs / 1000)),
        },
      }
    );
  }

  // 5. Inject tenant headers for downstream route handlers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-tenant-id',   session.tenantId);
  requestHeaders.set('x-user-id',     session.userId);
  requestHeaders.set('x-tenant-plan', session.plan);
  requestHeaders.set('x-user-role',   session.role ?? 'TENANT_ADMIN');
  if (session.impersonatedBy) {
    requestHeaders.set('x-impersonated-by', session.impersonatedBy);
  }
  // ENTERPRISE data residency — propagate to route handlers so they can
  // call getPrismaForTenant() without an extra DB lookup per request.
  if (session.dataResidency) {
    requestHeaders.set('x-data-residency', session.dataResidency);
  }

  // 5b. Backwards-compat shim — proxy /api/<migrated-module>/* to the
  // Go backend (/api/v1/<migrated-module>/*). See src/lib/api-shim.ts
  // for the matching rules. Runs AFTER auth so unauthenticated shim
  // requests 401 here without a wasted upstream hop.
  //
  // Pass the rewritten headers so the upstream gets x-tenant-id / etc.
  const shim = await proxyToGoBackend(request, requestHeaders);
  if (shim.proxied && shim.response) {
    // Surface shim identity + rate-limit info on the response too.
    shim.response.headers.set('X-RateLimit-Limit',     String(planLimit));
    shim.response.headers.set('X-RateLimit-Remaining', String(remaining));
    shim.response.headers.set('X-RateLimit-Reset',     String(Math.ceil(resetMs / 1000)));
    return shim.response;
  }

  // 6. Not shimmed — fall through to the Next.js route handler.
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Expose rate limit + API version info in response headers
  response.headers.set('X-RateLimit-Limit',     String(planLimit));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Reset',     String(Math.ceil(resetMs / 1000)));
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
