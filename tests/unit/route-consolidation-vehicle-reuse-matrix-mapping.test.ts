/**
 * tests/unit/route-consolidation-vehicle-reuse-matrix-mapping.test.ts
 *
 * Verifies a non-zero DROPOFF_TO_PICKUP matrix result correctly flows
 * through analyzeVehicleReuseOpportunities() into repositionDistanceMeters
 * / repositionDurationMinutes and the resulting slack calculation. Kept
 * in its own file (rather than alongside route-consolidation-vehicle-
 * reuse.test.ts) because vi.mock is hoisted file-wide and would otherwise
 * silently override the real same-point matrix shortcut those other
 * tests rely on.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ConsolidationFacts, RouteFacts } from '@/lib/planning/route-consolidation-facts';
import { analyzeVehicleReuseOpportunities } from '@/lib/planning/route-consolidation-vehicle-reuse';

vi.mock('@/lib/planning/route-consolidation-matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/planning/route-consolidation-matrix')>();
  return {
    ...actual,
    resolveMatrixPairings: vi.fn().mockImplementation(async (_prisma: unknown, _tenantId: string, pairings: Array<{ type: string; routeIdA: string; routeIdB: string }>) => {
      const results = new Map();
      for (const p of pairings) {
        results.set(actual.pairingKey(p.type as never, p.routeIdA, p.routeIdB), { distanceKm: 4.2, durationMin: 14 });
      }
      return results;
    }),
  };
});

const fakePrisma = {} as PrismaClient;

function route(opts: {
  id: string;
  name: string;
  arrivalTime: string;
  departureTime: string;
  pickup?: { lat: number; lng: number };
  dropoff?: { lat: number; lng: number };
}): RouteFacts {
  const pickup = opts.pickup ?? { lat: 25.10, lng: 55.20 };
  const dropoff = opts.dropoff ?? { lat: 25.20, lng: 55.30 };
  return {
    id: opts.id,
    name: opts.name,
    routeType: 'STAFF',
    requiredVehicleGroup: null,
    totalDistanceKm: null,
    estimatedDurationMins: null,
    capacity: 30,
    stops: [
      { placeId: null, lat: pickup.lat, lng: pickup.lng, sequence: 1 },
      { placeId: null, lat: dropoff.lat, lng: dropoff.lng, sequence: 2 },
    ],
    enrolledCount: 0,
    representativeShift: null,
    representativeDirection: null,
    representativeDepartureTime: opts.departureTime,
    representativeArrivalTime: opts.arrivalTime,
    assignedVehicleId: null,
    assignedDriverId: null,
  };
}

function facts(routes: RouteFacts[]): ConsolidationFacts {
  return { routes, constraints: [], tenantTimezone: 'Asia/Dubai' };
}

describe('analyzeVehicleReuseOpportunities — matrix result mapping', () => {
  it('maps a non-zero matrix result into repositionDistanceMeters/repositionDurationMinutes and the resulting slack', async () => {
    const a = route({ id: 'a', name: 'Route A', arrivalTime: '08:00', departureTime: '07:00', dropoff: { lat: 25.0, lng: 55.0 } });
    const b = route({ id: 'b', name: 'Route B', arrivalTime: '10:00', departureTime: '08:45', pickup: { lat: 25.01, lng: 55.01 } }); // within fallback km, distinct point
    const result = await analyzeVehicleReuseOpportunities(fakePrisma, 't1', facts([a, b]), {
      minimumTurnaroundMinutes: 20,
      maxReuseWindowMinutes: 180,
    });
    expect(result.opportunities).toHaveLength(1);
    const opp = result.opportunities[0];
    expect(opp.repositionDistanceMeters).toBe(4200);
    expect(opp.repositionDurationMinutes).toBe(14);
    expect(opp.availableGapMinutes).toBe(45);
    expect(opp.requiredGapMinutes).toBe(34); // 20 turnaround + 14 reposition
    expect(opp.remainingSlackMinutes).toBe(11);
    expect(opp.feasibility).toBe('FEASIBLE');
  });
});
