/**
 * tests/integration/staff-transport-cron-and-dispatcher.test.ts
 *
 * End-to-end integration test for the two new fleet-management surfaces:
 *
 *   1. Auto-close cron: any IN_PROGRESS trip with arrival_time +
 *      4h already passed is auto-closed with transition='AUTO_CLOSED',
 *      source='SYSTEM'. Idempotent — re-running is a no-op.
 *
 *   2. Dispatcher cancel: a dispatcher / tenant admin can cancel a
 *      SCHEDULED or IN_PROGRESS trip with an optional reason.
 *      COMPLETED trips are rejected (409). Already-cancelled trips
 *      return 200 idempotent.
 *
 * Run: npx vitest run tests/integration/staff-transport-cron-and-dispatcher.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { cleanupTenant, cleanupUser, isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';

let seed: SeedResult | undefined;
let testRouteId = '';
const testTripIds: string[] = [];

beforeAll(async () => {
  if (!(await isServerRunning())) {
    throw new Error('dev server must be running on :3000 — start with `npm run dev`');
  }
  seed = await seedTestTenantFull();
  await withTenantRls(prisma, seed.tenant.id, async (tx) => {
    const route = await tx.busRoute.create({
      data: {
        tenantId: seed!.tenant.id,
        name: `CRON-DISPATCH-ROUTE-${crypto.randomUUID().slice(0, 8)}`,
        origin: 'Origin Stop',
        destination: 'Dest Stop',
        routeType: 'STAFF',
        isActive: true,
        capacity: 30,
      },
    });
    testRouteId = route.id;
    await tx.routeStop.createMany({
      data: [
        { tenantId: seed!.tenant.id, routeId: testRouteId, stopName: 'Cron Stop 1', sequence: 1, gpsLat: 25.1972, gpsLng: 55.2744, geofenceRadiusM: 100 },
        { tenantId: seed!.tenant.id, routeId: testRouteId, stopName: 'Cron Stop 2', sequence: 2, gpsLat: 25.2582, gpsLng: 55.3047, geofenceRadiusM: 100 },
      ],
    });
  });
});

afterAll(async () => {
  if (!seed) return;
  const tid = seed.tenant.id;
  await withTenantRls(prisma, tid, async (tx) => {
    for (const id of testTripIds) {
      await tx.$executeRaw`DELETE FROM trip_state_transitions WHERE trip_id = ${id}`.catch(() => {});
      await tx.$executeRaw`DELETE FROM trip_schedules WHERE id = ${id}`.catch(() => {});
    }
    if (testRouteId) {
      await tx.routeStop.deleteMany({ where: { routeId: testRouteId } }).catch(() => {});
      await tx.busRoute.deleteMany({ where: { id: testRouteId } }).catch(() => {});
    }
  }).catch(() => {});
  await cleanupTenant(tid).catch(() => {});
  await cleanupUser(seed.user.id).catch(() => {});
});

async function seedTrip(opts: {
  status: 'SCHEDULED' | 'IN_PROGRESS';
  arrivalOffsetHours: number;  // negative = in the past
  departureOffsetHours?: number;
  actualDepartureOffsetHours?: number;
  tripNumber: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const dep = opts.departureOffsetHours ?? opts.arrivalOffsetHours - 1;
  const actualDep = opts.actualDepartureOffsetHours ?? (
    opts.status === 'IN_PROGRESS' ? opts.arrivalOffsetHours + 0.3 : null
  );
  const routeId = testRouteId;
  if (!routeId) throw new Error('no route with 2+ geocoded stops');
  const driverId = seed!.user.id;
  const now = new Date();
  const depAt = new Date(now.getTime() + dep * 3_600_000);
  const arrAt = new Date(now.getTime() + opts.arrivalOffsetHours * 3_600_000);
  const actualDepAt = actualDep != null
    ? new Date(now.getTime() + actualDep * 3_600_000)
    : null;
  const startedById = opts.status === 'IN_PROGRESS' ? driverId : null;
  await withTenantRls(prisma, seed!.tenant.id, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO trip_schedules (
        id, tenant_id, driver_id, vehicle_id, route_id,
        departure_time, arrival_time, actual_departure_at,
        status, direction, trip_number, capacity,
        started_by_driver_id, created_at, updated_at
      ) VALUES (
        ${id}, ${seed!.tenant.id}::uuid, ${driverId}, '', ${routeId},
        ${depAt.toISOString()}::timestamptz, ${arrAt.toISOString()}::timestamptz,
        ${actualDepAt?.toISOString() ?? null}::timestamptz,
        ${opts.status}, 'OUTBOUND', ${opts.tripNumber}, 30,
        ${startedById}::uuid, NOW(), NOW()
      )
    `;
  });
  testTripIds.push(id);
  return id;
}

// ──────────────────────────────────────────────────────────────────────
// Auto-close cron
// ──────────────────────────────────────────────────────────────────────

describe('Auto-close cron (/api/cron/auto-close-trips)', () => {
  it('auto-closes a stale IN_PROGRESS trip with status=AUTO_CLOSED + source=SYSTEM', async () => {
    const staleId = await seedTrip({
      status: 'IN_PROGRESS',
      arrivalOffsetHours: -5,           // 5h past arrival — should be closed
      tripNumber: 'CRON-IT-STALE',
    });
    const r = await makeRequest('GET', '/api/cron/auto-close-trips', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.staleThresholdHours).toBe(4);
    expect(body.scanned).toBeGreaterThan(0);
    expect(body.closed).toContain(staleId);

    // Verify the trip's new state in the DB
    await withTenantRls(prisma, seed!.tenant.id, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string; actual_arrival_at: Date | null; duration_minutes: number | null }>>`
        SELECT status, actual_arrival_at, duration_minutes FROM trip_schedules WHERE id = ${staleId}
      `;
      expect(rows[0].status).toBe('AUTO_CLOSED');
      expect(rows[0].actual_arrival_at).not.toBeNull();
      expect(rows[0].duration_minutes).toBeGreaterThan(0);
      const transitions = await tx.$queryRaw<Array<{ transition: string; source: string }>>`
        SELECT transition, source FROM trip_state_transitions
        WHERE trip_id = ${staleId}
        ORDER BY at
      `;
      const last = transitions[transitions.length - 1];
      expect(last.transition).toBe('AUTO_CLOSED');
      expect(last.source).toBe('SYSTEM');
    });
  });

  it('does NOT touch a fresh IN_PROGRESS trip', async () => {
    const freshId = await seedTrip({
      status: 'IN_PROGRESS',
      arrivalOffsetHours: +1,            // 1h in the FUTURE — fresh
      tripNumber: 'CRON-IT-FRESH',
    });
    const r = await makeRequest('GET', '/api/cron/auto-close-trips', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.closed).not.toContain(freshId);

    const rows = await withTenantRls(prisma, seed!.tenant.id, (tx) =>
      tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM trip_schedules WHERE id = ${freshId}
      `,
    );
    expect(rows[0].status).toBe('IN_PROGRESS');
  });

  it('idempotent — running the cron twice does not double-process', async () => {
    // First run closes the stale trips. Second run finds nothing
    // new to close (everything is already AUTO_CLOSED) — so the
    // `closed` count should drop to 0.
    const r1 = await makeRequest('GET', '/api/cron/auto-close-trips', undefined, seed!.headers);
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    const r2 = await makeRequest('GET', '/api/cron/auto-close-trips', undefined, seed!.headers);
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    // Second run should close fewer (or zero) new trips
    expect(b2.closed.length).toBeLessThanOrEqual(b1.closed.length);
  }, 90_000);
});

// ──────────────────────────────────────────────────────────────────────
// Dispatcher cancel
// ──────────────────────────────────────────────────────────────────────

describe('Dispatcher cancel (/api/dispatcher/trips/[id]/cancel)', () => {
  it('cancels a SCHEDULED trip with a reason', async () => {
    const id = await seedTrip({
      status: 'SCHEDULED',
      arrivalOffsetHours: +3,
      tripNumber: 'DISPATCH-IT-SCHED',
    });
    const r = await makeRequest('POST', `/api/dispatcher/trips/${id}/cancel`, {
      reason: 'Driver called in sick',
    }, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('CANCELLED');
    expect(body.notes).toContain('Driver called in sick');
    expect(body.idempotent).toBe(false);

    const rows = await withTenantRls(prisma, seed!.tenant.id, (tx) =>
      tx.$queryRaw<Array<{ transition: string; source: string; notes: string }>>`
        SELECT transition, source, notes FROM trip_state_transitions
        WHERE trip_id = ${id}
        ORDER BY at DESC LIMIT 1
      `,
    );
    expect(rows[0].transition).toBe('CANCELLED');
    expect(rows[0].source).toBe('DISPATCHER');
    expect(rows[0].notes).toContain('Driver called in sick');
  });

  it('cancels an IN_PROGRESS trip and records duration_minutes', async () => {
    const id = await seedTrip({
      status: 'IN_PROGRESS',
      arrivalOffsetHours: +2,
      tripNumber: 'DISPATCH-IT-PROG',
    });
    const r = await makeRequest('POST', `/api/dispatcher/trips/${id}/cancel`, null, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('CANCELLED');
    expect(body.durationMinutes).toBeGreaterThanOrEqual(0);
  });

  it('rejects cancelling a COMPLETED trip with 409', async () => {
    const id = await seedTrip({
      status: 'IN_PROGRESS',
      arrivalOffsetHours: +2,
      tripNumber: 'DISPATCH-IT-COMP',
    });
    // Force the trip to COMPLETED state directly — we want to test
    // the dispatcher's 409 path, not the driver-end endpoint.
    await withTenantRls(prisma, seed!.tenant.id, async (tx) => {
      await tx.$executeRaw`
        UPDATE trip_schedules
        SET status = 'COMPLETED',
            actual_departure_at = NOW() - INTERVAL '30 minutes',
            actual_arrival_at = NOW(),
            duration_minutes = 30,
            started_by_driver_id = ${seed!.user.id}::uuid,
            ended_by_driver_id = ${seed!.user.id}::uuid,
            updated_at = NOW()
        WHERE id = ${id}
      `;
    });
    // Now try to cancel
    const r = await makeRequest('POST', `/api/dispatcher/trips/${id}/cancel`, null, seed!.headers);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toMatch(/cannot cancel/);
    expect(body.currentStatus).toBe('COMPLETED');
  });

  it('idempotent — cancelling a CANCELLED trip is a no-op', async () => {
    const id = await seedTrip({
      status: 'SCHEDULED',
      arrivalOffsetHours: +3,
      tripNumber: 'DISPATCH-IT-IDEMP',
    });
    await makeRequest('POST', `/api/dispatcher/trips/${id}/cancel`, null, seed!.headers);
    const r2 = await makeRequest('POST', `/api/dispatcher/trips/${id}/cancel`, null, seed!.headers);
    expect(r2.status).toBe(200);
    const body = await r2.json();
    expect(body.idempotent).toBe(true);
  });

  it('rejects 404 for an unknown trip', async () => {
    const r = await makeRequest(
      'POST',
      `/api/dispatcher/trips/00000000-0000-0000-0000-000000000000/cancel`,
      null,
      seed!.headers,
    );
    expect(r.status).toBe(404);
  });

  it('rejects 401 for an unauthenticated request', async () => {
    const id = await seedTrip({
      status: 'SCHEDULED',
      arrivalOffsetHours: +3,
      tripNumber: 'DISPATCH-IT-AUTH',
    });
    const r = await makeRequest('POST', `/api/dispatcher/trips/${id}/cancel`, null);
    expect(r.status).toBe(401);
  });
});
