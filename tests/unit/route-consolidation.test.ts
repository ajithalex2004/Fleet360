/**
 * Unit tests for src/lib/planning/route-consolidation.ts
 *
 * analyzeConsolidations is pure over the ConsolidationFacts you hand
 * it, so tests build facts inline and read the recommendations +
 * skipped[] back. Full PCE math is covered by the planning-evaluate
 * suite; these tests focus on the consolidation-specific logic —
 * cheap-filter cascade, zone-compat integration, scoring/ranking,
 * PCE-verdict-affects-feasibility.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { analyzeConsolidations, type ConsolidationObjective } from '@/lib/planning/route-consolidation';
import type { ConsolidationFacts, RouteFacts } from '@/lib/planning/route-consolidation-facts';
import type { PlanningConstraintFacts } from '@/lib/planning/evaluate-plan';
import { DEFAULT_SCORING_POLICY } from '@/lib/planning/route-consolidation-scoring-policy';

// analyzeConsolidations is async and Prisma-aware: it batches a real
// distance/duration matrix lookup for the pairs that survive Stage 1.
// Stub that module so these stay pure unit tests over the consolidation
// logic itself (same approach as the vehicle-reuse matrix-mapping test).
// An empty result map means "no matrix refinement available", which is
// the same path the engine takes when the provider returns nothing — it
// falls back to its own estimates, keeping the scoring assertions valid.
vi.mock('@/lib/planning/route-consolidation-matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/planning/route-consolidation-matrix')>();
  return {
    ...actual,
    resolveMatrixPairings: vi.fn().mockResolvedValue(new Map()),
  };
});

// getLatestFuelPrice() receives this and rejects; the engine already
// wraps that call in .catch(() => null) and falls back to its default.
const fakePrisma = {} as PrismaClient;

/** Thin wrapper so every assertion below stays exactly as written. */
function analyze(f: ConsolidationFacts, objective: ConsolidationObjective = {}) {
  return analyzeConsolidations(fakePrisma, 'tenant-1', f, objective, DEFAULT_SCORING_POLICY);
}

// ─── Builders ────────────────────────────────────────────────────────

function route(overrides: Partial<RouteFacts> = {}): RouteFacts {
  return {
    id: 'r1',
    name: 'Route 1',
    routeType: 'STAFF',
    requiredVehicleGroup: 'BUS',
    totalDistanceKm: 20,
    estimatedDurationMins: 40,
    capacity: 40,
    stops: [
      { placeId: 'zone-al-barsha', lat: 25.10, lng: 55.20, sequence: 1 },
      { placeId: 'zone-jlt',       lat: 25.07, lng: 55.14, sequence: 2 },
    ],
    enrolledCount: 20,
    representativeShift: 'MORNING',
    representativeDirection: 'INBOUND',
    // Fields the current RouteFacts adds. Departure/arrival are only
    // read by the departure/arrival-proximity filters, which are opt-in
    // via objective overrides; null keeps them inert here, preserving
    // the original cheap-filter expectations.
    representativeDepartureTime: null,
    representativeArrivalTime: null,
    assignedVehicleId: null,
    assignedDriverId: null,
    ...overrides,
  };
}

function constraint(overrides: Partial<PlanningConstraintFacts>): PlanningConstraintFacts {
  return {
    id: 'c1',
    name: 'rule',
    kind: 'ROUTE_STOP_DEVIATION_MAX',
    action: 'BLOCK',
    penaltyScore: null,
    params: { maxMinutes: 15 },
    effectiveFrom: null,
    effectiveTo: null,
    reason: null,
    isEnabled: true,
    ...overrides,
  };
}

function facts(routes: RouteFacts[], constraints: PlanningConstraintFacts[] = []): ConsolidationFacts {
  return { routes, constraints, tenantTimezone: 'Asia/Dubai' };
}

// ─── Cheap filters ───────────────────────────────────────────────────

