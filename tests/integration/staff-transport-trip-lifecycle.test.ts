/**
 * tests/integration/staff-transport-trip-lifecycle.test.ts
 *
 * End-to-end integration test for the driver-controlled trip
 * lifecycle. Exercises:
 *   - POST /api/driver-app/trips/[id]/start  (status flip + transition log)
 *   - POST /api/driver-app/trips/[id]/end    (status flip + duration)
 *   - Idempotency (double-tap doesn't double-write)
 *   - 409 for invalid state transitions
 *   - GET  /api/driver-app/today/assignments  (returns new lifecycle fields)
 *   - 401 for unauthenticated requests
 *
 * Run: npx vitest run tests/integration/staff-transport-trip-lifecycle.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';

let serverUp = false;
let seed: SeedResult | undefined;
let tripId = '';
let otherTripId = '';
let busRouteId = '';

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('dev server not up â€” tests will skip');
    return;
  }
  seed = await seedTestTenantFull();

  const prisma = new PrismaClient();
  try {
    const routes = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bus_routes WHERE deleted_at IS NULL LIMIT 1
    `;
    busRouteId = routes[0]?.id ?? '';
    if (!busRouteId) throw new Error('no bus_routes row â€” cannot seed test trip');

    tripId = crypto.randomUUID();
    otherTripId = crypto.randomUUID();

    await prisma.$executeRaw`
      INSERT INTO trip_schedules (
        id, tenant_id, driver_id, vehicle_id, route_id,
        departure_time, arrival_time, status, direction,
        trip_number, capacity, created_at, updated_at
      ) VALUES (
        ${tripId}, ${seed.tenant.id}::uuid, ${seed.user.id}::text, '', ${busRouteId},
        NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '40 minutes',
        'SCHEDULED', 'OUTBOUND', 'LIFECYCLE-IT-1', 30, NOW(), NOW()
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO trip_schedules (
        id, tenant_id, driver_id, vehicle_id, route_id,
        departure_time, arrival_time, status, direction,
        trip_number, capacity, created_at, updated_at
      ) VALUES (
        ${otherTripId}, ${seed.tenant.id}::uuid, ${seed.user.id}::text, '', ${busRouteId},
        NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '40 minutes',
        'SCHEDULED', 'OUTBOUND', 'LIFECYCLE-IT-2', 30, NOW(), NOW()
      )
    `;
  } finally {
    await prisma.$disconnect();
  }
});

afterAll(async () => {
  if (!serverUp) return;
  const prisma = new PrismaClient();
  try {
    for (const id of [tripId, otherTripId]) {
      if (id) {
        await prisma.$executeRaw`DELETE FROM trip_state_transitions WHERE trip_id = ${id}`;
        await prisma.$executeRaw`DELETE FROM trip_schedules WHERE id = ${id}`;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
});

// We use `it` directly. The dev server is required to be running
// (the previous tests in this repo have the same assumption). If
// the server is down, the test will fail with a clear connection
// error in the response, which is what we want â€” silent skipping
// would let broken state changes go unnoticed.
describe('Trip lifecycle (driver-controlled)', () => {
  it('GET /today/assignments returns the new lifecycle fields', async () => {
    const r = await makeRequest('GET', '/api/driver-app/today/assignments', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    const t = body.trips.find((x: { id: string }) => x.id === tripId);
    expect(t).toBeTruthy();
    expect(t).toHaveProperty('actualDepartureAt');
    expect(t).toHaveProperty('actualArrivalAt');
    expect(t).toHaveProperty('lateMinutes');
    expect(t).toHaveProperty('durationMinutes');
    expect(t.actualDepartureAt).toBeNull();
  });

  it('driver Start â†’ 200, IN_PROGRESS, transition logged', async () => {
    const r = await makeRequest('POST', `/api/driver-app/trips/${tripId}/start`, {
      at: new Date().toISOString(),
      lat: 25.20,
      lng: 55.27,
      accuracyM: 12,
    }, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.timing).toBeTruthy();
    expect(['on_time', 'late']).toContain(body.timing.type);
    expect(body.idempotent).toBe(false);

    // Verify the transition was logged
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw<Array<{ transition: string; source: string }>>`
        SELECT transition, source FROM trip_state_transitions
        WHERE trip_id = ${tripId}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].transition).toBe('STARTED');
      expect(rows[0].source).toBe('DRIVER_APP');
    } finally {
      await prisma.$disconnect();
    }
  });

  it('double-tap Start is idempotent â€” no new transition row', async () => {
    const r = await makeRequest('POST', `/api/driver-app/trips/${tripId}/start`, undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.idempotent).toBe(true);

    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM trip_state_transitions
        WHERE trip_id = ${tripId}
      `;
      expect(rows[0].count).toBe('1');
    } finally {
      await prisma.$disconnect();
    }
  });

  it('driver End â†’ 200, COMPLETED, STARTED + COMPLETED transitions', async () => {
    await new Promise((res) => setTimeout(res, 1100));
    const r = await makeRequest('POST', `/api/driver-app/trips/${tripId}/end`, {
      at: new Date().toISOString(),
      lat: 25.21,
      lng: 55.28,
      accuracyM: 15,
    }, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('COMPLETED');
    expect(body.durationMinutes).toBeGreaterThanOrEqual(0);
    expect(body.idempotent).toBe(false);

    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw<Array<{ transition: string }>>`
        SELECT transition FROM trip_state_transitions
        WHERE trip_id = ${tripId} ORDER BY at
      `;
      expect(rows.map((x) => x.transition)).toEqual(['STARTED', 'COMPLETED']);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects End on a SCHEDULED trip with 409', async () => {
    const r = await makeRequest('POST', `/api/driver-app/trips/${otherTripId}/end`, undefined, seed!.headers);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toMatch(/invalid state transition/);
    expect(body.reason).toMatch(/has not started/i);
    expect(body.currentStatus).toBe('SCHEDULED');
  });

  it('rejects Start on a COMPLETED trip with 409', async () => {
    const r = await makeRequest('POST', `/api/driver-app/trips/${tripId}/start`, undefined, seed!.headers);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toMatch(/invalid state transition/);
    expect(body.reason).toMatch(/already completed/i);
  });

  it('rejects unknown trip with 404', async () => {
    const r = await makeRequest(
      'POST',
      `/api/driver-app/trips/00000000-0000-0000-0000-000000000000/start`,
      undefined,
      seed!.headers,
    );
    expect(r.status).toBe(404);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const r = await makeRequest(
      'POST',
      `/api/driver-app/trips/${otherTripId}/start`,
      undefined,
      // no headers
    );
    expect(r.status).toBe(401);
  });
});

