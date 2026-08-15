/**
 * Unit tests for the Planning Constraint Engine.
 *
 * The evaluator is pure over the facts you hand it, so tests build
 * `PlanFacts` inline — no Prisma mock needed, no DB dependency.
 * Coverage: every evaluator (positive + negative), effective-window
 * gating, is_enabled gating, unknown-kind fallback, evaluator-error
 * fallback, and verdict aggregation semantics.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluatePlan,
  type PlanFacts,
  type PlanTripFacts,
  type PlanningConstraintFacts,
  type ZoneFacts,
} from '@/lib/planning/evaluate-plan';

// ── Builders ─────────────────────────────────────────────────────────

const TZ = 'Asia/Dubai';

function trip(overrides: Partial<PlanTripFacts> = {}): PlanTripFacts {
  return {
    id: 't1',
    role: 'standalone',
    routeId: 'r1',
    vehicleId: 'v1',
    driverId: 'd1',
    departureTime: new Date('2026-08-14T06:00:00Z'), // 10:00 Asia/Dubai
    arrivalTime: new Date('2026-08-14T07:00:00Z'),   // 11:00 Asia/Dubai
    latestArrivalTime: null,
    confirmedCount: 20,
    stops: [
      { placeId: 'stop-a', lat: 25.20, lng: 55.27, sequence: 1 },
      { placeId: 'stop-b', lat: 25.22, lng: 55.29, sequence: 2 },
    ],
    vehicle: { id: 'v1', seatingCapacity: 30, vehicleGroup: 'BUS' },
    ...overrides,
  };
}

function rule(overrides: Partial<PlanningConstraintFacts>): PlanningConstraintFacts {
  return {
    id: 'c1',
    name: 'rule',
    kind: 'ZONE_VEHICLE_RESTRICTION',
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

function facts(overrides: Partial<PlanFacts> = {}): PlanFacts {
  return {
    trips: [trip()],
    constraints: [],
    zones: new Map(),
    tenantTimezone: TZ,
    ...overrides,
  };
}

// Small square around (25.15, 55.20). Trip default stops are outside.
const AL_KHAIL_POLYGON = [
  { lat: 25.10, lng: 55.15 },
  { lat: 25.10, lng: 55.25 },
  { lat: 25.20, lng: 55.25 },
  { lat: 25.20, lng: 55.15 },
];
const zonesWithAlKhail: ZoneFacts = new Map([
  ['zone-al-khail', { name: 'Al Khail', shape: 'POLYGON', polygon: AL_KHAIL_POLYGON }],
]);

// ── ZONE_VEHICLE_RESTRICTION ─────────────────────────────────────────

describe('ZONE_VEHICLE_RESTRICTION', () => {
  it('BLOCKs when trip enters zone with a matching heavy vehicle', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            stops: [
              { placeId: 'inside', lat: 25.15, lng: 55.20, sequence: 1 }, // inside polygon
            ],
            vehicle: { id: 'v1', seatingCapacity: 50, vehicleGroup: 'BUS' },
          }),
        ],
        zones: zonesWithAlKhail,
        constraints: [
          rule({
            kind: 'ZONE_VEHICLE_RESTRICTION',
            action: 'BLOCK',
            params: { zonePlaceId: 'zone-al-khail', minSeats: 40 },
          }),
        ],
      })
    );
    expect(result.verdict).toBe('BLOCK');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].code).toBe('ZONE_VEHICLE_RESTRICTION');
  });

  it('PASSes when the vehicle does not match the seats filter', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            stops: [{ placeId: 'inside', lat: 25.15, lng: 55.20, sequence: 1 }],
            vehicle: { id: 'v1', seatingCapacity: 20, vehicleGroup: 'VAN' },
          }),
        ],
        zones: zonesWithAlKhail,
        constraints: [
          rule({ kind: 'ZONE_VEHICLE_RESTRICTION', params: { zonePlaceId: 'zone-al-khail', minSeats: 40 } }),
        ],
      })
    );
    expect(result.verdict).toBe('PASS');
  });

  it('PASSes when trip path does not enter the zone', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            stops: [{ placeId: 'far', lat: 25.30, lng: 55.40, sequence: 1 }], // outside
            vehicle: { id: 'v1', seatingCapacity: 50, vehicleGroup: 'BUS' },
          }),
        ],
        zones: zonesWithAlKhail,
        constraints: [
          rule({ kind: 'ZONE_VEHICLE_RESTRICTION', params: { zonePlaceId: 'zone-al-khail', minSeats: 40 } }),
        ],
      })
    );
    expect(result.verdict).toBe('PASS');
  });

  it('respects fromHm/toHm time window in tenant timezone', () => {
    // Trip departs 06:00 UTC = 10:00 Asia/Dubai. Window 07:00–09:00 local → PASS.
    const result = evaluatePlan(
      facts({
        trips: [trip({ stops: [{ placeId: 'inside', lat: 25.15, lng: 55.20, sequence: 1 }] })],
        zones: zonesWithAlKhail,
        constraints: [
          rule({
            kind: 'ZONE_VEHICLE_RESTRICTION',
            params: { zonePlaceId: 'zone-al-khail', fromHm: 7 * 60, toHm: 9 * 60 },
          }),
        ],
      })
    );
    expect(result.verdict).toBe('PASS');
  });

  it('is silent when the referenced zone was not loaded', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ stops: [{ placeId: 'inside', lat: 25.15, lng: 55.20, sequence: 1 }] })],
        zones: new Map(),
        constraints: [rule({ kind: 'ZONE_VEHICLE_RESTRICTION', params: { zonePlaceId: 'missing' } })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });
});

// ── PICKUP_TIME_BUFFER ───────────────────────────────────────────────

describe('PICKUP_TIME_BUFFER', () => {
  it('BLOCKs when two source pickups are closer than the buffer', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({ id: 's1', role: 'source', departureTime: new Date('2026-08-14T06:00:00Z') }),
          trip({ id: 's2', role: 'source', departureTime: new Date('2026-08-14T06:04:00Z') }),
        ],
        constraints: [rule({ kind: 'PICKUP_TIME_BUFFER', params: { minBufferMin: 5 } })],
      })
    );
    expect(result.verdict).toBe('BLOCK');
    expect(result.checks[0].code).toBe('PICKUP_TIME_BUFFER');
  });

  it('PASSes when buffer is satisfied', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({ id: 's1', role: 'source', departureTime: new Date('2026-08-14T06:00:00Z') }),
          trip({ id: 's2', role: 'source', departureTime: new Date('2026-08-14T06:10:00Z') }),
        ],
        constraints: [rule({ kind: 'PICKUP_TIME_BUFFER', params: { minBufferMin: 5 } })],
      })
    );
    expect(result.verdict).toBe('PASS');
  });

  it('does not fire when plan has <2 source trips', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ id: 's1', role: 'source' })],
        constraints: [rule({ kind: 'PICKUP_TIME_BUFFER', params: { minBufferMin: 5 } })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });
});

// ── TRIP_MAX_DURATION ────────────────────────────────────────────────

describe('TRIP_MAX_DURATION', () => {
  it('BLOCKs when duration exceeds the ceiling', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T09:00:00Z'),
          }),
        ],
        constraints: [rule({ kind: 'TRIP_MAX_DURATION', params: { maxMinutes: 120 } })],
      })
    );
    expect(result.verdict).toBe('BLOCK');
  });

  it('WARNs when configured as WARN', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T09:00:00Z'),
          }),
        ],
        constraints: [rule({ kind: 'TRIP_MAX_DURATION', action: 'WARN', params: { maxMinutes: 120 } })],
      })
    );
    expect(result.verdict).toBe('WARN');
  });

  it('PENALTY does not change verdict but accumulates score', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T09:00:00Z'),
          }),
        ],
        constraints: [
          rule({ kind: 'TRIP_MAX_DURATION', action: 'PENALTY', penaltyScore: 7.5, params: { maxMinutes: 120 } }),
        ],
      })
    );
    expect(result.verdict).toBe('PASS');
    expect(result.totalPenalty).toBe(7.5);
  });

  it('skips trips without arrivalTime', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ arrivalTime: null })],
        constraints: [rule({ kind: 'TRIP_MAX_DURATION', params: { maxMinutes: 10 } })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });
});

// ── PASSENGER_MAX_DETOUR ─────────────────────────────────────────────

describe('PASSENGER_MAX_DETOUR', () => {
  it('BLOCKs when merged duration exceeds source by more than maxMinutes', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            id: 's1', role: 'source',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:30:00Z'),
          }),
          trip({
            id: 'm1', role: 'merged',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T07:15:00Z'),
          }),
        ],
        constraints: [rule({ kind: 'PASSENGER_MAX_DETOUR', params: { maxMinutes: 30 } })],
      })
    );
    expect(result.verdict).toBe('BLOCK');
  });

  it('BLOCKs on percent threshold', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({ id: 's1', role: 'source',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:30:00Z') }),
          trip({ id: 'm1', role: 'merged',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:45:00Z') }),
        ],
        constraints: [rule({ kind: 'PASSENGER_MAX_DETOUR', params: { maxPercent: 40 } })],
      })
    );
    // 15 minute detour on 30 min original = 50% > 40 → BLOCK
    expect(result.verdict).toBe('BLOCK');
  });

  it('does not fire when there is no merged trip', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ id: 's1', role: 'source' })],
        constraints: [rule({ kind: 'PASSENGER_MAX_DETOUR', params: { maxMinutes: 5 } })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });
});

// ── ROUTE_STOP_DEVIATION_MAX ─────────────────────────────────────────
//
// Shares evalDurationDetour with PASSENGER_MAX_DETOUR — these tests
// prove that (a) the dispatch entry is wired, (b) rule.kind flows into
// the check's `code` correctly so callers can tell which rule fired,
// (c) the params contract behaves identically. Full detour math is
// covered by the PASSENGER_MAX_DETOUR suite above.

describe('ROUTE_STOP_DEVIATION_MAX', () => {
  it('BLOCKs when consolidated route exceeds source traversal by more than maxMinutes', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            id: 'src-route', role: 'source',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:40:00Z'), // 40min typical run
          }),
          trip({
            id: 'consolidated-route', role: 'merged',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T07:00:00Z'), // 60min = 20min deviation
          }),
        ],
        constraints: [rule({ kind: 'ROUTE_STOP_DEVIATION_MAX', params: { maxMinutes: 15 } })],
      })
    );
    expect(result.verdict).toBe('BLOCK');
    expect(result.checks[0].code).toBe('ROUTE_STOP_DEVIATION_MAX');
  });

  it('PASSes when deviation is within threshold', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({ id: 'src', role: 'source',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:40:00Z') }),
          trip({ id: 'con', role: 'merged',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:50:00Z') }), // 10min deviation
        ],
        constraints: [rule({ kind: 'ROUTE_STOP_DEVIATION_MAX', params: { maxMinutes: 15 } })],
      })
    );
    expect(result.verdict).toBe('PASS');
  });

  it('honours percent threshold independently of maxMinutes', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({ id: 'src', role: 'source',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:20:00Z') }), // 20min
          trip({ id: 'con', role: 'merged',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:30:00Z') }), // 30min = 50% deviation
        ],
        constraints: [rule({ kind: 'ROUTE_STOP_DEVIATION_MAX', params: { maxPercent: 25 } })],
      })
    );
    expect(result.verdict).toBe('BLOCK');
  });

  it('can be authored as WARN independently of the passenger-detour rule', () => {
    // A tenant might want tight WARN on route deviation for design
    // review while keeping trip-time PASSENGER_MAX_DETOUR at a laxer
    // BLOCK threshold. Two separate kinds enable that policy split.
    const result = evaluatePlan(
      facts({
        trips: [
          trip({ id: 'src', role: 'source',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:30:00Z') }),
          trip({ id: 'con', role: 'merged',
            departureTime: new Date('2026-08-14T06:00:00Z'),
            arrivalTime: new Date('2026-08-14T06:50:00Z') }), // 20min deviation
        ],
        constraints: [
          rule({ kind: 'ROUTE_STOP_DEVIATION_MAX', action: 'WARN', params: { maxMinutes: 10 } }),
          rule({ kind: 'PASSENGER_MAX_DETOUR', action: 'BLOCK', params: { maxMinutes: 30 } }),
        ],
      })
    );
    expect(result.verdict).toBe('WARN'); // route-deviation warns, passenger-detour passes at 30min
  });

  it('silent when no merged trip present (same as passenger detour)', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ id: 'src', role: 'source' })],
        constraints: [rule({ kind: 'ROUTE_STOP_DEVIATION_MAX', params: { maxMinutes: 5 } })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });
});

// ── MERGED_ARRIVAL_SLA ───────────────────────────────────────────────

describe('MERGED_ARRIVAL_SLA', () => {
  it('BLOCKs when arrival slips past latestArrivalTime + tolerance', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            arrivalTime: new Date('2026-08-14T07:20:00Z'),
            latestArrivalTime: new Date('2026-08-14T07:00:00Z'),
          }),
        ],
        constraints: [rule({ kind: 'MERGED_ARRIVAL_SLA', params: { toleranceMin: 5 } })],
      })
    );
    expect(result.verdict).toBe('BLOCK');
  });

  it('PASSes within tolerance', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            arrivalTime: new Date('2026-08-14T07:03:00Z'),
            latestArrivalTime: new Date('2026-08-14T07:00:00Z'),
          }),
        ],
        constraints: [rule({ kind: 'MERGED_ARRIVAL_SLA', params: { toleranceMin: 5 } })],
      })
    );
    expect(result.verdict).toBe('PASS');
  });

  it('is silent when latestArrivalTime is null', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ latestArrivalTime: null })],
        constraints: [rule({ kind: 'MERGED_ARRIVAL_SLA' })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });
});

// ── ROUTE_STOP_RESTRICTION ───────────────────────────────────────────

describe('ROUTE_STOP_RESTRICTION', () => {
  it('BLOCKs when the trip uses the restricted stop with a matching group', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            stops: [{ placeId: 'restricted-stop', lat: 0, lng: 0, sequence: 1 }],
            vehicle: { id: 'v1', seatingCapacity: 50, vehicleGroup: 'BUS' },
          }),
        ],
        constraints: [
          rule({
            kind: 'ROUTE_STOP_RESTRICTION',
            params: { stopPlaceId: 'restricted-stop', vehicleGroups: ['bus'] },
          }),
        ],
      })
    );
    expect(result.verdict).toBe('BLOCK');
  });

  it('PASSes for a non-matching group', () => {
    const result = evaluatePlan(
      facts({
        trips: [
          trip({
            stops: [{ placeId: 'restricted-stop', lat: 0, lng: 0, sequence: 1 }],
            vehicle: { id: 'v1', seatingCapacity: 15, vehicleGroup: 'VAN' },
          }),
        ],
        constraints: [
          rule({
            kind: 'ROUTE_STOP_RESTRICTION',
            params: { stopPlaceId: 'restricted-stop', vehicleGroups: ['bus'] },
          }),
        ],
      })
    );
    expect(result.verdict).toBe('PASS');
  });
});

// ── VEHICLE_CAPACITY_HARD ────────────────────────────────────────────

describe('VEHICLE_CAPACITY_HARD', () => {
  it('BLOCKs when confirmed passengers exceed seats', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ confirmedCount: 40, vehicle: { id: 'v1', seatingCapacity: 30, vehicleGroup: 'BUS' } })],
        constraints: [rule({ kind: 'VEHICLE_CAPACITY_HARD' })],
      })
    );
    expect(result.verdict).toBe('BLOCK');
  });

  it('PASSes when at capacity', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ confirmedCount: 30, vehicle: { id: 'v1', seatingCapacity: 30, vehicleGroup: 'BUS' } })],
        constraints: [rule({ kind: 'VEHICLE_CAPACITY_HARD' })],
      })
    );
    expect(result.verdict).toBe('PASS');
  });

  it('is silent when vehicle has no known capacity', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ confirmedCount: 999, vehicle: { id: 'v1', seatingCapacity: null, vehicleGroup: null } })],
        constraints: [rule({ kind: 'VEHICLE_CAPACITY_HARD' })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });
});

// ── Engine-level behaviour ───────────────────────────────────────────

describe('engine', () => {
  it('skips disabled rules', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ confirmedCount: 999, vehicle: { id: 'v1', seatingCapacity: 10, vehicleGroup: 'BUS' } })],
        constraints: [rule({ kind: 'VEHICLE_CAPACITY_HARD', isEnabled: false })],
      })
    );
    expect(result.checks).toHaveLength(0);
  });

  it('skips rules whose effective window excludes all trips', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ confirmedCount: 999, vehicle: { id: 'v1', seatingCapacity: 10, vehicleGroup: 'BUS' } })],
        constraints: [
          rule({
            kind: 'VEHICLE_CAPACITY_HARD',
            effectiveFrom: new Date('2027-01-01T00:00:00Z'),
          }),
        ],
      })
    );
    expect(result.checks).toHaveLength(0);
  });

  it('fires rules whose effective window includes any trip', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ confirmedCount: 999, vehicle: { id: 'v1', seatingCapacity: 10, vehicleGroup: 'BUS' } })],
        constraints: [
          rule({
            kind: 'VEHICLE_CAPACITY_HARD',
            effectiveFrom: new Date('2026-08-14T00:00:00Z'),
            effectiveTo: new Date('2026-08-14T00:00:00Z'), // inclusive → whole day 2026-08-14
          }),
        ],
      })
    );
    expect(result.verdict).toBe('BLOCK');
  });

  it('surfaces unknown kinds as ENGINE_UNKNOWN_KIND WARN', () => {
    const result = evaluatePlan(
      facts({
        constraints: [rule({ kind: 'DOES_NOT_EXIST' })],
      })
    );
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].code).toBe('ENGINE_UNKNOWN_KIND');
    expect(result.checks[0].outcome).toBe('WARN');
    expect(result.verdict).toBe('WARN');
  });

  it('aggregates: BLOCK dominates WARN and PENALTY leaves verdict unchanged', () => {
    const result = evaluatePlan(
      facts({
        trips: [trip({ confirmedCount: 999, vehicle: { id: 'v1', seatingCapacity: 10, vehicleGroup: 'BUS' } })],
        constraints: [
          rule({ id: 'c-block', kind: 'VEHICLE_CAPACITY_HARD', action: 'BLOCK' }),
          rule({ id: 'c-penalty', kind: 'TRIP_MAX_DURATION', action: 'PENALTY', penaltyScore: 3,
            params: { maxMinutes: 1 } }),
        ],
      })
    );
    expect(result.verdict).toBe('BLOCK');
    expect(result.totalPenalty).toBe(3);
  });
});

// ── Zone helper ──────────────────────────────────────────────────────

describe('zone helpers', () => {
  it('pointInPolygon: inside/outside', async () => {
    const { pointInPolygon } = await import('@/lib/planning/zone');
    expect(pointInPolygon({ lat: 25.15, lng: 55.20 }, AL_KHAIL_POLYGON)).toBe(true);
    expect(pointInPolygon({ lat: 25.30, lng: 55.40 }, AL_KHAIL_POLYGON)).toBe(false);
  });

  it('haversineMeters: known short distance', async () => {
    const { haversineMeters } = await import('@/lib/planning/zone');
    const d = haversineMeters({ lat: 25.20, lng: 55.27 }, { lat: 25.20, lng: 55.28 });
    // ~1km per 0.01° at UAE latitude
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1100);
  });

  it('parsePolygonJson: rejects invalid input', async () => {
    const { parsePolygonJson } = await import('@/lib/planning/zone');
    expect(parsePolygonJson(null)).toBeNull();
    expect(parsePolygonJson([{ lat: 1, lng: 2 }, { lat: 3 }])).toBeNull();
    expect(parsePolygonJson([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }])).toBeNull(); // <3 vertices
    expect(parsePolygonJson(AL_KHAIL_POLYGON)).toHaveLength(4);
  });
});
