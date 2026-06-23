import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;

type ReadinessApiRow = {
  tenant?: { id: string };
  readiness: {
    score: number;
    metrics: { enabledModules: number };
    checks: Array<{ key: string }>;
    categories?: Array<{ key: string }>;
  };
};

function routeHeaders(seed: SeedResult, role = seed.role.code, extra: Record<string, string> = {}) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    ...extra,
  };
}

describe('Admin tenant readiness dashboard', () => {
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

    await prisma.tenantModule.create({
      data: { tenantId: superAdminSeed.tenant.id, module: 'rac', isEnabled: true },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO auth_login_attempts (tenant_id, user_id, email, success, reason, ip_address, occurred_at)
       VALUES ($1, $2, $3, false, 'invalid-password', '127.0.0.1', NOW())`,
      superAdminSeed.tenant.id,
      superAdminSeed.user.id,
      superAdminSeed.user.email,
    ).catch(() => {});
  }, 60_000);

  afterAll(async () => {
    await Promise.all([
      superAdminSeed ? cleanupTenant(superAdminSeed.tenant.id).then(() => cleanupUser(superAdminSeed.user.id)) : Promise.resolve(),
      tenantAdminSeed ? cleanupTenant(tenantAdminSeed.tenant.id).then(() => cleanupUser(tenantAdminSeed.user.id)) : Promise.resolve(),
      otherTenantSeed ? cleanupTenant(otherTenantSeed.tenant.id).then(() => cleanupUser(otherTenantSeed.user.id)) : Promise.resolve(),
    ]);
  }, 60_000);

  it('returns platform readiness summary and tenant-level next actions', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'GET',
      '/api/admin/tenants/readiness?limit=20',
      undefined,
      routeHeaders(superAdminSeed, 'SUPER_ADMIN'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.total).toBeGreaterThanOrEqual(1);

    const row = (body.tenants as ReadinessApiRow[]).find(item => item.tenant?.id === superAdminSeed.tenant.id);
    expect(row).toBeTruthy();
    if (!row) throw new Error('Seed tenant readiness row not found.');
    expect(row.readiness.score).toBeGreaterThanOrEqual(0);
    expect(row.readiness.metrics.enabledModules).toBe(1);
    expect(row.readiness.checks.some(check => check.key === 'failed-logins')).toBe(true);
  });

  it('embeds the consolidated readiness dashboard in tenant overview', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'GET',
      `/api/admin/tenants/${superAdminSeed.tenant.id}/overview`,
      undefined,
      routeHeaders(superAdminSeed, 'SUPER_ADMIN'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.readinessDashboard.tenantId).toBe(superAdminSeed.tenant.id);
    expect(body.readinessDashboard.categories.length).toBeGreaterThan(0);
    expect(body.readiness.risks.length).toBeGreaterThan(0);
  });

  it('blocks tenant admins from reading another tenant readiness', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'GET',
      `/api/admin/tenants/readiness?tenantId=${otherTenantSeed.tenant.id}`,
      undefined,
      routeHeaders(tenantAdminSeed, 'TENANT_ADMIN'),
    );
    expect(res.status).toBe(403);
  });
});
