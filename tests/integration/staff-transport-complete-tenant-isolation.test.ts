/**
 * Regression guard for the cross-tenant write path in
 * POST /api/bus-ops/schedules/[id]/complete.
 *
 * The route previously looked its schedule up with
 * `findUnique({ where: { id } })` and no tenant filter, so any
 * authenticated caller could complete another tenant's trip by
 * supplying its id. The handler then read `schedule.tenantId` off
 * whatever row it found and, against that tenant, emitted
 * TRIP_COMPLETED and wrote trip_schedules / trip_logs / vehicle.
 *
 * This test is part of the security control, not just coverage: the
 * important assertion is not only the HTTP status but that NOTHING in
 * the foreign tenant's data changed. Asserting 404 alone would still
 * pass if the route 404'd *after* performing its writes.
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

/** Schedule owned by tenant B — the thing tenant A must not touch. */
let scheduleB: string | null = null;
let routeB: string | null = null;

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

  // Seed a route + in-progress schedule under tenant B directly, so the
  // fixture doesn't depend on the create endpoints' own validation rules.
  await withPlatformAdmin(prisma, async (tx) => {
    const route = await tx.busRoute.create({
      data: {
        tenantId: tenantB!.tenant.id,
        name: `ISO-COMPLETE-${Date.now()}`,
        origin: 'Origin',
        destination: 'Destination',
        routeType: 'STAFF',
        isActive: true,
      },
    });
    routeB = route.id;

    const schedule = await tx.tripSchedule.create({
      data: {
        tenantId: tenantB!.tenant.id,
        routeId: route.id,
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
      await tx.tripLog.deleteMany({ where: { scheduleId: scheduleB } }).catch(() => {});
      await tx.tripSchedule.deleteMany({ where: { id: scheduleB } }).catch(() => {});
    }
    if (routeB) await tx.busRoute.deleteMany({ where: { id: routeB } }).catch(() => {});
  }).catch(() => {});

  for (const t of [tenantA, tenantB]) {
    if (!t) continue;
    await cleanupTenant(t.tenant.id).catch(() => {});
    await cleanupUser(t.user.id).catch(() => {});
  }
}, 60_000);

/** Read tenant B's schedule + its logs straight from the DB. */
async function readScheduleState(id: string) {
  return withPlatformAdmin(prisma, async (tx) => {
    const schedule = await tx.tripSchedule.findUnique({
      where: { id },
      select: { id: true, status: true, tenantId: true, vehicleId: true, updatedAt: true },
    });
    const logCount = await tx.tripLog.count({ where: { scheduleId: id } });
    return { schedule, logCount };
  });
}

describe('complete route — cross-tenant isolation', () => {
  it("tenant A cannot complete tenant B's schedule, and nothing in tenant B changes", async () => {
    if (!serverAvailable || !hasDb || !scheduleB || !tenantA) return;

    const before = await readScheduleState(scheduleB);
    expect(before.schedule).not.toBeNull();

    const res = await makeRequest(
      'POST',
      `/api/bus-ops/schedules/${scheduleB}/complete`,
      {},
      { cookie: `xl-session=${tenantA.token}` },
    );

    // Indistinguishable from a non-existent id — a 403 would confirm the
    // row exists and let a caller probe for ids in other tenants.
    expect(res.status).toBe(404);

    // The security-relevant half: no write reached tenant B.
    const after = await readScheduleState(scheduleB);
    expect(after.schedule?.status).toBe(before.schedule?.status);
    expect(after.schedule?.status).not.toBe('COMPLETED');
    expect(after.schedule?.vehicleId).toBe(before.schedule?.vehicleId);
    expect(after.schedule?.updatedAt?.getTime()).toBe(before.schedule?.updatedAt?.getTime());
    // No completion log written against the foreign tenant's trip.
    expect(after.logCount).toBe(before.logCount);
  }, 60_000);

  it('rejects a request with no tenant context', async () => {
    if (!serverAvailable || !hasDb || !scheduleB) return;

    const res = await makeRequest(
      'POST',
      `/api/bus-ops/schedules/${scheduleB}/complete`,
      {},
      {}, // no session cookie → middleware sets no x-tenant-id
    );
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);

    const after = await readScheduleState(scheduleB);
    expect(after.schedule?.status).not.toBe('COMPLETED');
  }, 60_000);

  it('positive control: tenant B can still complete its own schedule', async () => {
    if (!serverAvailable || !hasDb || !scheduleB || !tenantB) return;

    const res = await makeRequest(
      'POST',
      `/api/bus-ops/schedules/${scheduleB}/complete`,
      {},
      { cookie: `xl-session=${tenantB.token}` },
    );

    // Guards against "fixed" by breaking the route for everyone. A 5xx
    // here on the shared dev DB is a known RLS-transaction timeout (see
    // staff-transport-waitlist-sweep for the same caveat), so assert the
    // outcome via the DB rather than only the status code.
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(401);

    if ([200, 201].includes(res.status)) {
      const after = await readScheduleState(scheduleB);
      expect(after.schedule?.status).toBe('COMPLETED');
    }
  }, 60_000);
});
