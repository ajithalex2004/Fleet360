/**
 * Next.js Edge Middleware — Multi-tenant auth + rate limiting for XL AI Smart Mobility.
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

// ── Rate limiter singleton (module scope = shared across requests) ────────────
const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1_000 });

// Cleanup every 5 minutes to prevent unbounded memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);
}

// ── Public routes — bypass auth entirely ─────────────────────────────────────
const PUBLIC_EXACT: Set<string> = new Set([
  '/',
  '/login',
  '/onboarding',
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/forgot-password',
  '/reset-password',
  '/api/tenants/provision',
  '/api/tenants/verify-domain',
  '/api/admin/session',
  '/api/health',             // DB warm-up probe — no auth needed
  // /api/auth/me is NOT public — it must receive the injected headers
]);

const PUBLIC_PREFIXES: string[] = [
  '/login',
  '/onboarding/',
  '/track/',
  '/api/admin/session',
  '/api/setup/',      // one-time setup endpoints — protected by SETUP_SECRET, not session
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// ── UI routes that require auth (redirect on failure) ────────────────────────
const PROTECTED_UI_PREFIXES: string[] = [
  '/platform',
  '/fleet',
  '/rac',
  '/rental',
  '/leasing',
  '/logistics',
  '/staff-transport',
  '/school-bus',
  '/ambulance',
  '/finance',
  '/dispatch',
  '/incidents',
  '/compliance',
  '/agents',
  '/admin',
];

function isProtectedUiRoute(pathname: string): boolean {
  return PROTECTED_UI_PREFIXES.some(prefix => pathname.startsWith(prefix));
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
    if (isProtectedUiRoute(pathname)) {
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
  const { allowed, remaining, resetMs } = rateLimiter.check(rateLimitKey, planLimit);

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

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Expose rate limit info in response headers
  response.headers.set('X-RateLimit-Limit',     String(planLimit));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Reset',     String(Math.ceil(resetMs / 1000)));

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
