/**
 * tests/unit/route-consolidation-vehicle-reuse.test.ts
 *
 * Unit tests for the Case 2 ("vehicle reuse") advisory engine
 * (lib/planning/route-consolidation-vehicle-reuse.ts): pure gap/slack
 * math, assignment comparison, and the eligibility funnel (which pairs
 * get skipped and why, and which produce an opportunity). No DB or
 * network access — surviving pairs use identical dropoff/pickup
 * coordinates so route-consolidation-matrix.ts's real same-point
 * shortcut resolves locally without touching Prisma or Google.
 *
 * Non-zero matrix-result mapping is covered separately in
 * route-consolidation-vehicle-reuse-matrix-mapping.test.ts, which mocks
 * resolveMatrixPairings — kept in its own file since vi.mock is hoisted
 * file-wide and would otherwise silently override the real same-point
 * shortcut these tests rely on.
 */

import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ConsolidationFacts, RouteFacts } from '@/lib/planning/route-consolidation-facts';
import {
  analyzeVehicleReuseOpportunities,
  classifyReuseFeasibility,
  compareAssignment,
  computeReuseGap,
} from '@/lib/planning/route-consolidation-vehicle-reuse';

const fakePrisma = {} as PrismaClient;

function route(opts: {
  id: string;
  name: string;
  arrivalTime?: string | null;
  departureTime?: string | null;
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  assignedVehicleId?: string | null;
  assignedDriverId?: string | null;
  stopsCount?: number;
}): RouteFacts {
  const pickup = opts.pickup === null ? null : opts.pickup ?? { lat: 25.10, lng: 55.20 };
  const dropoff = opts.dropoff === null ? null : opts.dropoff ?? { lat: 25.20, lng: 55.30 };
  const stopsCount = opts.stopsCount ?? 2;
  const stops = Array.from({ length: stopsCount }, (_, i) => {
    const isFirst = i === 0;
    const isLast = i === stopsCount - 1;
    const point = isFirst ? pickup : isLast ? dropoff : { lat: 25.15, lng: 55.25 };
    return { placeId: null, lat: point?.lat ?? null, lng: point?.lng ?? null, sequence: i + 1 };
  });
  return {
    id: opts.id,
    name: opts.name,
    routeType: 'STAFF',
    requiredVehicleGroup: null,
    totalDistanceKm: null,
    estimatedDurationMins: null,
    capacity: 30,
    stops,
    enrolledCount: 0,
    representativeShift: null,
    representativeDirection: null,
    representativeDepartureTime: opts.departureTime ?? null,
    representativeArrivalTime: opts.arrivalTime ?? null,
    assignedVehicleId: opts.assignedVehicleId ?? null,
    assignedDriverId: opts.assignedDriverId ?? null,
  };
}

function facts(routes: RouteFacts[]): ConsolidationFacts {
  return { routes, constraints: [], tenantTimezone: 'Asia/Dubai' };
}

// ─── Pure math ──────────────────────────────────────────────────────

describe('classifyReuseFeasibility', () => {
  it('buckets by slack thresholds', () => {
    expect(classifyReuseFeasibility(20)).toBe('STRONG');
    expect(classifyReuseFeasibility(25)).toBe('STRONG');
    expect(classifyReuseFeasibility(19)).toBe('FEASIBLE');
    expect(classifyReuseFeasibility(10)).toBe('FEASIBLE');
    expect(classifyReuseFeasibility(9)).toBe('TIGHT');
    expect(classifyReuseFeasibility(0)).toBe('TIGHT');
    expect(classifyReuseFeasibility(-1)).toBe('NOT_FEASIBLE');
    expect(classifyReuseFeasibility(-100)).toBe('NOT_FEASIBLE');
  });
});

describe('computeReuseGap', () => {
  it('computes available/required/slack correctly with ample time', () => {
    const g = computeReuseGap({
      arrivalMinutes: 8 * 60,       // 08:00
      departureMinutes: 9 * 60,     // 09:00
      minimumTurnaroundMinutes: 30,
      repositionDurationMinutes: 10,
    });
    expect(g.availableGapMinutes).toBe(60);
    expect(g.requiredGapMinutes).toBe(40);
    expect(g.remainingSlackMinutes).toBe(20);
    expect(g.feasibility).toBe('STRONG');
  });

  it('produces negative slack (NOT_FEASIBLE) when reposition + turnaround exceed the gap', () => {
    const g = computeReuseGap({
      arrivalMinutes: 9 * 60,
      departureMinutes: 9 * 60 + 25,  // 25 min gap
      minimumTurnaroundMinutes: 30,
      repositionDurationMinutes: 14,
    });
    expect(g.availableGapMinutes).toBe(25);
    expect(g.requiredGapMinutes).toBe(44);
    expect(g.remainingSlackMinutes).toBe(-19);
    expect(g.feasibility).toBe('NOT_FEASIBLE');
  });
});

describe('compareAssignment', () => {
  it('classifies SAME / DIFFERENT / UNASSIGNED', () => {
    expect(compareAssignment('v1', 'v1')).toBe('SAME');
    expect(compareAssignment('v1', 'v2')).toBe('DIFFERENT');
    expect(compareAssignment(null, 'v2')).toBe('UNASSIGNED');
    expect(compareAssignment('v1', null)).toBe('UNASSIGNED');
    expect(compareAssignment(null, null)).toBe('UNASSIGNED');
  });
});

// ─── Eligibility funnel (all skip before the matrix call — no prisma/network touched) ──

