/**
 * Route Consolidation Engine — Phase 1 (analytical, read-only).
 *
 * Answers the customer's network-design question:
 *   "Which pairs of active routes should be consolidated into one?"
 *
 * Not to be confused with the Staff Transport merge consumer
 * (`src/lib/bus-ops/merge-trips.ts`), which operates on scheduled
 * trip rows for a given date. This engine operates on the ROUTE
 * network itself and produces recommendations the operator reviews —
 * nothing is mutated. Applying a recommendation is Phase 2.
 *
 * Algorithm (Phase 1, deliberately simple):
 *
 *   1. Pairwise O(N²) candidate generation over the tenant's active
 *      routes. Each pair passes through cheap filters first (shared
 *      shift, shared direction, pickup zone compat, dropoff zone
 *      compat, passenger-group compat) before a PCE evaluation. This
 *      is fine for the typical N ≤ 50; k-way clustering + heuristic
 *      search is a Phase-N upgrade.
 *
 *   2. Each surviving candidate gets scored: fleet-savings estimate
 *      minus (λ × PCE penalty). Lower total = better (matches the
 *      ranking optimizer's sign convention).
 *
 *   3. Ranked ascending. Infeasible candidates (PCE verdict BLOCK)
 *      sink to the bottom regardless of score — same convention as
 *      the ranking optimizer, same reason: operators can't apply
 *      what PCE won't accept.
 *
 * Pluggable via PlanningConstraint rows (esp. ROUTE_STOP_DEVIATION_MAX,
 * VEHICLE_CAPACITY_HARD, ZONE_VEHICLE_RESTRICTION) — the customer's
 * "acceptable detour", "combined capacity", and "planning constraints"
 * requirements all funnel through the existing PCE evaluator instead
 * of being re-encoded here.
 *
 * TODO: passenger-group segregation is out-of-scope for Phase 1 (no
 * data model exists). This engine currently treats all passengers as
 * compatible. Extension point: `passengerGroupsCompatible()` — layer
 * a segregation-rule check in there when the requirement lands.
 */

import { evaluatePlan, type PlanFacts, type PlanCheck, type PlanTripFacts } from './evaluate-plan';
import type { ConsolidationFacts, RouteFacts } from './route-consolidation-facts';
import {
  zoneCompatibility,
  isCompatPassing,
  DEFAULT_FALLBACK_KM,
  type ZoneCompatResult,
} from './zone-compat';

// ─── Objective ──────────────────────────────────────────────────────

export type ConsolidationObjective = {
  /** Weight on PCE totalPenalty. Default 1. */
  penaltyLambda?: number;
  /**
   * Rough per-day cost of running one vehicle end-to-end. Multiplied by
   * `fleetSavingsVehicles` (currently always 1 — see fleetSavings notes)
   * to produce fleet-savings estimate. Default 100.
   */
  costPerVehicleDay?: number;
  /**
   * Days per week the route operates. Multiplies fleet-savings estimate.
   * Default 5 (weekday-only staff transport).
   */
  operatingDaysPerWeek?: number;
  /** Override the pickup / dropoff fallback thresholds. */
  fallbackKm?: { pickup?: number; dropoff?: number };
  /**
   * Maximum time difference (in minutes) between route departure times
   * for consolidation eligibility. Routes with departure times further
   * apart than this will be skipped. Default: 60 minutes.
   *
   * Resolved by the caller (analyze/route.ts) via
   * resolveEligibilityPolicy() before this object is built — precedence
   * is request override > tenant PlanningConstraint (kind
   * DEPARTURE_TIME_PROXIMITY) > the 60-minute fallback. This field always
   * carries the already-resolved value by the time analyzeConsolidations
   * reads it; the function itself stays DB-free.
   */
  maxDepartureTimeDiffMinutes?: number;
  /**
   * Same as maxDepartureTimeDiffMinutes but comparing routes'
   * representativeArrivalTime instead of departure — catches pairs that
   * leave close together but run very different durations, which the
   * departure check alone wouldn't flag. Resolved the same way (tenant
   * PlanningConstraint kind ARRIVAL_TIME_PROXIMITY, fallback 45 minutes).
   */
  maxArrivalTimeDiffMinutes?: number;
  /**
   * Turnaround time buffer (in minutes) for vehicle reuse analysis.
   * When checking if a vehicle can do a return trip, this is the minimum
   * time required between arrival at destination and next departure.
   * Default: 30 minutes.
   */
  vehicleTurnaroundMinutes?: number;
};

