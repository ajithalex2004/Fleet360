/**
 * The single authorization decision for staff API requests: one function,
 * one matrix (src/lib/authz/policy-matrix.ts), one permission set (the
 * signed session claim, src/lib/authz/permission-claim.ts).
 *
 * Middleware calls decide() for every /api request that carries a verified
 * staff session. AUTHZ_MODE picks what happens to a denial:
 *   report   (default) log it as {"authz":"would-deny",…} and let it through,
 *            so the matrix can be checked against real traffic first
 *   enforce  answer 403
 *   off      don't evaluate
 *
 * Denials are fail-closed: a missing or unknown role, a session without a
 * permission claim, a role another tenant owns (no permissions), or a
 * request naming another tenant all deny.
 *
 * Edge-runtime safe (no Node APIs).
 */
import { busOpsCapability } from '@/lib/authz/bus-ops-routes';
import { ALL_PERMISSIONS, hasPermission } from '@/lib/permissions';
import { requiredAdminLevel, roleSatisfies, SUPER_ADMIN } from '@/lib/admin-access';
import { TRIAL_FREE_MODULES } from '@/lib/access-control';
import { AREAS, areaOf, POLICY_VERSION, type Rule } from '@/lib/authz/policy-matrix';

export { POLICY_VERSION };

export interface PolicySubject {
  role: string | null | undefined;
  tenantId: string;
  plan?: string | null;
  /** Effective permissions from the session claim; null when the session has none. */
  permissions: readonly string[] | null;
}

export interface PolicyRequest {
  pathname: string;
  method: string;
  /** ?tenantId= on the request, if any. */
  requestedTenantId?: string | null;
}

export type Decision = {
  allow: boolean;
  /** Why: 'granted' | 'delegated' | 'missing-role' | 'no-permission-claim' | … */
  reason: string;
  area: string | null;
  rule: Rule | null;
  /** The permission a module rule required, module:action:resource. */
  required?: string;
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Catalogue resources per module, to recognise the resource named in a path. */
const RESOURCES = new Map<string, Set<string>>();
for (const p of ALL_PERMISSIONS) {
  if (p.resource === '*') continue;
  if (!RESOURCES.has(p.module)) RESOURCES.set(p.module, new Set());
  RESOURCES.get(p.module)!.add(p.resource);
}

function actionFor(method: string, segments: string[]): 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' {
  const upper = method.toUpperCase();
  if (segments.some((s) => /export/i.test(s) || /\.csv$/i.test(s))) return 'export';
  if (WRITE_METHODS.has(upper) && segments.some((s) => /^(approve|approval|approvals|reject|decision)$/i.test(s))) return 'approve';
  if (upper === 'POST') return 'create';
  if (upper === 'PUT' || upper === 'PATCH') return 'edit';
  if (upper === 'DELETE') return 'delete';
  return 'view';
}

function resourceFor(module: string, segments: string[]): string {
  const known = RESOURCES.get(module);
  if (!known) return '*';
  for (const s of segments) {
    if (known.has(s)) return s;
    const underscored = s.replace(/-/g, '_');
    if (known.has(underscored)) return underscored;
  }
  return '*';
}

/** Whether `permissions` grant `action` on `module` for some resource. */
function holdsAnyResource(permissions: readonly string[], module: string, action: string): boolean {
  if (hasPermission([...permissions], module, action)) return true;
  return permissions.some((p) => p.startsWith(`${module}:${action}:`) || p === `${module}:*:*`);
}

function ruleFor(area: string, method: string): Rule {
  const r = AREAS[area];
  if ('kind' in r) return r;
  return WRITE_METHODS.has(method.toUpperCase()) ? r.write : r.read;
}

export function decide(req: PolicyRequest, subject: PolicySubject): Decision {
  const area = areaOf(req.pathname);
  if (!area) return { allow: false, reason: 'unmapped-route', area: null, rule: null };
  const rule = ruleFor(area, req.method);
  const base = { area, rule };

  if (rule.kind === 'external' || rule.kind === 'partner') {
    // Authorized by the area's own credential or partner membership.
    return { allow: true, reason: 'delegated', ...base };
  }

  const role = typeof subject.role === 'string' ? subject.role.trim() : '';
  if (!role) return { allow: false, reason: 'missing-role', ...base };

  if (req.requestedTenantId && req.requestedTenantId !== subject.tenantId && role !== SUPER_ADMIN) {
    return { allow: false, reason: 'cross-tenant', ...base };
  }

  switch (rule.kind) {
    case 'self':
      return { allow: true, reason: 'granted', ...base };
    case 'platform':
      return role === SUPER_ADMIN
        ? { allow: true, reason: 'granted', ...base }
        : { allow: false, reason: 'platform-only', ...base };
    case 'tenant-admin':
      return roleSatisfies(role, 'admin')
        ? { allow: true, reason: 'granted', ...base }
        : { allow: false, reason: 'tenant-admin-only', ...base };
    case 'admin-level': {
      const level = requiredAdminLevel(req.pathname, req.method);
      return !level || roleSatisfies(role, level)
        ? { allow: true, reason: 'granted', ...base }
        : { allow: false, reason: `admin-level:${level}`, ...base };
    }
    case 'module': {
      if (rule.module === 'bus-ops' && req.pathname.startsWith('/api/bus-ops/')) {
        const capability = busOpsCapability(req.pathname, req.method);
        if (!capability) return { allow: false, reason: 'unmapped-route', ...base };
        if (capability.action === 'external') return { allow: true, reason: 'delegated', ...base };
        const required = `bus-ops:${capability.action}:${capability.resource}`;
        if (subject.plan === 'TRIAL' && capability.action !== 'view') return { allow: false, reason: 'trial-read-only', required, ...base };
        return { allow: role === SUPER_ADMIN || hasPermission([...(subject.permissions ?? [])], 'bus-ops', capability.action, capability.resource), reason: 'bus-ops-capability', required, ...base };
      }
      const segments = req.pathname.slice('/api/'.length).split('/').slice(area.split('/').length);
      const action = rule.action ?? actionFor(req.method, segments);
      const resource = resourceFor(rule.module, segments);
      const required = `${rule.module}:${action}:${resource}`;
      if (role === SUPER_ADMIN) return { allow: true, reason: 'granted', required, ...base };
      if (!subject.permissions) return { allow: false, reason: 'no-permission-claim', required, ...base };
      // Trial tenants are read-only outside the trial-free modules.
      if (subject.plan === 'TRIAL' && action !== 'view'
          && !(TRIAL_FREE_MODULES as readonly string[]).includes(rule.module)) {
        return { allow: false, reason: 'trial-read-only', required, ...base };
      }
      const granted = resource === '*'
        ? holdsAnyResource(subject.permissions, rule.module, action)
        : hasPermission([...subject.permissions], rule.module, action, resource);
      return granted
        ? { allow: true, reason: 'granted', required, ...base }
        : { allow: false, reason: 'missing-permission', required, ...base };
    }
  }
}

export type AuthzMode = 'report' | 'enforce' | 'off';

export function authzMode(value: string | undefined = process.env.AUTHZ_MODE): AuthzMode {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'enforce' || v === 'off' ? v : 'report';
}
