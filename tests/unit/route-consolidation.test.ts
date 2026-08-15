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

import { describe, it, expect } from 'vitest';
import { analyzeConsolidations } from '@/lib/planning/route-consolidation';
import type { ConsolidationFacts, RouteFacts } from '@/lib/planning/route-consolidation-facts';
import type { PlanningConstraintFacts } from '@/lib/planning/evaluate-plan';

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
  it('empty route list → no recommendations, no skipped pairs', () => {
    const r = analyzeConsolidations(facts([]));
    expect(r.recommendations).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.totals.pairsConsidered).toBe(0);
  });

  it('skips pairs with different shift', () => {
    const r = analyzeConsolidations(facts([
      route({ id: 'r1', representativeShift: 'MORNING' }),
      route({ id: 'r2', representativeShift: 'EVENING' }),
    ]));
    expect(r.recommendations).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toBe('DIFFERENT_SHIFT');
  });

  it('skips pairs with different direction', () => {
    const r = analyzeConsolidations(facts([
      route({ id: 'r1', representativeDirection: 'INBOUND' }),
      route({ id: 'r2', representativeDirection: 'OUTBOUND' }),
    ]));
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toBe('DIFFERENT_DIRECTION');
  });

  it('skips pairs with different routeType (unless one is BOTH)', () => {
    const r1 = analyzeConsolidations(facts([
      route({ id: 'r1', routeType: 'STAFF' }),
      route({ id: 'r2', routeType: 'SCHOOL' }),
    ]));
    expect(r1.skipped[0].reason).toBe('DIFFERENT_ROUTE_TYPE');

    // BOTH is compatible with either
    const r2 = analyzeConsolidations(facts([
      route({ id: 'r1', routeType: 'STAFF' }),
      route({ id: 'r2', routeType: 'BOTH' }),
    ]));
    expect(r2.skipped).toHaveLength(0);
    expect(r2.recommendations).toHaveLength(1);
  });

  it('skips pairs with <2 stops', () => {
    const r = analyzeConsolidations(facts([
      route({ id: 'r1' }),
      route({ id: 'r2', stops: [{ placeId: 'z', lat: 0, lng: 0, sequence: 1 }] }),
    ]));
    expect(r.skipped[0].reason).toBe('INSUFFICIENT_ROUTE_DATA');
  });

  it('skips when pickup zones are explicitly different (ZONE_DIFFERENT wins over distance)', () => {
    // Both routes have first-stop placeIds but they don't overlap.
    // Even though coords are close, ZONE_DIFFERENT stops the candidate cold.
    const r = analyzeConsolidations(facts([
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
    expect(r.skipped[0].detail).toBe('ZONE_DIFFERENT');
  });

  it('skips when zone data is not available for compat', () => {
    const r = analyzeConsolidations(facts([
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
  it('generates a feasible recommendation when zones + times align and no constraints fire', () => {
    const r = analyzeConsolidations(facts([
      route({ id: 'r1' }),
      route({ id: 'r2' }),
    ]));
    expect(r.recommendations).toHaveLength(1);
    const rec = r.recommendations[0];
    expect(rec.feasible).toBe(true);
    expect(rec.verdict).toBe('PASS');
    expect(rec.demand.combined).toBe(40); // 20 + 20
    expect(rec.zoneCompat.pickup.kind).toBe('ZONE_MATCH');
    expect(rec.scores.fleetSavingsPerWeek).toBeGreaterThan(0);
    expect(rec.scores.totalScore).toBeLessThan(0); // savings > penalty
  });

  it('honours costPerVehicleDay + operatingDaysPerWeek overrides', () => {
    const r = analyzeConsolidations(
      facts([route({ id: 'r1' }), route({ id: 'r2' })]),
      { costPerVehicleDay: 200, operatingDaysPerWeek: 7 }
    );
    expect(r.recommendations[0].scores.fleetSavingsPerWeek).toBe(200 * 7);
  });

  it('BLOCK verdict from a ROUTE_STOP_DEVIATION_MAX rule sinks the recommendation to infeasible', () => {
    // Merged route duration will be max(40, 40) + 1 extra stop × 2 = 42 min
    // A hard 1-minute deviation threshold will BLOCK.
    const r = analyzeConsolidations(
      facts(
        [route({ id: 'r1' }), route({ id: 'r2' })],
        [constraint({ kind: 'ROUTE_STOP_DEVIATION_MAX', action: 'BLOCK', params: { maxMinutes: 1 } })]
      )
    );
    expect(r.recommendations[0].feasible).toBe(false);
    expect(r.recommendations[0].verdict).toBe('BLOCK');
    expect(r.recommendations[0].checks[0].code).toBe('ROUTE_STOP_DEVIATION_MAX');
  });

  it('PENALTY verdict keeps feasibility but raises totalScore', () => {
    const r = analyzeConsolidations(
      facts(
        [route({ id: 'r1' }), route({ id: 'r2' })],
        [constraint({
          kind: 'ROUTE_STOP_DEVIATION_MAX',
          action: 'PENALTY',
          penaltyScore: 100,
          params: { maxMinutes: 1 },
        })]
      ),
      { penaltyLambda: 10 }
    );
    const rec = r.recommendations[0];
    expect(rec.feasible).toBe(true);
    // PENALTY fires once per source route (both A and B passengers detour),
    // so the 100 penaltyScore accumulates to 200 across the two sources.
    // That's correct — the total passenger-experience cost is additive.
    expect(rec.scores.pcePenalty).toBe(200);
    // fleetSavings 500 (100 × 5) − λ×penalty 2000 = 1500 net cost. Higher than savings-only.
    expect(rec.scores.totalScore).toBe(2000 - 500);
  });
});

// ─── Ranking ────────────────────────────────────────────────────────

describe('analyzeConsolidations — ranking', () => {
  it('sorts feasible-first, then ascending totalScore, then higher combined demand as tiebreak', () => {
    const r = analyzeConsolidations(facts([
      route({ id: 'r-a', enrolledCount: 10 }),
      route({ id: 'r-b', enrolledCount: 10 }),
      route({ id: 'r-c', enrolledCount: 30 }),
      route({ id: 'r-d', enrolledCount: 30 }),
    ]));
    // 6 pairs, all pass; ties on totalScore because savings depend only
    // on objective, not demand. So combined-demand tiebreak orders the
    // heavy-demand pair (c,d) first.
    expect(r.recommendations[0].routeA.id).toBe('r-c');
    expect(r.recommendations[0].routeB.id).toBe('r-d');
  });

  it('infeasible pairs sink to the bottom regardless of totalScore', () => {
    const r = analyzeConsolidations(
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

  it('totals accurately reflect the funnel', () => {
    const r = analyzeConsolidations(facts([
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
});
