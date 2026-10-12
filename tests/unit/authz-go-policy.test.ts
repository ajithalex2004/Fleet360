/**
 * The Go backend enforces the same authorization policy as Next.js.
 *
 * backend/authz/policy.json (the policy as data) and
 * backend/authz/testdata/vectors.json (requests with the decision Next.js
 * makes) are generated here; backend/authz's Go tests require the same
 * decision for every vector. Regenerate after a policy change with:
 *
 *   UPDATE_AUTHZ_GO_POLICY=1 npx vitest run tests/unit/authz-go-policy.test.ts
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { decide } from '@/lib/authz/policy';
import { encodePermissionClaim, type PermissionClaim } from '@/lib/authz/permission-claim';
import { goPolicyDocument } from '@/lib/authz/go-policy';
import { GO_ROUTES as GO_ROUTE_LIST } from '@/lib/authz/go-routes';
import { areaOf, GO_ONLY_AREAS } from '@/lib/authz/policy-matrix';

const BACKEND = path.resolve(__dirname, '../../backend/authz');
const POLICY_FILE = path.join(BACKEND, 'policy.json');
const VECTORS_FILE = path.join(BACKEND, 'testdata/vectors.json');
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

/** Go's routes, then other rule kinds and edge cases. */
const GO_ROUTES: Array<[string, string]> = [
  ...GO_ROUTE_LIST.map(([m, p]) => [m, p.replace('{tenant}', TENANT)] as [string, string]),
  // Beyond Go's routes: other rule kinds and edge cases.
  ['GET', '/api/logistics/export'], ['POST', '/api/logistics/shipments/s1/approve'],
  ['HEAD', `/api/admin/tenants/${TENANT}`], ['OPTIONS', '/api/admin/tenants'],
  ['GET', '/api/leasing/contracts'], ['POST', '/api/rental/bookings'], ['GET', '/api/reports/export.csv'],
  ['PUT', '/api/billing/plan'], ['GET', '/api/debug/info'], ['GET', '/api/auth/me'], ['GET', '/api/exchange/jobs'],
  ['POST', '/api/webhooks/stripe'], ['GET', '/api/nothing-here'], ['GET', '/api/fleet/'], ['GET', '/api/users'],
  ['POST', '/api/users/u1'],
  ['POST', '/api/admin/users/set-password'], ['PUT', '/api/admin/roles/r1/permissions'], ['POST', '/api/admin/roles/override'],
  ['GET', '/api/admin/roles/r1/permissions'], ['POST', '/api/admin/users/u1/revoke-sessions'],
];

interface Subject { id: string; role: string; plan: string; permissions: string[] | null }

const rolePerms = (code: string) =>
  SYSTEM_ROLES.find((r) => r.code === code)!.permissions.map((p) => `${p.module}:${p.action}:${p.resource}`);

const SUBJECTS: Subject[] = [
  { id: 'super-admin', role: 'SUPER_ADMIN', plan: 'ENTERPRISE', permissions: ['*:*:*'] },
  { id: 'super-admin-no-claim', role: 'SUPER_ADMIN', plan: 'ENTERPRISE', permissions: null },
  { id: 'tenant-admin', role: 'TENANT_ADMIN', plan: 'ENTERPRISE', permissions: rolePerms('TENANT_ADMIN') },
  { id: 'tenant-admin-trial', role: 'TENANT_ADMIN', plan: 'TRIAL', permissions: rolePerms('TENANT_ADMIN') },
  { id: 'fleet-manager', role: 'FLEET_MANAGER', plan: 'PRO', permissions: rolePerms('FLEET_MANAGER') },
  { id: 'rac-operator', role: 'RAC_OPERATOR', plan: 'PRO', permissions: rolePerms('RAC_OPERATOR') },
  { id: 'viewer', role: 'VIEWER', plan: 'PRO', permissions: rolePerms('VIEWER') },
  { id: 'legacy-alias', role: 'CUSTOM', plan: 'PRO', permissions: ['rac:*:*', 'fleet:view:vehicles', 'custom:thing:x'] },
  { id: 'resource-scoped', role: 'CUSTOM', plan: 'PRO', permissions: ['logistics:create:shipments', 'fleet:edit:vehicles', 'maintenance:view:*'] },
  { id: 'empty', role: 'DISPATCHER', plan: 'PRO', permissions: [] },
  { id: 'no-claim', role: 'DISPATCHER', plan: 'PRO', permissions: null },
  { id: 'shipper-portal', role: 'SHIPPER_PORTAL', plan: 'PRO', permissions: null },
  { id: 'no-role', role: '', plan: 'PRO', permissions: ['*:*:*'] },
];

function buildVectors() {
  const subjects = SUBJECTS.map((s) => ({
    ...s,
    claim: s.permissions ? encodePermissionClaim(s.permissions) : null as PermissionClaim | null,
  }));
  const requests: Array<{ method: string; pathname: string; requestedTenantId: string | null }> = [];
  for (const [method, pathname] of GO_ROUTES) {
    requests.push({ method, pathname, requestedTenantId: null });
  }
  requests.push({ method: 'GET', pathname: '/api/fleet/vehicles', requestedTenantId: OTHER_TENANT });
  requests.push({ method: 'GET', pathname: '/api/fleet/vehicles', requestedTenantId: TENANT });
  const cases: Array<[number, number, boolean, string, string | null, string | null]> = [];
  requests.forEach((r, ri) => subjects.forEach((s, si) => {
    const d = decide(r, { role: s.role, tenantId: TENANT, plan: s.plan, permissions: s.permissions });
    cases.push([ri, si, d.allow, d.reason, d.area, d.required ?? null]);
  }));
  return { tenantId: TENANT, subjects, requests, cases };
}

const serialize = (v: unknown) => `${JSON.stringify(v, null, 1)}\n`;

function checkOrWrite(file: string, content: string) {
  if (process.env.UPDATE_AUTHZ_GO_POLICY) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  expect(fs.existsSync(file), `${file} missing: regenerate with UPDATE_AUTHZ_GO_POLICY=1`).toBe(true);
  const actual = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  expect(actual === content, `${path.basename(file)} is out of date: regenerate with UPDATE_AUTHZ_GO_POLICY=1`).toBe(true);
}

describe('Go policy', () => {
  it('every Go-only area is a route the Go backend serves', () => {
    const served = new Set(GO_ROUTES.map(([, p]) => areaOf(p)));
    expect(GO_ONLY_AREAS.filter((a) => !served.has(a))).toEqual([]);
  });

  it('backend/authz/policy.json matches the policy', () => {
    checkOrWrite(POLICY_FILE, serialize(goPolicyDocument()));
  });

  it('backend/authz/testdata/vectors.json matches decide()', () => {
    const vectors = buildVectors();
    // Every decision reason and rule kind is exercised.
    const reasons = new Set(vectors.cases.map((c) => c[3]));
    for (const r of ['granted', 'delegated', 'missing-role', 'cross-tenant', 'platform-only', 'tenant-admin-only',
      'no-permission-claim', 'trial-read-only', 'missing-permission', 'unmapped-route']) {
      expect(reasons.has(r), r).toBe(true);
    }
    expect([...reasons].some((r) => r.startsWith('admin-level:'))).toBe(true);
    checkOrWrite(VECTORS_FILE, serialize(vectors));
  });
});