describe('analyzeConsolidations — cheap filters', () => {
  it('empty route list → no recommendations, no skipped pairs', async () => {
    const r = await analyze(facts([]));
    expect(r.recommendations).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.totals.pairsConsidered).toBe(0);
  });

  it('skips pairs with different shift', async () => {
    const r = await analyze(facts([
      route({ id: 'r1', representativeShift: 'MORNING' }),
      route({ id: 'r2', representativeShift: 'EVENING' }),
    ]));
    expect(r.recommendations).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toBe('DIFFERENT_SHIFT');
  });

  it('skips pairs with different direction', async () => {
    const r = await analyze(facts([
      route({ id: 'r1', representativeDirection: 'INBOUND' }),
      route({ id: 'r2', representativeDirection: 'OUTBOUND' }),
    ]));
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toBe('DIFFERENT_DIRECTION');
  });

  it('skips pairs with different routeType (unless one is BOTH)', async () => {
    const r1 = await analyze(facts([
      route({ id: 'r1', routeType: 'STAFF' }),
      route({ id: 'r2', routeType: 'SCHOOL' }),
    ]));
    expect(r1.skipped[0].reason).toBe('DIFFERENT_ROUTE_TYPE');

    // BOTH is compatible with either
    const r2 = await analyze(facts([
      route({ id: 'r1', routeType: 'STAFF' }),
      route({ id: 'r2', routeType: 'BOTH' }),
    ]));
    expect(r2.skipped).toHaveLength(0);
    expect(r2.recommendations).toHaveLength(1);
  });

  it('skips pairs with <2 stops', async () => {
    const r = await analyze(facts([
      route({ id: 'r1' }),
      route({ id: 'r2', stops: [{ placeId: 'z', lat: 0, lng: 0, sequence: 1 }] }),
    ]));
    expect(r.skipped[0].reason).toBe('INSUFFICIENT_ROUTE_DATA');
  });

  it('skips when pickup zones are explicitly different (DIFFERENT_ZONES wins over distance)', async () => {
    // Both routes have first-stop placeIds but they don't overlap.
    // Even though coords are close, ZONE_DIFFERENT stops the candidate cold.
    const r = await analyze(facts([
      route({
        id: 'r1',
        stops: [
          { placeId: 'zone-north', lat: 25.10, lng: 55.20, sequence: 1 },
          { placeId: 'zone-dest',  lat: 25.07, lng: 55.14, sequence: 2 },
        ],
      }),
      route({
        id: 'r2',
        stops: [
          { placeId: 'zone-south', lat: 25.101, lng: 55.201, sequence: 1 },
          { placeId: 'zone-dest',  lat: 25.07, lng: 55.14, sequence: 2 },
        ],
      }),
    ]));
    expect(r.skipped[0].reason).toBe('PICKUP_ZONE_INCOMPATIBLE');
    expect(r.skipped[0].detail).toBe('DIFFERENT_ZONES');
  });

  it('skips when zone data is not available for compat', async () => {
    const r = await analyze(facts([
      route({ id: 'r1', stops: [
        { placeId: null, lat: null, lng: null, sequence: 1 },
        { placeId: null, lat: null, lng: null, sequence: 2 },
      ]}),
      route({ id: 'r2' }),
    ]));
    expect(r.skipped[0].reason).toBe('ZONE_DATA_UNAVAILABLE');
  });
});

// ─── Scoring + PCE integration ──────────────────────────────────────

