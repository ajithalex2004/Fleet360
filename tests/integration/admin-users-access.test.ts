import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  cleanupTenant,
  cleanupUser,
  createTestUser,
  createTestUserTenant,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;

function routeHeaders(seed: SeedResult, role = seed.role.code) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
  };
}

describe('Admin Users access and persistence', () => {
  let superAdminSeed: SeedResult;
  let tenantAdminSeed: SeedResult;
  let otherTenantSeed: SeedResult;
  let managedUserId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    [superAdminSeed, tenantAdminSeed, otherTenantSeed] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'SUPER_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);

    const managedUser = await createTestUser();
    managedUserId = managedUser.id;
    await createTestUserTenant(managedUser.id, superAdminSeed.tenant.id, superAdminSeed.role.id);
  }, 60_000);

  afterAll(async () => {
    if (managedUserId) await cleanupUser(managedUserId);
    await Promise.all([
      superAdminSeed ? cleanupTenant(superAdminSeed.tenant.id).then(() => cleanupUser(superAdminSeed.user.id)) : Promise.resolve(),
      tenantAdminSeed ? cleanupTenant(tenantAdminSeed.tenant.id).then(() => cleanupUser(tenantAdminSeed.user.id)) : Promise.resolve(),
      otherTenantSeed ? cleanupTenant(otherTenantSeed.tenant.id).then(() => cleanupUser(otherTenantSeed.user.id)) : Promise.resolve(),
    ]);
  }, 60_000);

  it('persists module access using canonical module keys and preset permissions', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'PATCH',
      `/api/admin/users/${managedUserId}`,
      {
        moduleAccess: {
          driver: { role: 'manager' },
          'bus-ops': { role: 'operator' },
          rental: true,
        },
      },
      routeHeaders(superAdminSeed),
    );

    expect(res.status).toBe(200);
    const stored = await prisma.user.findUnique({
      where: { id: managedUserId },
      select: { moduleAccess: true },
    });
    const access = stored?.moduleAccess as Record<string, { role: string; permissions: string[] }>;

    expect(Object.keys(access).sort()).toEqual(['bus_ops', 'drivers', 'rac']);
    expect(access.drivers.role).toBe('manager');
    expect(access.bus_ops.role).toBe('operator');
    expect(access.rac.role).toBe('viewer');
    expect(access.drivers.permissions.some(p => p.startsWith('drivers:edit:'))).toBe(true);
    expect(access.rac.permissions).toEqual(['rac:view:*']);
  });

  it('soft deletes a user and removes them from the default active listing', async () => {
    if (!serverAvailable) return;

    const del = await makeRequest('DELETE', `/api/admin/users/${managedUserId}`, undefined, routeHeaders(superAdminSeed));
    expect(del.status).toBe(200);

    const activeRes = await makeRequest('GET', '/api/admin/users?isActive=true', undefined, routeHeaders(superAdminSeed));
    expect(activeRes.status).toBe(200);
    const activeUsers = await activeRes.json();
    expect(activeUsers.some((u: { id: string }) => u.id === managedUserId)).toBe(false);

    const inactiveRes = await makeRequest('GET', '/api/admin/users?isActive=false', undefined, routeHeaders(superAdminSeed));
    expect(inactiveRes.status).toBe(200);
    const inactiveUsers = await inactiveRes.json();
    expect(inactiveUsers.some((u: { id: string }) => u.id === managedUserId)).toBe(true);
  });

  it('blocks tenant admins from editing users outside their tenant', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'PATCH',
      `/api/admin/users/${otherTenantSeed.user.id}`,
      { firstName: 'CrossTenantBlocked' },
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );

    expect(res.status).toBe(403);
  });

  it('blocks tenant admins from assigning users through another tenant route', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'POST',
      `/api/admin/tenants/${otherTenantSeed.tenant.id}/users`,
      { userId: tenantAdminSeed.user.id, roleId: otherTenantSeed.role.id },
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );

    expect(res.status).toBe(403);
  });

  it('presents tenant admin role aliases with canonical labels in role and user APIs', async () => {
    if (!serverAvailable) return;

    const aliasRole = await prisma.role.create({
      data: {
        tenantId: superAdminSeed.tenant.id,
        code: 'Tenant_Admin',
        name: 'Tenant Admin',
        description: 'Misaligned seed role',
        isSystem: false,
      },
    });
    const aliasUser = await createTestUser();
    await createTestUserTenant(aliasUser.id, superAdminSeed.tenant.id, aliasRole.id);

    try {
      const rolesRes = await makeRequest(
        'GET',
        `/api/admin/roles?tenantId=${superAdminSeed.tenant.id}`,
        undefined,
        routeHeaders(superAdminSeed),
      );
      expect(rolesRes.status).toBe(200);
      const roles = await rolesRes.json();
      const role = roles.find((r: { id: string }) => r.id === aliasRole.id);
      expect(role).toMatchObject({ code: 'TENANT_ADMIN', name: 'Tenant Administrator' });

      const usersRes = await makeRequest(
        'GET',
        `/api/admin/users?tenantId=${superAdminSeed.tenant.id}`,
        undefined,
        routeHeaders(superAdminSeed),
      );
      expect(usersRes.status).toBe(200);
      const users = await usersRes.json();
      const user = users.find((u: { id: string }) => u.id === aliasUser.id);
      expect(user).toMatchObject({ roleCode: 'TENANT_ADMIN', roleName: 'Tenant Administrator' });
      expect(user.tenants[0]).toMatchObject({ roleCode: 'TENANT_ADMIN', roleName: 'Tenant Administrator' });
    } finally {
      await cleanupUser(aliasUser.id);
      await prisma.role.delete({ where: { id: aliasRole.id } }).catch(() => {});
    }
  });
});
