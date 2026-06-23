import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { MODULES } from '@/lib/permissions';
import { getTenantActiveModules, moduleAccountFilter } from '@/lib/tenant-context';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
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

async function approveLatestTenantModuleRequest(seed: SeedResult, targetTenantId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM admin_approval_requests
      WHERE requested_by = $1
        AND action = 'tenant.modules.update'
        AND target_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    seed.user.id,
    targetTenantId,
  );
  const id = rows[0]?.id;
  expect(id).toBeTruthy();
  await prisma.$executeRawUnsafe(
    `UPDATE admin_approval_requests SET status = 'APPROVED', decided_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
    id,
  );
  return id;
}

describe('Admin tenant module consistency', () => {
  let superAdminSeed: SeedResult;
  let tenantAdminSeed: SeedResult;
  let otherTenantSeed: SeedResult;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    [superAdminSeed, tenantAdminSeed, otherTenantSeed] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'SUPER_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([
      superAdminSeed ? cleanupTenant(superAdminSeed.tenant.id).then(() => cleanupUser(superAdminSeed.user.id)) : Promise.resolve(),
      tenantAdminSeed ? cleanupTenant(tenantAdminSeed.tenant.id).then(() => cleanupUser(tenantAdminSeed.user.id)) : Promise.resolve(),
      otherTenantSeed ? cleanupTenant(otherTenantSeed.tenant.id).then(() => cleanupUser(otherTenantSeed.user.id)) : Promise.resolve(),
    ]);
  }, 60_000);

  it('queues approval for tenant module changes, then saves canonical aliases after approval', async () => {
    if (!serverAvailable) return;

    const first = await makeRequest(
      'PUT',
      `/api/admin/tenants/${superAdminSeed.tenant.id}/modules`,
      { enabledModules: ['driver', 'bus-ops', 'rental', 'compliance'] },
      routeHeaders(superAdminSeed),
    );
    expect(first.status).toBe(428);

    const approvalId = await approveLatestTenantModuleRequest(superAdminSeed, superAdminSeed.tenant.id);
    const retry = await makeRequest(
      'PUT',
      `/api/admin/tenants/${superAdminSeed.tenant.id}/modules`,
      { enabledModules: ['driver', 'bus-ops', 'rental', 'compliance'] },
      routeHeaders(superAdminSeed, 'SUPER_ADMIN', { 'x-admin-approval-id': approvalId }),
    );
    expect(retry.status).toBe(200);

    const body = await retry.json();
    const modules = body.map((row: { module: string }) => row.module).sort();
    expect(modules).toEqual(['bus_ops', 'compliance', 'drivers', 'rac']);

    const read = await makeRequest(
      'GET',
      `/api/admin/tenants/${superAdminSeed.tenant.id}/modules`,
      undefined,
      routeHeaders(superAdminSeed),
    );
    expect(read.status).toBe(200);
    const saved = await read.json();
    expect(saved.map((row: { module: string }) => row.module).sort()).toEqual(modules);
  }, 120_000);

  it('rejects truly unknown module keys and reports the canonical module set', async () => {
    if (!serverAvailable) return;

    const approvalId = await approveLatestTenantModuleRequest(superAdminSeed, superAdminSeed.tenant.id);
    const res = await makeRequest(
      'PUT',
      `/api/admin/tenants/${superAdminSeed.tenant.id}/modules`,
      { enabledModules: ['drivers', 'dispatch'] },
      routeHeaders(superAdminSeed, 'SUPER_ADMIN', { 'x-admin-approval-id': approvalId }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('dispatch');
    for (const moduleKey of MODULES) expect(body.error).toContain(moduleKey);
  });

  it('blocks tenant admins from reading and changing another tenant modules route', async () => {
    if (!serverAvailable) return;

    const read = await makeRequest(
      'GET',
      `/api/admin/tenants/${otherTenantSeed.tenant.id}/modules`,
      undefined,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(read.status).toBe(403);

    const write = await makeRequest(
      'PUT',
      `/api/admin/tenants/${otherTenantSeed.tenant.id}/modules`,
      { enabledModules: ['fleet'] },
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(write.status).toBe(403);
  });

  it('tenant context reads active modules from the canonical tenant_modules schema', async () => {
    if (!serverAvailable) return;

    const modules = await getTenantActiveModules(superAdminSeed.tenant.id, prisma);
    expect(modules.sort()).toEqual(['bus_ops', 'compliance', 'drivers', 'rac']);

    const filter = moduleAccountFilter(modules);
    expect(filter.racEnabled).toBe(true);
    expect(filter.staffTransportEnabled).toBe(true);
    expect(filter.leasingEnabled).toBe(false);
  });
});
