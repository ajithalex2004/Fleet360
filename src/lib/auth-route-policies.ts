/**
 * Auth route policy — the canonical public/protected route lists.
 *
 * Extracted from src/middleware.ts so that:
 *  - the middleware can import them without dragging in heavy modules,
 *  - the architectural test (tests/unit/auth-route-policies.test.ts)
 *    can import them and verify every src/app/<X>/page.tsx is covered.
 *
 * Adding a new top-level route under src/app/? Either:
 *  - add the prefix to PROTECTED_UI_PREFIXES (tenant-scoped UI), or
 *  - add the prefix to PUBLIC_EXACT / PUBLIC_PREFIXES (truly public).
 *
 * If neither list contains the prefix, the architectural test fails in CI.
 * See docs/AUDIT_PROTECTED_UI_PREFIXES.md for the historical context.
 */

// ── Public routes ────────────────────────────────────────────────────────────
// Exact-match public paths. Bypass auth entirely.
export const PUBLIC_EXACT: readonly string[] = [
  '/',
  '/login',
  '/platform',
  '/onboarding',
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/invitation/accept',
  '/api/auth/sso/initiate',
  '/api/auth/sso/callback',
  '/api/branding',
  '/api/stripe/webhook',
  '/forgot-password',
  '/reset-password',
  '/api/tenants/provision',
  '/api/tenants/verify-domain',
  '/api/tenants/pre-verify-domain',
  '/api/platform/plans',
  '/api/admin/session',
  '/api/health',
  '/api/version',
  // /api/auth/me is NOT public — it must receive the injected headers
];

// Prefix-match public paths. `/login` covers `/login`, `/login/foo`, etc.
export const PUBLIC_PREFIXES: readonly string[] = [
  '/login',
  '/platform/',
  '/onboarding/',
  '/track/',
  // Document signing is a public, capability-token flow. The token is
  // validated by the signing API; recipients do not need operator sessions.
  '/sign/',
  '/api/admin/session',
  '/api/setup/',            // one-time setup endpoints — SETUP_SECRET, not session
  '/api/auth/invitation/',  // public lookup by token
  '/invitation/',           // accept-invitation page
  // Shipper portal — separate auth domain (shipper-portal-session cookie).
  // The portal's own requireShipperPortal() guards every protected endpoint;
  // the middleware just lets traffic through so it can reach them.
  '/shipper-portal',
  '/api/shipper-portal/',
  // Carrier portal — token-authed (invite link), no operator session.
  '/carrier-portal/',
  '/api/carrier-portal/',
  // Driver mobile app — device-token authed.
  '/api/driver-app/',
  // Staff PWA push — the public-key endpoint is unauthenticated (the key
  // is meant to be public), the subscribe endpoint identifies the staff
  // member by employeeId (no admin session needed for the rider app),
  // and the test/scheduler endpoints are protected by PUSH_CRON_SECRET
  // rather than the operator session.
  '/api/push/',
  // System cron jobs (auto-close stale trips, etc.) — protected by
  // CRON_SECRET inside the handler (Vercel Cron sends it as a
  // Bearer token). Listed as public so the middleware doesn't
  // require an operator session.
  '/api/cron/',
  '/api/jobs/',
];

// ── Protected UI routes ──────────────────────────────────────────────────────
// Tenant-protected UI paths. Unauthenticated requests get redirected to
// /login. If a new module directory appears under src/app/ that isn't
// in either this list or PUBLIC_PREFIXES, the architectural test fails.
export const PROTECTED_UI_PREFIXES: readonly string[] = [
  '/fleet',
  '/rac',
  '/rental',
  '/leasing',
  '/logistics',
  '/staff-transport',
  '/bus-ops',           // canonical UI path for staff transport
  '/school-bus',
  '/ambulance',
  '/finance',
  '/dispatch',
  '/incidents',
  '/compliance',
  '/agents',
  '/admin',
  // ── Layer 2.5 hardening (2026-06-26) ─────────────────────────────────
  '/maintenance',
  '/assets',
  '/customer-mgmt',
  '/reports',
  '/service-tickets',
  '/driver-mgmt',
  '/sustainability',
  '/operations',
  // Formerly ambiguous operator UI surfaces. Each uses the xl-session and/or
  // tenant-scoped APIs, so it must never render anonymously.
  '/booking-portal',
  '/customer',
  '/mobile-apps',
  '/portal',
  '/driver',
  '/approvals',
  '/ai-platform',
  '/vendors',
];

/**
 * Returns true if the given pathname should bypass auth entirely.
 * Mirrors the logic in src/middleware.ts.
 */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

/**
 * Returns true if the given pathname is a tenant-protected UI route
 * that should redirect to /login on unauthenticated access.
 */
export function isProtectedUiPath(pathname: string): boolean {
  return PROTECTED_UI_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

/**
 * Returns true if the pathname is either public or protected — i.e. the
 * middleware knows what to do with it. Used by the architectural test to
 * detect "orphan" routes that would silently render unauthenticated.
 */
export function isRouted(pathname: string): boolean {
  return isPublicPath(pathname) || isProtectedUiPath(pathname);
}

/**
 * Find the top-level segment of a pathname under src/app/.
 * e.g. '/customer/my-bookings/x' → '/customer'
 *      '/'                          → '/'
 *
 * Used by the architectural test to map page.tsx paths to the prefix they
 * need to match against.
 */
export function topLevelSegment(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, '');
  if (!trimmed) return '/';
  const slash = trimmed.indexOf('/');
  return slash === -1 ? `/${trimmed}` : `/${trimmed.slice(0, slash)}`;
}
