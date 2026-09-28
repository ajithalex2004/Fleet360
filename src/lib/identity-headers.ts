/**
 * Identity headers — the request headers route handlers treat as proof of
 * who the caller is (tenant, user, role, plan, …).
 *
 * Only middleware may set these, and only from a verified credential. Any
 * copy sent by the client must be removed before the request reaches a
 * route handler; otherwise a caller can pick any tenant just by sending
 * `x-tenant-id` to a route middleware does not authenticate (the public
 * prefixes in auth-route-policies.ts). requireAuthorizedTenant() and the
 * Prisma auto-scoping in src/lib/prisma.ts both read x-tenant-id and cannot
 * tell a forged value from a middleware-injected one.
 *
 * Edge-runtime safe: no Node APIs.
 */

export const IDENTITY_HEADERS: readonly string[] = [
  'x-tenant-id',
  'x-user-id',
  'x-user-role',
  'x-role',            // legacy fallback read by resolveAuthorizedTenant()
  'x-tenant-plan',
  'x-impersonated-by',
  'x-data-residency',
  'x-user-email',      // never set by middleware; read by audit fields only
  'x-user-name',       // never set by middleware; read by audit fields only
  // A tenant to act on instead of the session's. Honoured only for a
  // SUPER_ADMIN or an authenticated scheduler, but still never taken from
  // the client unchecked: middleware re-derives it for scheduler paths, and a
  // platform admin switches with ?tenantId=.
  'x-requested-tenant-id',
];

/** Returns a copy of `headers` with every identity header removed. */
export function stripIdentityHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const name of IDENTITY_HEADERS) out.delete(name);
  return out;
}

/**
 * Minimal verified-session shape needed to build identity headers.
 * Matches the fields of SessionPayload in tenant-session.ts that are used.
 */
export interface VerifiedIdentity {
  tenantId: string;
  userId: string;
  plan?: string | null;
  role?: string | null;
  impersonatedBy?: string | null;
  dataResidency?: string | null;
}

/**
 * Returns a copy of `headers` with client-sent identity headers removed and
 * the verified identity injected. `role` is only set when the session
 * carries one; this helper never invents a role.
 */
export function withVerifiedIdentity(headers: Headers, identity: VerifiedIdentity): Headers {
  const out = stripIdentityHeaders(headers);
  out.set('x-tenant-id', identity.tenantId);
  out.set('x-user-id', identity.userId);
  if (identity.plan) out.set('x-tenant-plan', identity.plan);
  if (identity.role) out.set('x-user-role', identity.role);
  if (identity.impersonatedBy) out.set('x-impersonated-by', identity.impersonatedBy);
  if (identity.dataResidency) out.set('x-data-residency', identity.dataResidency);
  return out;
}
