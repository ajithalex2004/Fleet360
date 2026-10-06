/**
 * Role policy for /api/admin/* — who may call each admin endpoint.
 *
 * Enforced centrally in src/middleware.ts before any admin route handler
 * runs, so a handler that forgets its own role check is still protected.
 * Any /api/admin path or method that is NOT listed here requires
 * SUPER_ADMIN (fail closed): adding a new admin route means deciding its
 * level here. tests/unit/admin-access.test.ts fails CI if an existing route
 * method is missing from the table.
 *
 * Levels:
 *   platform — SUPER_ADMIN only. Endpoints that act on platform-wide
 *              records (all users, all tenants, system roles, platform
 *              settings, migrations, seeds).
 *   admin    — SUPER_ADMIN or TENANT_ADMIN. The handler must keep a tenant
 *              admin inside their own tenant (see isSuperAdmin()).
 *   member   — any signed-in role. Used only where non-admin screens call
 *              the endpoint (subscription banner, approvals, user switcher,
 *              service tickets, branch P&L); the handler scopes to the
 *              caller's tenant.
 *
 * Role codes are compared as signed into the session. A tenant's own copy
 * of a system role (see /api/admin/roles/override) keeps the same code.
 *
 * Edge-runtime safe: no Node APIs.
 */

export type AdminLevel = 'platform' | 'admin' | 'member';
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const SUPER_ADMIN = 'SUPER_ADMIN';
export const TENANT_ADMIN = 'TENANT_ADMIN';

/**
 * Route template (relative to /api/admin/, `[x]` = one path segment) →
 * level per HTTP method. Methods not listed fall back to 'platform'.
 */
