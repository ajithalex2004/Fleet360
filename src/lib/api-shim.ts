import { NextRequest, NextResponse } from 'next/server';
import { signJwtForBackend } from '@/lib/auth/jwt';

interface ProxyResult {
  proxied: boolean;
  response?: NextResponse;
}

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

const MIGRATED_EXACT_PATHS = new Set([
  '/api/logistics/analytics',
  '/api/logistics/driver-stats',
  '/api/logistics/rates/quote',
  '/api/logistics/sla',
  '/api/logistics/tracking',
]);

const MIGRATED_PREFIXES = [
  // Only list paths the Go backend ACTUALLY implements under /api/v1/logistics.
  // Go serves rfqs, carriers and shipments (plus their leaf routes). The
  // following were NOT ported to Go — they have working Next.js routes, and
  // proxying them returns a Go 404 that breaks the screen, so they must stay on
  // Next.js: control-tower, settlements, rates/contracts, master-data.
  // Do not add a path here without a matching Go handler in backend/.
  '/api/logistics/rfqs',
  '/api/logistics/shipments',
  '/api/logistics/carriers',
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
          // JWT_SECRET unset/too-short — let Go reject so the misconfig stays
          // visible, rather than silently proxying an unauthenticated call.
          console.warn('[api-shim] backend JWT sign failed:', err instanceof Error ? err.message : err);
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
  const method = request.method.toUpperCase();

  if (MIGRATED_EXACT_PATHS.has(pathname)) {
    return true;
  }

  // ── shipments — Go implements list/create + GET-by-id + POST tracking only.
  if (pathname === '/api/logistics/shipments') {
    return method === 'GET' || method === 'POST';
  }
  if (/^\/api\/logistics\/shipments\/[^/]+$/.test(pathname)) {
    return method === 'GET';
  }
  if (/^\/api\/logistics\/shipments\/[^/]+\/tracking$/.test(pathname)) {
    return method === 'POST';
  }

  // ── rfqs — Go implements the list/create + the bids sub-route ONLY. award,
  // invites and the whole broadcast/* tree are Next-only; proxying them returns
  // a Go 404 (which silently breaks the marketplace award + Driver Broadcast).
  if (pathname === '/api/logistics/rfqs') {
    return method === 'GET' || method === 'POST';
  }
  if (/^\/api\/logistics\/rfqs\/[^/]+\/bids$/.test(pathname)) {
    return true;
  }
  if (pathname.startsWith('/api/logistics/rfqs/')) {
    return false;
  }

  // ── carriers — Go implements list/create + GET-by-id ONLY. carriers/nearest
  // (otherwise wrongly captured by Go's /carriers/:id) and carriers/:id/app-device
  // (Go 404) are Next-only.
  if (pathname === '/api/logistics/carriers') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/logistics/carriers/nearest') {
    return false;
  }
  if (/^\/api\/logistics\/carriers\/[^/]+$/.test(pathname)) {
    return method === 'GET';
  }
  if (pathname.startsWith('/api/logistics/carriers/')) {
    return false;
  }

  return MIGRATED_PREFIXES
    .filter(prefix => !['/api/logistics/shipments', '/api/logistics/rfqs', '/api/logistics/carriers'].includes(prefix))
    .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
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
