/**
 * Next.js Edge Middleware — Multi-tenant auth + rate limiting for Fleet360.
 *
 * Responsibilities:
 *  1. Verify xl-session cookie and set x-tenant-id / x-user-id / x-tenant-plan headers
 *  2. Apply per-tenant sliding-window rate limiting
 *  3. Guard API routes (return 401 JSON) and UI routes (redirect to /login)
 *  4. Allow public routes to pass through without verification
 *  5. Remove client-sent identity headers from every request; only verified
 *     sessions or narrowly scoped scheduler requests may inject identity.
 */

import { bearerToken, secretsEqual } from '@/lib/secure-compare';
import { NextRequest, NextResponse } from 'next/server';
import { PARTNER_HOME, PARTNER_TENANT_ROLE, partnerRoleAllows } from '@/lib/exchange/partner-role';
import { verifySession } from '@/lib/tenant-session';
import { proxyToGoBackend } from '@/lib/api-shim';
import { API_VERSION_HEADER, CURRENT_API_VERSION } from '@/lib/api-version';
import {
  PUBLIC_EXACT,
  PUBLIC_PREFIXES,
  PROTECTED_UI_PREFIXES,
  CRON_SESSION_BYPASS_PATHS,
} from '@/lib/auth-route-policies';
import { computeRateLimit, getRateLimiter } from '@/lib/rate-limit-scope';
import { stripIdentityHeaders, withVerifiedIdentity } from '@/lib/identity-headers';
import { storedFileKey } from '@/lib/storage/stored-file-path';
import { isAdminApiPath, requiredAdminLevel, roleSatisfies } from '@/lib/admin-access';
import { authzMode, decide, POLICY_VERSION } from '@/lib/authz/policy';
import { DRY_RUN_HEADER, dryRunHeaders } from '@/lib/authz/dry-run';
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
 * Such a request may bypass the session requirement on allowlisted POST routes: the job
 * scheduler (/api/jobs/run → sweep-adapters.ts forwardToRoute()) calls
 * routes like /api/leasing/documents/sweep-expiry with an internal fetch()
 * that carries no session cookie, so without this they would be 401'd
 * before the route's own CRON_SECRET check ran. Never matches when
 * CRON_SECRET is unset, so there is no bypass-by-absence.
 */
