import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST as gatewayEventsPost } from '@/app/api/bus-ops/gateway/events/route';
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

async function ensureBusDeviceTables() {
  for (const table of ['bus_routes', 'trip_schedules', 'trip_passengers', 'staff_members', 'vehicles']) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  }
}

async function createVehicle(tenantId: string) {
  const id = crypto.randomUUID();
  await ensureBusDeviceTables();
  await prisma.$executeRawUnsafe(
    `INSERT INTO vehicles
       (id, tenant_id, make, model, license_plate, status, vehicle_usage, created_at, updated_at)
     VALUES ($1, $2::uuid, 'Toyota', 'Coaster', $3, 'AVAILABLE', 'STAFF', NOW(), NOW())`,
    id,
    tenantId,
    `BUS-${id.slice(0, 8)}`,
  );
  return id;
}

describe('Bus Ops device, check-in, notification, manifest, and route optimisation', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;
  let vehicleId: string;
  let routeId: string;
  let scheduleId: string;
  let staffId: string;
  let passengerId: string;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    await ensureBusDeviceTables();
    vehicleId = await createVehicle(tenantA.tenant.id);

    const route = await makeRequest('POST', '/api/bus-ops/routes', {
      name: `Device Route ${crypto.randomUUID().slice(0, 8)}`,
      origin: 'Depot',
      destination: 'HQ',
      routeType: 'STAFF',
      stops: [
        { stopName: 'Stop A', sequence: 1, gpsLat: 25.2048, gpsLng: 55.2708 },
        { stopName: 'Stop B', sequence: 2, gpsLat: 25.2148, gpsLng: 55.2808 },
        { stopName: 'Stop C', sequence: 3, gpsLat: 25.2248, gpsLng: 55.2608 },
      ],
    }, routeHeaders(tenantA));
    expect(route.status).toBe(201);
    routeId = (await route.json()).id;

    const staff = await makeRequest('POST', '/api/bus-ops/staff', {
      name: 'Device Staff',
      employeeId: `DEV-${crypto.randomUUID().slice(0, 8)}`,
      department: 'Operations',
      email: 'device.staff@example.com',
      contactNumber: '+971500000000',
    }, routeHeaders(tenantA));
    expect(staff.status).toBe(201);
    staffId = (await staff.json()).id;

    const schedule = await makeRequest('POST', '/api/bus-ops/schedules', {
      routeId,
      vehicleId,
      departureTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      status: 'SCHEDULED',
      frequency: 'ONCE',
      capacity: 30,
    }, routeHeaders(tenantA));
    expect(schedule.status).toBe(201);
    scheduleId = (await schedule.json()).id;

    const passenger = await makeRequest('POST', '/api/bus-ops/passengers', {
      tripId: scheduleId,
      staffMemberId: staffId,
      employeeName: 'Device Staff',
      employeeId: 'DEV-STAFF',
      status: 'CONFIRMED',
    }, routeHeaders(tenantA));
    expect(passenger.status).toBe(201);
    passengerId = (await passenger.json()).id;
  }, 120_000);

  afterAll(async () => {
    await ensureBusDeviceTables();
    const tenantIds = [tenantA?.tenant.id, tenantB?.tenant.id].filter(Boolean);
    for (const tenantId of tenantIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM boarding_events WHERE schedule_id::text IN (SELECT id::text FROM trip_schedules WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM bus_pretrip_checks WHERE schedule_id::text IN (SELECT id::text FROM trip_schedules WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM ble_gateway_presence WHERE schedule_id::text IN (SELECT id::text FROM trip_schedules WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM ble_gateways WHERE vehicle_id::text IN (SELECT id::text FROM vehicles WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM vehicle_beacons WHERE vehicle_id::text IN (SELECT id::text FROM vehicles WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM staff_ble_tags WHERE staff_member_id::text IN (SELECT id::text FROM staff_members WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM staff_rfid_tags WHERE staff_member_id::text IN (SELECT id::text FROM staff_members WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM trip_passengers WHERE tenant_id::text = $1`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM trip_schedules WHERE tenant_id::text = $1`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM route_stops WHERE route_id IN (SELECT id FROM bus_routes WHERE tenant_id::text = $1)`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM bus_routes WHERE tenant_id::text = $1`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM staff_members WHERE tenant_id::text = $1`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM vehicles WHERE tenant_id::text = $1`, tenantId).catch(() => {});
    }
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 120_000);

  it('registers tenant-scoped gateway, beacon, BLE tag, and RFID tag devices', async () => {
    if (!serverAvailable) return;

    const gateway = await makeRequest('PUT', `/api/bus-ops/vehicles/${vehicleId}/gateway`, {
      gatewayId: `GW-${vehicleId.slice(0, 8)}`,
      model: 'Fleet360 Gateway',
    }, routeHeaders(tenantA));
    expect(gateway.status).toBe(200);
    expect((await gateway.json()).gatewayId).toContain('GW-');

    const blockedGateway = await makeRequest('GET', `/api/bus-ops/vehicles/${vehicleId}/gateway`, undefined, routeHeaders(tenantB));
    expect(blockedGateway.status).toBe(404);

    const beacon = await makeRequest('PUT', `/api/bus-ops/vehicles/${vehicleId}/beacon`, {
      bleUuid: 'AABBCCDD-0000-1111-2222-333344445555',
      major: 1,
      minor: 2,
    }, routeHeaders(tenantA));
    expect(beacon.status).toBe(200);
    expect((await beacon.json()).bleUuid).toBe('aabbccdd-0000-1111-2222-333344445555');

    const ble = await makeRequest('PUT', `/api/bus-ops/staff/${staffId}/ble-tag`, {
      tagId: `BLE-${staffId.slice(0, 8)}`,
      formFactor: 'CARD',
    }, routeHeaders(tenantA));
    expect(ble.status).toBe(200);

    const rfid = await makeRequest('PUT', `/api/bus-ops/staff/${staffId}/rfid-tag`, {
      tagUid: `aa:bb:${staffId.slice(0, 2)}:${staffId.slice(2, 4)}`,
    }, routeHeaders(tenantA));
    expect(rfid.status).toBe(200);
    expect((await rfid.json()).tagUid).toBe(`AABB${staffId.slice(0, 2).toUpperCase()}${staffId.slice(2, 4).toUpperCase()}`);
  }, 120_000);

  it('supports QR, MANUAL, NFC, and BLE boarding while enforcing tenant boundary', async () => {
    if (!serverAvailable) return;

    const tokenRes = await makeRequest('GET', `/api/bus-ops/schedules/${scheduleId}/qr-token?ttlSeconds=60`, undefined, routeHeaders(tenantA));
    expect(tokenRes.status).toBe(200);
    const token = (await tokenRes.json()).token;

    const qr = await makeRequest('POST', '/api/bus-ops/checkin', {
      method: 'QR',
      token,
      staffMemberId: staffId,
      direction: 'BOARD',
    }, routeHeaders(tenantA));
    expect(qr.status).toBe(200);
    expect((await qr.json()).passenger.status).toBe('BOARDED');

    const manualBlocked = await makeRequest('POST', '/api/bus-ops/checkin', {
      method: 'MANUAL',
      scheduleId,
      passengerId,
      direction: 'BOARD',
    }, routeHeaders(tenantB));
    expect(manualBlocked.status).toBe(404);

    const manual = await makeRequest('POST', '/api/bus-ops/checkin', {
      method: 'MANUAL',
      scheduleId,
      passengerId,
      direction: 'ALIGHT',
    }, routeHeaders(tenantA));
    expect(manual.status).toBe(200);

    const nfc = await makeRequest('POST', '/api/bus-ops/checkin', {
      method: 'NFC',
      scheduleId,
      tagUid: `AA-BB-${staffId.slice(0, 2)}-${staffId.slice(2, 4)}`,
      direction: 'BOARD',
    }, routeHeaders(tenantA));
    expect(nfc.status).toBe(200);

    const ble = await makeRequest('POST', '/api/bus-ops/checkin', {
      method: 'BLE',
      scheduleId,
      staffMemberId: staffId,
      beaconUuid: 'aabbccdd-0000-1111-2222-333344445555',
      rssi: -55,
      direction: 'BOARD',
    }, routeHeaders(tenantA));
    expect(ble.status).toBe(200);

    const eventCount = await prisma.boardingEvent.count({ where: { scheduleId } });
    expect(eventCount).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('ingests signed BLE gateway events and rejects invalid signatures', async () => {
    if (!serverAvailable) return;

    const invalid = await makeRequest('POST', '/api/bus-ops/gateway/events', {
      gatewayId: `GW-${vehicleId.slice(0, 8)}`,
      events: [],
    }, { 'x-gateway-signature': 'bad' });
    expect(invalid.status).toBe(401);

    process.env.BLE_GATEWAY_SHARED_SECRET = 'bus-gateway-e2e-secret';
    const body = JSON.stringify({
      gatewayId: `GW-${vehicleId.slice(0, 8)}`,
      events: [{ kind: 'BOARD', tagId: `BLE-${staffId.slice(0, 8)}`, occurredAt: new Date().toISOString(), rssiDbm: -48 }],
    });
    const signature = crypto.createHmac('sha256', process.env.BLE_GATEWAY_SHARED_SECRET).update(body, 'utf8').digest('hex');
    const req = new NextRequest('http://localhost/api/bus-ops/gateway/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gateway-signature': signature },
      body,
    });
    const res = await gatewayEventsPost(req);
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.summary.transitionsApplied).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('records pre-trip checks, dry-run notifications, manifest PDF exports, and route optimisation', async () => {
    if (!serverAvailable) return;

    const pretrip = await makeRequest('POST', `/api/bus-ops/schedules/${scheduleId}/pretrip-check`, {
      items: [
        { key: 'tyres_pressure', ok: true },
        { key: 'brakes', ok: false, note: 'Soft brake pedal' },
        { key: 'lights_indicators', ok: true },
      ],
      notes: 'E2E pre-trip',
    }, routeHeaders(tenantA));
    expect(pretrip.status).toBe(201);
    const pretripBody = await pretrip.json();
    expect(pretripBody.assessment.overallPass).toBe(false);

    const notify = await makeRequest('POST', `/api/bus-ops/schedules/${scheduleId}/notify`, {
      kind: 'DELAY',
      delayMinutes: 10,
      newDeparture: new Date(Date.now() + 40 * 60_000).toISOString(),
      reason: 'Traffic',
      dryRun: true,
    }, routeHeaders(tenantA));
    expect(notify.status).toBe(200);
    expect((await notify.json()).preview.subject).toContain('Bus delay');

    const manifest = await makeRequest('GET', `/api/bus-ops/schedules/${scheduleId}/manifest/pdf?lang=en`, undefined, routeHeaders(tenantA));
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('content-type')).toContain('application/pdf');

    const preview = await makeRequest('GET', `/api/bus-ops/routes/${routeId}/optimise`, undefined, routeHeaders(tenantA));
    expect(preview.status).toBe(200);
    expect((await preview.json()).ok).toBe(true);

    const apply = await makeRequest('POST', `/api/bus-ops/routes/${routeId}/optimise`, {}, routeHeaders(tenantA));
    expect(apply.status).toBe(200);
    expect((await apply.json()).applied).toBe(true);
  }, 180_000);
  }, 120_000);
