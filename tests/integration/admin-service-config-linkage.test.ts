import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { ensureSeededForTenant } from '@/lib/service-config/schema';
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

async function latestApprovalId(seed: SeedResult, action: string, targetId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM admin_approval_requests
      WHERE requested_by = $1
        AND action = $2
        AND target_id = $3
      ORDER BY created_at DESC
      LIMIT 1`,
    seed.user.id,
    action,
    targetId,
  );
  const id = rows[0]?.id;
  expect(id).toBeTruthy();
  await prisma.$executeRawUnsafe(
    `UPDATE admin_approval_requests
        SET status = 'APPROVED', decided_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid`,
    id,
  );
  return id;
}

async function seededServiceType(seed: SeedResult) {
  await ensureSeededForTenant(seed.tenant.id);
  const types = await prisma.$queryRawUnsafe<Array<{ id: string; key: string; name: string }>>(
    `SELECT id::text, key, name
       FROM service_types
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY sort_order, name`,
    seed.tenant.id,
  );
  const type = types.find(t => t.key === 'MAINTENANCE') ?? types[0];
  expect(type?.id).toBeTruthy();
  return type;
}

describe('Admin Service Configuration linkage', () => {
  let tenantAdminSeed: SeedResult;
  let otherTenantSeed: SeedResult;
  let typeId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    [tenantAdminSeed, otherTenantSeed] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    typeId = (await seededServiceType(tenantAdminSeed)).id;
    await seededServiceType(otherTenantSeed);
  }, 180_000);

  afterAll(async () => {
    if (tenantAdminSeed?.user?.id) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE requested_by = $1`, tenantAdminSeed.user.id).catch(() => {});
    }
    await Promise.all([
      tenantAdminSeed ? cleanupTenant(tenantAdminSeed.tenant.id).then(() => cleanupUser(tenantAdminSeed.user.id)) : Promise.resolve(),
      otherTenantSeed ? cleanupTenant(otherTenantSeed.tenant.id).then(() => cleanupUser(otherTenantSeed.user.id)) : Promise.resolve(),
    ]);
  }, 60_000);

  it('saves module mapping aliases after approval and reloads the canonical mapping', async () => {
    if (!serverAvailable) return;

    const first = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/module-mapping`,
      {
        linkedModule: 'bus_ops',
        subModule: 'Staff Ops',
        workflowEngineEnabled: true,
        notificationEngineEnabled: true,
        approvalEngineEnabled: true,
        financeEngineEnabled: false,
        dispatchEngineEnabled: true,
      },
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(first.status).toBe(428);

    const approvalId = await latestApprovalId(tenantAdminSeed, 'service_config.module_mapping.update', typeId);
    const retry = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/module-mapping`,
      {
        linkedModule: 'bus_ops',
        subModule: 'Staff Ops',
        workflowEngineEnabled: true,
        notificationEngineEnabled: true,
        approvalEngineEnabled: true,
        financeEngineEnabled: false,
        dispatchEngineEnabled: true,
      },
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN', { 'x-admin-approval-id': approvalId }),
    );
    expect(retry.status).toBe(200);
    const saved = await retry.json();
    expect(saved.mapping).toMatchObject({
      linked_module: 'STAFF_TRANSPORT',
      sub_module: 'Staff Ops',
      workflow_engine_enabled: true,
      approval_engine_enabled: true,
      dispatch_engine_enabled: true,
    });

    const reload = await makeRequest(
      'GET',
      `/api/admin/service-config/types/${typeId}/module-mapping`,
      undefined,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(reload.status).toBe(200);
    const body = await reload.json();
    expect(body.mapping).toMatchObject({ linked_module: 'STAFF_TRANSPORT', sub_module: 'Staff Ops' });
  }, 90_000);

  it('rejects invalid module mappings before queueing approval', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/module-mapping`,
      { linkedModule: 'dispatch', notificationEngineEnabled: true },
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('linkedModule must be one of');
  }, 60_000);

  it('saves rules after approval and exposes immutable rule history', async () => {
    if (!serverAvailable) return;

    const firstRules = {
      responseSlaMinutes: 45,
      resolutionSlaHours: 12,
      businessHoursOnly: true,
      ignoredByServer: 'nope',
    };
    const first = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/rules/sla`,
      firstRules,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(first.status).toBe(428);
    const firstApproval = await latestApprovalId(tenantAdminSeed, 'service_config.rules.update', typeId);
    const firstRetry = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/rules/sla`,
      firstRules,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN', { 'x-admin-approval-id': firstApproval }),
    );
    expect(firstRetry.status).toBe(200);

    const secondRules = { responseSlaMinutes: 30, resolutionSlaHours: 8, businessHoursOnly: false };
    const second = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/rules/sla`,
      secondRules,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(second.status).toBe(428);
    const secondApproval = await latestApprovalId(tenantAdminSeed, 'service_config.rules.update', typeId);
    const secondRetry = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/rules/sla`,
      secondRules,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN', { 'x-admin-approval-id': secondApproval }),
    );
    expect(secondRetry.status).toBe(200);

    const current = await makeRequest(
      'GET',
      `/api/admin/service-config/types/${typeId}/rules/sla`,
      undefined,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(current.status).toBe(200);
    const currentBody = await current.json();
    expect(currentBody.rules.responseSlaMinutes).toBe(30);
    expect(currentBody.rules.ignoredByServer).toBeUndefined();

    const history = await makeRequest(
      'GET',
      `/api/admin/service-config/types/${typeId}/rules/sla/history`,
      undefined,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    expect(historyBody.versions.length).toBeGreaterThanOrEqual(2);
    expect(historyBody.versions[0].active).toBe(true);
    expect(historyBody.versions.some((v: { active: boolean }) => v.active === false)).toBe(true);
  }, 120_000);

  it('keeps tenant admins scoped to their own tenant service types', async () => {
    if (!serverAvailable) return;

    const read = await makeRequest(
      'GET',
      `/api/admin/service-config/types/${typeId}/module-mapping`,
      undefined,
      routeHeaders(otherTenantSeed, 'TENANT_ADMIN'),
    );
    expect(read.status).toBe(404);

    const write = await makeRequest(
      'PUT',
      `/api/admin/service-config/types/${typeId}/rules/sla`,
      { responseSlaMinutes: 5 },
      routeHeaders(otherTenantSeed, 'TENANT_ADMIN'),
    );
    expect(write.status).toBe(404);
  }, 60_000);
});