// ─── Result shapes ──────────────────────────────────────────────────

export type CandidateSkipReason =
  | 'DIFFERENT_ROUTE_TYPE'
  | 'DIFFERENT_SHIFT'
  | 'DIFFERENT_DIRECTION'
  | 'DEPARTURE_TIME_TOO_FAR'
  | 'ARRIVAL_TIME_TOO_FAR'
  | 'PICKUP_ZONE_INCOMPATIBLE'
  | 'DROPOFF_ZONE_INCOMPATIBLE'
  | 'ZONE_DATA_UNAVAILABLE'
  | 'INSUFFICIENT_ROUTE_DATA'
  | 'MERGED_EXCEEDS_CAPACITY';

export type SkippedPair = {
  routeIdA: string;
  routeIdB: string;
  reason: CandidateSkipReason;
  detail?: string;
};

export type ConsolidationRecommendation = {
  routeA: { id: string; name: string };
  routeB: { id: string; name: string };
  zoneCompat: {
    pickup: ZoneCompatResult;
    dropoff: ZoneCompatResult;
  };
  timeCompat: {
    shift: string | null;
    direction: string | null;
    departureTimeDiffMinutes: number | null;
  };
  demand: {
    routeAEnrolled: number;
    routeBEnrolled: number;
    combined: number;
  };
  verdict: 'PASS' | 'WARN' | 'BLOCK';
  checks: PlanCheck[];
  scores: {
    /** Estimated per-week cost saved by removing one operating vehicle. */
    fleetSavingsPerWeek: number;
    /** Sum of PCE penalty across the candidate evaluation. */
    pcePenalty: number;
    /**
     * `pcePenalty × λ - fleetSavingsPerWeek`. Lower = better.
     * Sign convention matches the ranking optimizer's totalCost.
     */
    totalScore: number;
  };
  /** True when PCE verdict is not BLOCK. Infeasible recs sink to the bottom. */
  feasible: boolean;
  /**
   * Vehicle reuse analysis: can the consolidated vehicle complete this
   * trip and still make a return trip from the destination back to origin
   * (or serve another outbound route) within the turnaround window?
   */
  vehicleReuse: {
    canReuseForReturn: boolean;
    returnTripCandidates: Array<{
      routeId: string;
      routeName: string;
      departureTime: string;
      availableMinutes: number;
    }>;
  } | null;
};

export type ConsolidationAnalysis = {
  objective: ConsolidationObjective;
  recommendations: ConsolidationRecommendation[];
  skipped: SkippedPair[];
  /** Sanity counts for the UI header. */
  totals: {
    routesAnalysed: number;
    pairsConsidered: number;
    pairsSurvivingFilters: number;
    pairsRecommended: number;
    pairsInfeasible: number;
  };
};

// ─── Public entry point ─────────────────────────────────────────────

/**
 * Analyze all pairs across `facts.routes` and return ranked
 * recommendations plus the reasons for skipped pairs. Pure over facts:
 * no DB access, no Prisma, no writes.
 */