export const ADMIN_ROUTE_POLICY: Record<string, Partial<Record<Method, AdminLevel>>> = {
  // Own tenant's audit trail for admins; any user may record client-side
  // audit events for their own tenant (src/lib/platform-audit-log.ts).
  'audit-logs':                                  { GET: 'admin', POST: 'member' },
  // Attachment Type master: the Create Tenant modal reads it; only platform admins edit it.
  'attachment-types':                            { GET: 'admin', POST: 'platform' },
  'attachment-types/[id]':                       { PATCH: 'platform' },
  // Reads document number / expiry date from a file; sends it to the AI provider.
  'attachment-types/[id]/autofill':              { POST: 'platform' },
  'billing':                                     { GET: 'member' },   // SubscriptionBanner
  'billing/checkout':                            { POST: 'admin' },
  'billing/portal':                              { POST: 'admin' },
  'change-password':                             { POST: 'member' },  // caller's own password
  // Caller's own company identity (TRN, address) — read by invoice screens.
  'company-profile':                             { GET: 'member', PATCH: 'admin' },
  'corporate-clients':                           { GET: 'admin', POST: 'admin' },
  // logistics/shippers page (operations users) invites shippers to the portal
  'customers/[id]/portal-invitations':           { GET: 'member', POST: 'member' },
  'customers/[id]/tracking-visibility':          { PATCH: 'admin' },
  'customers/portal-status':                     { GET: 'admin' },
  'dispatch-stats':                              { GET: 'admin' },
  // Email wording per tenant (src/lib/email-templates); the platform
  // defaults (scope=platform) are checked for platform admins in the handlers.
  'email-templates':                             { GET: 'admin' },
  'email-templates/[id]':                        { PUT: 'admin', DELETE: 'admin' },
  'email-templates/[id]/test':                   { POST: 'admin' },
  'email-templates/[id]/versions':               { GET: 'admin' },
  'events/outbox':                               { GET: 'platform' },
  // Which users act for which Exchange transport partner (partner_users).
  'exchange/partner-users':                      { GET: 'platform', POST: 'platform', DELETE: 'platform' },
  // The Exchange's transport partners (platform-level records).
  'exchange/partners':                           { GET: 'platform', POST: 'platform' },
  'exchange/partners/[id]/services':             { PUT: 'platform' },
  'exchange/partners/[id]/onboarding-tenant':    { PUT: 'platform' },
  'exchange/partners/[id]/invitations':          { GET: 'platform', POST: 'platform', DELETE: 'platform' },
  'exchange/partners/[id]/compliance':           { GET: 'platform' },
  'exchange/partners/[id]/compliance/[id]':      { PATCH: 'platform' },
  // Partner activation review: the onboarding tenant's administrators; the
  // handlers keep a tenant admin to partners its own tenant onboarded.
  'exchange/onboarding':                         { GET: 'admin' },
  'exchange/onboarding/[id]':                    { GET: 'admin' },
  'exchange/onboarding/[id]/decision':           { POST: 'admin' },
  'exchange/onboarding/[id]/documents/[id]':     { PATCH: 'admin' },
  'exchange/onboarding/[id]/documents/[id]/file': { GET: 'admin' },
  'events/outbox/replay':                        { POST: 'platform' },
  'impersonate':                                 { POST: 'platform' },
  // Called while impersonating, when the session carries the target's role.
  'impersonate/stop':                            { POST: 'member' },
  'info':                                        { GET: 'platform' },
  'migrate/fleet-phase1':                        { GET: 'platform', POST: 'platform' },
  'migrate/indexes':                             { GET: 'platform', POST: 'platform' },
  'migrate/rac-phase1':                          { POST: 'platform' },
  'nav-permissions':                             { GET: 'admin', PUT: 'platform' },
  'notification-rules':                          { GET: 'platform', POST: 'platform', PUT: 'platform' },
  'notification-templates':                      { GET: 'platform', POST: 'platform', PUT: 'platform' },
  'permissions':                                 { GET: 'admin' },
  'platform-settings':                           { GET: 'platform', PATCH: 'platform' },
  'platform/plans':                              { GET: 'platform', POST: 'platform' },
  'platform/plans/[id]':                         { PATCH: 'platform', DELETE: 'platform' },
  'roles':                                       { GET: 'member', POST: 'platform' },
  // Tenant admins may edit their own tenant's roles; the handler checks
  // the role belongs to their tenant. System roles stay platform-only.
  'roles/[id]':                                  { GET: 'admin', PATCH: 'admin', DELETE: 'admin' },
  'roles/[id]/permissions':                      { GET: 'admin', PUT: 'admin' },
  'roles/override':                              { POST: 'admin' },
  'seed':                                        { GET: 'platform', POST: 'platform' },
  'seed/leasing':                                { POST: 'platform' },
  'service-config/categories':                   { GET: 'member', POST: 'admin' },
  'service-config/categories/[id]':              { PATCH: 'admin', DELETE: 'admin' },
  'service-config/scopes':                       { GET: 'member', POST: 'admin' },
  'service-config/scopes/[id]':                  { PATCH: 'admin', DELETE: 'admin' },
  'service-config/types':                        { POST: 'admin' },
  'service-config/types/[id]':                   { PATCH: 'admin', DELETE: 'admin' },
  'service-config/types/[id]/module-mapping':    { GET: 'member', PUT: 'admin' },
  'service-config/types/[id]/rules/[id]':        { GET: 'member', PUT: 'admin' },
  'service-config/types/[id]/rules/[id]/history': { GET: 'member', POST: 'admin' },
  'shipper-portal/seed-demo':                    { POST: 'platform' },
  'tenant-settings/tracking-visibility':         { GET: 'admin', PUT: 'admin' },
  'tenants':                                     { GET: 'member', POST: 'platform' },
  // PATCH writes any Tenant column (plan, residency, CORS origins, …).
  'tenants/[id]':                                { GET: 'member', PATCH: 'platform', DELETE: 'platform' },
  'tenants/[id]/api-keys':                       { GET: 'admin', POST: 'admin' },
  // Trade license, VAT certificate, ...: the tenant's admins can read them;
  // only platform admins add or remove them.
  'tenants/[id]/attachments':                    { GET: 'admin', POST: 'platform' },
  'tenants/[id]/attachments/[id]':               { DELETE: 'platform' },
  'tenants/[id]/api-keys/[id]/revoke':           { POST: 'admin' },
  'tenants/[id]/branding':                       { GET: 'admin', PUT: 'admin' },
  'tenants/[id]/branding/logo':                  { POST: 'admin' },
  'tenants/[id]/hard-delete':                    { POST: 'platform' },
  'tenants/[id]/invitations':                    { GET: 'admin', POST: 'admin' },
  'tenants/[id]/invitations/[id]/revoke':        { POST: 'admin' },
  // PUT would let a tenant switch on modules its plan doesn't include.
  'tenants/[id]/modules':                        { GET: 'admin', PUT: 'platform' },
  'tenants/[id]/settings':                       { GET: 'admin', PUT: 'admin' },
  'tenants/[id]/sso':                            { GET: 'admin', PUT: 'admin', DELETE: 'admin' },
  'tenants/[id]/ticket-types':                   { GET: 'member', PUT: 'admin' },  // service-tickets page
  'tenants/[id]/users':                          { GET: 'admin', POST: 'admin', DELETE: 'admin' },
  // Sends a test message through caller-supplied SMTP/SMS settings.
  'test-channel':                                { POST: 'platform' },
  // Platform-wide user directory: GET is scoped to the caller's tenant for
  // non-super-admins (user switcher, session bar); writes act on global
  // User rows and stay platform-only.
  'users':                                       { GET: 'member', POST: 'platform' },
  'users/[id]':                                  { GET: 'platform', PATCH: 'platform', DELETE: 'platform' },
  // Ends a user's sessions within 60 s; a tenant admin only in their own tenant.
  'users/[id]/revoke-sessions':                  { POST: 'admin' },
  'users/[id]/hard-delete':                      { POST: 'platform' },
  'users/set-password':                          { POST: 'platform' },
  'workflow-instances':                          { GET: 'member' },   // approvals page
  // Workflows: tenant admins manage their own tenant's workflows (service
  // configuration); handlers check ownership. Platform templates
  // (tenantId NULL) stay platform-only.
  'workflows':                                   { GET: 'admin', POST: 'admin' },
  'workflows/[id]':                              { GET: 'admin', PUT: 'admin', DELETE: 'admin' },
  'workflows/[id]/duplicate':                    { POST: 'admin' },
  'workflows/[id]/steps':                        { GET: 'admin', POST: 'admin' },
  'workflows/[id]/steps/[id]':                   { PUT: 'admin', DELETE: 'admin' },
  'workflows/stats':                             { GET: 'platform' },  // counts across all tenants
};

