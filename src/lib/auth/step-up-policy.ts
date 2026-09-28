/**
 * Which admin actions need a passkey step-up: a fresh passkey check
 * (src/lib/auth/passkeys.ts) within the last STEP_UP_TTL_MS, on top of the
 * session and the admin role policy (src/lib/admin-access.ts).
 *
 * High impact = changes who can do what, removes people or tenants, hands
 * out credentials, or runs platform-wide operations. Protective actions
 * (revoking sessions, revoking an API key or an invitation) are left out so
 * they stay one click away during an incident.
 *
 * Enforced centrally in src/middleware.ts, so a handler cannot forget it.
 * STEP_UP_MODE: enforce (default) answers 403 step_up_required; report logs
 * would-require and lets the request through; off disables the check (an
 * emergency switch, e.g. when the only platform admin lost every passkey).
 *
 * Edge-runtime safe: no Node APIs.
 */

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** How long one passkey check covers further high-impact actions. */
export const STEP_UP_TTL_MS = 5 * 60_000;

/** httpOnly cookie carrying the step-up token (src/lib/auth/step-up-token.ts). */
export const STEP_UP_COOKIE = 'xl-step-up';

/** Sent to the APIs only: the admin actions and passkey management need it. */
export const STEP_UP_COOKIE_PATH = '/api';

/** The 403 body answered when a passkey check is needed (the client prompts and retries). */
export const STEP_UP_REQUIRED_BODY = {
  error: 'step_up_required',
  message: 'Confirm it\u2019s you with your passkey to continue.',
} as const;

/** Route template (relative to /api/admin/, `[id]` = one segment) → methods needing step-up. */
export const STEP_UP_ROUTES: Record<string, readonly Method[]> = {
  // Acting as someone else.
  'impersonate':                          ['POST'],
  // Users: create, edit (role, module access, active), delete, passwords, passkeys.
  'users':                                ['POST'],
  'users/[id]':                           ['PATCH', 'DELETE'],
  'users/[id]/hard-delete':               ['POST'],
  'users/[id]/passkeys':                  ['DELETE'],
  'users/set-password':                   ['POST'],
  // Memberships and invitations grant a role in a tenant.
  'tenants/[id]/users':                   ['POST', 'DELETE'],
  'tenants/[id]/invitations':             ['POST'],
  // Roles and permissions.
  'roles':                                ['POST'],
  'roles/[id]':                           ['PATCH', 'DELETE'],
  'roles/[id]/permissions':               ['PUT'],
  'roles/override':                       ['POST'],
  'nav-permissions':                      ['PUT'],
  // Tenants: plan, modules, deactivation, deletion, sign-in, API credentials.
  'tenants':                              ['POST'],
  'tenants/[id]':                         ['PATCH', 'DELETE'],
  'tenants/[id]/hard-delete':             ['POST'],
  'tenants/[id]/modules':                 ['PUT'],
  'tenants/[id]/sso':                     ['PUT', 'DELETE'],
  'tenants/[id]/api-keys':                ['POST'],
  // Exchange: who acts for a transport partner.
  'exchange/partner-users':               ['POST', 'DELETE'],
  // Platform-wide operations.
  'platform-settings':                    ['PATCH'],
  'migrate/fleet-phase1':                 ['POST'],
  'migrate/indexes':                      ['POST'],
  'migrate/rac-phase1':                   ['POST'],
  'seed':                                 ['POST'],
  'seed/leasing':                         ['POST'],
  'events/outbox/replay':                 ['POST'],
};

/**
 * Go backend admin actions (/api/v1/admin/<template>) with no Next.js
 * route, that need the same step-up. Go cannot see the step-up cookie (it
 * is called with a Bearer token), so it refuses every step-up action in
 * enforce mode; the admin console performs them. See backend/authz.
 */
export const GO_STEP_UP_ROUTES: Record<string, readonly Method[]> = {
  'tenants/[id]/suspend':                 ['POST'],
  'tenants/[id]/offboard':                ['POST'],
};

const ADMIN_PREFIX = '/api/admin/';

function templateToRegExp(template: string): RegExp {
  const body = template
    .split('/')
    .map((seg) => (seg === '[id]' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}/?$`);
}

// Literal templates first ('users/set-password' before 'users/[id]'); a
// path matching several templates needs step-up if any of them lists the
// method, so a `[id]` template can never shadow a literal one.
const COMPILED = Object.entries(STEP_UP_ROUTES)
  .map(([template, methods]) => ({
    template,
    re: templateToRegExp(template),
    methods: new Set<string>(methods),
    params: template.split('/').filter((seg) => seg === '[id]').length,
  }))
  .sort((a, b) => a.params - b.params);

/** The STEP_UP_ROUTES template `method` on `pathname` falls under, or null when no step-up is needed. */
export function stepUpRouteFor(pathname: string, method: string): string | null {
  if (!pathname.startsWith(ADMIN_PREFIX)) return null;
  const upper = method.toUpperCase();
  const rel = pathname.slice(ADMIN_PREFIX.length);
  for (const entry of COMPILED) {
    if (entry.re.test(rel) && entry.methods.has(upper)) return entry.template;
  }
  return null;
}

export type StepUpMode = 'enforce' | 'report' | 'off';

export function stepUpMode(value: string | undefined = process.env.STEP_UP_MODE): StepUpMode {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'report' || v === 'off' ? v : 'enforce';
}

const GO_COMPILED = Object.entries({ ...STEP_UP_ROUTES, ...GO_STEP_UP_ROUTES }).map(([template, methods]) => ({
  re: templateToRegExp(template),
  methods: new Set<string>(methods),
}));

/** Whether the Go backend refuses this /api/admin action for a step-up (any matching template). */
export function goStepUpRequired(pathname: string, method: string): boolean {
  if (!pathname.startsWith(ADMIN_PREFIX)) return false;
  const rel = pathname.slice(ADMIN_PREFIX.length);
  const upper = method.toUpperCase();
  return GO_COMPILED.some((e) => e.re.test(rel) && e.methods.has(upper));
}