export function analyzeConsolidations(
  facts: ConsolidationFacts,
  objective: ConsolidationObjective = {}
): ConsolidationAnalysis {
  const skipped: SkippedPair[] = [];
  const recommendations: ConsolidationRecommendation[] = [];

  let pairsConsidered = 0;
  let pairsSurvivingFilters = 0;

  for (let i = 0; i < facts.routes.length; i++) {
    for (let j = i + 1; j < facts.routes.length; j++) {
      pairsConsidered++;
      const a = facts.routes[i];
      const b = facts.routes[j];

      const filterResult = passesCheapFilters(a, b, objective);
      if (filterResult.skip) {
        skipped.push({ routeIdA: a.id, routeIdB: b.id, reason: filterResult.skip, detail: filterResult.detail });
        continue;
      }
      pairsSurvivingFilters++;

      recommendations.push(scoreCandidate(a, b, filterResult.zoneCompat, facts, objective));
    }
  }

  recommendations.sort(rankRecommendations);

  return {
    objective,
    recommendations,
    skipped,
    totals: {
      routesAnalysed: facts.routes.length,
      pairsConsidered,
      pairsSurvivingFilters,
      pairsRecommended: recommendations.filter((r) => r.feasible).length,
      pairsInfeasible: recommendations.filter((r) => !r.feasible).length,
    },
  };
}

// ─── Cheap filters (before PCE) ─────────────────────────────────────

type FilterResult =
  | { skip: CandidateSkipReason; detail?: string }
  | {
      skip: null;
      zoneCompat: { pickup: ZoneCompatResult; dropoff: ZoneCompatResult };
    };

/**
 * Order matters — most-selective / cheapest checks first so we never
 * spend a PCE call on a pair that a nickel-and-dime filter would have
 * rejected anyway.
 */
function passesCheapFilters(
  a: RouteFacts,
  b: RouteFacts,
  objective: ConsolidationObjective
): FilterResult {
  if (a.stops.length < 2 || b.stops.length < 2) {
    return { skip: 'INSUFFICIENT_ROUTE_DATA', detail: 'route has <2 stops' };
  }
  if (a.routeType && b.routeType && a.routeType !== b.routeType && a.routeType !== 'BOTH' && b.routeType !== 'BOTH') {
    return { skip: 'DIFFERENT_ROUTE_TYPE', detail: `${a.routeType} vs ${b.routeType}` };
  }
  if (a.representativeShift && b.representativeShift && a.representativeShift !== b.representativeShift) {
    return { skip: 'DIFFERENT_SHIFT', detail: `${a.representativeShift} vs ${b.representativeShift}` };
  }
  if (a.representativeDirection && b.representativeDirection && a.representativeDirection !== b.representativeDirection) {
    return { skip: 'DIFFERENT_DIRECTION', detail: `${a.representativeDirection} vs ${b.representativeDirection}` };
  }

  // Departure time proximity check — routes with times too far apart can't
  // realistically share a vehicle (passengers would wait hours). Skip before
  // any expensive zone / PCE work.
  if (a.representativeDepartureTime && b.representativeDepartureTime) {
    const maxDiffMinutes = objective.maxDepartureTimeDiffMinutes ?? 60;
    const timeDiffMinutes = parseTimeDifference(a.representativeDepartureTime, b.representativeDepartureTime);
    if (timeDiffMinutes > maxDiffMinutes) {
      return {
        skip: 'DEPARTURE_TIME_TOO_FAR',
        detail: `${timeDiffMinutes} min apart (max ${maxDiffMinutes})`,
      };
    }
  }

  // Arrival time proximity — same idea as departure, but catches pairs
  // that leave close together yet run very different durations (a short
  // hop merged with a long cross-town route still strands the short
  // route's riders for the extra time, even though departures matched).
  if (a.representativeArrivalTime && b.representativeArrivalTime) {
    const maxDiffMinutes = objective.maxArrivalTimeDiffMinutes ?? 45;
    const timeDiffMinutes = parseTimeDifference(a.representativeArrivalTime, b.representativeArrivalTime);
    if (timeDiffMinutes > maxDiffMinutes) {
      return {
        skip: 'ARRIVAL_TIME_TOO_FAR',
        detail: `${timeDiffMinutes} min apart (max ${maxDiffMinutes})`,
      };
    }
  }

  const { pickupSideA, pickupSideB, dropoffSideA, dropoffSideB } = pickupAndDropoffSides(a, b);
  const pickupCompat = zoneCompatibility(pickupSideA, pickupSideB, {
    fallbackKm: objective.fallbackKm?.pickup ?? DEFAULT_FALLBACK_KM.PICKUP,
  });
  const dropoffCompat = zoneCompatibility(dropoffSideA, dropoffSideB, {
    fallbackKm: objective.fallbackKm?.dropoff ?? DEFAULT_FALLBACK_KM.DROPOFF,
  });

  if (pickupCompat.kind === 'UNKNOWN' || dropoffCompat.kind === 'UNKNOWN') {
    return { skip: 'ZONE_DATA_UNAVAILABLE', detail: `pickup=${pickupCompat.kind}, dropoff=${dropoffCompat.kind}` };
  }
  if (!isCompatPassing(pickupCompat)) {
    return { skip: 'PICKUP_ZONE_INCOMPATIBLE', detail: pickupCompat.kind };
  }
  if (!isCompatPassing(dropoffCompat)) {
    return { skip: 'DROPOFF_ZONE_INCOMPATIBLE', detail: dropoffCompat.kind };
  }

  // Cheap seat check. If both routes carry a capacity target and the combined
  // enrolment blows past the larger of the two, no single vehicle can seat
  // the merged trip — skip before any PCE work. When either capacity is
  // unknown, fall through and let VEHICLE_CAPACITY_HARD (which fires on the
  // synthesized merged trip below) catch violations only if an operator has
  // configured that rule.
  if (a.capacity != null && b.capacity != null) {
    const mergedEnrolled = a.enrolledCount + b.enrolledCount;
    const largestSeat = Math.max(a.capacity, b.capacity);
    if (mergedEnrolled > largestSeat) {
      return {
        skip: 'MERGED_EXCEEDS_CAPACITY',
        detail: `${a.enrolledCount}+${b.enrolledCount}=${mergedEnrolled} > max(${a.capacity},${b.capacity})=${largestSeat}`,
      };
    }
  }

  return { skip: null, zoneCompat: { pickup: pickupCompat, dropoff: dropoffCompat } };
}

