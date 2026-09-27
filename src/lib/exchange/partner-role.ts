/**
 * The "Partner" tenant role (code PARTNER).
 *
 * A transport partner's staff are users of the tenant that onboarded the
 * partner, with this role. It grants nothing in that tenant's own app: the
 * role has no permissions, and because tenant APIs are not gated by
 * permissions, the middleware also confines a PARTNER session to the paths
 * below. Everything else answers 403 (API) or redirects to the partner
 * dashboard (pages).
 */

export const PARTNER_TENANT_ROLE = 'PARTNER';

export const PARTNER_HOME = '/exchange/dashboard';

/** API prefixes a PARTNER session may call: the partner portal's, and sign-in/session. */
const PARTNER_API_PREFIXES = ['/api/exchange', '/api/auth'];

/** Pages a PARTNER session may open. */
const PARTNER_PAGE_PREFIXES = ['/exchange', '/invitation', '/login', '/logout', '/forgot-password', '/reset-password'];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Whether a PARTNER session may request `pathname`. */
export function partnerRoleAllows(pathname: string): boolean {
  if (pathname.startsWith('/_next/')) return true;
  const prefixes = pathname.startsWith('/api/') || pathname === '/api' ? PARTNER_API_PREFIXES : PARTNER_PAGE_PREFIXES;
  if (prefixes.some((p) => under(pathname, p))) return true;
  // Static files served from /public (icons, manifest, images): a file
  // extension on the last segment, outside /api.
  return !pathname.startsWith('/api') && /\/[^/]+\.[a-z0-9]{2,5}$/i.test(pathname);
}
