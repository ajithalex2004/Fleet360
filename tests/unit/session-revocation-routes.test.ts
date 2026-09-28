/**
 * Where access changes, sessions are revoked: role change or membership
 * removal, user and tenant deactivation, role permission edits, password
 * changes, sign out everywhere; and /api/users no longer exposes or edits
 * users outside the caller's tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const revoked = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const db = vi.hoisted(() => ({
  existingMembership: null as null | { id: string; roleId: string },
  member: true,
  tenantMembers: [] as unknown[],
}));

vi.mock('@/lib/auth/session-revocation', () => ({
  revokeSessions: vi.fn(async (s: Record<string, unknown>) => { revoked.push(s); }),
  revokeSessionsSafely: vi.fn(async (s: Record<string, unknown>) => { revoked.push(s); return true; }),
  holdersOfRole: vi.fn(async () => ({ tenantId: 'tenant-a' })),
  revokeRoleHolders: vi.fn(async (h: unknown, reason: string) => { revoked.push({ holders: h, reason }); }),
}));

const tx = {
  userTenant: {
    findUnique: vi.fn(async () => (db.member ? { id: 'ut', user: { id: 'u2', email: 'x@y', username: 'x', firstName: 'X', lastName: 'Y', isActive: true, createdAt: new Date() }, role: { code: 'VIEWER', name: 'Viewer' }, ...(db.existingMembership ?? {}) } : null)),
    findMany: vi.fn(async (args: { where: { tenantId: string } }) => { db.tenantMembers.push(args.where); return []; }),
    update: vi.fn(async (a: { data: unknown }) => ({ id: 'ut', ...(a.data as object) })),
    create: vi.fn(async (a: { data: unknown }) => ({ id: 'ut', ...(a.data as object) })),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  },
  user: { update: vi.fn(async () => ({ id: 'u2' })), findUnique: vi.fn(async () => ({ id: 'u2' })) },
  role: { findUnique: vi.fn(async () => ({ id: 'r2', tenantId: 'tenant-a', code: 'VIEWER' })) },
  tenant: { update: vi.fn(async () => ({ id: 'tenant-a' })), findUnique: vi.fn(async () => ({ id: 'tenant-a', isActive: true })) },
  rolePermission: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(async () => []) },
  $executeRawUnsafe: vi.fn(async () => 1),
  $queryRawUnsafe: vi.fn(async () => []),
};
// The test alias of next/server is a stub without response cookies.
vi.mock('next/server', async () => await import('next/server.js'));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: vi.fn(async (_p: unknown, fn: (t: unknown) => unknown) => fn(tx)),
  withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx)),
}));
vi.mock('@/lib/server-cache', () => ({ revalidateCache: vi.fn(), cacheRead: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/admin-scope', async (orig) => ({
  ...(await orig<object>()),
  checkGrantableRole: () => null,
  checkRoleAccess: async () => ({ denied: null, owner: 'tenant-a' }),
}));

import { NextRequest } from 'next/server';

const headers = (role = 'SUPER_ADMIN', tenant = 'tenant-a') => ({
  'content-type': 'application/json', 'x-user-id': 'admin-1', 'x-tenant-id': tenant, 'x-user-role': role,
});
const req = (url: string, method: string, body?: unknown, role?: string, tenant?: string) =>
  new NextRequest(`http://localhost${url}`, { method, headers: headers(role, tenant), ...(body ? { body: JSON.stringify(body) } : {}) });
const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  revoked.length = 0;
  db.existingMembership = null;
  db.member = true;
  db.tenantMembers = [];
});

describe('membership and role changes', () => {
  it('revokes the user in the tenant when their role changes, not on a first assignment', async () => {
    const { POST } = await import('@/app/api/admin/tenants/[id]/users/route');
    db.existingMembership = { id: 'ut', roleId: 'r1' };
    const vUser = '33333333-3333-4333-8333-333333333333';
    await POST(req('/api/admin/tenants/tenant-a/users', 'POST', { userId: vUser, roleId: 'r2' }), params({ id: 'tenant-a' }));
    expect(revoked).toEqual([expect.objectContaining({ userId: vUser, tenantId: 'tenant-a', reason: 'role-changed' })]);
  });

  it('revokes the user in the tenant when their membership is removed', async () => {
    const { DELETE } = await import('@/app/api/admin/tenants/[id]/users/route');
    await DELETE(req('/api/admin/tenants/tenant-a/users?userId=u2', 'DELETE'), params({ id: 'tenant-a' }));
    expect(revoked).toEqual([expect.objectContaining({ userId: 'u2', tenantId: 'tenant-a', reason: 'membership-removed' })]);
  });

  it('revokes every session of a deactivated user', async () => {
    const mod = await import('@/app/api/admin/users/[id]/route');
    await mod.PATCH(req('/api/admin/users/u2', 'PATCH', { isActive: false }), params({ id: 'u2' }));
    await mod.DELETE(req('/api/admin/users/u2', 'DELETE'), params({ id: 'u2' }));
    expect(revoked.map((r) => r.reason)).toEqual(['user-deactivated', 'user-deactivated']);
    expect(revoked.every((r) => r.userId === 'u2' && !r.tenantId)).toBe(true);
  });

  it('revokes the tenant when it is deactivated', async () => {
    const { DELETE } = await import('@/app/api/admin/tenants/[id]/route');
    await DELETE(req('/api/admin/tenants/tenant-a', 'DELETE'), params({ id: 'tenant-a' }));
    expect(revoked).toEqual([expect.objectContaining({ tenantId: 'tenant-a', reason: 'tenant-deactivated' })]);
  });

  it('revokes a role\'s holders when its permissions change', async () => {
    const { PUT } = await import('@/app/api/admin/roles/[id]/permissions/route');
    await PUT(req('/api/admin/roles/r2/permissions', 'PUT', { permissionIds: [] }, 'TENANT_ADMIN'), params({ id: 'r2' }));
    expect(revoked).toEqual([{ holders: { tenantId: 'tenant-a' }, reason: 'role-permissions-changed' }]);
  });
});

describe('sign out everywhere', () => {
  it('revokes all the caller\'s sessions and clears the cookie', async () => {
    const { POST } = await import('@/app/api/auth/logout-all/route');
    const res = await POST(req('/api/auth/logout-all', 'POST', undefined, 'VIEWER'));
    expect(res.status).toBe(200);
    expect(revoked).toEqual([expect.objectContaining({ userId: 'admin-1', reason: 'signed-out-everywhere' })]);
    expect(res.headers.get('set-cookie')).toMatch(/xl-session=;/);
  });

  it('lets a tenant admin revoke a member in their own tenant only', async () => {
    const { POST } = await import('@/app/api/admin/users/[id]/revoke-sessions/route');
    const ok = await POST(req('/api/admin/users/u2/revoke-sessions', 'POST', undefined, 'TENANT_ADMIN'), params({ id: 'u2' }));
    expect(await ok.json()).toMatchObject({ scope: 'tenant' });
    expect(revoked[0]).toMatchObject({ userId: 'u2', tenantId: 'tenant-a' });

    db.member = false;
    const denied = await POST(req('/api/admin/users/u9/revoke-sessions', 'POST', undefined, 'TENANT_ADMIN'), params({ id: 'u9' }));
    expect(denied.status).toBe(404);
    expect(revoked).toHaveLength(1);
  });
});

describe('/api/users', () => {
  it('lists only the caller\'s tenant members', async () => {
    const { GET } = await import('@/app/api/users/route');
    expect((await GET(req('/api/users', 'GET', undefined, 'VIEWER'))).status).toBe(200);
    expect(db.tenantMembers).toEqual([{ tenantId: 'tenant-a', isActive: true }]);
  });

  it('no longer creates, edits or deletes users', async () => {
    const list = await import('@/app/api/users/route');
    const one = await import('@/app/api/users/[id]/route');
    expect('POST' in list).toBe(false);
    expect('PATCH' in one || 'DELETE' in one).toBe(false);
  });

  it('hides a user who is not a member of the caller\'s tenant', async () => {
    const { GET } = await import('@/app/api/users/[id]/route');
    db.member = false;
    expect((await GET(req('/api/users/u9', 'GET', undefined, 'VIEWER'), params({ id: 'u9' }))).status).toBe(404);
  });
});
