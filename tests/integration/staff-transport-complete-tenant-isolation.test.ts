/**
 * Regression guard for the cross-tenant write path in
 * POST /api/bus-ops/schedules/[id]/complete.
 *
 * The route previously looked its schedule up with
 * `findUnique({ where: { id } })` and no tenant filter, so any
 * authenticated caller could complete another tenant's trip by
 * supplying its id. The handler then read `schedule.tenantId` off
 * whatever row it found and, against that tenant, wrote
 * trip_schedules + trip_logs, propagated end-mileage onto the foreign
 * tenant's Vehicle, and published TRIP_COMPLETED into the outbox for
 * Finance consumers to bill against.
 *
 * This test is part of the security control, not just coverage: the
 * important assertion is not the HTTP status but that NOTHING in the
 * foreign tenant's data changed. Asserting 404 alone would still pass
 * if the route 404'd *after* performing its writes, so every one of the
 * four write paths above is asserted against directly in the DB.
 *
 * The attacking request deliberately carries a full body (endMileage,
 * fuelUsed, passengersBoarded). An empty body would leave the vehicle
 * and outbox paths unreachable — the assertions would pass vacuously
 * and prove nothing.
 *
 * Sibling routes (depart, cancel) already scope correctly; this file
 * pins `complete` to the same contract.
 *
 * Prerequisites:
 *   - Next.js dev server running on localhost:3000
 *   - DATABASE_URL set
 *
 * Run: npx vitest run tests/integration/staff-transport-complete-tenant-isolation.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { allowedTripTransitions, type TripScheduleStatus } from '@/lib/bus-ops/state-machines';
import { TRIP_COMPLETED } from '@/events/registry';
import {
  seedTestTenantFull,
  cleanupTenant,
  cleanupUser,
  makeRequest,
  isServerRunning,
  type SeedResult,
} from '../setup';

const hasDb = Boolean(process.env.DATABASE_URL);
let serverAvailable = false;
let tenantA: SeedResult | null = null;
let tenantB: SeedResult | null = null;

/** Fixtures owned by tenant B — the things tenant A must not touch. */
let scheduleB: string | null = null;
let routeB: string | null = null;
let vehicleB: string | null = null;

/**
 * The fixture vehicle's starting odometer, and the (different) value the
 * attacker sends as `endMileage`. The handler propagates endMileage onto
 * Vehicle.currentMileage/odometerReading, so these must differ or the
 * "no vehicle mutation" assertion would hold trivially.
 */
const VEHICLE_START_KM = 10_000;
const ATTACKER_END_KM  = 987_654;

/**
 * A status that can legally transition to COMPLETED, read from the
 * state machine itself rather than hardcoded. The trip vocabulary is
 * mid-rename (DEPARTED/IN_TRANSIT → STARTED/EN_ROUTE, see the
 * status-reconciliation PR), so hardcoding either spelling would make
 * this test branch-dependent. Deriving it keeps the test correct under
 * both vocabularies.
 */
