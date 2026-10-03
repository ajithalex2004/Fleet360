/**
 * The authorization policy (src/lib/authz): one versioned matrix mapping
 * every API route to one rule, one decision function, and the permission
 * claim signed into sessions.
 *
 *  - every /api route file belongs to an area of the matrix;
 *  - docs/security/AUTHZ_MATRIX.md is generated from the matrix and the
 *    system roles, and must match them (UPDATE_AUTHZ_MATRIX=1 rewrites it);
 *  - allow/deny for every system role × area × method is checked against an
 *    independent reading of SYSTEM_ROLES;
 *  - missing, unknown, removed and cross-tenant roles fail;
 *  - middleware logs denials in report mode and answers 403 in enforce mode.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signSession } from '@/lib/tenant-session';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { AREAS, GO_ONLY_AREAS, areaOf, POLICY_VERSION, type Rule } from '@/lib/authz/policy-matrix';
import { busOpsCapability } from '@/lib/authz/bus-ops-routes';
import { authzMode, decide } from '@/lib/authz/policy';
import { CATALOGUE_VERSION, decodePermissionClaim, encodePermissionClaim } from '@/lib/authz/permission-claim';
import { permissionsForEffectiveRole, systemRolePermissions } from '@/lib/authz/session-permissions';

const API_DIR = path.resolve(__dirname, '../../src/app/api');
const MATRIX_DOC = path.resolve(__dirname, '../../docs/security/AUTHZ_MATRIX.md');
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return e.name === 'route.ts' ? [full] : [];
  });
}

/** /api/… path of a route file, dynamic segments as "x". */
function apiPath(file: string): string {
  const rel = path.relative(API_DIR, path.dirname(file)).split(path.sep)
    .filter((s) => !/^\(.+\)$/.test(s))
    .map((s) => (/^\[.+\]$/.test(s) ? 'x' : s));
  return `/api/${rel.join('/')}`;
}

function exportedMethods(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
}

const ROUTES = routeFiles(API_DIR).map((f) => ({ file: path.relative(API_DIR, f), path: apiPath(f), methods: exportedMethods(f) }));

const subject = (role: string, permissions: string[] | null, plan = 'PROFESSIONAL') => ({ role, tenantId: TENANT, plan, permissions });
const system = (code: string) => subject(code, [...systemRolePermissions(code), ...(code === 'SUPER_ADMIN' ? ['*:*:*'] : [])]);

// ── Coverage ───────────────────────────────────────────────────────────────

describe('policy matrix coverage', () => {
  it('finds the API routes', () => {
    expect(ROUTES.length).toBeGreaterThan(700);
  });

  it('maps every API route file to exactly one area', () => {
    const unmapped = ROUTES.filter((r) => areaOf(r.path) === null).map((r) => r.file);
    expect(unmapped).toEqual([]);
  });

  it('has no area without a route (Next.js, or the Go backend for GO_ONLY_AREAS)', () => {
    const used = new Set(ROUTES.map((r) => areaOf(r.path)));
    expect(Object.keys(AREAS).filter((a) => !used.has(a) && !GO_ONLY_AREAS.includes(a))).toEqual([]);
    expect(GO_ONLY_AREAS.filter((a) => used.has(a)), 'has a Next.js route: not Go-only').toEqual([]);
  });

  it('decides every route and method without an unmapped result', () => {
    for (const r of ROUTES) {
      for (const method of r.methods) {
        expect(decide({ pathname: r.path, method }, system('TENANT_ADMIN')).reason, `${method} ${r.path}`).not.toBe('unmapped-route');
      }
    }
  });

  it('refuses a path outside the matrix', () => {
    expect(decide({ pathname: '/api/not-a-real-area/x', method: 'GET' }, system('SUPER_ADMIN'))).toMatchObject({ allow: false, reason: 'unmapped-route' });
  });
});

// ── The reviewable matrix document ─────────────────────────────────────────

