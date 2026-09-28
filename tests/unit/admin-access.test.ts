/**
 * tests/unit/admin-access.test.ts
 *
 * Role policy for /api/admin/* (src/lib/admin-access.ts), the middleware
 * gate that enforces it, and the tenant-ownership rules admin handlers use
 * (src/lib/admin-scope.ts).
 *
 * Background: most /api/admin routes had no role check, so any signed-in
 * user of any tenant could e.g. reset any user's password
 * (/api/admin/users/set-password) or assign the platform SUPER_ADMIN role
 * (/api/admin/tenants/[id]/users).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';

// vitest.config.ts aliases next/server to a stub without NextResponse.next()
// or cookies; the middleware tests need the real module.
vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signSession, verifySession } from '@/lib/tenant-session';
import { signStepUp } from '@/lib/auth/step-up-token';
import {
  ADMIN_ROUTE_POLICY,
  requiredAdminLevel,
  roleSatisfies,
} from '@/lib/admin-access';
import { checkGrantableRole, checkOwnership } from '@/lib/admin-scope';

const ADMIN_DIR = path.resolve(__dirname, '../../src/app/api/admin');
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return e.name === 'route.ts' ? [full] : [];
  });
}

/** Route path relative to /api/admin/, with every dynamic segment as [id]. */
function templateFor(file: string): string {
  return path
    .relative(ADMIN_DIR, path.dirname(file))
    .split(path.sep)
    .map((seg) => (/^\[.+\]$/.test(seg) ? '[id]' : seg))
    .join('/');
}

function exportedMethods(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
}

describe('ADMIN_ROUTE_POLICY covers every admin route', () => {
  // /api/admin/session is a public route (auth-route-policies.ts PUBLIC_EXACT)
  // and never reaches the admin gate.
  const files = routeFiles(ADMIN_DIR).filter((f) => templateFor(f) !== 'session');

  it('finds the admin routes', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  for (const file of files) {
    const template = templateFor(file);
    for (const method of exportedMethods(file)) {
      it(`${method} /api/admin/${template} has an explicit level`, () => {
        const entry = ADMIN_ROUTE_POLICY[template];
        expect(entry, `add '${template}' to ADMIN_ROUTE_POLICY`).toBeDefined();
        expect(entry?.[method as keyof typeof entry], `add ${method} for '${template}'`).toBeDefined();
      });
    }
  }

  it('has no stale entries for routes that no longer exist', () => {
    const existing = new Set(files.map(templateFor));
    const stale = Object.keys(ADMIN_ROUTE_POLICY).filter((t) => !existing.has(t));
    expect(stale).toEqual([]);
  });
});

describe('requiredAdminLevel', () => {
  it('fails closed to platform for unknown routes and methods', () => {
    expect(requiredAdminLevel('/api/admin/something-new', 'GET')).toBe('platform');
    expect(requiredAdminLevel('/api/admin/billing', 'DELETE')).toBe('platform');
  });

  it('matches dynamic segments and a trailing slash', () => {
    expect(requiredAdminLevel(`/api/admin/tenants/${TENANT_A}/users`, 'POST')).toBe('admin');
    expect(requiredAdminLevel('/api/admin/billing/', 'GET')).toBe('member');
  });

  it('treats HEAD as GET and leaves OPTIONS to the handler', () => {
    expect(requiredAdminLevel('/api/admin/billing', 'HEAD')).toBe('member');
    expect(requiredAdminLevel('/api/admin/users/set-password', 'OPTIONS')).toBeNull();
  });

  it('keeps the takeover-grade endpoints platform-only', () => {
    expect(requiredAdminLevel('/api/admin/users/set-password', 'POST')).toBe('platform');
    expect(requiredAdminLevel('/api/admin/users/abc', 'PATCH')).toBe('platform');
    expect(requiredAdminLevel(`/api/admin/tenants/${TENANT_A}`, 'PATCH')).toBe('platform');
    expect(requiredAdminLevel(`/api/admin/tenants/${TENANT_A}/modules`, 'PUT')).toBe('platform');
    expect(requiredAdminLevel('/api/admin/roles', 'POST')).toBe('platform');
    expect(requiredAdminLevel('/api/admin/migrate/indexes', 'POST')).toBe('platform');
  });
});

describe('roleSatisfies', () => {
  it.each([
    ['SUPER_ADMIN', 'platform', true],
    ['SUPER_ADMIN', 'admin', true],
    ['TENANT_ADMIN', 'platform', false],
    ['TENANT_ADMIN', 'admin', true],
    ['TENANT_ADMIN', 'member', true],
    ['DRIVER', 'admin', false],
    ['DRIVER', 'member', true],
    ['', 'member', false],
    [null, 'member', false],
  ] as const)('%s at %s → %s', (role, level, expected) => {
    expect(roleSatisfies(role, level)).toBe(expected);
  });
});

// Carries a passkey step-up for the session, so these tests exercise the
// role policy alone (the step-up gate: tests/unit/step-up.test.ts).
async function adminRequest(pathname: string, method: string, role: string) {
  const token = await signSession({ userId: 'user-1', tenantId: TENANT_A, plan: 'ENTERPRISE', role });
  const session = await verifySession(token);
  const stepUp = await signStepUp({ userId: 'user-1', tenantId: TENANT_A, issuedAt: session!.issuedAt });
  return middleware(new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { cookie: `xl-session=${token}; xl-step-up=${stepUp}` },
  }));
}

