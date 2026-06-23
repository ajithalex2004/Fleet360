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

describe('Cross-module governance foundation', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);

    await prisma.$executeRawUnsafe(`ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
    await prisma.$executeRawUnsafe(`ALTER TABLE rental_bookings ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  }, 60_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
    await prisma.$executeRawUnsafe(`ALTER TABLE rental_bookings ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_bookings WHERE tenant_id IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_customers WHERE tenant_id IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 60_000);

  it('blocks tenant-admin query-param attempts against another tenant', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'GET',
      `/api/finance/invoices?tenantId=${tenantB.tenant.id}`,
      undefined,
      routeHeaders(tenantA),
    );
    expect(res.status).toBe(403);
  });

  it('scopes RAC bookings to the authenticated tenant and writes audit history', async () => {
    if (!serverAvailable) return;

    const customerA = crypto.randomUUID();
    const customerB = crypto.randomUUID();
    const bookingB = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_customers (id, tenant_id, full_name, created_at, updated_at)
       VALUES ($1,$2,'Tenant A Customer',NOW(),NOW()), ($3,$4,'Tenant B Customer',NOW(),NOW())`,
      customerA,
      tenantA.tenant.id,
      customerB,
      tenantB.tenant.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_bookings
         (id, tenant_id, customer_id, pickup_date, dropoff_date, status, created_at, updated_at)
       VALUES ($1,$2,$3,NOW(),NOW() + INTERVAL '1 day','PENDING',NOW(),NOW())`,
      bookingB,
      tenantB.tenant.id,
      customerB,
    );

    const create = await makeRequest(
      'POST',
      '/api/rental/bookings',
      {
        customerId: customerA,
        pickupDate: new Date().toISOString(),
        dropoffDate: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'PENDING',
      },
      routeHeaders(tenantA),
    );
    expect(create.status).toBe(201);
    const created = await create.json();

    const list = await makeRequest('GET', '/api/rental/bookings', undefined, routeHeaders(tenantA));
    expect(list.status).toBe(200);
    const body = await list.json();
    const ids = (body.data as Array<{ id: string }>).map(row => row.id);
    expect(ids).toContain(created.id);
    expect(ids).not.toContain(bookingB);

    const auditRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM admin_change_history
        WHERE tenant_id = $1
          AND entity_type = 'RentalBooking'
          AND action = 'CREATE'`,
      tenantA.tenant.id,
    );
    expect(Number(auditRows[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  it('rejects invalid cross-module status transitions', async () => {
    if (!serverAvailable) return;

    const customerA = crypto.randomUUID();
    const bookingA = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_customers (id, tenant_id, full_name, created_at, updated_at)
       VALUES ($1,$2,'Transition Customer',NOW(),NOW())`,
      customerA,
      tenantA.tenant.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_bookings
         (id, tenant_id, customer_id, pickup_date, dropoff_date, status, created_at, updated_at)
       VALUES ($1,$2,$3,NOW(),NOW() + INTERVAL '1 day','PENDING',NOW(),NOW())`,
      bookingA,
      tenantA.tenant.id,
      customerA,
    );

    const res = await makeRequest(
      'PATCH',
      `/api/rental/bookings/${bookingA}`,
      { status: 'COMPLETED' },
      routeHeaders(tenantA),
    );
    expect(res.status).toBe(409);
  });
});