function hasValidCronSecret(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return secretsEqual(bearerToken(request.headers), cronSecret);
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


/** A PARTNER session asked for something outside the partner portal (see src/lib/exchange/partner-role.ts). */
function partnerForbidden(): NextResponse {
  return NextResponse.json(
    { error: 'Forbidden', message: 'Partner accounts can only use the partner portal.' },
    { status: 403 },
  );
}

function partnerHomeRedirect(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = PARTNER_HOME;
  url.search = '';
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Identity headers (x-tenant-id, x-user-id, x-user-role, …) are only
  // trustworthy when middleware sets them from a verified credential. Every
  // branch below forwards either these sanitized headers or headers rebuilt
  // from a verified session, never the client's copies. See
  // src/lib/identity-headers.ts.
  const sanitizedHeaders = stripIdentityHeaders(request.headers);

  // Scheduler credentials authorize only exact POST sweep targets, never
  // arbitrary APIs or caller-controlled user/role impersonation.
  if (request.method === 'POST' && CRON_SESSION_BYPASS_PATHS.includes(pathname) && hasValidCronSecret(request)) {
    const target = request.headers.get('x-tenant-id') ?? request.nextUrl.searchParams.get('tenantId');
    if (target) {
      if (!/^[a-zA-Z0-9_-]+$/.test(target)) {
        return NextResponse.json({ error: 'Invalid tenant selector' }, { status: 400 });
      }
      sanitizedHeaders.set('x-tenant-id', target);
      sanitizedHeaders.set('x-user-id', 'system:cron');
      sanitizedHeaders.set('x-user-role', 'SYSTEM_JOB');
    }
    return NextResponse.next({ request: { headers: sanitizedHeaders } });
  }

  // 0b. Stored files. /uploads/* used to be served straight from public/,
  // skipping every authorization check. Both URL forms now go to the
  // /api/files handler, which authorizes the caller against the file's
  // owning record (src/lib/storage/file-access.ts). A staff session is
  // optional here because logos are shown before sign-in and leasing-portal
  // users carry their own session; when there is one, its verified identity
  // is forwarded, never the client's headers.
  const fileKey = storedFileKey(pathname);
  if (fileKey !== null) {
    const token = request.cookies.get('xl-session')?.value;
    const staffSession = token ? await verifySession(token).catch(() => null) : null;
    if (staffSession) {
      const refusal = residencyRefusal(pathname, staffSession.dataResidency);
      if (refusal) return refusal;
      // Partner staff don't read the onboarding tenant's stored files.
      if (staffSession.role === PARTNER_TENANT_ROLE) return partnerForbidden();
    }
    const url = request.nextUrl.clone();
    url.pathname = `/api/files/${fileKey}`;
    return NextResponse.rewrite(url, {
      request: {
        headers: staffSession ? withVerifiedIdentity(request.headers, staffSession) : sanitizedHeaders,
      },
    });
  }

  // 0b. Partner staff land in the partner portal. The launcher (/platform,
  // where sign-in lands) and / are public, so the PARTNER gate in step 3c
  // never sees them.
  if (pathname === '/platform' || pathname === '/') {
    const token = request.cookies.get('xl-session')?.value;
    const landing = token ? await verifySession(token).catch(() => null) : null;
    if (landing?.role === PARTNER_TENANT_ROLE) return partnerHomeRedirect(request);
  }

  // 1. Public routes — no session required. Client-sent identity headers
  // are removed; driver-app requests get the identity of their verified
  // session cookie, if they have one.
  if (isPublicRoute(pathname)) {
    // Preserve legacy targeting as an untrusted selector. Public job handlers
    // must authenticate independently before honoring it.
    if (pathname.startsWith('/api/jobs/') || pathname.startsWith('/api/cron/') ||
        pathname === '/api/push/run-scheduler') {
      const target = request.headers.get('x-requested-tenant-id') ?? request.headers.get('x-tenant-id');
      if (target) sanitizedHeaders.set('x-requested-tenant-id', target);
    }
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

  // 3c. Transport partner staff (tenant role PARTNER) reach only the partner
  // portal and its APIs, not the onboarding tenant's own modules — tenant
  // APIs are not gated by role permissions. See src/lib/exchange/partner-role.ts.
  if (session.role === PARTNER_TENANT_ROLE && !partnerRoleAllows(pathname)) {
    return pathname.startsWith('/api/') ? partnerForbidden() : partnerHomeRedirect(request);
  }

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

  // 4a. Authorization dry run (src/lib/authz/dry-run.ts): answer the admin
  // gate and policy decision in headers without running anything.
  if (pathname.startsWith('/api/') && request.headers.get(DRY_RUN_HEADER) === '1') {
    const level = isAdminApiPath(pathname) ? requiredAdminLevel(pathname, request.method) : null;
    const headers = dryRunHeaders({
      policyVersion: POLICY_VERSION,
      mode: authzMode(),
      decision: decide(
        { pathname, method: request.method, requestedTenantId: request.nextUrl.searchParams.get('tenantId') },
        { role: session.role, tenantId: session.tenantId, plan: session.plan, permissions: session.permissions },
      ),
      adminGateRefusal: level && !roleSatisfies(session.role, level) ? level : null,
    });
    return new NextResponse(null, { status: 204, headers });
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

  // 4c. The authorization policy (src/lib/authz/policy.ts): one decision
  // per staff API request from the versioned matrix and the session's
  // permission claim. AUTHZ_MODE=report (default) logs would-be denials;
  // enforce answers 403. Runs before the Go shim, so proxied routes are
  // decided the same way.
  if (pathname.startsWith('/api/')) {
    const mode = pathname.startsWith('/api/bus-ops/') ? 'enforce' : authzMode();
    if (mode !== 'off') {
      const decision = decide(
        { pathname, method: request.method, requestedTenantId: request.nextUrl.searchParams.get('tenantId') },
        { role: session.role, tenantId: session.tenantId, plan: session.plan, permissions: session.permissions },
      );
      // Sessions issued before the permission claim existed hold none until
      // they roll over (24 h); in report mode that is expected, not signal.
      const quiet = mode === 'report' && decision.reason === 'no-permission-claim';
      if (!decision.allow && !quiet) {
        console.warn(JSON.stringify({
          authz: mode === 'enforce' ? 'deny' : 'would-deny',
          policy: POLICY_VERSION,
          method: request.method,
          path: pathname,
          area: decision.area,
          reason: decision.reason,
          required: decision.required,
          role: session.role,
          tenantId: session.tenantId,
          userId: session.userId,
        }));
      }
      if (!decision.allow && mode === 'enforce') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Your role does not allow this action.', reason: decision.reason, required: decision.required },
          { status: 403 },
        );
      }
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
  const shim = await proxyToGoBackend(request, requestHeaders, session.permissions);
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
