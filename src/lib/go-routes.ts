/**
 * The one map of API routes the Go backend owns (architecture audit A10).
 *
 * The middleware shim (src/lib/api-shim.ts) forwards a request to Go only
 * when its METHOD and PATH match an entry here: `/api/<path>` on Next maps to
 * `/api/v1/<path>` on Go, with a backend token minted from the verified
 * session. Anything else — another method, a sub-path Go does not serve, a
 * whole area Go does not implement — is handled by Next.js. (Before, the shim
 * forwarded whole path prefixes, so a canary tenant's file download, a PATCH,
 * or an unported sub-path got a Go 404; and next.config.ts separately
 * rewrote ten legacy prefixes to Go paths that do not exist.)
 *
 * Rollout (who is forwarded at all) stays in environment variables:
 *   LOGISTICS_GO_PROXY_ENABLED=false     — kill switch: nothing is forwarded
 *   LOGISTICS_GO_CANARY_TENANT_IDS=a,b   — only these tenants are forwarded
 *   GO_BACKEND_URL                       — required in production while
 *                                          forwarding is on (readiness checks it)
 *
 * tests/unit/go-route-map.test.ts keeps this list identical to the
 * logistics and files routes registered in backend/main.go: add the Go route
 * and the entry together.
 */

export type GoMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface GoRoute {
  method: GoMethod;
  /** Next.js path, with :param for a path segment (Go: the same under /api/v1). */
  path: string;
}

export const GO_ROUTES: readonly GoRoute[] = [
  // Files (object storage)
  { method: 'POST', path: '/api/files/upload' },
  { method: 'GET', path: '/api/files/sign' },
  { method: 'DELETE', path: '/api/files' },

  // Logistics — shipments, analytics, tracking
  { method: 'GET', path: '/api/logistics/shipments' },
  { method: 'GET', path: '/api/logistics/shipments/:id' },
  { method: 'POST', path: '/api/logistics/shipments' },
  { method: 'POST', path: '/api/logistics/shipments/:id/tracking' },
  { method: 'GET', path: '/api/logistics/stats' },
  { method: 'GET', path: '/api/logistics/analytics' },
  { method: 'GET', path: '/api/logistics/sla' },
  { method: 'GET', path: '/api/logistics/driver-stats' },
  { method: 'GET', path: '/api/logistics/tracking' },

  // Logistics — shipping requests (demand intake & conversion)
  { method: 'GET', path: '/api/logistics/shipping-requests' },
  { method: 'POST', path: '/api/logistics/shipping-requests' },
  { method: 'GET', path: '/api/logistics/shipping-requests/:id' },
  { method: 'PATCH', path: '/api/logistics/shipping-requests/:id' },
  { method: 'POST', path: '/api/logistics/shipping-requests/:id/convert' },

  // Logistics — carriers, rates, marketplace
  { method: 'GET', path: '/api/logistics/carriers' },
  { method: 'GET', path: '/api/logistics/carriers/:id' },
  { method: 'POST', path: '/api/logistics/carriers' },
  { method: 'GET', path: '/api/logistics/rate-contracts' },
  { method: 'POST', path: '/api/logistics/rate-contracts' },
  { method: 'POST', path: '/api/logistics/rates/quote' },
  { method: 'GET', path: '/api/logistics/rfqs' },
  { method: 'POST', path: '/api/logistics/rfqs' },
  { method: 'GET', path: '/api/logistics/rfqs/:id/bids' },
  { method: 'GET', path: '/api/logistics/bids' },
  { method: 'POST', path: '/api/logistics/bids' },
  { method: 'GET', path: '/api/logistics/carrier-scorecards' },
  { method: 'POST', path: '/api/logistics/carrier-scorecards' },

  // Logistics — execution
  { method: 'GET', path: '/api/logistics/stops' },
  { method: 'POST', path: '/api/logistics/stops' },
  { method: 'GET', path: '/api/logistics/route-legs' },
  { method: 'POST', path: '/api/logistics/route-legs' },
  { method: 'GET', path: '/api/logistics/assignments' },
  { method: 'POST', path: '/api/logistics/assignments' },
  { method: 'GET', path: '/api/logistics/tracking-events' },
  { method: 'POST', path: '/api/logistics/tracking-events' },
  { method: 'GET', path: '/api/logistics/pod-events' },
  { method: 'POST', path: '/api/logistics/pod-events' },
  { method: 'GET', path: '/api/logistics/telematics-events' },
  { method: 'POST', path: '/api/logistics/telematics-events' },
  { method: 'GET', path: '/api/logistics/exceptions' },

  // Logistics — finance
  { method: 'GET', path: '/api/logistics/freight-charges' },
  { method: 'GET', path: '/api/logistics/carrier-settlements' },
  { method: 'GET', path: '/api/logistics/driver-payouts' },
  { method: 'GET', path: '/api/logistics/finance-postings' },
  { method: 'GET', path: '/api/logistics/finance/reconciliation' },

  // Logistics — route planner
  { method: 'POST', path: '/api/logistics/planner/optimize' },
  { method: 'GET', path: '/api/logistics/planner/inputs' },
  { method: 'GET', path: '/api/logistics/planner/plans' },
  { method: 'GET', path: '/api/logistics/planner/plans/:id' },
  { method: 'POST', path: '/api/logistics/planner/plans/:id/commit' },
  { method: 'POST', path: '/api/logistics/planner/plans/:id/discard' },
  { method: 'POST', path: '/api/logistics/planner/plans/:id/edit' },
];

const COMPILED = GO_ROUTES.map((r) => ({
  route: r,
  re: new RegExp('^' + r.path.replace(/:[A-Za-z]+/g, '[^/]+') + '/?$'),
}));

/** The Go route a request maps to, or null when Next.js handles it. HEAD follows GET. */
export function goRouteFor(method: string, pathname: string): GoRoute | null {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  return COMPILED.find((c) => c.route.method === m && c.re.test(pathname))?.route ?? null;
}

/** The Go path for a Next.js API path: /api/<x> → /api/v1/<x>. */
export function goUpstreamPath(pathname: string): string {
  return pathname.replace(/^\/api(?=\/)/, '/api/v1');
}

/** Forwarding is on unless the kill switch says otherwise. */
export function goProxyEnabled(): boolean {
  return process.env.LOGISTICS_GO_PROXY_ENABLED !== 'false';
}

/**
 * Whether forwarding is configured to reach a backend: in production, with
 * forwarding on, GO_BACKEND_URL must be set (the localhost default only
 * serves local development).
 */
export function goBackendConfigured(): boolean {
  if (!goProxyEnabled()) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return !!process.env.GO_BACKEND_URL?.trim();
}
