/**
 * Unit tests for src/lib/planning/route-consolidation-apply.ts
 *
 * Covers the guard cascade shape for previewApply, the idempotency
 * short-circuit for applyConsolidation, and the revert guard cascade
 * for revertConsolidation. Full write-path integration (transaction
 * body assertions) is deferred to staging DB tests — mocking the
 * multi-step transactional writes exhaustively in unit tests
 * duplicates schema coverage without catching real integration
 * failures.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  previewApply,
  applyConsolidation,
  revertConsolidation,
  type PreviewApplyInput,
  type ApplyConsolidationInput,
} from '@/lib/planning/route-consolidation-apply';

// ─── Prisma mock builder ────────────────────────────────────────────
//
// Reasonable defaults for a happy-path preview; tests override the
// specific methods they exercise. All methods are vi.fn so unexpected
// calls are visible in test output.

interface MockCounts {
  futureTrips?: number;
  activeTemplates?: number;
  executedTrips?: number;
}

interface MockData {
  sources?: Array<{
    id: string;
    name: string;
    isActive: boolean | null;
    retiredReason: string | null;
    retiredAt: Date | null;
    updatedAt: Date | null;
  }>;
  routeStops?: Array<{ id: string; placeId: string | null; gpsLat: number | null; gpsLng: number | null; routeId: string }>;
  routePassengers?: Array<{ id: string; routeId: string; pickupStopId: string | null; dropoffStopId: string | null }>;
  transportEnrollments?: Array<{ id: string; defaultRouteId: string; defaultStopId: string | null }>;
  planningConstraints?: unknown[];
  alreadyConsolidatedSources?: Array<{ sourceRouteId: string; consolidationId: string }>;
  existingConsolidation?: { id: string; mergedRouteId: string | null; status: string; appliedAt?: Date; sources?: unknown[]; enrollmentMigrations?: unknown[]; appliedStateHash?: string } | null;
  downstreamConsolidationSource?: { consolidationId: string } | null;
}

function buildMock(
  data: MockData = {},
  counts: MockCounts = {}
): PrismaClient {
  const findManyRouteStop = vi.fn().mockImplementation(async (args: unknown) => {
    if (!args || typeof args !== 'object') return data.routeStops ?? [];
    return data.routeStops ?? [];
  });

  return {
    busRoute: {
      findMany: vi.fn().mockResolvedValue(data.sources ?? []),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    routeStop: { findMany: findManyRouteStop },
    routePassenger: { findMany: vi.fn().mockResolvedValue(data.routePassengers ?? []) },
    transportEnrollment: { findMany: vi.fn().mockResolvedValue(data.transportEnrollments ?? []) },
    tripSchedule: { count: vi.fn().mockResolvedValue(counts.futureTrips ?? 0) },
    busOpsScheduleTemplate: { count: vi.fn().mockResolvedValue(counts.activeTemplates ?? 0) },
    planningConstraint: { findMany: vi.fn().mockResolvedValue(data.planningConstraints ?? []) },
    routeConsolidation: {
      findFirst: vi.fn().mockResolvedValue(data.existingConsolidation ?? null),
    },
    routeConsolidationSource: {
      findMany: vi.fn().mockResolvedValue(data.alreadyConsolidatedSources ?? []),
      findFirst: vi.fn().mockResolvedValue(data.downstreamConsolidationSource ?? null),
    },
    $transaction: vi.fn().mockRejectedValue(new Error('$transaction unexpectedly called in test')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as PrismaClient;
}

const T = 'tenant-A';

function baseInput(overrides: Partial<PreviewApplyInput> = {}): PreviewApplyInput {
  return {
    tenantId: T,
    recommendationId: 'rec-1',
    sourceRouteIds: ['route-a', 'route-b'],
    mergedRoute: { stopIds: ['stop-1', 'stop-2'] },
    ...overrides,
  };
}

function sourceRoute(overrides: Partial<{ id: string; name: string; isActive: boolean | null; retiredReason: string | null; retiredAt: Date | null; updatedAt: Date | null }> = {}) {
  return {
    id: 'route-a',
    name: 'Route A',
    isActive: true,
    retiredReason: null,
    retiredAt: null,
    updatedAt: new Date('2026-08-16T00:00:00Z'),
    ...overrides,
  };
}

// ─── previewApply — guard cascade shape ─────────────────────────────

describe('previewApply guards', () => {
  it('BLOCKS on missing source routes', async () => {
    const prisma = buildMock({
      sources: [sourceRoute({ id: 'route-a' })], // only 1 of 2 requested returned
      routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }],
    });
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('BLOCKED');
    const g = r.guards.find((x) => x.code === 'GUARD_SOURCE_ROUTE_NOT_FOUND');
    expect(g?.status).toBe('BLOCK');
    expect(g?.message).toContain('route-b');
  });

  it('BLOCKS on inactive source route', async () => {
    const prisma = buildMock({
      sources: [sourceRoute({ id: 'route-a', isActive: false }), sourceRoute({ id: 'route-b' })],
      routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }],
    });
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('BLOCKED');
    expect(r.guards.find((x) => x.code === 'GUARD_SOURCE_ROUTE_INACTIVE')?.status).toBe('BLOCK');
  });

  it('BLOCKS on already-retired source route', async () => {
    const prisma = buildMock({
      sources: [
        sourceRoute({ id: 'route-a', retiredAt: new Date('2026-08-10'), retiredReason: 'CONSOLIDATED_SOURCE' }),
        sourceRoute({ id: 'route-b' }),
      ],
      routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }],
    });
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('BLOCKED');
    expect(r.guards.find((x) => x.code === 'GUARD_SOURCE_ROUTE_ALREADY_RETIRED')?.status).toBe('BLOCK');
  });

  it('BLOCKS on fingerprint mismatch (staleness)', async () => {
    const prisma = buildMock({
      sources: [
        sourceRoute({ id: 'route-a', updatedAt: new Date('2026-08-16T05:00:00Z') }), // actual
        sourceRoute({ id: 'route-b' }),
      ],
      routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }],
    });
    const r = await previewApply(prisma, baseInput({
      sourceRouteFingerprints: { 'route-a': '2026-08-14T00:00:00.000Z' }, // stale
    }));
    expect(r.overallVerdict).toBe('BLOCKED');
    expect(r.guards.find((x) => x.code === 'GUARD_SOURCE_ROUTE_STALE_FINGERPRINT')?.status).toBe('BLOCK');
  });

  it('PASSes fingerprint check when the value matches actual updatedAt', async () => {
    const actual = new Date('2026-08-16T05:00:00Z');
    const prisma = buildMock({
      sources: [sourceRoute({ id: 'route-a', updatedAt: actual }), sourceRoute({ id: 'route-b', updatedAt: actual })],
      routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }],
    });
    const r = await previewApply(prisma, baseInput({
      sourceRouteFingerprints: { 'route-a': actual.toISOString(), 'route-b': actual.toISOString() },
    }));
    // Not blocked BY staleness (may still be blocked by others in a busier test)
    expect(r.guards.find((x) => x.code === 'GUARD_SOURCE_ROUTE_STALE_FINGERPRINT')).toBeUndefined();
  });

  it('BLOCKS when a source is already part of an APPLIED consolidation', async () => {
    const prisma = buildMock({
      sources: [sourceRoute({ id: 'route-a' }), sourceRoute({ id: 'route-b' })],
      alreadyConsolidatedSources: [{ sourceRouteId: 'route-a', consolidationId: 'consol-prior' }],
      routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }],
    });
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('BLOCKED');
    expect(r.guards.find((x) => x.code === 'GUARD_SOURCE_ALREADY_CONSOLIDATED')?.status).toBe('BLOCK');
  });

  it('BLOCKS on future scheduled trips existing on source routes', async () => {
    const prisma = buildMock(
      { sources: [sourceRoute({ id: 'route-a' }), sourceRoute({ id: 'route-b' })], routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }] },
      { futureTrips: 3 }
    );
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('BLOCKED');
    const g = r.guards.find((x) => x.code === 'GUARD_FUTURE_TRIPS_EXIST');
    expect(g?.status).toBe('BLOCK');
    expect(g?.message).toContain('3');
  });

  it('BLOCKS on active schedule templates existing on source routes', async () => {
    const prisma = buildMock(
      { sources: [sourceRoute({ id: 'route-a' }), sourceRoute({ id: 'route-b' })], routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }] },
      { activeTemplates: 2 }
    );
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('BLOCKED');
    expect(r.guards.find((x) => x.code === 'GUARD_ACTIVE_SCHEDULE_TEMPLATES_EXIST')?.status).toBe('BLOCK');
  });

  it('BLOCKS when an enrolment stop cannot be auto-mapped and no operator resolution supplied', async () => {
    const prisma = buildMock({
      sources: [sourceRoute({ id: 'route-a' }), sourceRoute({ id: 'route-b' })],
      routeStops: [
        // Merged route uses these stops; stop-1 belongs to route-a, stop-2 to route-b
        { id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' },
        { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-b' },
        // Additional stop-A exists on route-a but is NOT in the merged stopIds
        { id: 'stop-A-only', placeId: 'p-unique-to-a', gpsLat: 0, gpsLng: 0, routeId: 'route-a' },
      ],
      routePassengers: [
        // Passenger enrolled at the unique stop that ISN'T on the merged route
        { id: 'rp-1', routeId: 'route-a', pickupStopId: 'stop-A-only', dropoffStopId: null },
      ],
    });
    const r = await previewApply(prisma, baseInput());
    expect(r.guards.find((x) => x.code === 'GUARD_ENROLLMENT_UNRESOLVED')?.status).toBe('BLOCK');
    expect(r.enrollmentMigrations).toHaveLength(1);
    expect(r.enrollmentMigrations[0].requiresOperatorResolution).toBe(true);
  });

  it('READY when all guards pass and no enrolments require resolution', async () => {
    const prisma = buildMock({
      sources: [sourceRoute({ id: 'route-a' }), sourceRoute({ id: 'route-b' })],
      routeStops: [
        { id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' },
        { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-b' },
      ],
      routePassengers: [{ id: 'rp-1', routeId: 'route-a', pickupStopId: 'stop-1', dropoffStopId: null }],
    });
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('READY');
    expect(r.guards.filter((g) => g.status === 'BLOCK')).toHaveLength(0);
    expect(r.enrollmentMigrations[0].requiresOperatorResolution).toBe(false);
    expect(r.enrollmentMigrations[0].pickupMapping.method).toBe('EXACT_STOP');
  });

  it('reports multiple guard failures in one preview call', async () => {
    const prisma = buildMock(
      { sources: [sourceRoute({ id: 'route-a', isActive: false }), sourceRoute({ id: 'route-b' })], routeStops: [{ id: 'stop-1', placeId: 'p1', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }, { id: 'stop-2', placeId: 'p2', gpsLat: 0, gpsLng: 0, routeId: 'route-a' }] },
      { futureTrips: 5, activeTemplates: 1 }
    );
    const r = await previewApply(prisma, baseInput());
    expect(r.overallVerdict).toBe('BLOCKED');
    const blocking = r.guards.filter((g) => g.status === 'BLOCK').map((g) => g.code);
    expect(blocking).toContain('GUARD_SOURCE_ROUTE_INACTIVE');
    expect(blocking).toContain('GUARD_FUTURE_TRIPS_EXIST');
    expect(blocking).toContain('GUARD_ACTIVE_SCHEDULE_TEMPLATES_EXIST');
  });
});

// ─── applyConsolidation — idempotency short-circuit ─────────────────

describe('applyConsolidation idempotency', () => {
  it('returns ALREADY_APPLIED without a transaction when the idempotencyKey has a prior consolidation', async () => {
    const prisma = buildMock({
      existingConsolidation: { id: 'consol-prior', mergedRouteId: 'route-M', status: 'APPLIED' },
    });
    // The base mock's $transaction rejects on invocation — so if apply
    // erroneously reaches the transaction body, this test fails hard.
    const input: ApplyConsolidationInput = {
      ...baseInput(),
      idempotencyKey: 'idem-1',
      appliedBy: 'user-1',
    };
    const r = await applyConsolidation(prisma, input);
    expect(r).toEqual({
      status: 'ALREADY_APPLIED',
      consolidationId: 'consol-prior',
      mergedRouteId: 'route-M',
      priorStatus: 'APPLIED',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('returns ALREADY_APPLIED even when the prior status is REVERTED (recommendation was applied+reverted)', async () => {
    const prisma = buildMock({
      existingConsolidation: { id: 'consol-r', mergedRouteId: 'route-M', status: 'REVERTED' },
    });
    const r = await applyConsolidation(prisma, {
      ...baseInput(), idempotencyKey: 'idem-1', appliedBy: 'user-1',
    });
    expect(r.status).toBe('ALREADY_APPLIED');
    if (r.status === 'ALREADY_APPLIED') expect(r.priorStatus).toBe('REVERTED');
  });
});

// ─── revertConsolidation — guard cascade ────────────────────────────

describe('revertConsolidation guards', () => {
  function buildRevertMock(overrides: {
    consolidation?: {
      id: string; tenantId: string; status: string; mergedRouteId: string | null;
      appliedAt: Date; appliedStateHash: string;
      sources: Array<{ sourceRouteId: string }>;
      enrollmentMigrations: Array<{ routePassengerId: string | null; transportEnrollmentId: string | null; sourceRouteId: string; oldPickupStopId: string | null; oldDropoffStopId: string | null }>;
    } | null;
    executedTrips?: number;
    downstream?: { consolidationId: string } | null;
    currentHashRoute?: { name: string; isActive: boolean; retiredReason: string | null; updatedAt: Date; capacity: number | null; requiredVehicleGroup: string | null } | null;
    currentHashStops?: Array<{ id: string; placeId: string | null; gpsLat: number | null; gpsLng: number | null; sequence: number }>;
  } = {}): PrismaClient {
    return {
      routeConsolidation: {
        findFirst: vi.fn().mockResolvedValue(overrides.consolidation ?? null),
      },
      tripSchedule: { count: vi.fn().mockResolvedValue(overrides.executedTrips ?? 0) },
      routeConsolidationSource: { findFirst: vi.fn().mockResolvedValue(overrides.downstream ?? null) },
      busRoute: { findUnique: vi.fn().mockResolvedValue(overrides.currentHashRoute ?? null) },
      routeStop: { findMany: vi.fn().mockResolvedValue(overrides.currentHashStops ?? []) },
      planningConstraint: { findMany: vi.fn().mockResolvedValue([]) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as PrismaClient;
  }

  function withTx(prisma: PrismaClient): PrismaClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$transaction = vi.fn().mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = prisma as any;
      tx.$queryRawUnsafe = vi.fn().mockResolvedValue([]);
      return fn(tx as PrismaClient);
    });
    return prisma;
  }

  it('BLOCKS on consolidation not found in this tenant', async () => {
    const prisma = withTx(buildRevertMock({ consolidation: null }));
    const r = await revertConsolidation(prisma, { tenantId: T, consolidationId: 'no-such', revertedBy: 'u1' });
    expect(r.status).toBe('BLOCKED');
    if (r.status === 'BLOCKED') expect(r.guards[0].code).toBe('GUARD_CONSOLIDATION_NOT_FOUND');
  });

  it('BLOCKS on consolidation not in APPLIED status', async () => {
    const prisma = withTx(buildRevertMock({
      consolidation: {
        id: 'c1', tenantId: T, status: 'REVERTED', mergedRouteId: 'route-M',
        appliedAt: new Date(), appliedStateHash: 'x', sources: [], enrollmentMigrations: [],
      },
    }));
    const r = await revertConsolidation(prisma, { tenantId: T, consolidationId: 'c1', revertedBy: 'u1' });
    expect(r.status).toBe('BLOCKED');
    if (r.status === 'BLOCKED') expect(r.guards[0].code).toBe('GUARD_CONSOLIDATION_NOT_APPLIED');
  });

  it('BLOCKS on revert window elapsed (default 24h)', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3600_000);
    const prisma = withTx(buildRevertMock({
      consolidation: {
        id: 'c1', tenantId: T, status: 'APPLIED', mergedRouteId: 'route-M',
        appliedAt: twoDaysAgo, appliedStateHash: 'stable', sources: [], enrollmentMigrations: [],
      },
      currentHashRoute: { name: 'M', isActive: true, retiredReason: null, updatedAt: twoDaysAgo, capacity: null, requiredVehicleGroup: null },
      currentHashStops: [],
    }));
    const r = await revertConsolidation(prisma, { tenantId: T, consolidationId: 'c1', revertedBy: 'u1' });
    expect(r.status).toBe('BLOCKED');
    if (r.status === 'BLOCKED') {
      expect(r.guards.find((g) => g.code === 'GUARD_REVERT_WINDOW_ELAPSED')?.status).toBe('BLOCK');
    }
  });

  it('BLOCKS when executed trips exist on the merged route', async () => {
    const prisma = withTx(buildRevertMock({
      consolidation: {
        id: 'c1', tenantId: T, status: 'APPLIED', mergedRouteId: 'route-M',
        appliedAt: new Date(), appliedStateHash: 'stable', sources: [], enrollmentMigrations: [],
      },
      executedTrips: 4,
      currentHashRoute: { name: 'M', isActive: true, retiredReason: null, updatedAt: new Date(), capacity: null, requiredVehicleGroup: null },
      currentHashStops: [],
    }));
    const r = await revertConsolidation(prisma, { tenantId: T, consolidationId: 'c1', revertedBy: 'u1' });
    expect(r.status).toBe('BLOCKED');
    if (r.status === 'BLOCKED') {
      expect(r.guards.find((g) => g.code === 'GUARD_MERGED_ROUTE_HAS_EXECUTED_TRIPS')?.status).toBe('BLOCK');
    }
  });

  it('BLOCKS when the merged route has been consumed by a downstream consolidation', async () => {
    const prisma = withTx(buildRevertMock({
      consolidation: {
        id: 'c1', tenantId: T, status: 'APPLIED', mergedRouteId: 'route-M',
        appliedAt: new Date(), appliedStateHash: 'stable', sources: [], enrollmentMigrations: [],
      },
      downstream: { consolidationId: 'c2-later' },
      currentHashRoute: { name: 'M', isActive: true, retiredReason: null, updatedAt: new Date(), capacity: null, requiredVehicleGroup: null },
      currentHashStops: [],
    }));
    const r = await revertConsolidation(prisma, { tenantId: T, consolidationId: 'c1', revertedBy: 'u1' });
    expect(r.status).toBe('BLOCKED');
    if (r.status === 'BLOCKED') {
      expect(r.guards.find((g) => g.code === 'GUARD_MERGED_ROUTE_HAS_DOWNSTREAM_CONSOLIDATION')?.status).toBe('BLOCK');
    }
  });
});
