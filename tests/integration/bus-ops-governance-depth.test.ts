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

function routeHeaders(seed: SeedResult, role = seed.role.code) {
  return {
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    'x-tenant-plan': seed.tenant.plan,
    'x-test-auth-bypass': 'fleet360-test-bypass',
  };
}

async function ensureBusTenantColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE trip_schedules ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE trip_passengers ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE trip_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE staff_transport_requests ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE trip_incidents ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
}

describe('Bus Ops governance depth', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    await ensureBusTenantColumns();
  }, 60_000);

  afterAll(async () => {
    await ensureBusTenantColumns();
    await prisma.$executeRawUnsafe(`DELETE FROM trip_logs WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM trip_passengers WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM staff_transport_requests WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM trip_incidents WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM trip_schedules WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM route_stops WHERE route_id IN (SELECT id FROM bus_routes WHERE tenant_id::text IN ($1,$2))`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM staff_members WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM bus_routes WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id, tenantB?.tenant.id).catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 60_000);

  it('scopes schedules/passengers/staff and writes audit history for Bus Ops mutations', async () => {
    if (!serverAvailable) return;

    const route = await makeRequest('POST', '/api/bus-ops/routes', {
      name: `Governed Route ${crypto.randomUUID().slice(0, 8)}`,
      origin: 'Depot',
      destination: 'HQ',
      routeType: 'STAFF',
    }, routeHeaders(tenantA));
    expect(route.status).toBe(201);
    const routeBody = await route.json();

    const schedule = await makeRequest('POST', '/api/bus-ops/schedules', {
      routeId: routeBody.id,
      departureTime: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'SCHEDULED',
      frequency: 'ONCE',
    }, routeHeaders(tenantA));
    expect(schedule.status).toBe(201);
    const scheduleBody = await schedule.json();

    const passenger = await makeRequest('POST', '/api/bus-ops/passengers', {
      tripId: scheduleBody.id,
      employeeName: 'Governed Passenger',
      status: 'CONFIRMED',
    }, routeHeaders(tenantA));
    expect(passenger.status).toBe(201);
    const passengerBody = await passenger.json();

    const boarded = await makeRequest('PATCH', `/api/bus-ops/passengers/${passengerBody.id}`, {
      status: 'BOARDED',
    }, routeHeaders(tenantA));
    expect(boarded.status).toBe(200);

    const staff = await makeRequest('POST', '/api/bus-ops/staff', {
      name: 'Governed Staff',
      employeeId: `EMP-${crypto.randomUUID().slice(0, 8)}`,
      department: 'Operations',
    }, routeHeaders(tenantA));
    expect(staff.status).toBe(201);
    const staffBody = await staff.json();

    const request = await makeRequest('POST', '/api/bus-ops/transport-requests', {
      staffMemberId: staffBody.id,
      requestType: 'ADHOC',
      tripDate: new Date(Date.now() + 172_800_000).toISOString(),
      reason: 'Governance test',
    }, routeHeaders(tenantA));
    expect(request.status).toBe(201);

    const listA = await makeRequest('GET', '/api/bus-ops/schedules', undefined, routeHeaders(tenantA));
    const schedulesA = await listA.json();
    expect(schedulesA.some((row: { id: string }) => row.id === scheduleBody.id)).toBe(true);

    const listB = await makeRequest('GET', '/api/bus-ops/schedules', undefined, routeHeaders(tenantB));
    const schedulesB = await listB.json();
    expect(schedulesB.some((row: { id: string }) => row.id === scheduleBody.id)).toBe(false);

    const auditRows = await prisma.$queryRawUnsafe<Array<{ entity_type: string; count: bigint }>>(
      `SELECT entity_type, COUNT(*)::bigint AS count
         FROM admin_change_history
        WHERE tenant_id = $1
          AND entity_type IN ('BusTrip','TripPassenger','StaffMember','TransportRequest')
        GROUP BY entity_type`,
      tenantA.tenant.id,
    );
    const counts = Object.fromEntries(auditRows.map(row => [row.entity_type, Number(row.count)]));
    expect(counts.BusTrip).toBeGreaterThan(0);
    expect(counts.TripPassenger).toBeGreaterThan(0);
    expect(counts.StaffMember).toBeGreaterThan(0);
    expect(counts.TransportRequest).toBeGreaterThan(0);
  }, 120_000);

  it('blocks cross-tenant Bus Ops detail access and invalid lifecycle jumps', async () => {
    if (!serverAvailable) return;

    const route = await makeRequest('POST', '/api/bus-ops/routes', {
      name: `Blocked Route ${crypto.randomUUID().slice(0, 8)}`,
      origin: 'Depot',
      destination: 'HQ',
    }, routeHeaders(tenantA));
    const routeBody = await route.json();

    const schedule = await makeRequest('POST', '/api/bus-ops/schedules', {
      routeId: routeBody.id,
      departureTime: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'SCHEDULED',
    }, routeHeaders(tenantA));
    const scheduleBody = await schedule.json();

    const crossTenant = await makeRequest('GET', `/api/bus-ops/schedules/${scheduleBody.id}`, undefined, routeHeaders(tenantB));
    expect(crossTenant.status).toBe(404);

    const invalid = await makeRequest('PATCH', `/api/bus-ops/schedules/${scheduleBody.id}`, {
      status: 'ARCHIVED',
    }, routeHeaders(tenantA));
    expect(invalid.status).toBe(409);
  }, 120_000);
});
