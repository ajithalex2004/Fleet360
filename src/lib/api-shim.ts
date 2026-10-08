import { NextRequest, NextResponse } from 'next/server';
import { signJwtForBackend } from '@/lib/auth/jwt';
import { goProxyEnabled, goRouteFor, goUpstreamPath } from '@/lib/go-routes';

interface ProxyResult {
  proxied: boolean;
  response?: NextResponse;
}

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

// Which requests go to Go is decided by the route map, src/lib/go-routes.ts:
// method AND path must match a route the Go backend registers. Everything
// else stays on Next.js. Rollout (kill switch, canary tenants) is below.

/**
 * `permissions`: the verified session's permission claim, signed into the
 * backend token so Go makes the same authorization decision (backend/authz).
 */
export async function proxyToGoBackend(
  request: NextRequest,
  headersOverride?: Headers,
  permissions?: readonly string[] | null,
): Promise<ProxyResult> {
  // 1. Kill switch: immediate toggle to fall through to existing Next.js handlers.
  if (!goProxyEnabled()) {
    return { proxied: false };
  }

  // 2. Route map: only a method + path the Go backend serves is forwarded.
  if (!goRouteFor(request.method, request.nextUrl.pathname)) return { proxied: false };

  const source = headersOverride ?? request.headers;

  // 3. Canary tenant check: gradual server-side activation by tenant ID.
  const canaryTenantsRaw = process.env.LOGISTICS_GO_CANARY_TENANT_IDS?.trim();
  if (canaryTenantsRaw) {
    const allowedTenantIds = new Set(
      canaryTenantsRaw
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
    );
    const tenantId = source.get('x-tenant-id')?.trim().toLowerCase();
    if (!tenantId || !allowedTenantIds.has(tenantId)) {
      // Non-canary tenant or unauthenticated tenant-scoped request falls through to Next.js
      return { proxied: false };
    }
  }

  const { pathname, search } = request.nextUrl;

  try {
    const upstream = new URL(goUpstreamPath(pathname) + search, GO_BACKEND_URL);
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
        // Middleware only injects identity from a verified session, and
        // verifySession() rejects sessions without a role, so a missing role
        // here means something upstream is wrong. Refuse rather than mint a
        // backend token with a guessed (and previously admin) role.
        const role = source.get('x-user-role');
        if (!role) {
          return {
            proxied: true,
            response: NextResponse.json(
              { error: 'Unauthorized', message: 'Session has no role' },
              { status: 401 },
            ),
          };
        }
        try {
          const token = await signJwtForBackend({
            userId, tenantId, role, permissions, plan: source.get('x-tenant-plan'),
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

    const resHeaders = new Headers(response.headers);
    resHeaders.set('x-backend', 'go');

    return {
      proxied: true,
      response: new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
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
