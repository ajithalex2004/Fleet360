/**
 * Facts loader for the Route Consolidation Engine.
 *
 * Loads the tenant's active BusRoutes with the fields consolidation
 * scoring needs: stops (ordered, with placeId + coords), enrolment
 * demand, a representative schedule for shift/direction inference,
 * and the tenant's active PlanningConstraint rows so the engine can
 * evaluate candidate consolidations through PCE.
 *
 * Kept separate from the engine so tests can synthesise facts inline
 * without a DB, and future callers (nightly analysis job, comparison
 * tools) can amortise the shared load.
 */

import type { PrismaClient } from '@prisma/client';
import type { PlanningConstraintFacts } from './evaluate-plan';

// ─── Public fact shapes ──────────────────────────────────────────────

/** Route as consumed by the consolidation engine. */
export type RouteFacts = {
  id: string;
  name: string;
  routeType: string | null;                // STAFF | SCHOOL | BOTH
  requiredVehicleGroup: string | null;
  totalDistanceKm: number | null;
  estimatedDurationMins: number | null;
  capacity: number | null;
  /** Ordered stops. Not every stop has coords or a placeId — engine tolerates both. */
  stops: Array<{
    placeId: string | null;
    lat: number | null;
    lng: number | null;
    sequence: number;
  }>;
  /** Number of ACTIVE enrolments — proxy for demand. */
  enrolledCount: number;
  /**
   * Representative schedule shape. Primarily the route's own declared
   * departureTime/expectedArrivalTime/shiftType/direction (BusRoute is the
   * source of truth for the intended schedule); falls back to the most
   * recent non-cancelled TripSchedule only when the route itself has no
   * value set (e.g. legacy routes created before those columns existed).
   * null if neither source has a value. Used only for compat filters
   * (shift, direction, departure-time proximity) — the engine doesn't
   * need per-trip data.
   */
  representativeShift: string | null;      // MORNING | EVENING | NIGHT | SPLIT
  representativeDirection: string | null;  // INBOUND | OUTBOUND
  representativeDepartureTime: string | null;  // HH:MM 24h format
  representativeArrivalTime: string | null;    // HH:MM 24h format (for turnaround calc)
  /** Current default vehicle/driver on the route (BusRoute.assignedVehicleId/assignedDriverId) — used by the Case 2 vehicle-reuse analysis to flag when two routes are already on different vehicles/drivers. Not enforced as FK (see BusRoute schema comment); read-only here. */
  assignedVehicleId: string | null;
  assignedDriverId: string | null;
};

export type ConsolidationFacts = {
  routes: RouteFacts[];
  constraints: PlanningConstraintFacts[];
  tenantTimezone: string;
};

export type LoadFactsInput = {
  tenantId: string;
  tenantTimezone?: string;
  /** Optional subset — defaults to all active non-deleted routes. */
  routeIds?: string[];
};

// ─── Loader ──────────────────────────────────────────────────────────

export async function loadConsolidationFacts(
  prisma: PrismaClient,
  input: LoadFactsInput
): Promise<ConsolidationFacts> {
  const [routes, enrolmentRows, scheduleRows, constraintRows] = await Promise.all([
    prisma.busRoute.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        isActive: true,
        ...(input.routeIds ? { id: { in: input.routeIds } } : {}),
      },
      select: {
        id: true, name: true, routeType: true, requiredVehicleGroup: true,
        totalDistanceKm: true, estimatedDurationMins: true, capacity: true,
        departureTime: true, expectedArrivalTime: true, shiftType: true, direction: true,
        assignedVehicleId: true, assignedDriverId: true,
        stops: {
          select: { placeId: true, gpsLat: true, gpsLng: true, sequence: true },
          orderBy: { sequence: 'asc' },
        },
      },
    }),
    prisma.routePassenger.groupBy({
      by: ['routeId'],
      where: { tenantId: input.tenantId, deletedAt: null, status: 'ACTIVE' },
      _count: { _all: true },
    }),
    // Most recent non-cancelled schedule per route — used to infer shift + direction + times.
    // `distinct` on routeId with a descending departure order gives us the
    // freshest single row per route without loading the full schedule set.
    prisma.tripSchedule.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        ...(input.routeIds ? { routeId: { in: input.routeIds } } : {}),
      },
      select: { routeId: true, shiftType: true, direction: true, departureTime: true, arrivalTime: true },
      orderBy: { departureTime: 'desc' },
      distinct: ['routeId'],
    }),
    prisma.planningConstraint.findMany({
      where: { tenantId: input.tenantId, deletedAt: null, isEnabled: true },
    }),
  ]);

  const enrolmentByRoute = new Map(enrolmentRows.map((r) => [r.routeId, r._count._all]));
  const scheduleByRoute = new Map(scheduleRows.map((r) => [r.routeId, r]));

  const formatTime = (date: Date | null): string | null => {
    if (!date) return null;
    const h = date.getHours();
    const m = date.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const routeFacts: RouteFacts[] = routes.map((r) => {
    const rep = scheduleByRoute.get(r.id);
    return {
      id: r.id,
      name: r.name,
      routeType: r.routeType,
      requiredVehicleGroup: r.requiredVehicleGroup,
      totalDistanceKm: r.totalDistanceKm,
      estimatedDurationMins: r.estimatedDurationMins,
      capacity: r.capacity,
      stops: r.stops.map((s) => ({
        placeId: s.placeId,
        lat: s.gpsLat,
        lng: s.gpsLng,
        sequence: s.sequence,
      })),
      enrolledCount: enrolmentByRoute.get(r.id) ?? 0,
      representativeShift: r.shiftType ?? rep?.shiftType ?? null,
      representativeDirection: r.direction ?? rep?.direction ?? null,
      representativeDepartureTime: r.departureTime ?? formatTime(rep?.departureTime ?? null),
      representativeArrivalTime: r.expectedArrivalTime ?? formatTime(rep?.arrivalTime ?? null),
      assignedVehicleId: r.assignedVehicleId,
      assignedDriverId: r.assignedDriverId,
    };
  });

  const constraints: PlanningConstraintFacts[] = constraintRows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    action: (r.action === 'WARN' || r.action === 'PENALTY' ? r.action : 'BLOCK') as
      | 'BLOCK'
      | 'WARN'
      | 'PENALTY',
    penaltyScore: r.penaltyScore ? Number(r.penaltyScore) : null,
    params: (r.params ?? {}) as Record<string, unknown>,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    reason: r.reason,
    isEnabled: r.isEnabled,
  }));

  return {
    routes: routeFacts,
    constraints,
    tenantTimezone: input.tenantTimezone ?? 'Asia/Dubai',
  };
}

/**
 * Pickup/dropoff-end convention shared by route-consolidation.ts (zone
 * compat, PCE facts synthesis) and route-consolidation-matrix.ts (Stage 2
 * pairing endpoints). Lives here rather than in either of those two
 * modules so importing it doesn't create a circular dependency between
 * them. Simplification: first stop is the pickup-end, last stop is the
 * dropoff-end.
 */
export function routePickupStop(r: RouteFacts) {
  return r.stops[0];
}
export function routeDropoffStop(r: RouteFacts) {
  return r.stops[r.stops.length - 1];
}