/**
 * Sides for zone-compat comparison. Simplification: first stop is
 * treated as the pickup-end and last stop is the dropoff-end.
 * Multi-stop pickup routes (typical INBOUND) collapse to their first
 * pickup point for compat, which is enough for the "same origin
 * neighbourhood" test operators actually care about. The full stop
 * list still drives the PCE deviation check.
 */
function pickupAndDropoffSides(a: RouteFacts, b: RouteFacts) {
  const first = (r: RouteFacts) => r.stops[0];
  const last = (r: RouteFacts) => r.stops[r.stops.length - 1];
  const toPoint = (s: { placeId: string | null; lat: number | null; lng: number | null }) => ({
    placeId: s.placeId,
    lat: s.lat,
    lng: s.lng,
  });
  return {
    pickupSideA: [toPoint(first(a))],
    pickupSideB: [toPoint(first(b))],
    dropoffSideA: [toPoint(last(a))],
    dropoffSideB: [toPoint(last(b))],
  };
}

// ─── Scoring (PCE evaluation + savings arithmetic) ──────────────────

function scoreCandidate(
  a: RouteFacts,
  b: RouteFacts,
  zoneCompat: { pickup: ZoneCompatResult; dropoff: ZoneCompatResult },
  facts: ConsolidationFacts,
  objective: ConsolidationObjective
): ConsolidationRecommendation {
  const planFacts = synthesizePlanFacts(a, b, facts);
  const evalResult = evaluatePlan(planFacts);

  const costPerDay = objective.costPerVehicleDay ?? 100;
  const daysPerWeek = objective.operatingDaysPerWeek ?? 5;
  // Rough model: consolidating two routes into one saves one vehicle-day.
  // Real fleet savings depend on utilisation, deadhead, driver assignment
  // — proper accounting is Phase-N. This lets the ranking still order
  // "obviously cheaper" pairs correctly.
  const fleetSavingsPerWeek = costPerDay * daysPerWeek;
  const lambda = objective.penaltyLambda ?? 1;
  const totalScore = lambda * evalResult.totalPenalty - fleetSavingsPerWeek;

  // Calculate departure time difference for display
  const timeDiffMinutes =
    a.representativeDepartureTime && b.representativeDepartureTime
      ? parseTimeDifference(a.representativeDepartureTime, b.representativeDepartureTime)
      : null;

  // Analyze vehicle reuse: can this vehicle do a return trip?
  const vehicleReuse = analyzeVehicleReuse(a, b, facts, objective);

  return {
    routeA: { id: a.id, name: a.name },
    routeB: { id: b.id, name: b.name },
    zoneCompat,
    timeCompat: {
      shift: a.representativeShift ?? b.representativeShift ?? null,
      direction: a.representativeDirection ?? b.representativeDirection ?? null,
      departureTimeDiffMinutes: timeDiffMinutes,
    },
    demand: {
      routeAEnrolled: a.enrolledCount,
      routeBEnrolled: b.enrolledCount,
      combined: a.enrolledCount + b.enrolledCount,
    },
    verdict: evalResult.verdict,
    checks: evalResult.checks,
    scores: {
      fleetSavingsPerWeek,
      pcePenalty: evalResult.totalPenalty,
      totalScore,
    },
    feasible: evalResult.verdict !== 'BLOCK',
    vehicleReuse,
  };
}

