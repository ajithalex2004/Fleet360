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
  const source = headersOverride ?? request.headers;
  const { pathname, search } = request.nextUrl;

  // Protect debug and profiling endpoints (/debug/pprof, etc.) behind admin authentication or disable in production (F35)
  if (pathname.startsWith('/debug') || pathname.startsWith('/api/debug')) {
    const isProd = process.env.NODE_ENV === 'production';
    const role = source.get('x-user-role');
    if (isProd || (role !== 'SUPER_ADMIN' && role !== 'ADMIN')) {
      return {
        proxied: true,
        response: NextResponse.json(
          { error: 'Forbidden', message: 'Debug and profiling endpoints require admin authentication' },
          { status: 403 },
        ),
      };
    }
  }

  // 1. Kill switch: immediate toggle to fall through to existing Next.js handlers.
  if (!goProxyEnabled()) {
    return { proxied: false };
  }

  // 2. Route map: only a method + path the Go backend serves is forwarded.
  if (!goRouteFor(request.method, pathname)) return { proxied: false };

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

  try {
    const upstream = new URL(goUpstreamPath(pathname) + search, GO_BACKEND_URL);
    const headers = buildProxyHeaders(source);

    // Go's /api/v1/* surface sits behind Bearer-JWT auth (backend/auth/jwt.go).
    // Whenever middleware verified an operator session (from xl-session cookie
    // OR mobile/Capacitor `Authorization: Bearer <xl-session>`) and injected
    // verified x-user-id / x-tenant-id / x-user-role headers, ALWAYS mint and
    // overwrite Authorization with a fresh short-lived Go HS256 JWT. This keeps
    // mobile Bearer xl-session callers working across all shimmed routes and
    // prevents arbitrary client Authorization headers from reaching Go.
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
        // Exclusively source impersonation identity from middleware-verified x-impersonated-by.
        const impersonatedBy = source.get('x-impersonated-by')?.trim() || undefined;
        const sid = source.get('x-session-id')?.trim() || undefined;
        const rawIatMs = source.get('x-session-iat');
        const parsedIatMs = rawIatMs ? Number(rawIatMs) : NaN;
        const issuedAtMs =
          Number.isFinite(parsedIatMs) && parsedIatMs > 0
            ? Math.floor(parsedIatMs)
            : undefined;
        const token = await signJwtForBackend({
          userId,
          tenantId,
          role,
          permissions,
          plan: source.get('x-tenant-plan'),
          impersonatedBy,
          sid,
          issuedAtMs,
          ttlSeconds: 300,
        });
        headers.set('Authorization', `Bearer ${token}`);
      } catch (err) {
        // JWT_SECRET unset/too-short (or any other signing failure) is a
        // deployment misconfiguration, not a per-request auth failure.
        // Fail closed here: never forward a request that was supposed to carry
        // proof of identity without a valid Go JWT.
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

    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: hasRequestBody(request.method) ? request.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000), // 10s proxy timeout per audit F35
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
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.message.includes('timeout'));
    const message = err instanceof Error ? err.message : 'Go backend unavailable';
    return {
      proxied: true,
      response: NextResponse.json(
        { error: isTimeout ? 'Gateway Timeout' : 'Backend unavailable', message },
        { status: isTimeout ? 504 : 502 }
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
