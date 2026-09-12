import { NextRequest, NextResponse } from 'next/server';
import { signJwtForBackend } from '@/lib/auth/jwt';

interface ProxyResult {
  proxied: boolean;
  response?: NextResponse;
}

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

// 2026-09-12: no Go backend is currently deployed/reachable anywhere in
// this account (GO_BACKEND_URL is unset in production, defaulting to an
// unreachable localhost:8080 — see docs/LOGISTICS_GO_MIGRATION_STATUS.md).
// analytics/driver-stats/rates/quote/sla have NO Next.js fallback (deleted
// when ported) and stay listed here — they're already broken either way,
// and re-adding them costs nothing. tracking DOES have a working Next.js
// fallback and was removed below so it stops 502ing for real users; add it
// back once a live Go backend is actually reachable.
const MIGRATED_EXACT_PATHS = new Set([
  '/api/logistics/analytics',
  '/api/logistics/driver-stats',
  '/api/logistics/rates/quote',
  '/api/logistics/sla',
]);

// ── Bus-ops shim: intentionally empty ────────────────────────────────────
//
// Architectural risk #8 from the Staff Transportation audit:
// `/api/bus-ops/*` is Next-only. If a bus-ops handler is ever ported to
// the Go backend (e.g. `/api/v1/bus-ops/schedules`), this shim WILL NOT
// route to it — you must:
//   1. Add the path here (MIGRATED_EXACT_PATHS or MIGRATED_PREFIXES)
//   2. Verify the Go handler returns the same response contract
//   3. Add an integration test that shows the shimmed path returns
//      an `X-Backend: go` header
// Without steps 1-3 a "silent migration" (Go route deployed, but Next
// still serving here) leaves the two implementations drifting.

const MIGRATED_PREFIXES = [
  // Only list paths the Go backend ACTUALLY implements under /api/v1/logistics.
  // rfqs/shipments/carriers removed 2026-09-12 — no Go backend is reachable
  // (see the note on MIGRATED_EXACT_PATHS above) and, unlike
  // analytics/driver-stats/rates/quote/sla, these three DO still have a
  // working Next.js implementation, so leaving them proxied was actively
  // breaking a fallback that already worked. Their per-path shouldProxy()
  // logic below was removed along with them. Re-add both once a live Go
  // backend is reachable again.
  // Do not add a path here without a matching Go handler in backend/.
  '/api/logistics/planner',
  '/api/carrier-portal/app',
  '/api/driver-app',
];

export async function proxyToGoBackend(request: NextRequest, headersOverride?: Headers): Promise<ProxyResult> {
  const { pathname, search } = request.nextUrl;
  if (!shouldProxy(request)) return { proxied: false };

  const source = headersOverride ?? request.headers;

  try {
    const upstream = new URL(pathname.replace(/^\/api/, '/api/v1') + search, GO_BACKEND_URL);
    const headers = buildProxyHeaders(source);

    // Go's /api/v1/* surface sits behind Bearer-JWT auth (backend/auth/jwt.go).
    // The browser reaches these paths with a plain fetch that carries no token,
    // so mint a short-lived JWT from the identity the middleware already
    // verified and injected (x-user-id / x-tenant-id / x-user-role) and attach
    // it. Without this, Go rejects every proxied call with "missing or
    // malformed Authorization header". Skip when a Bearer is already present
    // (e.g. a backendFetch caller) or when there's no operator session on the
    // request (carrier-portal / driver-app paths carry their own auth).
    if (!headers.has('authorization')) {
      const userId = source.get('x-user-id');
      const tenantId = source.get('x-tenant-id');
      if (userId && tenantId) {
        try {
          const token = await signJwtForBackend({
            userId,
            tenantId,
            role: source.get('x-user-role') ?? 'TENANT_ADMIN',
          });
          headers.set('Authorization', `Bearer ${token}`);
        } catch (err) {
          // JWT_SECRET unset/too-short (or any other signing failure) is a
          // deployment misconfiguration, not a per-request auth failure.
          // Previously this only logged and fell through to fetch(upstream)
          // below, forwarding an authenticated operator's request to Go with
          // NO Authorization header at all — relying entirely on Go to
          // reject it. Fail closed here instead: never forward a request
          // that was supposed to carry proof of identity but doesn't.
          console.error('[api-shim] backend JWT sign failed — refusing to forward unauthenticated:', err instanceof Error ? err.message : err);
          return {
            proxied: true,
            response: NextResponse.json(
              { error: 'Backend authentication unavailable' },
              { status: 503 },
            ),
          };
        }
      }
    }

    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: hasRequestBody(request.method) ? request.body : undefined,
      redirect: 'manual',
    });

    return {
      proxied: true,
      response: new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Go backend unavailable';
    return {
      proxied: true,
      response: NextResponse.json(
        { error: 'Backend unavailable', message },
        { status: 502 }
      ),
    };
  }
}

function shouldProxy(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;

  if (MIGRATED_EXACT_PATHS.has(pathname)) {
    return true;
  }

  return MIGRATED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function hasRequestBody(method: string): boolean {
  return !['GET', 'HEAD'].includes(method.toUpperCase());
}

function buildProxyHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  // Strip browser-level cross-origin headers. The shim is a server-to-server
  // proxy that has already authenticated the caller and minted a fresh
  // Bearer JWT — forwarding the browser's Origin/Referer would otherwise
  // make Go's gin-contrib/cors allow-list reject the call with HTTP 403 +
  // empty body whenever the Next dev server binds to a non-baseline port
  // (e.g. :3001 after port-shift from :3000). CORS allow-lists are designed
  // for direct browser → Go calls, not for proxied server-side ones.
  headers.delete('origin');
  headers.delete('referer');
  return headers;
}