describe('analyzeConsolidations — scoring', () => {
  it('generates a feasible recommendation when zones + times align and no constraints fire', async () => {
    const r = await analyze(facts([
      route({ id: 'r1' }),
      route({ id: 'r2' }),
    ]));
    expect(r.recommendations).toHaveLength(1);
    const rec = r.recommendations[0];
    expect(rec.feasible).toBe(true);
    expect(rec.verdict).toBe('PASS');
    expect(rec.demand.combined).toBe(40); // 20 + 20
    expect(rec.zoneCompat.pickup.kind).toBe('SAME_ZONE');
    // scores.{fleetSavingsPerWeek,totalScore} became
    // estimatedSavings.weeklyAmount and rankingCost. Same two properties
    // asserted: the merge shows a positive weekly saving, and with no
    // constraints firing the candidate carries no PCE penalty (the old
    // "savings > penalty" condition, expressed against the new model).
    expect(rec.estimatedSavings.weeklyAmount).toBeGreaterThan(0);
    expect(rec.components.pcePenalty).toBe(0);
  });

  it('honours costPerVehicleDay + operatingDaysPerWeek overrides', async () => {
    // The savings model now blends vehicle-day cost with a fuel term
    // (estimatedSavings.weeklyAmount) instead of exposing a raw
    // costPerVehicleDay × operatingDaysPerWeek product, so the original
    // exact-arithmetic assertion no longer maps. Same property is still
    // asserted: both overrides must actually reach the calculation.
    const baseline = await analyze(
      facts([route({ id: 'r1' }), route({ id: 'r2' })]),
      { costPerVehicleDay: 100, operatingDaysPerWeek: 5 }
    );
    const raised = await analyze(
      facts([route({ id: 'r1' }), route({ id: 'r2' })]),
      { costPerVehicleDay: 200, operatingDaysPerWeek: 7 }
    );
    expect(raised.recommendations[0].estimatedSavings.operatingDaysPerWeek).toBe(7);
    expect(raised.recommendations[0].estimatedSavings.weeklyAmount)
      .toBeGreaterThan(baseline.recommendations[0].estimatedSavings.weeklyAmount);
  });

  it('BLOCK verdict from a ROUTE_STOP_DEVIATION_MAX rule sinks the recommendation to infeasible', async () => {
    // Merged route duration will be max(40, 40) + 1 extra stop × 2 = 42 min
    // A hard 1-minute deviation threshold will BLOCK.
    const r = await analyze(
      facts(
        [route({ id: 'r1' }), route({ id: 'r2' })],
        [constraint({ kind: 'ROUTE_STOP_DEVIATION_MAX', action: 'BLOCK', params: { maxMinutes: 1 } })]
      )
    );
    expect(r.recommendations[0].feasible).toBe(false);
    expect(r.recommendations[0].verdict).toBe('BLOCK');
    expect(r.recommendations[0].checks[0].code).toBe('ROUTE_STOP_DEVIATION_MAX');
  });

  it('PENALTY verdict keeps feasibility but raises ranking cost', async () => {
    const penaltyRule = constraint({
      kind: 'ROUTE_STOP_DEVIATION_MAX',
      action: 'PENALTY',
      penaltyScore: 100,
      params: { maxMinutes: 1 },
    });
    const r = await analyze(
      facts([route({ id: 'r1' }), route({ id: 'r2' })], [penaltyRule]),
      { penaltyLambda: 10 }
    );
    const rec = r.recommendations[0];
    expect(rec.feasible).toBe(true);
    // PENALTY fires once per source route (both A and B passengers detour),
    // so the 100 penaltyScore accumulates to 200 across the two sources.
    // That's correct — the total passenger-experience cost is additive.
    // This assertion is unchanged; the value simply moved from
    // scores.pcePenalty to components.pcePenalty.
    expect(rec.components.pcePenalty).toBe(200);

    // Ranking is now a normalized weighted cost (rankingCost, lower is
    // better) rather than the old raw `savings − λ×penalty` arithmetic,
    // so the exact 2000−500 figure no longer applies. The behaviour it
    // was guarding still holds and is asserted directly: a PENALTY makes
    // the same candidate rank worse than it does with no penalty rule.
    const noPenalty = await analyze(facts([route({ id: 'r1' }), route({ id: 'r2' })]));
    expect(rec.rankingCost).toBeGreaterThan(noPenalty.recommendations[0].rankingCost);
  });
});

// ─── Ranking ────────────────────────────────────────────────────────

