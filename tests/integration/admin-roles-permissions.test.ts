import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  cleanupTenant,
  cleanupUser,
  createAuthHeaders,
  createSessionToken,
  createTestUser,
  createTestUserTenant,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
  type TestUser,
} from '../setup';

let serverAvailable = false;

function routeHeaders(seed: SeedResult, role = seed.role.code, extra: Record<string, string> = {}) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    ...extra,
  };
}

async function permission(module: string, action: string, resource = '*') {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO permissions (id, module, action, resource, label, description)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (module, action, resource)
     DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    randomUUID(),
    module,
    action,
    resource,
    `${module}:${action}:${resource}`,
    'Admin roles integration test permission',
  );
  return rows[0].id;
}

async function approve(approvalId: string, seed: SeedResult, user: TestUser) {
  const token = await createSessionToken(user.id, seed.tenant.id, seed.tenant.plan, 'TENANT_ADMIN');
  const res = await makeRequest(
    'POST',
    `/api/admin/approvals/${approvalId}/vote`,
    { decision: 'APPROVE', note: 'roles integration approval' },
    {
      ...createAuthHeaders(token),
      'x-user-id': user.id,
      'x-tenant-id': seed.tenant.id,
      'x-user-role': 'TENANT_ADMIN',
    },
  );
  expect(res.status).toBe(200);
}