function statusThatCanComplete(): TripScheduleStatus {
  const candidates: TripScheduleStatus[] = [
    'SCHEDULED', 'DEPARTED', 'IN_TRANSIT', 'STARTED', 'EN_ROUTE',
  ] as unknown as TripScheduleStatus[];
  for (const s of candidates) {
    try {
      if (allowedTripTransitions(s)?.includes('COMPLETED' as TripScheduleStatus)) return s;
    } catch {
      /* status not in this build's vocabulary — try the next */
    }
  }
  throw new Error('No trip status permits a transition to COMPLETED');
}

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable || !hasDb) return;

  tenantA = await seedTestTenantFull();
  tenantB = await seedTestTenantFull();

  // Seed route + vehicle + in-progress schedule under tenant B directly,
  // so the fixture doesn't depend on the create endpoints' own validation.
  await withPlatformAdmin(prisma, async (tx) => {
    const stamp = Date.now();

    const route = await tx.busRoute.create({
      data: {
        tenantId: tenantB!.tenant.id,
        name: `ISO-COMPLETE-${stamp}`,
        origin: 'Origin',
        destination: 'Destination',
        routeType: 'STAFF',
        isActive: true,
      },
    });
    routeB = route.id;

    // Vehicle must be attached to the schedule: the mileage-propagation
    // branch is `if (body.endMileage != null && schedule.vehicleId)`.
    const vehicle = await tx.vehicle.create({
      data: {
        tenantId:        tenantB!.tenant.id,
        make:            'ISO',
        model:           'Fixture',
        licensePlate:    `ISO-${stamp}`,
        seatingCapacity: 30,
        currentMileage:  BigInt(VEHICLE_START_KM),
        odometerReading: BigInt(VEHICLE_START_KM),
        isActive:        true,
      },
    });
    vehicleB = vehicle.id;

    const schedule = await tx.tripSchedule.create({
      data: {
        tenantId: tenantB!.tenant.id,
        routeId: route.id,
        vehicleId: vehicle.id,
        departureTime: new Date(),
        status: statusThatCanComplete(),
        capacity: 30,
        confirmedCount: 0,
      },
    });
    scheduleB = schedule.id;
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await withPlatformAdmin(prisma, async (tx) => {
    if (scheduleB) {
      await tx.$executeRaw`DELETE FROM event_outbox WHERE aggregate_id::text = ${scheduleB}`.catch(() => {});
      await tx.tripLog.deleteMany({ where: { scheduleId: scheduleB } }).catch(() => {});
      await tx.tripSchedule.deleteMany({ where: { id: scheduleB } }).catch(() => {});
    }
    if (vehicleB) await tx.vehicle.deleteMany({ where: { id: vehicleB } }).catch(() => {});
    if (routeB)   await tx.busRoute.deleteMany({ where: { id: routeB } }).catch(() => {});
  }).catch(() => {});

  for (const t of [tenantA, tenantB]) {
    if (!t) continue;
    await cleanupTenant(t.tenant.id).catch(() => {});
    await cleanupUser(t.user.id).catch(() => {});
  }
}, 60_000);

/**
 * Snapshot every piece of tenant B state the handler is capable of
 * writing: the schedule row, its trip logs, the attached vehicle's
 * odometer, and the outbox.
 */