function ruleText(r: Rule): string {
  switch (r.kind) {
    case 'module': return `module \`${r.module}\``;
    case 'admin-level': return 'ADMIN_ROUTE_POLICY';
    default: return r.kind;
  }
}

function renderMatrix(): string {
  const lines: string[] = [];
  lines.push('# Authorization matrix');
  lines.push('');
  lines.push(`Generated from \`src/lib/authz/policy-matrix.ts\` and \`SYSTEM_ROLES\` by \`tests/unit/authz-policy-matrix.test.ts\`.`);
  lines.push('Do not edit by hand: run `UPDATE_AUTHZ_MATRIX=1 npx vitest run tests/unit/authz-policy-matrix.test.ts`.');
  lines.push('');
  lines.push(`- Policy version: \`${POLICY_VERSION}\``);
  lines.push(`- Permission catalogue version: \`${CATALOGUE_VERSION}\` (${ALL_PERMISSIONS.length} permissions)`);
  lines.push('');
  lines.push('## API areas');
  lines.push('');
  lines.push('| Area (`/api/…`) | Routes | Reads (GET) | Writes (POST/PUT/PATCH/DELETE) |');
  lines.push('|---|---:|---|---|');
  for (const area of Object.keys(AREAS).sort()) {
    const r = AREAS[area];
    const count = ROUTES.filter((x) => areaOf(x.path) === area).length;
    const read = 'kind' in r ? r : r.read;
    const write = 'kind' in r ? r : r.write;
    lines.push(`| \`${area}\` | ${count} | ${ruleText(read)} | ${ruleText(write)} |`);
  }
  lines.push('');
  lines.push('## System roles × modules');
  lines.push('');
  lines.push('V view · C create · E edit · D delete · A approve · X export · `*` all resources, `r` some resources only.');
  lines.push('');
  const modules = [...new Set(ALL_PERMISSIONS.map((p) => p.module))].sort();
  lines.push(`| Role | ${modules.join(' | ')} |`);
  lines.push(`|---|${modules.map(() => '---').join('|')}|`);
  const letters: Record<string, string> = { view: 'V', create: 'C', edit: 'E', delete: 'D', approve: 'A', export: 'X', admin: 'M' };
  for (const role of SYSTEM_ROLES) {
    const perms = role.permissions;
    const cells = modules.map((mod) => {
      const parts = Object.entries(letters).flatMap(([action, letter]) => {
        const held = perms.filter((p) => p.module === mod && p.action === action);
        if (!held.length) return [];
        return [held.some((p) => p.resource === '*') ? letter : `${letter}r`];
      });
      return role.code === 'SUPER_ADMIN' ? 'all' : parts.join(' ') || '—';
    });
    lines.push(`| ${role.code} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

describe('matrix document', () => {
  it('matches the policy (regenerate with UPDATE_AUTHZ_MATRIX=1)', () => {
    const rendered = renderMatrix();
    if (process.env.UPDATE_AUTHZ_MATRIX === '1') fs.writeFileSync(MATRIX_DOC, rendered);
    expect(fs.readFileSync(MATRIX_DOC, 'utf8')).toBe(rendered);
  });
});

// ── Allow / deny, generated from the matrix ────────────────────────────────

/** Independent reading of what a system role may do on a module area. */
function expectedModuleAllow(code: string, module: string, action: string, resource: string): boolean {
  if (code === 'SUPER_ADMIN') return true;
  const perms = SYSTEM_ROLES.find((r) => r.code === code)!.permissions.filter((p) => p.module === module);
  if (resource === '*') return perms.some((p) => p.action === action);
  return perms.some((p) => p.action === action && (p.resource === '*' || p.resource === resource));
}

function expectedAllow(code: string, rule: Rule, pathname: string, method: string, required?: string): boolean {
  switch (rule.kind) {
    case 'external': case 'partner': case 'self': return true;
    case 'platform': return code === 'SUPER_ADMIN';
    case 'tenant-admin': return code === 'SUPER_ADMIN' || code === 'TENANT_ADMIN';
    case 'admin-level': return true; // checked against ADMIN_ROUTE_POLICY in admin-access.test.ts
    case 'module': {
      if (rule.module === 'bus-ops' && busOpsCapability(pathname,method)?.action === 'external') return true;
      if (!required) return false;
      const [module, action, resource] = required!.split(':');
      return expectedModuleAllow(code, module, action, resource);
    }
  }
}

describe('allow/deny for every system role, area and method', () => {
  const samples = new Map<string, { path: string; method: string }>();
  for (const r of ROUTES) for (const method of r.methods) samples.set(`${method} ${r.path}`, { path: r.path, method });

  for (const role of SYSTEM_ROLES) {
    it(`${role.code}`, () => {
      const mismatches: string[] = [];
      for (const { path: p, method } of samples.values()) {
        const d = decide({ pathname: p, method }, system(role.code));
        if (d.rule!.kind === 'admin-level') continue;
        const want = expectedAllow(role.code, d.rule!, p, method, d.required);
        if (d.allow !== want) mismatches.push(`${method} ${p} → ${d.allow} (${d.reason}, ${d.required ?? d.rule!.kind})`);
      }
      expect(mismatches).toEqual([]);
    });
  }

  it('grants what each role is for, and denies what it is not', () => {
    const can = (role: string, method: string, p: string) => decide({ pathname: p, method }, system(role)).allow;
    expect(can('TENANT_ADMIN', 'POST', '/api/school-bus/trips')).toBe(true);
    expect(can('TENANT_ADMIN', 'GET', '/api/debug')).toBe(false);
    expect(can('VIEWER', 'GET', '/api/finance/invoices')).toBe(true);
    expect(can('VIEWER', 'POST', '/api/finance/invoices')).toBe(false);
    expect(can('LEASING_OPERATOR', 'POST', '/api/leasing/inquiries')).toBe(true);
    expect(can('LEASING_OPERATOR', 'POST', '/api/leasing/contracts')).toBe(true);
    expect(can('LEASING_OPERATOR', 'DELETE', '/api/leasing/contracts/x')).toBe(false);
    expect(can('LEASING_OPERATOR', 'POST', '/api/leasing/contracts/x/approve')).toBe(false);
    expect(can('FLEET_MANAGER', 'DELETE', '/api/fleet/vehicles/x')).toBe(true);
    expect(can('FLEET_MANAGER', 'POST', '/api/finance/invoices')).toBe(false);
    expect(can('RAC_OPERATOR', 'POST', '/api/users')).toBe(false);
    expect(can('PARTNER', 'GET', '/api/fleet/vehicles')).toBe(false);
    expect(can('SUPER_ADMIN', 'DELETE', '/api/finance/invoices/x')).toBe(true);
  });

  it('reads approvals and exports from the path', () => {
    expect(decide({ pathname: '/api/leasing/contracts/x/approve', method: 'POST' }, system('LEASING_MANAGER')).required).toBe('leasing:approve:contracts');
    expect(decide({ pathname: '/api/finance/export', method: 'GET' }, system('VIEWER'))).toMatchObject({ allow: false, required: 'finance:export:*' });
  });
});

// ── Fail-closed cases ──────────────────────────────────────────────────────

describe('missing, unknown, removed and cross-tenant roles', () => {
  const write = { pathname: '/api/fleet/vehicles', method: 'POST' };
  const read = { pathname: '/api/fleet/vehicles', method: 'GET' };

  it('denies a session without a role', () => {
    expect(decide(read, subject('', systemRolePermissions('TENANT_ADMIN')))).toMatchObject({ allow: false, reason: 'missing-role' });
    expect(decide({ pathname: '/api/notifications', method: 'GET' }, subject('', []))).toMatchObject({ allow: false, reason: 'missing-role' });
  });

  it('denies an unknown role with no permissions', () => {
    expect(decide(read, subject('HACKER', []))).toMatchObject({ allow: false, reason: 'missing-permission' });
    expect(decide({ pathname: '/api/users', method: 'POST' }, subject('HACKER', []))).toMatchObject({ allow: false, reason: 'tenant-admin-only' });
  });

  it('denies a session without a permission claim (removed or legacy)', () => {
    expect(decide(write, subject('TENANT_ADMIN', null))).toMatchObject({ allow: false, reason: 'no-permission-claim' });
  });

  it('denies a request naming another tenant, except for a platform admin', () => {
    const cross = { ...write, requestedTenantId: OTHER_TENANT };
    expect(decide(cross, system('TENANT_ADMIN'))).toMatchObject({ allow: false, reason: 'cross-tenant' });
    expect(decide(cross, system('SUPER_ADMIN'))).toMatchObject({ allow: true });
  });

  it('keeps trial tenants read-only outside the trial-free modules', () => {
    const trial = { ...system('TENANT_ADMIN'), plan: 'TRIAL' };
    expect(decide({ pathname: '/api/finance/invoices', method: 'POST' }, trial)).toMatchObject({ allow: false, reason: 'trial-read-only' });
    expect(decide({ pathname: '/api/finance/invoices', method: 'GET' }, trial).allow).toBe(true);
    expect(decide({ pathname: '/api/fleet/vehicles', method: 'POST' }, trial).allow).toBe(true);
  });

  it('gives a tenant role coded SUPER_ADMIN no wildcard, and another tenant\'s role nothing', () => {
    const tenantRole = { id: 'r', code: 'SUPER_ADMIN', name: 'x', isOverride: false, isPlatform: false, sourceRoleId: 'r', permissions: ['fleet:view:*'] };
    expect(permissionsForEffectiveRole(tenantRole)).toEqual(['fleet:view:*']);
    expect(permissionsForEffectiveRole(null)).toEqual([]);
  });

  it('uses the code catalogue for a platform system role, the database for overrides', () => {
    const platform = { id: 'r', code: 'VIEWER', name: 'Viewer', isOverride: false, isPlatform: true, sourceRoleId: 'r', permissions: ['stale:view:*'] };
    expect(permissionsForEffectiveRole(platform)).toEqual(systemRolePermissions('VIEWER'));
    const override = { ...platform, isOverride: true, isPlatform: false, permissions: ['fleet:view:*'] };
    expect(permissionsForEffectiveRole(override)).toEqual(['fleet:view:*']);
  });
});

// ── Permission claim ───────────────────────────────────────────────────────

describe('permission claim', () => {
  it('round-trips permissions, extras and the wildcard compactly', () => {
    const perms = [...systemRolePermissions('TENANT_ADMIN'), 'custom:view:thing', '*:*:*'];
    const claim = encodePermissionClaim(perms);
    expect(new Set(decodePermissionClaim(claim))).toEqual(new Set(perms));
    expect(JSON.stringify(claim).length).toBeLessThan(200);
  });

  it('treats a claim from another catalogue version, or a malformed one, as absent', () => {
    const claim = encodePermissionClaim(['fleet:view:*']);
    expect(decodePermissionClaim({ ...claim, v: 'deadbeef' })).toBeNull();
    expect(decodePermissionClaim({ v: claim.v })).toBeNull();
    expect(decodePermissionClaim(undefined)).toBeNull();
  });
});

// ── Middleware ─────────────────────────────────────────────────────────────

describe('middleware', () => {
  const saved = process.env.AUTHZ_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTHZ_MODE;
    else process.env.AUTHZ_MODE = saved;
    vi.restoreAllMocks();
  });

  async function call(pathname: string, method: string, role: string, permissions?: string[]) {
    const token = await signSession({ userId: 'user-1', tenantId: TENANT, plan: 'ENTERPRISE', role, permissions });
    return middleware(new NextRequest(`http://localhost${pathname}`, { method, headers: { cookie: `xl-session=${token}` } }));
  }

  it('always enforces Bus Ops even when global authorization is off', async () => {
    process.env.AUTHZ_MODE = 'off';
    expect((await call('/api/bus-ops/schedules/x/depart', 'POST', 'VIEWER', systemRolePermissions('VIEWER'))).status).toBe(403);
  });

  it('defaults to report mode', () => {
    expect(authzMode(undefined)).toBe('report');
    expect(authzMode('ENFORCE')).toBe('enforce');
    expect(authzMode('nonsense')).toBe('report');
  });

  it('report mode logs a would-be denial and lets the request through', async () => {
    delete process.env.AUTHZ_MODE;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await call('/api/finance/invoices', 'POST', 'VIEWER', systemRolePermissions('VIEWER'));
    expect(res.status).toBe(200);
    const logged = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"authz"'));
    expect(JSON.parse(logged!)).toMatchObject({ authz: 'would-deny', policy: POLICY_VERSION, reason: 'missing-permission', required: 'finance:create:invoices', role: 'VIEWER' });
  });

  it('report mode stays quiet for sessions issued before the claim existed', async () => {
    delete process.env.AUTHZ_MODE;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await call('/api/fleet/vehicles', 'POST', 'TENANT_ADMIN')).status).toBe(200);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('"authz"'))).toBe(false);
  });

  it('enforce mode answers 403 and allows what the role grants', async () => {
    process.env.AUTHZ_MODE = 'enforce';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const denied = await call('/api/finance/invoices', 'POST', 'VIEWER', systemRolePermissions('VIEWER'));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ reason: 'missing-permission', required: 'finance:create:invoices' });
    expect((await call('/api/finance/invoices', 'GET', 'VIEWER', systemRolePermissions('VIEWER'))).status).toBe(200);
    expect((await call('/api/finance/invoices', 'POST', 'FINANCE_MANAGER', systemRolePermissions('FINANCE_MANAGER'))).status).toBe(200);
    // A session signed without permissions is denied.
    expect((await call('/api/fleet/vehicles', 'POST', 'TENANT_ADMIN')).status).toBe(403);
  });
});

