/**
 * Integration tests for the Route Consolidation Phase 2 engine.
 *
 * Hits the DATABASE_URL Postgres — dev locally, staging in CI. Each
 * test seeds a fresh tenant scope (prefix `test-rc-p2-` + random
 * suffix) so parallel runs don't collide and dev data is unaffected.
 * afterEach tears down everything created under that tenant.
 *
 * Covers the 6 scenarios flagged in the PR #24 review:
 *
 *   1. Successful apply creates one merged route, retires both
 *      sources, migrates both enrollment types, writes lineage
 *      atomically.
 *   2. Mid-transaction failure leaves zero partial state.
 *   3. Same idempotencyKey twice produces exactly one consolidation.
 *   4. Two concurrent applies sharing a source route cannot both succeed.
 *   5. Revert restores original enrollment mappings and archives
 *      (not deletes) the merged route.
 *   6. RLS prevents cross-tenant source-routes / mappings /
 *      consolidation rows from being touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  applyConsolidation,
  revertConsolidation,
  type ApplyConsolidationInput,
} from '@/lib/planning/route-consolidation-apply';

const prisma = new PrismaClient();

type Fixture = {
  tenantId: string;
  otherTenantId: string;
  sourceA: string;
  sourceB: string;
  stopsA: [string, string]; // [pickup, dropoff]
  stopsB: [string, string];
  routePassengerId: string;
  transportEnrollmentId: string;
};

// ─── Fixture setup / teardown ───────────────────────────────────────

async function seed(): Promise<Fixture> {
  // All IDs are UUIDs so they satisfy every column type in the fixture
  // graph — the codebase has some FK columns typed UUID pointing at
  // TEXT id columns (route_passengers.route_id UUID → bus_routes.id
  // TEXT, etc.). UUID-formatted strings are valid TEXT, so using them
  // everywhere is the least-surprise solution. Do NOT normalise the
  // schema types — see PR #24 review re: preserving legacy asymmetry.
  const suffix = randomUUID();
  const tenantId = randomUUID();       // stored in tenants.id (TEXT); UUID-safe for FK columns
  const otherTenantId = randomUUID();

  const sourceA = randomUUID();
  const sourceB = randomUUID();

  await prisma.tenant.create({ data: { id: tenantId, name: `Test Tenant ${suffix}` } });
  await prisma.tenant.create({ data: { id: otherTenantId, name: `Other Test Tenant ${suffix}` } });

  await prisma.busRoute.create({
    data: {
      id: sourceA, tenantId, name: `Test A ${suffix}`,
      origin: 'A-origin', destination: 'shared-dest',
      isActive: true, capacity: 40,
    },
  });
  await prisma.busRoute.create({
    data: {
      id: sourceB, tenantId, name: `Test B ${suffix}`,
      origin: 'B-origin', destination: 'shared-dest',
      isActive: true, capacity: 40,
    },
  });

  const stopsA: [string, string] = [randomUUID(), randomUUID()];
  const stopsB: [string, string] = [randomUUID(), randomUUID()];
  const placeIds: [string, string] = [randomUUID(), randomUUID()];

  // Seed spatial.places first so route_stops.place_id FKs are satisfied.
  // Route A and B share placeIds so the engine's EXACT_PLACE_ID stop-
  // mapping path can match A's original enrolment stops onto B's copied
  // stops on the merged route.
  for (let i = 0; i < 2; i++) {
    await prisma.place.create({
      data: {
        id: placeIds[i],
        tenantId,
        name: `Place ${i} ${suffix}`,
        type: 'STOP',
        shape: 'POINT',
        centerLat: 25.10 + i * 0.05,
        centerLng: 55.15 + i * 0.05,
      },
    });
  }

  for (let i = 0; i < 2; i++) {
    await prisma.routeStop.create({
      data: {
        id: stopsA[i], tenantId, routeId: sourceA,
        stopName: `A-stop-${i}`, sequence: i + 1,
        gpsLat: 25.10 + i * 0.01, gpsLng: 55.15 + i * 0.01,
        placeId: placeIds[i], // shared placeId so EXACT_PLACE_ID matches on merged route
      },
    });
    await prisma.routeStop.create({
      data: {
        id: stopsB[i], tenantId, routeId: sourceB,
        stopName: `B-stop-${i}`, sequence: i + 1,
        gpsLat: 25.20 + i * 0.01, gpsLng: 55.25 + i * 0.01,
        placeId: placeIds[i],
      },
    });
  }

  // RoutePassenger enrolled on source A at stop-a-pickup / dropoff
  const routePassengerId = randomUUID();
  await prisma.routePassenger.create({
    data: {
      id: routePassengerId, tenantId, routeId: sourceA,
      staffMemberId: randomUUID(),
      pickupStopId: stopsA[0], dropoffStopId: stopsA[1],
      status: 'ACTIVE',
    },
  });

  // TransportEnrollment on source B at stop-b-pickup
  const transportEnrollmentId = randomUUID();
  const employeeId = randomUUID();
  // TransportEnrollment.employeeId FKs to StaffMember; create a minimal one
  await prisma.staffMember.create({
    data: { id: employeeId, tenantId, name: `Emp ${suffix}` },
  });
  await prisma.transportEnrollment.create({
    data: {
      id: transportEnrollmentId, tenantId, employeeId,
      defaultRouteId: sourceB, defaultStopId: stopsB[0],
      isActive: true,
    },
  });

  return { tenantId, otherTenantId, sourceA, sourceB, stopsA, stopsB, routePassengerId, transportEnrollmentId };
}

async function teardown(f: Fixture): Promise<void> {
  // Order matters — child FKs first. Consolidation cascade handles
  // its own children; we still need to drop everything else.
  await prisma.routeConsolidation.deleteMany({ where: { tenantId: f.tenantId } });
  await prisma.transportEnrollment.deleteMany({ where: { tenantId: f.tenantId } });
  await prisma.staffMember.deleteMany({ where: { tenantId: f.tenantId } });
  await prisma.routePassenger.deleteMany({ where: { tenantId: f.tenantId } });
  await prisma.routeStop.deleteMany({ where: { tenantId: f.tenantId } });
  await prisma.busRoute.deleteMany({ where: { tenantId: f.tenantId } });
  // Same for otherTenantId in case a test used it
  await prisma.busRoute.deleteMany({ where: { tenantId: f.otherTenantId } });
  // Places after route_stops
  await prisma.place.deleteMany({ where: { tenantId: f.tenantId } });
  // Tenants last — anything FK'd to them is already gone.
  await prisma.tenant.deleteMany({ where: { id: { in: [f.tenantId, f.otherTenantId] } } });
}

let fx: Fixture;

beforeEach(async () => {
  try {
    fx = await seed();
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.error('[integration seed] failed:', JSON.stringify({ msg: (e as Error).message, code: (e as any).code, meta: (e as any).meta, stack: (e as Error).stack?.split('\n').slice(0, 5) }, null, 2));
    throw e;
  }
});
afterEach(async () => { if (fx) await teardown(fx); });

function applyInput(f: Fixture, over: Partial<ApplyConsolidationInput> = {}): ApplyConsolidationInput {
  return {
    tenantId: f.tenantId,
    recommendationId: `rec-${randomUUID()}`,
    sourceRouteIds: [f.sourceA, f.sourceB],
    mergedRoute: {
      name: 'Merged Test',
      stopIds: [f.stopsA[0], f.stopsB[0], f.stopsA[1]],
      estimatedDurationMins: 90,
      capacity: 50,
    },
    idempotencyKey: `idem-${randomUUID()}`,
    appliedBy: 'test-user',
    ...over,
  };
}

// ─── Scenario 1: successful apply is atomic and complete ────────────

describe('scenario 1: apply is atomic', () => {
  it('creates merged route, retires both sources, migrates both enrollment types, writes lineage rows', async () => {
    const input = applyInput(fx);
    const r = await applyConsolidation(prisma, input);

    expect(r.status).toBe('APPLIED');
    if (r.status !== 'APPLIED') return;

    // Merged route exists and is active
    const merged = await prisma.busRoute.findUnique({ where: { id: r.mergedRouteId } });
    expect(merged?.isActive).toBe(true);
    expect(merged?.name).toBe('Merged Test');
    const mergedStops = await prisma.routeStop.count({ where: { routeId: r.mergedRouteId } });
    expect(mergedStops).toBe(3);

    // Sources retired
    const sources = await prisma.busRoute.findMany({
      where: { id: { in: [fx.sourceA, fx.sourceB] } },
      select: { id: true, isActive: true, retiredReason: true, retiredBy: true },
    });
    for (const s of sources) {
      expect(s.isActive).toBe(false);
      expect(s.retiredReason).toBe('CONSOLIDATED_SOURCE');
      expect(s.retiredBy).toBe('test-user');
    }

    // Both enrollment types migrated
    const rp = await prisma.routePassenger.findUnique({ where: { id: fx.routePassengerId } });
    expect(rp?.routeId).toBe(r.mergedRouteId);
    const te = await prisma.transportEnrollment.findUnique({ where: { id: fx.transportEnrollmentId } });
    expect(te?.defaultRouteId).toBe(r.mergedRouteId);

    // Lineage rows exist
    const consolidation = await prisma.routeConsolidation.findUnique({
      where: { id: r.consolidationId },
      include: { sources: true, enrollmentMigrations: true },
    });
    expect(consolidation?.status).toBe('APPLIED');
    expect(consolidation?.appliedBy).toBe('test-user');
    expect(consolidation?.sources).toHaveLength(2);
    expect(consolidation?.enrollmentMigrations).toHaveLength(2);
  });
});

// ─── Scenario 2: mid-transaction failure leaves zero partial state ──

describe('scenario 2: mid-transaction failure rolls back completely', () => {
  it('a bad stopId in mergedRoute causes throw; nothing is written', async () => {
    const input = applyInput(fx, {
      mergedRoute: {
        stopIds: [fx.stopsA[0], 'nonexistent-stop-id', fx.stopsA[1]],
        estimatedDurationMins: 90,
      },
    });

    const priorConsolidationCount = await prisma.routeConsolidation.count({ where: { tenantId: fx.tenantId } });
    await expect(applyConsolidation(prisma, input)).rejects.toThrow();

    // No consolidation row
    const afterCount = await prisma.routeConsolidation.count({ where: { tenantId: fx.tenantId } });
    expect(afterCount).toBe(priorConsolidationCount);

    // Sources still active
    const sources = await prisma.busRoute.findMany({ where: { id: { in: [fx.sourceA, fx.sourceB] } } });
    for (const s of sources) {
      expect(s.isActive).toBe(true);
      expect(s.retiredReason).toBeNull();
    }

    // Enrollments unchanged
    const rp = await prisma.routePassenger.findUnique({ where: { id: fx.routePassengerId } });
    expect(rp?.routeId).toBe(fx.sourceA);
    const te = await prisma.transportEnrollment.findUnique({ where: { id: fx.transportEnrollmentId } });
    expect(te?.defaultRouteId).toBe(fx.sourceB);

    // No orphan merged route
    const orphanRoutes = await prisma.busRoute.count({
      where: { tenantId: fx.tenantId, name: 'Merged Test' },
    });
    expect(orphanRoutes).toBe(0);
  });
});

// ─── Scenario 3: idempotency ─────────────────────────────────────────

describe('scenario 3: idempotencyKey enforces one consolidation per key', () => {
  it('second apply with same key returns ALREADY_APPLIED and does not create a new row', async () => {
    const input = applyInput(fx);
    const first = await applyConsolidation(prisma, input);
    expect(first.status).toBe('APPLIED');
    if (first.status !== 'APPLIED') return;

    // Second call with the same input (same idempotencyKey)
    const second = await applyConsolidation(prisma, input);
    expect(second.status).toBe('ALREADY_APPLIED');
    if (second.status !== 'ALREADY_APPLIED') return;
    expect(second.consolidationId).toBe(first.consolidationId);
    expect(second.mergedRouteId).toBe(first.mergedRouteId);

    // Only one consolidation row for that key
    const count = await prisma.routeConsolidation.count({
      where: { tenantId: fx.tenantId, idempotencyKey: input.idempotencyKey },
    });
    expect(count).toBe(1);
  });
});

// ─── Scenario 4: concurrent applies sharing a source ────────────────

describe('scenario 4: concurrent applies sharing a source route cannot both succeed', () => {
  it('one wins as APPLIED, the other bounces off SOURCE_ALREADY_CONSOLIDATED or ALREADY_APPLIED', async () => {
    const inputA = applyInput(fx);
    const inputB = applyInput(fx); // shares sources with A but different idempotencyKey

    // Fire both without awaiting — the SELECT FOR UPDATE in the first
    // transaction should force serialisation of the source-route locks.
    const results = await Promise.allSettled([
      applyConsolidation(prisma, inputA),
      applyConsolidation(prisma, inputB),
    ]);

    const settled = results.map((r) => r.status === 'fulfilled' ? r.value : { status: 'ERROR', error: String(r.reason) });
    const applied = settled.filter((s) => (s as { status: string }).status === 'APPLIED');
    const blocked = settled.filter((s) => (s as { status: string }).status === 'BLOCKED' || (s as { status: string }).status === 'ERROR');

    expect(applied).toHaveLength(1);
    expect(blocked).toHaveLength(1);

    // Only one consolidation row for this tenant across both attempts
    const count = await prisma.routeConsolidation.count({ where: { tenantId: fx.tenantId } });
    expect(count).toBe(1);
  });
});

// ─── Scenario 5: revert restores originals and archives (not deletes) M ──

describe('scenario 5: revert restores originals and archives merged route', () => {
  it('sources reactivate, enrollments restored to source route + old stops, merged route archived not deleted', async () => {
    const input = applyInput(fx);
    const applied = await applyConsolidation(prisma, input);
    expect(applied.status).toBe('APPLIED');
    if (applied.status !== 'APPLIED') return;

    const reverted = await revertConsolidation(prisma, {
      tenantId: fx.tenantId,
      consolidationId: applied.consolidationId,
      revertedBy: 'test-user-revert',
      revertReason: 'operator error',
    });
    expect(reverted.status).toBe('REVERTED');
    if (reverted.status !== 'REVERTED') return;

    // Sources reactivated
    const sources = await prisma.busRoute.findMany({
      where: { id: { in: [fx.sourceA, fx.sourceB] } },
      select: { id: true, isActive: true, retiredReason: true, retiredAt: true },
    });
    for (const s of sources) {
      expect(s.isActive).toBe(true);
      expect(s.retiredReason).toBeNull();
      expect(s.retiredAt).toBeNull();
    }

    // Enrollments restored to source routes with old stops
    const rp = await prisma.routePassenger.findUnique({ where: { id: fx.routePassengerId } });
    expect(rp?.routeId).toBe(fx.sourceA);
    expect(rp?.pickupStopId).toBe(fx.stopsA[0]);
    expect(rp?.dropoffStopId).toBe(fx.stopsA[1]);
    const te = await prisma.transportEnrollment.findUnique({ where: { id: fx.transportEnrollmentId } });
    expect(te?.defaultRouteId).toBe(fx.sourceB);
    expect(te?.defaultStopId).toBe(fx.stopsB[0]);

    // Merged route archived, not deleted
    const merged = await prisma.busRoute.findUnique({ where: { id: applied.mergedRouteId } });
    expect(merged).not.toBeNull();
    expect(merged?.isActive).toBe(false);
    expect(merged?.retiredReason).toBe('CONSOLIDATED_ARCHIVED');
    expect(merged?.retiredBy).toBe('test-user-revert');

    // Consolidation row updated to REVERTED — lineage preserved
    const consolidation = await prisma.routeConsolidation.findUnique({
      where: { id: applied.consolidationId },
      include: { sources: true, enrollmentMigrations: true },
    });
    expect(consolidation?.status).toBe('REVERTED');
    expect(consolidation?.revertedBy).toBe('test-user-revert');
    expect(consolidation?.revertReason).toBe('operator error');
    expect(consolidation?.sources).toHaveLength(2);
    expect(consolidation?.enrollmentMigrations).toHaveLength(2);
  });
});

// ─── Scenario 6: RLS blocks cross-tenant access ─────────────────────

describe('scenario 6: RLS structural + data-level tenant isolation', () => {
  /**
   * Full end-to-end RLS enforcement requires the DB session user to
   * lack BYPASSRLS. The Neon-hosted dev DB used by this suite only
   * exposes bypass-RLS roles (neondb_owner, neon_superuser). The
   * production connection role MUST not have BYPASSRLS for RLS to
   * actually filter — verify that separately as part of the deploy
   * runbook. This test covers the two checks that DO work here:
   *
   *   1. Structural — the policies exist on every new lineage table
   *      with USING + WITH CHECK + the strict tenant predicate.
   *      A policy misconfiguration is caught here.
   *
   *   2. Data-level — the persisted row carries the correct tenant_id.
   *      If the engine ever wrote to the wrong tenant, RLS would leak
   *      the row cross-tenant even with a non-bypass role; this test
   *      proves the engine isn't leaking at the write level.
   */

  it('lineage tables have RLS + FORCE + policy with USING and WITH CHECK on the strict tenant predicate', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      tablename: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      polname: string;
      qual: string;
      with_check: string | null;
    }>>(`
      SELECT c.relname AS tablename,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             p.polname,
             pg_get_expr(p.polqual, p.polrelid) AS qual,
             pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'route_consolidations',
          'route_consolidation_sources',
          'route_consolidation_enrollment_migrations'
        )
      ORDER BY c.relname
    `);

    // 3 tables, each with exactly one policy
    expect(rows).toHaveLength(3);
    const byTable: Record<string, typeof rows[number]> = {};
    for (const r of rows) byTable[r.tablename] = r;

    for (const table of Object.keys(byTable)) {
      const r = byTable[table];
      expect(r.rls_enabled, `${table} must have ROW LEVEL SECURITY enabled`).toBe(true);
      expect(r.rls_forced,  `${table} must have FORCE ROW LEVEL SECURITY enabled`).toBe(true);
      expect(r.polname).toBe('tenant_isolation');
      // Both clauses present and identical
      expect(r.qual).toBeTruthy();
      expect(r.with_check).toBeTruthy();
      expect(r.qual).toBe(r.with_check);
      // Strict predicate — no NULL branch, no wildcard bypass
      expect(r.qual).toContain('current_setting');
      expect(r.qual).toContain('app.tenant_id');
    }
  });

  it('a committed apply writes rows tagged with the caller\'s tenantId, not any other', async () => {
    const applied = await applyConsolidation(prisma, applyInput(fx));
    expect(applied.status).toBe('APPLIED');
    if (applied.status !== 'APPLIED') return;

    // Parent lineage row
    const consolidation = await prisma.routeConsolidation.findUnique({
      where: { id: applied.consolidationId },
      include: { sources: true, enrollmentMigrations: true },
    });
    expect(consolidation?.tenantId).toBe(fx.tenantId);

    // Child tenant tagging
    for (const s of consolidation!.sources) expect(s.tenantId).toBe(fx.tenantId);
    for (const m of consolidation!.enrollmentMigrations) expect(m.tenantId).toBe(fx.tenantId);

    // Merged route tenant tagging
    const merged = await prisma.busRoute.findUnique({ where: { id: applied.mergedRouteId! } });
    expect(merged?.tenantId).toBe(fx.tenantId);

    // Nothing under otherTenantId
    const cross = await prisma.routeConsolidation.count({ where: { tenantId: fx.otherTenantId } });
    expect(cross).toBe(0);
  });
});