const ADMIN_PREFIX = '/api/admin/';

function templateToRegExp(template: string): RegExp {
  const body = template
    .split('/')
    .map((seg) => (seg === '[id]' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}/?$`);
}

const COMPILED = Object.entries(ADMIN_ROUTE_POLICY).map(([template, methods]) => ({
  template,
  re: templateToRegExp(template),
  methods,
}));

/** True for paths the admin policy governs. */
export function isAdminApiPath(pathname: string): boolean {
  return pathname.startsWith(ADMIN_PREFIX);
}

/**
 * The level required for `method` on `pathname`, or 'platform' when the
 * route or method is not in ADMIN_ROUTE_POLICY. HEAD follows GET; OPTIONS
 * (CORS preflight) carries no credentials and is left to the handler.
 */
export function requiredAdminLevel(pathname: string, method: string): AdminLevel | null {
  const upper = method.toUpperCase();
  if (upper === 'OPTIONS') return null;
  const effective = (upper === 'HEAD' ? 'GET' : upper) as Method;
  const rel = pathname.slice(ADMIN_PREFIX.length);
  for (const entry of COMPILED) {
    if (entry.re.test(rel)) return entry.methods[effective] ?? 'platform';
  }
  return 'platform';
}

/** Whether a signed-in role meets `level`. An empty role meets nothing. */
export function roleSatisfies(role: string | null | undefined, level: AdminLevel): boolean {
  if (!role) return false;
  if (role === SUPER_ADMIN) return true;
  if (level === 'platform') return false;
  if (level === 'admin') return role === TENANT_ADMIN;
  return true;
}

/** True when the middleware-verified caller is a platform super admin. */
export function isSuperAdmin(headers: Headers): boolean {
  return headers.get('x-user-role') === SUPER_ADMIN;
}