// ── Effective role resolution ──────────────────────────────────────────────

describe('effective role', () => {
  const role = (tenantId: string | null, code = 'CUSTOM') => ({
    id: `role-${tenantId ?? 'platform'}`, code, name: code, tenantId,
    permissions: [{ permission: { module: 'fleet', action: 'view', resource: '*' } }],
  });
  const tx = (assigned: ReturnType<typeof role>, override: ReturnType<typeof role> | null = null) => ({
    userTenant: { findUnique: async () => ({ isActive: true, role: assigned }) },
    role: { findUnique: async () => override },
  });

  it('never treats a tenant\'s own role as a platform role', async () => {
    const { getEffectiveRole } = await import('@/lib/permissions/effective-role');
    const r = await getEffectiveRole(tx(role(TENANT, 'SUPER_ADMIN')) as never, 'u', TENANT);
    expect(r).toMatchObject({ isPlatform: false, isOverride: false });
    expect(permissionsForEffectiveRole(r)).not.toContain('*:*:*');
  });

  it('gives a role owned by another tenant no permissions', async () => {
    const { getEffectiveRole } = await import('@/lib/permissions/effective-role');
    expect(await getEffectiveRole(tx(role(OTHER_TENANT)) as never, 'u', TENANT)).toBeNull();
  });

  it('gives the platform SUPER_ADMIN the wildcard', async () => {
    const { getEffectiveRole } = await import('@/lib/permissions/effective-role');
    const r = await getEffectiveRole(tx(role(null, 'SUPER_ADMIN')) as never, 'u', TENANT);
    expect(permissionsForEffectiveRole(r)).toContain('*:*:*');
  });
});
