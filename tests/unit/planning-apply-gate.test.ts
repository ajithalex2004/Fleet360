/**
 * Unit tests for src/lib/planning/apply-gate.ts
 *
 * The gate composes a Prisma trip lookup with the PCE evaluator. We
 * mock Prisma to control what trips look like and what constraints are
 * active, then assert the per-trip verdicts and the aggregate.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { evaluatePlanApply, type EvaluateApplyInput } from '@/lib/planning/apply-gate';

// ── Prisma mock builder ──────────────────────────────────────────────

type TripRow = {
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
  id: string;
  name: string;
  kind: string;
  action: string;
  penaltyScore: number | null;
  params: Record<string, unknown>;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  reason: string | null;
  isEnabled: boolean;
};

type VehicleRow = { id: string; seatingCapacity: number | null; vehicleGroup: string | null };

interface MockFacts {
  trips?: TripRow[];
  constraints?: PlanningConstraintRow[];
  vehicles?: VehicleRow[];
}

function buildPrismaMock(facts: MockFacts): PrismaClient {
  return {
    tripSchedule: { findMany: vi.fn().mockResolvedValue(facts.trips ?? []) },
    planningConstraint: { findMany: vi.fn().mockResolvedValue(facts.constraints ?? []) },
    vehicle: { findMany: vi.fn().mockResolvedValue(facts.vehicles ?? []) },
    place: { findMany: vi.fn().mockResolvedValue([]) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as PrismaClient;
}

function tripRow(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: 'trip-1',
    routeId: 'route-1',
    vehicleId: 'vehicle-old',
    driverId: 'driver-old',
    departureTime: new Date('2026-08-14T06:00:00Z'),
    arrivalTime: new Date('2026-08-14T07:00:00Z'),
    latestArrivalTime: null,
    confirmedCount: 20,
    tenantId: 'tenant-A',
    deletedAt: null,
    route: { stops: [{ placeId: 'p1', gpsLat: 25.20, gpsLng: 55.27, sequence: 1 }] },
    ...overrides,
  };
}

function constraint(overrides: Partial<PlanningConstraintRow>): PlanningConstraintRow {
  return {
    id: 'c1',
    name: 'rule',
    kind: 'VEHICLE_CAPACITY_HARD',
    action: 'BLOCK',
    penaltyScore: null,
    params: {},
    effectiveFrom: null,
    effectiveTo: null,
    reason: null,
    isEnabled: true,
    ...overrides,
  };
}

const T = 'tenant-A';
const baseInput = (overrides: Partial<EvaluateApplyInput> = {}): EvaluateApplyInput => ({
  tenantId: T,
  deltas: [{ tripId: 'trip-1', newDriverId: 'driver-new', newVehicleId: 'vehicle-new' }],
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────

describe('evaluatePlanApply', () => {
  it('PASS with empty deltas — no Prisma calls, no trips', async () => {
    const prisma = buildPrismaMock({});
    const result = await evaluatePlanApply(prisma, baseInput({ deltas: [] }));
    expect(result.verdict).toBe('PASS');
    expect(result.trips).toHaveLength(0);
    expect(prisma.tripSchedule.findMany).not.toHaveBeenCalled();
  });

  it('BLOCKs a delta whose trip is missing (deleted or cross-tenant)', async () => {
    const prisma = buildPrismaMock({ trips: [] });
    const result = await evaluatePlanApply(prisma, baseInput());
    expect(result.verdict).toBe('BLOCK');
    expect(result.blockedTripIds).toEqual(['trip-1']);
    expect(result.trips[0].checks[0].code).toBe('GATE_TRIP_NOT_FOUND');
  });

  it('PASSes when no constraints are configured', async () => {
    const prisma = buildPrismaMock({
      trips: [tripRow()],
      vehicles: [{ id: 'vehicle-new', seatingCapacity: 30, vehicleGroup: 'BUS' }],
    });
    const result = await evaluatePlanApply(prisma, baseInput());
    expect(result.verdict).toBe('PASS');
    expect(result.trips[0].verdict).toBe('PASS');
  });

  it('BLOCKs when VEHICLE_CAPACITY_HARD fires — passengers exceed new vehicle seats', async () => {
    const prisma = buildPrismaMock({
      trips: [tripRow({ confirmedCount: 40 })],
      vehicles: [{ id: 'vehicle-new', seatingCapacity: 30, vehicleGroup: 'BUS' }],
      constraints: [constraint({ kind: 'VEHICLE_CAPACITY_HARD' })],
    });
    const result = await evaluatePlanApply(prisma, baseInput());
    expect(result.verdict).toBe('BLOCK');
    expect(result.trips[0].checks[0].code).toBe('VEHICLE_CAPACITY_HARD');
    expect(result.blockedTripIds).toEqual(['trip-1']);
  });

  it('WARNs when TRIP_MAX_DURATION action=WARN fires', async () => {
    const prisma = buildPrismaMock({
      trips: [
        tripRow({
          departureTime: new Date('2026-08-14T06:00:00Z'),
          arrivalTime: new Date('2026-08-14T10:00:00Z'), // 4h
        }),
      ],
      vehicles: [{ id: 'vehicle-new', seatingCapacity: 30, vehicleGroup: 'BUS' }],
      constraints: [
        constraint({ kind: 'TRIP_MAX_DURATION', action: 'WARN', params: { maxMinutes: 120 } }),
      ],
    });
    const result = await evaluatePlanApply(prisma, baseInput());
    expect(result.verdict).toBe('WARN');
    expect(result.warningTripIds).toEqual(['trip-1']);
    expect(result.blockedTripIds).toHaveLength(0);
  });

  it('aggregates worst verdict across multiple trips', async () => {
    const prisma = buildPrismaMock({
      trips: [
        tripRow({ id: 'trip-a', confirmedCount: 40 }), // will BLOCK on capacity
        tripRow({ id: 'trip-b', confirmedCount: 10 }), // PASS
      ],
      vehicles: [{ id: 'vehicle-new', seatingCapacity: 30, vehicleGroup: 'BUS' }],
      constraints: [constraint({ kind: 'VEHICLE_CAPACITY_HARD' })],
    });
    const result = await evaluatePlanApply(
      prisma,
      baseInput({
        deltas: [
          { tripId: 'trip-a', newDriverId: 'd', newVehicleId: 'vehicle-new' },
          { tripId: 'trip-b', newDriverId: 'd', newVehicleId: 'vehicle-new' },
        ],
      })
    );
    expect(result.verdict).toBe('BLOCK');
    expect(result.blockedTripIds).toEqual(['trip-a']);
    expect(result.trips).toHaveLength(2);
  });

  it('accumulates PENALTY scores across trips without changing verdict', async () => {
    const prisma = buildPrismaMock({
      trips: [
        tripRow({
          id: 'trip-a',
          departureTime: new Date('2026-08-14T06:00:00Z'),
          arrivalTime: new Date('2026-08-14T10:00:00Z'),
        }),
        tripRow({
          id: 'trip-b',
          departureTime: new Date('2026-08-14T06:00:00Z'),
          arrivalTime: new Date('2026-08-14T10:00:00Z'),
        }),
      ],
      vehicles: [{ id: 'vehicle-new', seatingCapacity: 30, vehicleGroup: 'BUS' }],
      constraints: [
        constraint({
          kind: 'TRIP_MAX_DURATION',
          action: 'PENALTY',
          penaltyScore: 5,
          params: { maxMinutes: 60 },
        }),
      ],
    });
    const result = await evaluatePlanApply(
      prisma,
      baseInput({
        deltas: [
          { tripId: 'trip-a', newDriverId: 'd', newVehicleId: 'vehicle-new' },
          { tripId: 'trip-b', newDriverId: 'd', newVehicleId: 'vehicle-new' },
        ],
      })
    );
    expect(result.verdict).toBe('PASS');
    expect(result.totalPenalty).toBe(10);
  });

  it('honors the delta — new vehicle capacity is checked, not the old vehicle', async () => {
    // Old vehicle has capacity 100 (would pass) — delta swaps in vehicle-new
    // with capacity 10 (should BLOCK).
    const prisma = buildPrismaMock({
      trips: [tripRow({ vehicleId: 'vehicle-old', confirmedCount: 20 })],
      vehicles: [
        { id: 'vehicle-new', seatingCapacity: 10, vehicleGroup: 'VAN' },
        { id: 'vehicle-old', seatingCapacity: 100, vehicleGroup: 'BUS' },
      ],
      constraints: [constraint({ kind: 'VEHICLE_CAPACITY_HARD' })],
    });
    const result = await evaluatePlanApply(prisma, baseInput());
    expect(result.verdict).toBe('BLOCK');
  });
});
