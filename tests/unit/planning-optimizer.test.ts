/**
 * Unit tests for src/lib/planning/optimizer.ts
 *
 * scorePlan composes the plan-delta walker with evaluatePlanApply.
 * We mock Prisma so we can (a) supply a canonical vehicle pool, (b)
 * make loadPlanFacts see a deterministic trip + constraint set, and
 * (c) assert what totalCost the objective produces.
 *
 * rankPlans is just scorePlan-in-a-loop-then-sort; we cover the sort
 * contract (BLOCK plans last, ascending totalCost, name tiebreak).
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { scorePlan, rankPlans, type ScorablePlan } from '@/lib/planning/optimizer';

// ── Prisma mock — mirrors the one used in planning-apply-gate.test ──

type TripRow = {
  id: string; routeId: string;
  vehicleId: string | null; driverId: string | null;
  departureTime: Date; arrivalTime: Date | null;
  latestArrivalTime: Date | null; confirmedCount: number | null;
  tenantId: string; deletedAt: Date | null;
  route: { stops: Array<{ placeId: string | null; gpsLat: number | null; gpsLng: number | null; sequence: number }> };
};
type Constraint = {
  id: string; name: string; kind: string; action: string;
  penaltyScore: number | null; params: Record<string, unknown>;
  effectiveFrom: Date | null; effectiveTo: Date | null;
  reason: string | null; isEnabled: boolean;
};
type Vehicle = { id: string; seatingCapacity: number | null; vehicleGroup: string | null };
type PoolRow = { id: string; licensePlate: string | null; registrationNo: string | null };

interface Facts {
  trips?: TripRow[];
  constraints?: Constraint[];
  vehicles?: Vehicle[];
  pool?: PoolRow[];
}

function buildPrismaMock(facts: Facts): PrismaClient {
  return {
    tripSchedule: { findMany: vi.fn().mockResolvedValue(facts.trips ?? []) },
    planningConstraint: { findMany: vi.fn().mockResolvedValue(facts.constraints ?? []) },
    // vehicle.findMany serves BOTH the loader (id-in filter) and the
    // pool loader (isActive filter). We return the union — the loader
    // then filters by id in-memory via the .get(). For the pool
    // loader (which orders by plate) the same rows go through.
    vehicle: {
      findMany: vi.fn().mockImplementation(async (args?: { where?: { isActive?: boolean } }) => {
        // If asked for the pool (isActive: true), return pool rows;
        // else return the vehicle-fact rows the trip-loader wants.
        if (args?.where?.isActive === true) return facts.pool ?? [];
        return facts.vehicles ?? [];
      }),
    },
    place: { findMany: vi.fn().mockResolvedValue([]) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as PrismaClient;
}

// ── Test data ────────────────────────────────────────────────────────

const T = 'tenant-A';

const basePool: PoolRow[] = [
  { id: 'veh-1', licensePlate: 'AA-001', registrationNo: null },
  { id: 'veh-2', licensePlate: 'AA-002', registrationNo: null },
];

function tripRow(id: string, confirmed = 10): TripRow {
  return {
    id, routeId: 'route-1',
    vehicleId: 'veh-1', driverId: 'drv-1',
    departureTime: new Date('2026-08-14T06:00:00Z'),
    arrivalTime: new Date('2026-08-14T07:00:00Z'),
    latestArrivalTime: null, confirmedCount: confirmed,
    tenantId: T, deletedAt: null,
    route: { stops: [{ placeId: 'p1', gpsLat: 25.20, gpsLng: 55.27, sequence: 1 }] },
  };
}

function scorablePlan(id: string, overrides: Partial<ScorablePlan> = {}): ScorablePlan {
  return {
    id,
    name: `Plan ${id}`,
    runs: [{ id: 'r1', date: '2026-08-14', tripIds: ['trip-1'] }],
    blocks: [{ id: 'b1', vehicleLabel: 'V1', date: '2026-08-14', tripIds: ['trip-1'] }],
    rosters: [{ driverId: 'drv-A', days: [{ date: '2026-08-14', runIds: ['r1'] }] }],
    summary: { totalPayCost: 1000 },
    ...overrides,
  };
}

// ── scorePlan ────────────────────────────────────────────────────────

describe('scorePlan', () => {
  it('feasible plan with no constraints — totalCost = plan.totalPayCost', async () => {
    const prisma = buildPrismaMock({
      trips: [tripRow('trip-1')],
      pool: basePool,
      vehicles: [{ id: 'veh-1', seatingCapacity: 30, vehicleGroup: 'BUS' }],
    });
    const s = await scorePlan(prisma, T, scorablePlan('p1'));
    expect(s.feasible).toBe(true);
    expect(s.verdict).toBe('PASS');
    expect(s.operatingCost).toBe(1000);
    expect(s.pcePenalty).toBe(0);
    expect(s.totalCost).toBe(1000);
    expect(s.tripCount).toBe(1);
  });

  it('penaltyLambda amplifies PCE penalty into totalCost', async () => {
    const prisma = buildPrismaMock({
      trips: [
        // Deliberately overcap: 40 pax on a 30-seat vehicle. With a
        // PENALTY-action rule for TRIP_MAX_DURATION we get a nonzero
        // penalty without triggering BLOCK.
        {
          ...tripRow('trip-1', 10),
          arrivalTime: new Date('2026-08-14T09:00:00Z'), // 3h duration
        },
      ],
      pool: basePool,
      vehicles: [{ id: 'veh-1', seatingCapacity: 30, vehicleGroup: 'BUS' }],
      constraints: [{
        id: 'c1', name: 'dur', kind: 'TRIP_MAX_DURATION', action: 'PENALTY',
        penaltyScore: 20, params: { maxMinutes: 60 },
        effectiveFrom: null, effectiveTo: null, reason: null, isEnabled: true,
      }],
    });
    const s = await scorePlan(prisma, T, scorablePlan('p1'), { penaltyLambda: 5 });
    expect(s.feasible).toBe(true);
    expect(s.pcePenalty).toBe(20);
    expect(s.totalCost).toBe(1000 + 5 * 20);
  });

  it('BLOCK verdict → feasible=false, keeps operatingCost + penalty in result', async () => {
    const prisma = buildPrismaMock({
      trips: [tripRow('trip-1', 999)],
      pool: basePool,
      vehicles: [{ id: 'veh-1', seatingCapacity: 30, vehicleGroup: 'BUS' }],
      constraints: [{
        id: 'c1', name: 'cap', kind: 'VEHICLE_CAPACITY_HARD', action: 'BLOCK',
        penaltyScore: null, params: {},
        effectiveFrom: null, effectiveTo: null, reason: null, isEnabled: true,
      }],
    });
    const s = await scorePlan(prisma, T, scorablePlan('p1'));
    expect(s.feasible).toBe(false);
    expect(s.verdict).toBe('BLOCK');
    expect(s.blockedTripIds).toEqual(['trip-1']);
  });

  it('override cost model — replaces plan.totalPayCost with per-metric breakdown', async () => {
    const prisma = buildPrismaMock({
      trips: [tripRow('trip-1')],
      pool: basePool,
      vehicles: [{ id: 'veh-1', seatingCapacity: 30, vehicleGroup: 'BUS' }],
    });
    const plan = scorablePlan('p1', {
      summary: {
        totalPayCost: 9999,        // should be ignored when overrides given
        totalPayHours: 8,
        totalDeadheadHours: 2,
        blockCount: 2,
        driverCount: 3,
      },
    });
    const s = await scorePlan(prisma, T, plan, {
      costPerPayHour: 50,
      costPerDeadheadHour: 30,
      costPerVehicleDay: 100,
      costPerDriverDay: 40,
    });
    // 8*50 + 2*30 + 2*100 + 3*40 = 400 + 60 + 200 + 120 = 780
    expect(s.operatingCost).toBe(780);
  });

  it('plan with empty deltas — no PCE call, verdict=PASS, operatingCost from summary', async () => {
    const prisma = buildPrismaMock({ pool: basePool });
    const emptyPlan: ScorablePlan = {
      id: 'p-empty', name: 'Empty',
      runs: null, blocks: null, rosters: null,
      summary: { totalPayCost: 500 },
    };
    const s = await scorePlan(prisma, T, emptyPlan);
    expect(s.tripCount).toBe(0);
    expect(s.operatingCost).toBe(500);
    expect(s.feasible).toBe(true);
  });
});

// ── rankPlans ───────────────────────────────────────────────────────

describe('rankPlans', () => {
  it('sorts feasible-first, then by totalCost ascending, name as tiebreak', async () => {
    const prisma = buildPrismaMock({
      trips: [tripRow('trip-1')],
      pool: basePool,
      vehicles: [{ id: 'veh-1', seatingCapacity: 30, vehicleGroup: 'BUS' }],
    });
    const plans: ScorablePlan[] = [
      scorablePlan('p-expensive', { name: 'expensive', summary: { totalPayCost: 5000 } }),
      scorablePlan('p-cheap',     { name: 'cheap',     summary: { totalPayCost: 1000 } }),
      scorablePlan('p-mid',       { name: 'mid',       summary: { totalPayCost: 3000 } }),
    ];
    const ranked = await rankPlans(prisma, T, plans);
    expect(ranked.map((r) => r.planName)).toEqual(['cheap', 'mid', 'expensive']);
  });

  it('BLOCK plans sink to the bottom regardless of totalCost', async () => {
    // Two plans: cheap-but-BLOCK and expensive-but-PASS. Expensive wins.
    let call = 0;
    const prisma = {
      tripSchedule: {
        findMany: vi.fn().mockImplementation(async () => {
          // Alternate returns: cheap-block plan sees an overcap trip;
          // expensive-pass sees the normal one.
          call++;
          return call === 1
            ? [tripRow('trip-1', 999)]
            : [tripRow('trip-1', 5)];
        }),
      },
      planningConstraint: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'c1', name: 'cap', kind: 'VEHICLE_CAPACITY_HARD', action: 'BLOCK',
          penaltyScore: null, params: {},
          effectiveFrom: null, effectiveTo: null, reason: null, isEnabled: true,
        }]),
      },
      vehicle: {
        findMany: vi.fn().mockImplementation(async (args?: { where?: { isActive?: boolean } }) => {
          if (args?.where?.isActive === true) return basePool;
          return [{ id: 'veh-1', seatingCapacity: 30, vehicleGroup: 'BUS' }];
        }),
      },
      place: { findMany: vi.fn().mockResolvedValue([]) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as PrismaClient;

    const ranked = await rankPlans(prisma, T, [
      scorablePlan('p-cheap-block', { name: 'cheap-blocked', summary: { totalPayCost: 100 } }),
      scorablePlan('p-expensive-pass', { name: 'expensive-passes', summary: { totalPayCost: 5000 } }),
    ]);
    expect(ranked[0].planName).toBe('expensive-passes');
    expect(ranked[0].feasible).toBe(true);
    expect(ranked[1].planName).toBe('cheap-blocked');
    expect(ranked[1].feasible).toBe(false);
  });
});
