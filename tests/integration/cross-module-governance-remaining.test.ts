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

function routeHeaders(seed: SeedResult, role = seed.role.code, extra: Record<string, string> = {}) {
  return {
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    'x-tenant-plan': seed.tenant.plan,
    'x-test-auth-bypass': 'fleet360-test-bypass',
    ...extra,
  };
}

async function ensureTenantColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
}

describe('Cross-module governance rollout for remaining modules', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    await ensureTenantColumns();
  }, 60_000);

  afterAll(async () => {
    await ensureTenantColumns();
    await prisma.$executeRawUnsafe(`DELETE FROM drivers WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM bus_routes WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM maintenance_requests WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM report_schedules WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 60_000);

  it('scopes drivers by tenant, audits create, and rejects invalid status transitions', async () => {
    if (!serverAvailable) return;

    const create = await makeRequest('POST', '/api/drivers', {
      name: 'Governed Driver',
      licenseNumber: `DRV-${crypto.randomUUID()}`,
      status: 'ACTIVE',
    }, routeHeaders(tenantA));
    expect(create.status).toBe(201);
    const driver = await create.json();

    const listA = await makeRequest('GET', '/api/drivers', undefined, routeHeaders(tenantA));
    expect(listA.status).toBe(200);
    const driversA = await listA.json();
    expect(driversA.some((row: { id: string }) => row.id === driver.id)).toBe(true);

    const listB = await makeRequest('GET', '/api/drivers', undefined, routeHeaders(tenantB));
    expect(listB.status).toBe(200);
    const driversB = await listB.json();
    expect(driversB.some((row: { id: string }) => row.id === driver.id)).toBe(false);

    const invalid = await makeRequest('PATCH', `/api/drivers/${driver.id}`, { status: 'COMPLETED' }, routeHeaders(tenantA));
    expect(invalid.status).toBe(409);

    const auditRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM admin_change_history
        WHERE tenant_id = $1
          AND entity_type = 'Driver'
          AND action = 'CREATE'`,
      tenantA.tenant.id,
    );
    expect(Number(auditRows[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  it('audits Bus Ops, Maintenance, and Reports creates under the active tenant', async () => {
    if (!serverAvailable) return;

    const bus = await makeRequest('POST', '/api/bus-ops/routes', {
      name: `Route ${crypto.randomUUID().slice(0, 8)}`,
      origin: 'Depot',
      destination: 'HQ',
      routeType: 'STAFF',
    }, routeHeaders(tenantA));
    expect(bus.status).toBe(201);

    const maintenance = await makeRequest('POST', '/api/maintenance-requests', {
      description: 'Governance test request',
      status: 'Open',
      priority: 'Medium',
      maintenanceType: 'Preventive',
    }, routeHeaders(tenantA));
    expect(maintenance.status).toBe(201);

    const report = await makeRequest('POST', '/api/reports/schedules', {
      reportName: `Governance ${crypto.randomUUID().slice(0, 8)}`,
      reportType: 'FLEET_UTILIZATION',
      frequency: 'DAILY',
      recipients: ['ops@example.com'],
      format: 'PDF',
    }, routeHeaders(tenantA));
    expect(report.status).toBe(201);

    const auditRows = await prisma.$queryRawUnsafe<Array<{ entity_type: string; count: bigint }>>(
      `SELECT entity_type, COUNT(*)::bigint AS count
         FROM admin_change_history
        WHERE tenant_id = $1
          AND entity_type IN ('BusRoute','MaintenanceRequest','ReportSchedule')
          AND action = 'CREATE'
        GROUP BY entity_type`,
      tenantA.tenant.id,
    );
    const counts = Object.fromEntries(auditRows.map(row => [row.entity_type, Number(row.count)]));
    expect(counts.BusRoute).toBeGreaterThan(0);
    expect(counts.MaintenanceRequest).toBeGreaterThan(0);
    expect(counts.ReportSchedule).toBeGreaterThan(0);
  });

  it('blocks tenant-admin query-param attempts on remaining module routes', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'GET',
      `/api/reports/schedules?tenantId=${tenantB.tenant.id}`,
      undefined,
      routeHeaders(tenantA),
    );
    expect(res.status).toBe(403);
  });
});
