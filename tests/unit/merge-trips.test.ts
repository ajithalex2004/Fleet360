/**
 * Unit tests for src/lib/bus-ops/merge-trips.ts
 *
 * previewMerge is pure over Prisma reads — we mock the client and drive
 * each guard + happy path. applyMerge shares the guards via previewMerge;
 * its DB writes go through prisma.$transaction, which we mock by having
 * the callback receive a stubbed tx.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { previewMerge, applyMerge, type MergeInput } from '@/lib/bus-ops/merge-trips';

// ── Prisma mock builder ──────────────────────────────────────────────

type SourceTripRow = {
  id: string;
  tenantId: string | null;
  status: string | null;
  mergedIntoTripId: string | null;
  departureTime: Date;
  confirmedCount: number | null;
};

type TripWithRoute = {
  id: string;
  routeId: string;
  vehicleId: string | null;
  driverId: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  latestArrivalTime: Date | null;
  confirmedCount: number | null;
  tenantId: string;
  deletedAt: Date | null;
  route: {
    stops: Array<{ placeId: string | null; gpsLat: number | null; gpsLng: number | null; sequence: number }>;
  };
};

type PlanningConstraintRow = {
  id: string; name: string; kind: string; action: string;
  penaltyScore: number | null; params: Record<string, unknown>;
  effectiveFrom: Date | null; effectiveTo: Date | null;
  reason: string | null; isEnabled: boolean;
};

type VehicleRow = { id: string; seatingCapacity: number | null; vehicleGroup: string | null };

interface MockFacts {
  sources?: SourceTripRow[];
  /** Rows returned to loadPlanFacts' existing-trip lookup. */
  tripsWithRoute?: TripWithRoute[];
  vehicle?: VehicleRow | null;
  constraints?: PlanningConstraintRow[];
  vehicles?: VehicleRow[];
}