async function readTenantBState() {
  return withPlatformAdmin(prisma, async (tx) => {
    const schedule = scheduleB
      ? await tx.tripSchedule.findUnique({
          where: { id: scheduleB },
          select: { id: true, status: true, tenantId: true, vehicleId: true, updatedAt: true },
        })
      : null;

    const logCount = scheduleB
      ? await tx.tripLog.count({ where: { scheduleId: scheduleB } })
      : 0;

    const vehicle = vehicleB
      ? await tx.vehicle.findUnique({
          where: { id: vehicleB },
          select: { id: true, currentMileage: true, odometerReading: true, updatedAt: true },
        })
      : null;

    // Queried as raw SQL, not via `tx.eventOutbox`, for two reasons:
    // it matches how event-bus.ts actually writes the row (a raw
    // `INSERT INTO event_outbox`), and the Prisma EventOutbox model is
    // currently drifted — its fields declare camelCase with no @map
    // while the table is snake_case, so `tx.eventOutbox.count()` fails
    // with "column event_outbox.aggregateId does not exist".
    const outboxRows = scheduleB
      ? await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT COUNT(*)::bigint AS n
          FROM event_outbox
          WHERE aggregate_id::text = ${scheduleB}
            AND event_type = ${TRIP_COMPLETED}
        `
      : null;
    const outboxCount = outboxRows ? Number(outboxRows[0]?.n ?? 0) : 0;

    return { schedule, logCount, vehicle, outboxCount };
  });
}

/**
 * The outbox publish is fire-and-forget (`.catch()` on a floating
 * promise), so a leaked write could land slightly after the response.
 * Asserting absence immediately would risk a false pass — give it time
 * to show up before concluding it never happened.
 */
const OUTBOX_SETTLE_MS = 2_000;
const settle = () => new Promise(r => setTimeout(r, OUTBOX_SETTLE_MS));

describe('complete route — cross-tenant isolation', () => {
  it("tenant A cannot complete tenant B's schedule, and nothing in tenant B changes", async () => {
    if (!serverAvailable || !hasDb || !scheduleB || !tenantA) return;

    const before = await readTenantBState();
    expect(before.schedule).not.toBeNull();
    expect(before.vehicle).not.toBeNull();
    // Sanity-check the fixture actually arms the vehicle path.
    expect(before.schedule?.vehicleId).toBe(vehicleB);
    expect(String(before.vehicle?.currentMileage)).toBe(String(VEHICLE_START_KM));

    const res = await makeRequest(
      'POST',
      `/api/bus-ops/schedules/${scheduleB}/complete`,
      {
        endMileage: ATTACKER_END_KM,
        fuelUsed: 42,
        passengersBoarded: 7,
        farePerHead: 25,
        driverNotes: 'cross-tenant attempt',
      },
      { cookie: `xl-session=${tenantA.token}` },
    );

    // Indistinguishable from a non-existent id — a 403 would confirm the
    // row exists and let a caller probe for ids in other tenants.
    expect(res.status).toBe(404);

    await settle();
    const after = await readTenantBState();

    // ── The security-relevant half: no write reached tenant B ──────────
    // Schedule untouched.
    expect(after.schedule?.status).toBe(before.schedule?.status);
    expect(after.schedule?.status).not.toBe('COMPLETED');
    expect(after.schedule?.vehicleId).toBe(before.schedule?.vehicleId);
    expect(after.schedule?.updatedAt?.getTime()).toBe(before.schedule?.updatedAt?.getTime());

    // No completion log written against the foreign tenant's trip.
    expect(after.logCount).toBe(before.logCount);

    // Vehicle odometer not advanced to the attacker's endMileage. This is
    // the path that would have fed the foreign tenant's Maintenance alert
    // engine bogus accumulating km.
    expect(String(after.vehicle?.currentMileage)).toBe(String(VEHICLE_START_KM));
    expect(String(after.vehicle?.odometerReading)).toBe(String(VEHICLE_START_KM));
    expect(String(after.vehicle?.currentMileage)).not.toBe(String(ATTACKER_END_KM));
    expect(after.vehicle?.updatedAt?.getTime()).toBe(before.vehicle?.updatedAt?.getTime());

    // No TRIP_COMPLETED emitted. Finance consumers bill off this event,
    // so a leaked publish would invoice the foreign tenant for a trip
    // that never completed.
    expect(after.outboxCount).toBe(before.outboxCount);
    expect(after.outboxCount).toBe(0);
  }, 60_000);

  it('rejects a request with no tenant context', async () => {
    if (!serverAvailable || !hasDb || !scheduleB) return;

    const before = await readTenantBState();

    const res = await makeRequest(
      'POST',
      `/api/bus-ops/schedules/${scheduleB}/complete`,
      { endMileage: ATTACKER_END_KM },
      {}, // no session cookie → middleware sets no x-tenant-id
    );
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);

    const after = await readTenantBState();
    expect(after.schedule?.status).not.toBe('COMPLETED');
    expect(after.logCount).toBe(before.logCount);
    expect(String(after.vehicle?.currentMileage)).toBe(String(VEHICLE_START_KM));
    expect(after.outboxCount).toBe(0);
  }, 60_000);

  it('positive control: tenant B can still complete its own schedule', async () => {
    if (!serverAvailable || !hasDb || !scheduleB || !tenantB) return;

    const res = await makeRequest(
      'POST',
      `/api/bus-ops/schedules/${scheduleB}/complete`,
      { endMileage: VEHICLE_START_KM + 120, passengersBoarded: 7 },
      { cookie: `xl-session=${tenantB.token}` },
    );

    // Asserted strictly rather than tolerating a 5xx. These assertions
    // are load-bearing twice over: they guard against "fixing" the route
    // by breaking it for everyone, AND they are the non-vacuity proof
    // for the negative test above. Hiding them behind
    // `if (res.status === 200)` would let the whole positive control
    // silently no-op on an error response.
    expect(res.status, `positive control got HTTP ${res.status}`).toBe(200);

    await settle();
    const after = await readTenantBState();

    // ── Non-vacuity proof for the negative test ──────────────────────
    // Every field the cross-tenant case asserted was UNCHANGED is
    // asserted here to have CHANGED, read back through the same helper.
    // That is what makes those assertions discriminating: these are the
    // values the negative test would have seen had the blocked request
    // actually performed its writes.
    expect(after.schedule?.status).toBe('COMPLETED');
    expect(after.logCount).toBeGreaterThan(0);
    expect(String(after.vehicle?.currentMileage)).toBe(String(VEHICLE_START_KM + 120));
    expect(String(after.vehicle?.odometerReading)).toBe(String(VEHICLE_START_KM + 120));
    expect(after.outboxCount).toBeGreaterThan(0);
  }, 60_000);
});