describe('analyzeConsolidations — ranking', () => {
  it('sorts feasible-first, then ascending rankingCost', async () => {
    const r = await analyze(facts([
      route({ id: 'r-a', enrolledCount: 10 }),
      route({ id: 'r-b', enrolledCount: 10 }),
      route({ id: 'r-c', enrolledCount: 30 }),
      route({ id: 'r-d', enrolledCount: 30 }),
    ]));
    // The old assertion relied on every pair tying on score so that a
    // combined-demand tiebreak decided the order. Demand now feeds the
    // passenger-impact component and therefore rankingCost directly, so
    // pairs no longer tie. The ordering invariant itself is what
    // mattered and is asserted here: feasible candidates first, then
    // ascending rankingCost (lower cost = better).
    expect(r.recommendations.length).toBeGreaterThan(1);
    const feasibleFlags = r.recommendations.map((x) => x.feasible);
    expect(feasibleFlags).toEqual([...feasibleFlags].sort((a, b) => Number(b) - Number(a)));
    const costs = r.recommendations.filter((x) => x.feasible).map((x) => x.rankingCost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('infeasible pairs sink to the bottom regardless of totalScore', async () => {
    const r = await analyze(
      facts(
        [
          route({ id: 'r1' }),
          route({ id: 'r2' }),
          route({ id: 'r3', requiredVehicleGroup: 'VAN', capacity: 5 }), // low seats
        ],
        [
          // Constraint that BLOCKs any pair whose merged trip has too many pax.
          // (r1+r2) → 40 pax vs some vehicle assumption — but we don't
          // pass a vehicle in synth, so VEHICLE_CAPACITY_HARD silently
          // no-ops (vehicle is null). Use ROUTE_STOP_DEVIATION_MAX
          // targeted at any pair involving r3 by making the constraint
          // tight, since duration proxy differs.
          constraint({ kind: 'ROUTE_STOP_DEVIATION_MAX', action: 'BLOCK', params: { maxMinutes: 0 } }),
        ]
      )
    );
    // All pairs will BLOCK on the zero-min threshold. All infeasible.
    for (const rec of r.recommendations) expect(rec.feasible).toBe(false);
    expect(r.totals.pairsInfeasible).toBe(r.recommendations.length);
  });

  it('totals accurately reflect the funnel', async () => {
    const r = await analyze(facts([
      route({ id: 'r1', representativeShift: 'MORNING' }),
      route({ id: 'r2', representativeShift: 'MORNING' }),
      route({ id: 'r3', representativeShift: 'EVENING' }),
    ]));
    expect(r.totals.routesAnalysed).toBe(3);
    expect(r.totals.pairsConsidered).toBe(3);       // C(3,2)
    expect(r.totals.pairsSurvivingFilters).toBe(1); // only (r1, r2)
    expect(r.totals.pairsRecommended).toBe(1);
    expect(r.totals.pairsInfeasible).toBe(0);
  });

  // ─── Unknown / malformed timing ────────────────────────────────────
  //
  // Regression cover for the failure behind the 2026-08-20 revert, where a
  // 03:45 route was recommended for merging with a 12:00 one. The proximity
  // filter now exists, but two ways of evading it remained: an unparseable
  // value compared as "0 minutes apart", and an absent value skipped the
  // check with no trace in the output.

  it('skips a pair when a departure time exists but is not valid HH:MM', async () => {
    const r = await analyze(facts([
      route({ id: 'r1', representativeDepartureTime: '03:45' }),
      // Realistic corruption: a value that kept its seconds component.
      // parseTimeToMinutes rejects it, which used to mean "0 apart".
      route({ id: 'r2', representativeDepartureTime: '12:00:00' }),
    ]));
    expect(r.totals.pairsSurvivingFilters).toBe(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toBe('UNKNOWN_DEPARTURE_TIME');
    expect(r.skipped[0].detail).toContain('unparseable');
    expect(r.skipped[0].detail).toContain('12:00:00');
  });

  it('still enforces the proximity threshold on well-formed far-apart times', async () => {
    const r = await analyze(facts([
      route({ id: 'r1', representativeDepartureTime: '03:45' }),
      route({ id: 'r2', representativeDepartureTime: '12:00' }),
    ]));
    expect(r.totals.pairsSurvivingFilters).toBe(0);
    expect(r.skipped[0].reason).toBe('DEPARTURE_TIME_TOO_FAR');
    expect(r.skipped[0].detail).toContain('495 min apart'); // not 945 — wraps
  });

  it('treats an absent departure time as inert by default', async () => {
    const r = await analyze(facts([
      route({ id: 'r1', representativeDepartureTime: null }),
      route({ id: 'r2', representativeDepartureTime: '12:00' }),
    ]));
    // Long-standing behaviour: a route with no time recorded is simply not
    // timing-checked, so the pair proceeds on the remaining filters.
    expect(r.totals.pairsSurvivingFilters).toBe(1);
  });

  it('skips an absent departure time when requireKnownTimes is set', async () => {
    const r = await analyze(
      facts([
        route({ id: 'r1', representativeDepartureTime: null }),
        route({ id: 'r2', representativeDepartureTime: '12:00' }),
      ]),
      { requireKnownTimes: true },
    );
    expect(r.totals.pairsSurvivingFilters).toBe(0);
    expect(r.skipped[0].reason).toBe('UNKNOWN_DEPARTURE_TIME');
    expect(r.skipped[0].detail).toContain('no time recorded for route A');
  });

  it('reports malformed times even when requireKnownTimes is off', async () => {
    // The opt-in gates *absent* times only; corruption is always disqualifying.
    const r = await analyze(
      facts([
        route({ id: 'r1', representativeDepartureTime: 'not-a-time' }),
        route({ id: 'r2', representativeDepartureTime: null }),
      ]),
      { requireKnownTimes: false },
    );
    expect(r.skipped[0].reason).toBe('UNKNOWN_DEPARTURE_TIME');
    expect(r.skipped[0].detail).toContain('unparseable');
  });
});