describe('Admin Roles & Permissions granular API flow', () => {
  let seed: SeedResult;
  let otherSeed: SeedResult;
  let approverOne: TestUser;
  let approverTwo: TestUser;
  let assignedUser: TestUser;
  let viewPerm = '';
  let editPerm = '';
  let exportPerm = '';
  let sourceSystemRoleId = '';
  const roleIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    [seed, otherSeed] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);

    [viewPerm, editPerm, exportPerm] = await Promise.all([
      permission('admin_roles_test', 'view'),
      permission('admin_roles_test', 'edit'),
      permission('admin_roles_test', 'export'),
    ]);

    sourceSystemRoleId = randomUUID();
    await prisma.role.create({
      data: {
        id: sourceSystemRoleId,
        name: 'System Role Template',
        code: `SYS_TEMPLATE_${Date.now()}`,
        description: 'Template for clone testing',
        tenantId: null,
        isSystem: true,
        permissions: {
          create: [{ permissionId: viewPerm }, { permissionId: editPerm }],
        },
      },
    });
    roleIds.push(sourceSystemRoleId);

    [approverOne, approverTwo, assignedUser] = await Promise.all([
      createTestUser(),
      createTestUser(),
      createTestUser(),
    ]);
    await Promise.all([
      createTestUserTenant(approverOne.id, seed.tenant.id, seed.role.id),
      createTestUserTenant(approverTwo.id, seed.tenant.id, seed.role.id),
    ]);
    userIds.push(seed.user.id, otherSeed.user.id, approverOne.id, approverTwo.id, assignedUser.id);
  }, 180_000);

  afterAll(async () => {
    for (const userId of userIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE actor_user_id = $1`, userId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE user_id = $1`, userId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE requested_by = $1`, userId).catch(() => {});
    }
    for (const roleId of roleIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM role_versions WHERE role_id = $1`, roleId).catch(() => {});
      await prisma.rolePermission.deleteMany({ where: { roleId } }).catch(() => {});
      await prisma.userTenant.deleteMany({ where: { roleId } }).catch(() => {});
      await prisma.role.delete({ where: { id: roleId } }).catch(() => {});
    }
    await Promise.all([
      approverOne ? cleanupUser(approverOne.id) : Promise.resolve(),
      approverTwo ? cleanupUser(approverTwo.id) : Promise.resolve(),
      assignedUser ? cleanupUser(assignedUser.id) : Promise.resolve(),
      seed ? cleanupTenant(seed.tenant.id).then(() => cleanupUser(seed.user.id)) : Promise.resolve(),
      otherSeed ? cleanupTenant(otherSeed.tenant.id).then(() => cleanupUser(otherSeed.user.id)) : Promise.resolve(),
    ]);
  }, 90_000);

  it('clones a system role into the tenant, compares roles, and previews affected users', async () => {
    if (!serverAvailable) return;

    const clone = await makeRequest(
      'POST',
      `/api/admin/roles/${sourceSystemRoleId}/clone`,
      {
        name: 'Tenant Clone Role',
        code: `TENANT_CLONE_${Date.now()}`,
      },
      routeHeaders(seed),
    );
    expect(clone.status).toBe(201);
    const clonedRole = await clone.json();
    roleIds.push(clonedRole.id);
    expect(clonedRole).toMatchObject({
      tenantId: seed.tenant.id,
      isSystem: false,
    });
    expect(clonedRole._count.permissions).toBe(2);

    await createTestUserTenant(assignedUser.id, seed.tenant.id, clonedRole.id);

    const custom = await makeRequest(
      'POST',
      '/api/admin/roles',
      {
        name: 'Tenant Compare Role',
        code: `TENANT_COMPARE_${Date.now()}`,
        description: 'Compare target',
        permissionIds: [viewPerm, exportPerm],
      },
      routeHeaders(seed),
    );
    expect(custom.status).toBe(201);
    const comparedRole = await custom.json();
    roleIds.push(comparedRole.id);

    const compare = await makeRequest(
      'GET',
      `/api/admin/roles/compare?leftId=${clonedRole.id}&rightId=${comparedRole.id}`,
      undefined,
      routeHeaders(seed),
    );
    expect(compare.status).toBe(200);
    const compareBody = await compare.json();
    expect(compareBody.added.map((p: { key: string }) => p.key)).toContain('admin_roles_test:export:*');
    expect(compareBody.removed.map((p: { key: string }) => p.key)).toContain('admin_roles_test:edit:*');
    expect(compareBody.affectedUsers.leftRoleUsers).toBe(1);

    const preview = await makeRequest(
      'GET',
      `/api/admin/roles/${clonedRole.id}/permissions?previewPermissionIds=${viewPerm},${exportPerm}`,
      undefined,
      routeHeaders(seed),
    );
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody).toMatchObject({
      roleId: clonedRole.id,
      affectedUsers: 1,
      currentPermissionCount: 2,
      proposedPermissionCount: 2,
    });
    expect(previewBody.added.map((p: { id: string }) => p.id)).toContain(exportPerm);
    expect(previewBody.removed.map((p: { id: string }) => p.id)).toContain(editPerm);

    const crossTenantCompare = await makeRequest(
      'GET',
      `/api/admin/roles/compare?leftId=${clonedRole.id}&rightId=${otherSeed.role.id}`,
      undefined,
      routeHeaders(seed),
    );
    expect(crossTenantCompare.status).toBe(403);
  }, 120_000);

  it('captures immutable role versions and requires two-actor approval before rollback', async () => {
    if (!serverAvailable) return;

    const created = await makeRequest(
      'POST',
      '/api/admin/roles',
      {
        name: 'Rollback Test Role',
        code: `ROLLBACK_TEST_${Date.now()}`,
        description: 'Initial role',
        permissionIds: [viewPerm],
      },
      routeHeaders(seed),
    );
    expect(created.status).toBe(201);
    const role = await created.json();
    roleIds.push(role.id);

    const updatePerms = await makeRequest(
      'PUT',
      `/api/admin/roles/${role.id}/permissions`,
      { permissionIds: [viewPerm, editPerm] },
      routeHeaders(seed),
    );
    expect(updatePerms.status).toBe(200);

    const versions = await makeRequest(
      'GET',
      `/api/admin/roles/${role.id}/versions`,
      undefined,
      routeHeaders(seed),
    );
    expect(versions.status).toBe(200);
    const versionsBody = await versions.json();
    expect(versionsBody.versions.length).toBeGreaterThanOrEqual(2);
    const createVersion = versionsBody.versions.find((v: any) => v.change_type === 'CREATE');
    expect(createVersion?.id).toBeTruthy();
    expect(createVersion.snapshot_json.permissions.length).toBe(1);

    const queued = await makeRequest(
      'POST',
      `/api/admin/roles/${role.id}/versions`,
      { action: 'rollback', versionId: createVersion.id },
      routeHeaders(seed),
    );
    expect(queued.status).toBe(428);
    const queuedBody = await queued.json();
    expect(queuedBody.approvalRequest?.id).toBeTruthy();

    await approve(queuedBody.approvalRequest.id, seed, approverOne);
    await approve(queuedBody.approvalRequest.id, seed, approverTwo);

    const rollback = await makeRequest(
      'POST',
      `/api/admin/roles/${role.id}/versions`,
      { action: 'rollback', versionId: createVersion.id },
      routeHeaders(seed, 'TENANT_ADMIN', { 'x-admin-approval-id': queuedBody.approvalRequest.id }),
    );
    expect(rollback.status).toBe(200);
    const rollbackBody = await rollback.json();
    expect(rollbackBody.role.permissions.map((p: { id: string }) => p.id)).toEqual([viewPerm]);

    const history = await prisma.$queryRawUnsafe<Array<{ action: string; before_json: any; after_json: any }>>(
      `SELECT action, before_json, after_json
         FROM admin_change_history
        WHERE entity_type = 'Role'
          AND entity_id = $1
        ORDER BY created_at DESC`,
      role.id,
    );
    expect(history.some(row => row.action === 'ROLLBACK')).toBe(true);
    expect(history.some(row => row.action === 'UPDATE')).toBe(true);
  }, 120_000);
});