describe('middleware admin gate', () => {
  it('blocks a driver from resetting passwords', async () => {
    const res = await adminRequest('/api/admin/users/set-password', 'POST', 'DRIVER');
    expect(res.status).toBe(403);
  });

  it('blocks a tenant admin from platform-only endpoints', async () => {
    for (const [p, m] of [
      ['/api/admin/users/set-password', 'POST'],
      ['/api/admin/users', 'POST'],
      [`/api/admin/tenants/${TENANT_A}`, 'PATCH'],
      [`/api/admin/tenants/${TENANT_A}/modules`, 'PUT'],
      ['/api/admin/platform-settings', 'PATCH'],
      ['/api/admin/not-in-the-policy', 'GET'],
    ]) {
      expect((await adminRequest(p, m, 'TENANT_ADMIN')).status, `${m} ${p}`).toBe(403);
    }
  });

  it('lets a tenant admin reach tenant-admin endpoints', async () => {
    const res = await adminRequest(`/api/admin/tenants/${TENANT_A}/users`, 'POST', 'TENANT_ADMIN');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe('TENANT_ADMIN');
  });

  it('blocks a dispatcher from tenant-admin endpoints but not member ones', async () => {
    expect((await adminRequest(`/api/admin/tenants/${TENANT_A}/users`, 'POST', 'DISPATCHER')).status).toBe(403);
    expect((await adminRequest('/api/admin/billing', 'GET', 'DISPATCHER')).status).toBe(200);
    expect((await adminRequest('/api/admin/workflow-instances', 'GET', 'DISPATCHER')).status).toBe(200);
  });

  it('lets a super admin through platform endpoints', async () => {
    const res = await adminRequest('/api/admin/users/set-password', 'POST', 'SUPER_ADMIN');
    expect(res.status).toBe(200);
  });

  it('does not gate non-admin API paths', async () => {
    const res = await adminRequest('/api/bus-ops/schedules', 'GET', 'DRIVER');
    expect(res.status).toBe(200);
  });
});

function headersFor(role: string) {
  return new Headers({ 'x-user-role': role, 'x-tenant-id': TENANT_A });
}

describe('checkOwnership', () => {
  const admin = headersFor('TENANT_ADMIN');

  it('allows own-tenant reads and writes', () => {
    expect(checkOwnership(admin, TENANT_A, TENANT_A, 'read')).toBeNull();
    expect(checkOwnership(admin, TENANT_A, TENANT_A, 'write')).toBeNull();
  });

  it('allows reading but not changing platform records', () => {
    expect(checkOwnership(admin, TENANT_A, null, 'read')).toBeNull();
    expect(checkOwnership(admin, TENANT_A, null, 'write')?.status).toBe(403);
  });

  it('hides another tenant’s records', () => {
    expect(checkOwnership(admin, TENANT_A, TENANT_B, 'read')?.status).toBe(404);
    expect(checkOwnership(admin, TENANT_A, TENANT_B, 'write')?.status).toBe(404);
  });

  it('returns 404 for missing records and lets super admins do anything', () => {
    expect(checkOwnership(admin, TENANT_A, undefined, 'read')?.status).toBe(404);
    expect(checkOwnership(headersFor('SUPER_ADMIN'), TENANT_A, TENANT_B, 'write')).toBeNull();
    expect(checkOwnership(headersFor('SUPER_ADMIN'), TENANT_A, null, 'write')).toBeNull();
  });
});

describe('checkGrantableRole', () => {
  it('stops a tenant admin granting SUPER_ADMIN', () => {
    const res = checkGrantableRole(headersFor('TENANT_ADMIN'), TENANT_A, { code: 'SUPER_ADMIN', tenantId: null });
    expect(res?.status).toBe(403);
  });

  it('stops anyone granting another tenant’s role', () => {
    const role = { code: 'FLEET_MANAGER', tenantId: TENANT_B };
    expect(checkGrantableRole(headersFor('TENANT_ADMIN'), TENANT_A, role)?.status).toBe(400);
    expect(checkGrantableRole(headersFor('SUPER_ADMIN'), TENANT_A, role)?.status).toBe(400);
  });

  it('allows platform roles other than SUPER_ADMIN and own-tenant roles', () => {
    const h = headersFor('TENANT_ADMIN');
    expect(checkGrantableRole(h, TENANT_A, { code: 'FLEET_MANAGER', tenantId: null })).toBeNull();
    expect(checkGrantableRole(h, TENANT_A, { code: 'TENANT_ADMIN', tenantId: TENANT_A })).toBeNull();
  });

  it('lets a super admin grant SUPER_ADMIN', () => {
    expect(checkGrantableRole(headersFor('SUPER_ADMIN'), TENANT_A, { code: 'SUPER_ADMIN', tenantId: null })).toBeNull();
  });
});