/**
 * Build PlanFacts representing the pair as a merge for PCE evaluation.
 *   - Each source route → a `source` PlanTrip (representative traversal)
 *   - The consolidated route → a `merged` PlanTrip
 *
 * Duration estimate for the merged trip: max(a.duration, b.duration) +
 * a small overhead per extra stop. Crude but honest — the PCE evaluator
 * only compares durations, so directional error dominates precision.
 */
function synthesizePlanFacts(a: RouteFacts, b: RouteFacts, facts: ConsolidationFacts): PlanFacts {
  const now = new Date();
  const anchor = new Date(now.getTime());

  const sourceA: PlanTripFacts = tripForRoute(a, 'source-a', 'source', anchor);
  const sourceB: PlanTripFacts = tripForRoute(b, 'source-b', 'source', anchor);

  const durA = a.estimatedDurationMins ?? computeDurationProxyMin(a);
  const durB = b.estimatedDurationMins ?? computeDurationProxyMin(b);
  const extraStops = Math.max(0, b.stops.length - 1); // adding B's stops beyond the shared endpoint
  const mergedDurationMin = Math.max(durA, durB) + extraStops * 2; // ~2min per added stop
  const mergedStopsUnion = dedupeStops([...a.stops, ...b.stops]);

  // Synthesize a vehicle with the largest per-route capacity as its seat
  // count. Without this, VEHICLE_CAPACITY_HARD short-circuits on the
  // `!trip.vehicle` guard and the operator's capacity rule (if configured)
  // never fires against the merged trip. Nulls if neither route has a
  // capacity — the cheap filter above already skipped the guaranteed-fail
  // case; a null-seats vehicle here would be a no-op anyway.
  const largestSeat =
    a.capacity != null && b.capacity != null
      ? Math.max(a.capacity, b.capacity)
      : a.capacity ?? b.capacity ?? null;

  const merged: PlanTripFacts = {
    id: 'consolidated',
    role: 'merged',
    routeId: `synth-consolidated-${a.id}-${b.id}`,
    vehicleId: null,
    driverId: null,
    departureTime: anchor,
    arrivalTime: new Date(anchor.getTime() + mergedDurationMin * 60_000),
    latestArrivalTime: null,
    confirmedCount: a.enrolledCount + b.enrolledCount,
    stops: mergedStopsUnion.map((s, i) => ({
      placeId: s.placeId ?? `synth-${i}`,
      lat: s.lat ?? 0,
      lng: s.lng ?? 0,
      sequence: i + 1,
    })),
    vehicle: largestSeat != null
      ? { id: `synth-vehicle-${a.id}-${b.id}`, seatingCapacity: largestSeat, vehicleGroup: null }
      : null,
  };

  return {
    trips: [sourceA, sourceB, merged],
    constraints: facts.constraints,
    zones: new Map(), // consolidation engine doesn't evaluate zone-restriction rules here
    tenantTimezone: facts.tenantTimezone,
  };
}