describe('analyzeVehicleReuseOpportunities — eligibility funnel', () => {
  it('skips a pair with missing timing data', async () => {
    const a = route({ id: 'a', name: 'A', arrivalTime: null, departureTime: '09:00' });
    const b = route({ id: 'b', name: 'B', arrivalTime: '08:00', departureTime: null });
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 30,
      maxReuseWindowMinutes: 180,
      zoneFallbackKm: 3,
    });
    expect(result.opportunities).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'MISSING_TIMING_DATA')).toBe(true);
  });

  it('skips a non-sequential pair (B departs before A arrives)', async () => {
    const a = route({ id: 'a', name: 'A', arrivalTime: '10:00', departureTime: '07:00' });
    const b = route({ id: 'b', name: 'B', arrivalTime: '11:00', departureTime: '09:00' }); // B departs 09:00, before A arrives 10:00
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 30,
      maxReuseWindowMinutes: 180,
      zoneFallbackKm: 3,
    });
    expect(result.opportunities).toHaveLength(0);
    expect(result.skipped.find((s) => s.firstRouteId === 'a' && s.secondRouteId === 'b')?.reason).toBe('NOT_SEQUENTIAL');
  });

  it('excludes a pair entirely (not NOT_FEASIBLE) when the gap exceeds the max reuse window', async () => {
    const a = route({ id: 'a', name: 'A', arrivalTime: '08:00', departureTime: '07:00' });
    const b = route({ id: 'b', name: 'B', arrivalTime: '17:00', departureTime: '16:00' }); // 8h gap
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 30,
      maxReuseWindowMinutes: 180,
      zoneFallbackKm: 3,
    });
    expect(result.opportunities).toHaveLength(0);
    expect(result.skipped.find((s) => s.firstRouteId === 'a' && s.secondRouteId === 'b')?.reason).toBe('OUTSIDE_REUSE_WINDOW');
  });

  it('skips a zone-incompatible pair (dropoff of A far from pickup of B)', async () => {
    const a = route({ id: 'a', name: 'A', arrivalTime: '08:00', departureTime: '07:00', dropoff: { lat: 25.0, lng: 55.0 } });
    const b = route({ id: 'b', name: 'B', arrivalTime: '10:00', departureTime: '08:30', pickup: { lat: 26.5, lng: 56.5 } }); // far away
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 30,
      maxReuseWindowMinutes: 180,
      zoneFallbackKm: 3,
    });
    expect(result.opportunities).toHaveLength(0);
    expect(result.skipped.find((s) => s.firstRouteId === 'a' && s.secondRouteId === 'b')?.reason).toBe('ZONE_INCOMPATIBLE');
  });

  it('treats A->B and B->A as separate ordered candidates', async () => {
    // A arrives 08:00, B departs 08:30 (A->B sequential); B arrives 17:00, A departs 07:00 (B->A not sequential)
    const a = route({ id: 'a', name: 'A', arrivalTime: '08:00', departureTime: '07:00' }); // default dropoff (25.20, 55.30)
    const b = route({ id: 'b', name: 'B', arrivalTime: '17:00', departureTime: '08:30', pickup: { lat: 25.20, lng: 55.30 } }); // matches A's dropoff
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 10,
      maxReuseWindowMinutes: 180,
      zoneFallbackKm: 3,
    });
    expect(result.totals.orderedPairsConsidered).toBe(2); // (a,b) and (b,a)
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].firstRouteId).toBe('a');
    expect(result.opportunities[0].secondRouteId).toBe('b');
    expect(result.skipped.find((s) => s.firstRouteId === 'b' && s.secondRouteId === 'a')?.reason).toBe('NOT_SEQUENTIAL');
  });
});

// ─── Feasible opportunity — real same-point matrix shortcut, no mocking ──

describe('analyzeVehicleReuseOpportunities — feasible opportunity, zero reposition', () => {
  it('produces a FEASIBLE opportunity when dropoff/pickup coincide (matrix same-point shortcut)', async () => {
    const samePoint = { lat: 25.10, lng: 55.20 };
    const a = route({ id: 'a', name: 'Route A', arrivalTime: '08:00', departureTime: '07:00', dropoff: samePoint });
    const b = route({ id: 'b', name: 'Route B', arrivalTime: '10:00', departureTime: '08:40', pickup: samePoint });
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 30,
      maxReuseWindowMinutes: 180,
      zoneFallbackKm: 3,
    });
    expect(result.opportunities).toHaveLength(1);
    const opp = result.opportunities[0];
    expect(opp.availableGapMinutes).toBe(40);
    expect(opp.repositionDistanceMeters).toBe(0);
    expect(opp.repositionDurationMinutes).toBe(0);
    expect(opp.requiredGapMinutes).toBe(30);
    expect(opp.remainingSlackMinutes).toBe(10);
    expect(opp.feasibility).toBe('FEASIBLE');
    expect(opp.dropoffPickupZoneCompatibility.kind).toBe('WITHIN_FALLBACK');
  });

  it('flags differing vehicle/driver assignments with warnings', async () => {
    const samePoint = { lat: 25.10, lng: 55.20 };
    const a = route({ id: 'a', name: 'Route A', arrivalTime: '08:00', departureTime: '07:00', dropoff: samePoint, assignedVehicleId: 'veh-1', assignedDriverId: 'drv-1' });
    const b = route({ id: 'b', name: 'Route B', arrivalTime: '10:00', departureTime: '08:40', pickup: samePoint, assignedVehicleId: 'veh-2', assignedDriverId: 'drv-1' });
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 30,
      maxReuseWindowMinutes: 180,
      zoneFallbackKm: 3,
    });
    const opp = result.opportunities[0];
    expect(opp.vehicleAssignmentStatus).toBe('DIFFERENT');
    expect(opp.driverAssignmentStatus).toBe('SAME');
    expect(opp.warnings).toContain('Vehicle assignments differ — manual scheduling review required.');
    expect(opp.warnings).not.toContain('Driver assignments differ — manual scheduling review required.');
  });
});
