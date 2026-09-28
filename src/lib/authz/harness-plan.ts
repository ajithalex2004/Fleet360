/**
 * The security harness plan (scripts/security-harness/plan.json): what to
 * probe on a live deployment and what the policy says each system role
 * should get. Generated from the policy code by
 * tests/unit/security-harness-plan.test.ts, which fails when it is stale.
 *
 *   probes     one request per (area × action) of the matrix, every admin
 *              route and method, and every Go route; asked as dry runs
 *              (src/lib/authz/dry-run.ts), so nothing is executed
 *   expected   per system role and plan: one character per probe,
 *              1 = allow, 0 = deny
 *   stepUp     the same for "needs a passkey step-up"
 *   resources  list and detail endpoints for the cross-tenant tests
 *              (discovered from the route files by the generator)
 *
 * Paths use {tenant} for the caller's tenant id and {other} for the other
 * test tenant's id.
 */
import { SYSTEM_ROLES } from '@/lib/permissions';
import { ADMIN_ROUTE_POLICY } from '@/lib/admin-access';
import { decide } from '@/lib/authz/policy';
import { AREAS, GO_ONLY_AREAS, POLICY_VERSION, type Rule } from '@/lib/authz/policy-matrix';
import { goStepUpRequired, stepUpRouteFor } from '@/lib/auth/step-up-policy';
import { GO_ROUTES } from '@/lib/authz/go-routes';

export interface Probe {
  id: string;
  method: string;
  /** Next.js path (/api/…); for backend go, the Go path is /api/v1/… of the same. */
  path: string;
  backend: 'next' | 'go';
  /** What the probe exercises, for the report. */
  label: string;
}

export interface Resource {
  /** Module area, e.g. fleet. */
  area: string;
  list: string;
  /** Detail path with {id}. */
  detail: string;
  /** Write methods the detail route exports. */
  writes: string[];
}

export interface HarnessPlan {
  policyVersion: string;
  probes: Probe[];
  /** role → plan → one character per probe (same order): 1 allow, 0 deny. */
  expected: Record<string, Record<string, string>>;
  /** One character per probe: 1 = needs a passkey step-up. */
  stepUp: string;
  resources: Resource[];
}

const PROBE_ID = 'harness-probe';
const PLANS = ['PRO', 'TRIAL'] as const;

const writeRule = (r: (typeof AREAS)[string]): Rule => ('kind' in r ? r : r.write);
const readRule = (r: (typeof AREAS)[string]): Rule => ('kind' in r ? r : r.read);

function staffProbes(): Probe[] {
  const probes: Probe[] = [];
  const add = (method: string, path: string, label: string) =>
    probes.push({ id: `${method} ${path}`, method, path, backend: 'next', label });

  for (const area of Object.keys(AREAS).sort()) {
    if (area === 'admin' || GO_ONLY_AREAS.includes(area)) continue;
    const read = readRule(AREAS[area]);
    const write = writeRule(AREAS[area]);
    if (read.kind === 'external' || read.kind === 'partner') continue;
    const base = `/api/${area}`;
    if (read.kind === 'module' || write.kind === 'module') {
      add('GET', base, `${area}: view`);
      add('POST', base, `${area}: create`);
      add('PATCH', `${base}/${PROBE_ID}`, `${area}: edit`);
      add('DELETE', `${base}/${PROBE_ID}`, `${area}: delete`);
      add('POST', `${base}/${PROBE_ID}/approve`, `${area}: approve`);
      add('GET', `${base}/export`, `${area}: export`);
    } else {
      add('GET', base, `${area}: read (${read.kind})`);
      add('POST', base, `${area}: write (${write.kind})`);
    }
  }
  for (const [template, methods] of Object.entries(ADMIN_ROUTE_POLICY)) {
    const path = `/api/admin/${template.replace(/^tenants\/\[id\]/, 'tenants/{tenant}').replace(/\[id\]/g, PROBE_ID)}`;
    for (const method of Object.keys(methods)) add(method, path, `admin ${template}: ${method}`);
  }
  // Another tenant, named explicitly: always refused below platform level.
  add('GET', '/api/fleet/vehicles?tenantId={other}', 'cross-tenant selector');
  return probes;
}

function goProbes(): Probe[] {
  return GO_ROUTES.map(([method, path]) => ({
    id: `go ${method} ${path}`,
    method,
    path,
    backend: 'go' as const,
    label: `go: ${method} ${path}`,
  }));
}

/** The concrete path a probe asks, for a tenant and the other tenant. */
export function probePath(path: string, tenant: string, other: string): string {
  return path.replace(/\{tenant\}/g, tenant).replace(/\{other\}/g, other);
}

const bits = (answers: boolean[]) => answers.map((a) => (a ? '1' : '0')).join('');

const PLAN_TENANT = '11111111-1111-4111-8111-111111111111';
const PLAN_OTHER = '22222222-2222-4222-8222-222222222222';

export function buildHarnessPlan(resources: Resource[]): HarnessPlan {
  const probes = [...staffProbes(), ...goProbes()];
  const expected: HarnessPlan['expected'] = {};
  for (const role of SYSTEM_ROLES) {
    const permissions = role.code === 'SUPER_ADMIN'
      ? ['*:*:*']
      : role.permissions.map((p) => `${p.module}:${p.action}:${p.resource}`);
    expected[role.code] = {};
    for (const plan of PLANS) {
      expected[role.code][plan] = bits(probes.map((p) => {
        const url = new URL(probePath(p.path, PLAN_TENANT, PLAN_OTHER), 'http://x');
        return decide(
          { pathname: url.pathname, method: p.method, requestedTenantId: url.searchParams.get('tenantId') },
          { role: role.code, tenantId: PLAN_TENANT, plan, permissions },
        ).allow;
      }));
    }
  }
  return {
    policyVersion: POLICY_VERSION,
    probes,
    expected,
    stepUp: bits(probes.map((p) => {
      const url = new URL(probePath(p.path, PLAN_TENANT, PLAN_OTHER), 'http://x');
      return p.backend === 'go'
        ? goStepUpRequired(url.pathname, p.method)
        : stepUpRouteFor(url.pathname, p.method) !== null;
    })),
    resources,
  };
}