function tripForRoute(
  r: RouteFacts,
  id: string,
  role: PlanTripFacts['role'],
  anchor: Date
): PlanTripFacts {
  const durMin = r.estimatedDurationMins ?? computeDurationProxyMin(r);
  return {
    id,
    role,
    routeId: r.id,
    vehicleId: null,
    driverId: null,
    departureTime: anchor,
    arrivalTime: new Date(anchor.getTime() + durMin * 60_000),
    latestArrivalTime: null,
    confirmedCount: r.enrolledCount,
    stops: r.stops
      .filter((s) => s.placeId && s.lat != null && s.lng != null)
      .map((s) => ({
        placeId: s.placeId as string,
        lat: s.lat as number,
        lng: s.lng as number,
        sequence: s.sequence,
      })),
    vehicle: null,
  };
}

/** Fallback duration when a route lacks estimatedDurationMins. Assumes 30 km/h avg. */
function computeDurationProxyMin(r: RouteFacts): number {
  if (r.totalDistanceKm != null) return Math.max(15, Math.round((r.totalDistanceKm / 30) * 60));
  // With no distance either, assume 3min per stop as a floor — enough
  // to let the evaluator produce a comparable number for both sides.
  return Math.max(15, r.stops.length * 3);
}

function dedupeStops(
  stops: Array<{ placeId: string | null; lat: number | null; lng: number | null; sequence: number }>
) {
  const seen = new Set<string>();
  const out: typeof stops = [];
  for (const s of stops) {
    const key = s.placeId ?? `${s.lat},${s.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ─── Ranking ────────────────────────────────────────────────────────

function rankRecommendations(
  x: ConsolidationRecommendation,
  y: ConsolidationRecommendation
): number {
  // Feasible-first (same as ranking optimizer).
  if (x.feasible !== y.feasible) return x.feasible ? -1 : 1;
  // Ascending totalScore. Ties broken by combined-demand descending so
  // higher-impact ties surface first.
  if (x.scores.totalScore !== y.scores.totalScore) return x.scores.totalScore - y.scores.totalScore;
  return y.demand.combined - x.demand.combined;
}

// ─── Time utilities ─────────────────────────────────────────────────

/**
 * Parse HH:MM time string to minutes since midnight.
 * Returns null if the format is invalid.
 */
function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Calculate absolute time difference in minutes between two HH:MM times.
 * Returns the shortest distance (wraps across midnight if needed).
 */
function parseTimeDifference(timeA: string, timeB: string): number {
  const minA = parseTimeToMinutes(timeA);
  const minB = parseTimeToMinutes(timeB);
  if (minA === null || minB === null) return 0;
  const diff = Math.abs(minA - minB);
  // Take the shorter path (e.g., 23:00 to 01:00 is 2 hours, not 22 hours)
  return Math.min(diff, 1440 - diff);
}

/**
 * Analyze vehicle reuse opportunity: after completing the consolidated
 * inbound trip (A+B), can the same vehicle serve an outbound trip back
 * from the destination to the origin zone within the turnaround window?
 *
 * This detects "round-trip" savings where one vehicle can do:
 *   Morning: accommodation → workplace (OUTBOUND)
 *   Evening: workplace → accommodation (INBOUND, consolidated A+B)
 *   Next morning: accommodation → workplace again
 *
 * Returns null if either route lacks timing data.
 */
function analyzeVehicleReuse(
  a: RouteFacts,
  b: RouteFacts,
  facts: ConsolidationFacts,
  objective: ConsolidationObjective
): ConsolidationRecommendation['vehicleReuse'] {
  // Need arrival time for the consolidated trip to calculate turnaround
  const laterRoute = getLaterRoute(a, b);
  if (!laterRoute?.representativeArrivalTime) return null;

  const arrivalMinutes = parseTimeToMinutes(laterRoute.representativeArrivalTime);
  if (arrivalMinutes === null) return null;

  const turnaroundMinutes = objective.vehicleTurnaroundMinutes ?? 30;
  const earliestDepartureMinutes = (arrivalMinutes + turnaroundMinutes) % 1440;

  // Look for OUTBOUND routes from the consolidated destination back to
  // the origin zone (reverse direction).
  const destStop = laterRoute.stops[laterRoute.stops.length - 1];
  const originStop = laterRoute.stops[0];

  const returnCandidates = facts.routes
    .filter((r) => {
      // Must be opposite direction
      if (r.representativeDirection !== getOppositeDirection(laterRoute.representativeDirection)) {
        return false;
      }
      // Must depart from near the consolidated trip's destination
      if (r.stops.length < 2) return false;
      const rOrigin = r.stops[0];
      if (!stopsAreNearby(destStop, rOrigin)) return false;
      // Must go to near the consolidated trip's origin
      const rDest = r.stops[r.stops.length - 1];
      if (!stopsAreNearby(originStop, rDest)) return false;
      // Must have a departure time
      if (!r.representativeDepartureTime) return false;
      return true;
    })
    .map((r) => {
      const depMinutes = parseTimeToMinutes(r.representativeDepartureTime!);
      if (depMinutes === null) return null;
      // Calculate available time (how long the vehicle waits before this trip)
      let availableMinutes = depMinutes - earliestDepartureMinutes;
      if (availableMinutes < 0) availableMinutes += 1440; // wrap midnight
      return {
        routeId: r.id,
        routeName: r.name,
        departureTime: r.representativeDepartureTime!,
        availableMinutes,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .filter((c) => c.availableMinutes >= 0 && c.availableMinutes <= 180) // within 3 hours
    .sort((x, y) => x.availableMinutes - y.availableMinutes); // closest first

  return {
    canReuseForReturn: returnCandidates.length > 0,
    returnTripCandidates: returnCandidates,
  };
}

function getLaterRoute(a: RouteFacts, b: RouteFacts): RouteFacts | null {
  if (!a.representativeDepartureTime || !b.representativeDepartureTime) return null;
  const minA = parseTimeToMinutes(a.representativeDepartureTime);
  const minB = parseTimeToMinutes(b.representativeDepartureTime);
  if (minA === null || minB === null) return null;
  return minA >= minB ? a : b;
}

function getOppositeDirection(direction: string | null): string | null {
  if (direction === 'INBOUND') return 'OUTBOUND';
  if (direction === 'OUTBOUND') return 'INBOUND';
  return null;
}

function stopsAreNearby(
  s1: { placeId: string | null; lat: number | null; lng: number | null },
  s2: { placeId: string | null; lat: number | null; lng: number | null }
): boolean {
  // Same placeId = same location
  if (s1.placeId && s2.placeId && s1.placeId === s2.placeId) return true;
  // Within 2km (approx 0.018 degrees at UAE latitude)
  if (s1.lat != null && s1.lng != null && s2.lat != null && s2.lng != null) {
    const dLat = Math.abs(s1.lat - s2.lat);
    const dLng = Math.abs(s1.lng - s2.lng);
    return dLat < 0.018 && dLng < 0.018;
  }
  return false;
}