function buildPrismaMock(facts: MockFacts) {
  const created: unknown[] = [];
  const passengerUpdates: unknown[] = [];
  const sourceUpdates: unknown[] = [];
  const tripLogs: unknown[] = [];

  const tx = {
    tripSchedule: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: 'merged-trip-1' };
      }),
      updateMany: vi.fn(async (args: unknown) => {
        sourceUpdates.push(args);
        return { count: (facts.sources ?? []).length };
      }),
    },
    tripPassenger: {
      updateMany: vi.fn(async (args: unknown) => {
        passengerUpdates.push(args);
        return { count: 7 }; // arbitrary — asserted only in tests that need it
      }),
    },
    tripLog: {
      create: vi.fn(async (args: unknown) => {
        tripLogs.push(args);
        return { id: 'log-1' };
      }),
    },
  };

  const prisma = {
    tripSchedule: {
      findMany: vi.fn().mockResolvedValue(facts.tripsWithRoute ?? []),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // Source-trip lookup uses .findMany with a specific select shape — we
    // return the sources list; happy tests set both `sources` and
    // `tripsWithRoute` because the two lookups have different shapes.
    vehicle: {
      findFirst: vi.fn().mockResolvedValue(facts.vehicle ?? null),
      findMany: vi.fn().mockResolvedValue(facts.vehicles ?? []),
    },
    planningConstraint: { findMany: vi.fn().mockResolvedValue(facts.constraints ?? []) },
    place: { findMany: vi.fn().mockResolvedValue([]) },
    tripPassenger: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as PrismaClient & { $sinks: { created: unknown[]; passengerUpdates: unknown[]; sourceUpdates: unknown[]; tripLogs: unknown[] } };

  // First tripSchedule.findMany call = source lookup (returns SourceTripRow[])
  // Second call (from loadPlanFacts for existing trips) = tripsWithRoute
  prisma.tripSchedule.findMany = vi.fn()
    .mockResolvedValueOnce(facts.sources ?? [])
    .mockResolvedValueOnce(facts.tripsWithRoute ?? []);

  // Attach test sinks for assertion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$sinks = { created, passengerUpdates, sourceUpdates, tripLogs };
  return prisma;
}

// ── Test data ────────────────────────────────────────────────────────

const T = 'tenant-A';
const src1Depart = new Date('2026-08-14T06:00:00Z');
const src2Depart = new Date('2026-08-14T06:05:00Z');
const mergedDepart = new Date('2026-08-14T06:00:00Z');
const mergedArrive = new Date('2026-08-14T07:00:00Z');

function baseInput(overrides: Partial<MergeInput> = {}): MergeInput {
  return {
    tenantId: T,
    sourceTripIds: ['trip-a', 'trip-b'],
    merged: {
      routeId: 'route-1',
      vehicleId: 'vehicle-new',
      driverId: 'driver-new',
      departureTime: mergedDepart,
      arrivalTime: mergedArrive,
      latestArrivalTime: null,
      stops: [{ placeId: 'p1', lat: 25.20, lng: 55.27, sequence: 1 }],
      notes: null,
    },
    ...overrides,
  };
}

function source(overrides: Partial<SourceTripRow> = {}): SourceTripRow {
  return {
    id: 'trip-a',
    tenantId: T,
    status: 'SCHEDULED',
    mergedIntoTripId: null,
    departureTime: src1Depart,
    confirmedCount: 10,
    ...overrides,
  };
}

function tripWithRoute(overrides: Partial<TripWithRoute> = {}): TripWithRoute {
  return {
    id: 'trip-a',
    routeId: 'route-1',
    vehicleId: 'vehicle-old',
    driverId: 'driver-old',
    departureTime: src1Depart,
    arrivalTime: new Date('2026-08-14T06:45:00Z'),
    latestArrivalTime: null,
    confirmedCount: 10,
    tenantId: T,
    deletedAt: null,
    route: { stops: [{ placeId: 'p1', gpsLat: 25.20, gpsLng: 55.27, sequence: 1 }] },
    ...overrides,
  };
}

// ── Structural guards ────────────────────────────────────────────────

describe('previewMerge — structural guards', () => {
  it('rejects <2 sources', async () => {
    const prisma = buildPrismaMock({});
    const r = await previewMerge(prisma, baseInput({ sourceTripIds: ['only-one'] }));
    expect('code' in r && r.code).toBe('MERGE_TOO_FEW_SOURCES');
  });

  it('rejects duplicate source ids', async () => {
    const prisma = buildPrismaMock({});
    const r = await previewMerge(prisma, baseInput({ sourceTripIds: ['trip-a', 'trip-a'] }));
    expect('code' in r && r.code).toBe('MERGE_DUPLICATE_SOURCE_IDS');
  });
});

// ── Source-state guards ──────────────────────────────────────────────

describe('previewMerge — source-state guards', () => {
  it('rejects when a source is missing (or cross-tenant)', async () => {
    const prisma = buildPrismaMock({ sources: [source({ id: 'trip-a' })] });
    const r = await previewMerge(prisma, baseInput());
    expect('code' in r && r.code).toBe('MERGE_SOURCE_NOT_FOUND');
    if ('details' in r && r.details) {
      expect((r.details as { missing: string[] }).missing).toEqual(['trip-b']);
    }
  });

  it('rejects when a source has already been merged', async () => {
    const prisma = buildPrismaMock({
      sources: [
        source({ id: 'trip-a', status: 'MERGED', mergedIntoTripId: 'other-merged' }),
        source({ id: 'trip-b' }),
      ],
    });
    const r = await previewMerge(prisma, baseInput());
    expect('code' in r && r.code).toBe('MERGE_SOURCE_ALREADY_MERGED');
  });

  it('rejects when a source is DEPARTED', async () => {
    const prisma = buildPrismaMock({
      sources: [source({ id: 'trip-a', status: 'DEPARTED' }), source({ id: 'trip-b' })],
    });
    const r = await previewMerge(prisma, baseInput());
    expect('code' in r && r.code).toBe('MERGE_SOURCE_NOT_SCHEDULED');
  });

  it('rejects when merged departure precedes earliest source', async () => {
    const prisma = buildPrismaMock({
      sources: [
        source({ id: 'trip-a', departureTime: src1Depart }),
        source({ id: 'trip-b', departureTime: src2Depart }),
      ],
    });
    const r = await previewMerge(
      prisma,
      baseInput({
        merged: {
          ...baseInput().merged,
          departureTime: new Date('2026-08-14T05:30:00Z'), // before src1Depart
        },
      })
    );
    expect('code' in r && r.code).toBe('MERGE_DEPARTURE_BEFORE_SOURCE');
  });
});

// ── Happy paths + PCE integration ───────────────────────────────────

describe('previewMerge — PCE integration', () => {
  it('PASSes with no constraints — returns preview counts', async () => {
    const prisma = buildPrismaMock({
      sources: [
        source({ id: 'trip-a', confirmedCount: 10 }),
        source({ id: 'trip-b', confirmedCount: 15 }),
      ],
      tripsWithRoute: [
        tripWithRoute({ id: 'trip-a', confirmedCount: 10 }),
        tripWithRoute({ id: 'trip-b', confirmedCount: 15 }),
      ],
      vehicle: { id: 'vehicle-new', seatingCapacity: 40, vehicleGroup: 'BUS' },
    });
    const r = await previewMerge(prisma, baseInput());
    expect('code' in r).toBe(false);
    if ('code' in r) return;
    expect(r.verdict).toBe('PASS');
    expect(r.preview.passengerCount).toBe(25);
    expect(r.preview.capacity).toBe(40);
    expect(r.preview.sourceTripIds).toEqual(['trip-a', 'trip-b']);
  });

  it('BLOCKs when merged capacity is exceeded (VEHICLE_CAPACITY_HARD)', async () => {
    const prisma = buildPrismaMock({
      sources: [
        source({ id: 'trip-a', confirmedCount: 30 }),
        source({ id: 'trip-b', confirmedCount: 30 }),
      ],
      tripsWithRoute: [
        tripWithRoute({ id: 'trip-a', confirmedCount: 30 }),
        tripWithRoute({ id: 'trip-b', confirmedCount: 30 }),
      ],
      vehicle: { id: 'vehicle-new', seatingCapacity: 40, vehicleGroup: 'BUS' },
      constraints: [{
        id: 'c1', name: 'seats', kind: 'VEHICLE_CAPACITY_HARD', action: 'BLOCK',
        penaltyScore: null, params: {}, effectiveFrom: null, effectiveTo: null,
        reason: null, isEnabled: true,
      }],
    });
    const r = await previewMerge(prisma, baseInput());
    expect('code' in r).toBe(false);
    if ('code' in r) return;
    expect(r.verdict).toBe('BLOCK');
    expect(r.checks.some((c) => c.code === 'VEHICLE_CAPACITY_HARD')).toBe(true);
  });

  it('BLOCKs when PASSENGER_MAX_DETOUR fires — merged trip is much longer than a source', async () => {
    const prisma = buildPrismaMock({
      sources: [
        source({ id: 'trip-a', confirmedCount: 10 }),
        source({ id: 'trip-b', confirmedCount: 10 }),
      ],
      tripsWithRoute: [
        // source A is 30min; merged is 60min → 30min detour = 100%
        tripWithRoute({
          id: 'trip-a', confirmedCount: 10,
          departureTime: new Date('2026-08-14T06:00:00Z'),
          arrivalTime: new Date('2026-08-14T06:30:00Z'),
        }),
        tripWithRoute({
          id: 'trip-b', confirmedCount: 10,
          departureTime: new Date('2026-08-14T06:00:00Z'),
          arrivalTime: new Date('2026-08-14T06:30:00Z'),
        }),
      ],
      vehicle: { id: 'vehicle-new', seatingCapacity: 40, vehicleGroup: 'BUS' },
      constraints: [{
        id: 'c1', name: 'detour', kind: 'PASSENGER_MAX_DETOUR', action: 'BLOCK',
        penaltyScore: null, params: { maxMinutes: 15 }, effectiveFrom: null, effectiveTo: null,
        reason: null, isEnabled: true,
      }],
    });
    const r = await previewMerge(prisma, baseInput());
    if ('code' in r) throw new Error('should not have errored: ' + r.code);
    expect(r.verdict).toBe('BLOCK');
    expect(r.checks.some((c) => c.code === 'PASSENGER_MAX_DETOUR')).toBe(true);
  });
});

// ── applyMerge — write path ─────────────────────────────────────────

describe('applyMerge', () => {
  it('refuses to write when preview verdict is BLOCK', async () => {
    const prisma = buildPrismaMock({
      sources: [
        source({ id: 'trip-a', confirmedCount: 30 }),
        source({ id: 'trip-b', confirmedCount: 30 }),
      ],
      tripsWithRoute: [
        tripWithRoute({ id: 'trip-a', confirmedCount: 30 }),
        tripWithRoute({ id: 'trip-b', confirmedCount: 30 }),
      ],
      vehicle: { id: 'vehicle-new', seatingCapacity: 40, vehicleGroup: 'BUS' },
      constraints: [{
        id: 'c1', name: 'seats', kind: 'VEHICLE_CAPACITY_HARD', action: 'BLOCK',
        penaltyScore: null, params: {}, effectiveFrom: null, effectiveTo: null,
        reason: null, isEnabled: true,
      }],
    });
    const r = await applyMerge(prisma, baseInput(), 'user-1');
    expect('code' in r && r.code).toBe('MERGE_BLOCKED_BY_CONSTRAINTS');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((prisma as any).$sinks.created)).toHaveLength(0);
  });

  it('commits on PASS: creates merged trip, reassigns passengers, marks sources MERGED', async () => {
    const prisma = buildPrismaMock({
      sources: [
        source({ id: 'trip-a', confirmedCount: 10 }),
        source({ id: 'trip-b', confirmedCount: 15 }),
      ],
      tripsWithRoute: [
        tripWithRoute({ id: 'trip-a', confirmedCount: 10 }),
        tripWithRoute({ id: 'trip-b', confirmedCount: 15 }),
      ],
      vehicle: { id: 'vehicle-new', seatingCapacity: 40, vehicleGroup: 'BUS' },
    });
    const r = await applyMerge(prisma, baseInput(), 'user-1');
    expect('code' in r).toBe(false);
    if ('code' in r) return;
    expect(r.mergedTripId).toBe('merged-trip-1');
    expect(r.passengersReassigned).toBe(7);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sinks = (prisma as any).$sinks;
    // Created merged trip carries the summed passenger count
    expect(sinks.created).toHaveLength(1);
    expect(sinks.created[0].confirmedCount).toBe(25);
    // Passengers reassigned by trip ids
    expect(sinks.passengerUpdates).toHaveLength(1);
    // Source trips flipped to MERGED
    expect(sinks.sourceUpdates).toHaveLength(1);
    // One trip-log per source (audit trail)
    expect(sinks.tripLogs).toHaveLength(2);
  });
});
