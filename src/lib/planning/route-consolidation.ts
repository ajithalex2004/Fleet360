/**
 * Route Consolidation Engine.
 *
 * Answers the customer's network-design question:
 *   "Which pairs of active routes should be consolidated into one?"
 *
 * Not to be confused with the Staff Transport merge consumer
 * (`src/lib/bus-ops/merge-trips.ts`), which operates on scheduled
 * trip rows for a given date. This engine operates on the ROUTE
 * network itself and produces recommendations the operator reviews —
 * nothing is mutated. Applying a recommendation is a separate step.
 *
 * Four-stage pipeline (each stage landed as its own reviewable change):
 *
 *   Stage 1 — cheap eligibility filters (passesCheapFilters): shift,
 *     direction, departure buffer, arrival buffer, zone compatibility,
 *     capacity pre-check. Pure, in-memory, no DB/API access. Order
 *     matters — cheapest/most-selective first, so nothing expensive
 *     runs on a pair a nickel-and-dime filter would reject anyway.
 *
 *   Stage 2 — real road distance/duration for survivors, batched
 *     against Google's Routes API matrix (route-consolidation-matrix.ts).
 *
 *   Stage 3 — PCE evaluation, once per candidate, using Stage 2's real
 *     distances instead of a coordinate estimate.
 *
 *   Stage 4 — component scoring (route-consolidation-scoring.ts):
 *     detour, passenger impact, distance/time saving, resource release,
 *     PCE penalty, combined into a bounded rankingCost.
 *
 * `analyzeConsolidations()` is therefore no longer DB/API-free — it
 * orchestrates all four stages, including the async matrix + fuel-price
 * lookups. The pure arithmetic (filtering, PCE-facts synthesis,
 * component scoring, ranking) still lives in ordinary synchronous
 * functions/modules so it stays easy to test in isolation; only the
 * top-level orchestrator touches Prisma.
 *
 * Pluggable via PlanningConstraint rows (esp. ROUTE_STOP_DEVIATION_MAX,
 * VEHICLE_CAPACITY_HARD, ZONE_VEHICLE_RESTRICTION, and — since Stage 2 —
 * DEPARTURE_TIME_PROXIMITY / ARRIVAL_TIME_PROXIMITY) — the customer's
 * "acceptable detour", "combined capacity", and "planning constraints"
 * requirements all funnel through the existing PCE evaluator instead
 * of being re-encoded here.
 *
 * TODO: passenger-group segregation is out-of-scope (no data model
 * exists). This engine currently treats all passengers as compatible.
 * Extension point: `passengerGroupsCompatible()` — layer a
 * segregation-rule check in there when the requirement lands.
 */

import type { PrismaClient } from '@prisma/client';
import { evaluatePlan, type PlanFacts, type PlanCheck, type PlanTripFacts } from './evaluate-plan';
import type { ConsolidationFacts, RouteFacts } from './route-consolidation-facts';
import { routePickupStop, routeDropoffStop } from './route-consolidation-facts';
import {
  zoneCompatibility,
  isCompatPassing,
  DEFAULT_FALLBACK_KM,
  type ZoneCompatResult,
} from './zone-compat';
import {
  buildCase1Pairings,
  resolveMatrixPairings,
  pairingKey,
  type MatrixPairingResult,
} from './route-consolidation-matrix';
import {
  computeScoreComponents,
  rankCandidate,
  computeEstimatedSavings,
  type ScoreComponents,
  type EstimatedSavings,
} from './route-consolidation-scoring';
import type { ScoringPolicy } from './route-consolidation-scoring-policy';
import { getLatestFuelPrice } from '@/lib/fleet/fuel-price';
import { DEFAULT_FUEL_PRICE_AED } from '@/lib/mapbox';

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
  /** True when PCE verdict is not BLOCK. Infeasible recs sink to the bottom. */
  feasible: boolean;
  /** Real road distance/duration for this candidate's endpoint pairings (Stage 2/3), null for a pairing the matrix couldn't resolve. */
  matrixRefinement: {
    pickupToPickup: MatrixPairingResult | null;
    dropoffToDropoff: MatrixPairingResult | null;
  };
  /** Stage 4 component breakdown — shown to operators instead of one opaque number. */
  components: ScoreComponents;
  /** impactScore - benefitScore, bounded [-1,+1], lower = better. Internal sorting key — matches the PCE-stack convention, not shown to operators directly. */
  rankingCost: number;
  /** 50 x (1 - rankingCost), 0-100, higher = better. Display-only presentation of rankingCost. */
  operatorScore: number;
  /** "Estimated Direct Operating Saving" — only fuel + vehicle-day costs are dollarized; see route-consolidation-scoring.ts. */
  estimatedSavings: EstimatedSavings;
};

export type ConsolidationAnalysis = {
  objective: ConsolidationObjective;
  /** Resolved policy this run scored against — id null when serving DEFAULT_SCORING_POLICY (no tenant row saved yet). Not persisted here; only snapshotted into RouteConsolidation.objectiveSnapshot at Apply time. */
  scoringPolicy: { id: string | null; name: string; calculationVersion: string };
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
 * Run all four stages over `facts.routes` and return ranked
 * recommendations plus the reasons for skipped pairs. Orchestrates the
 * async Stage 2 (matrix) + fuel-price lookups; the actual filtering/
 * scoring math stays in ordinary synchronous helpers below. Analyse
 * itself is stateless — nothing is written; the resolved scoringPolicy
 * is only persisted by the caller if/when a recommendation is applied.
 */
export async function analyzeConsolidations(
  prisma: PrismaClient,
  tenantId: string,
  facts: ConsolidationFacts,
  objective: ConsolidationObjective,
  scoringPolicy: ScoringPolicy,
): Promise<ConsolidationAnalysis> {
  // Stage 1 — cheap eligibility filters.
  const skipped: SkippedPair[] = [];
  const survivors: Array<{ a: RouteFacts; b: RouteFacts; zoneCompat: { pickup: ZoneCompatResult; dropoff: ZoneCompatResult } }> = [];

  let pairsConsidered = 0;
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
      survivors.push({ a, b, zoneCompat: filterResult.zoneCompat });
    }
  }

  // Stage 2 — real distance/duration for survivors, batched. Resolved
  // once for the whole run, not per pair inside the loop below.
  const pairings = buildCase1Pairings(
    survivors.map(({ a, b }) => ({ routeIdA: a.id, routeIdB: b.id, a, b })),
  );
  const matrixResults = await resolveMatrixPairings(prisma, tenantId, pairings);

  // Fuel price — same real-pump-price source as Single Route/Fleet
  // Planner, resolved once for the batch (it's a tenant-wide value, not
  // per-candidate).
  const latestFuel = await getLatestFuelPrice(prisma, tenantId).catch(() => null);
  const fuelPricePerLitreAED = latestFuel?.price ?? DEFAULT_FUEL_PRICE_AED;
  const fuelPriceSource: 'fleet-log' | 'default' = latestFuel ? 'fleet-log' : 'default';

  // Stage 3 (PCE, using Stage 2's real distances) + Stage 4 (component
  // scoring) — both happen inside scoreCandidate per surviving pair.
  const recommendations = survivors.map(({ a, b, zoneCompat }) => {
    const matrixRefinement = {
      pickupToPickup: matrixResults.get(pairingKey('PICKUP_TO_PICKUP', a.id, b.id)) ?? null,
      dropoffToDropoff: matrixResults.get(pairingKey('DROPOFF_TO_DROPOFF', a.id, b.id)) ?? null,
    };
    return scoreCandidate(a, b, zoneCompat, facts, objective, scoringPolicy, matrixRefinement, {
      fuelPricePerLitreAED,
      fuelPriceSource,
    });
  });

  recommendations.sort(rankRecommendations);

  return {
    objective,
    scoringPolicy: { id: scoringPolicy.id, name: scoringPolicy.name, calculationVersion: scoringPolicy.calculationVersion },
    recommendations,
    skipped,
    totals: {
      routesAnalysed: facts.routes.length,
      pairsConsidered,
      pairsSurvivingFilters: survivors.length,
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
  const toPoint = (s: { placeId: string | null; lat: number | null; lng: number | null }) => ({
    placeId: s.placeId,
    lat: s.lat,
    lng: s.lng,
  });
  return {
    pickupSideA: [toPoint(routePickupStop(a))],
    pickupSideB: [toPoint(routePickupStop(b))],
    dropoffSideA: [toPoint(routeDropoffStop(a))],
    dropoffSideB: [toPoint(routeDropoffStop(b))],
  };
}

// ─── Scoring (PCE evaluation + savings arithmetic) ──────────────────

function scoreCandidate(
  a: RouteFacts,
  b: RouteFacts,
  zoneCompat: { pickup: ZoneCompatResult; dropoff: ZoneCompatResult },
  facts: ConsolidationFacts,
  objective: ConsolidationObjective,
  scoringPolicy: ScoringPolicy,
  matrixRefinement: { pickupToPickup: MatrixPairingResult | null; dropoffToDropoff: MatrixPairingResult | null },
  fuelContext: { fuelPricePerLitreAED: number; fuelPriceSource: 'fleet-log' | 'default' },
): ConsolidationRecommendation {
  // Stage 3 — PCE, using Stage 2's real distances when the matrix
  // resolved this pair (falls back to the coordinate-based estimate
  // inside synthesizePlanFacts otherwise — a matrix miss shouldn't sink
  // the whole candidate).
  const planFacts = synthesizePlanFacts(a, b, facts, matrixRefinement);
  const evalResult = evaluatePlan(planFacts);

  // Stage 4 — component scoring + bounded ranking + dollarized savings.
  const components = computeScoreComponents({
    sourceA: { totalDistanceKm: a.totalDistanceKm, estimatedDurationMins: a.estimatedDurationMins, enrolledCount: a.enrolledCount },
    sourceB: { totalDistanceKm: b.totalDistanceKm, estimatedDurationMins: b.estimatedDurationMins, enrolledCount: b.enrolledCount },
    matrixRefinement,
    pcePenalty: evalResult.totalPenalty,
  });
  const { rankingCost, operatorScore } = rankCandidate(components, scoringPolicy);
  const estimatedSavings = computeEstimatedSavings(components, {
    fuelPricePerLitreAED: fuelContext.fuelPricePerLitreAED,
    fuelPriceSource: fuelContext.fuelPriceSource,
    vehicleCostPerDay: objective.costPerVehicleDay ?? 100,
    operatingDaysPerWeek: objective.operatingDaysPerWeek ?? 5,
    calculationVersion: scoringPolicy.calculationVersion,
  });

  // Calculate departure time difference for display
  const timeDiffMinutes =
    a.representativeDepartureTime && b.representativeDepartureTime
      ? parseTimeDifference(a.representativeDepartureTime, b.representativeDepartureTime)
      : null;

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
    feasible: evalResult.verdict !== 'BLOCK',
    matrixRefinement,
    components,
    rankingCost,
    operatorScore,
    estimatedSavings,
  };
}

/**
 * Build PlanFacts representing the pair as a merge for PCE evaluation.
 *   - Each source route → a `source` PlanTrip (representative traversal)
 *   - The consolidated route → a `merged` PlanTrip
 *
 * Merged-trip duration: when the Stage 2 matrix resolved this pair's
 * endpoint pairings, mergedDurationMin = max(durA,durB) + real detour
 * minutes (pickupToPickup + dropoffToDropoff duration) — precise.
 * Otherwise falls back to the old coordinate-free estimate (~2min per
 * added stop) so a matrix miss degrades gracefully instead of blocking
 * the candidate.
 */
function synthesizePlanFacts(
  a: RouteFacts,
  b: RouteFacts,
  facts: ConsolidationFacts,
  matrixRefinement: { pickupToPickup: MatrixPairingResult | null; dropoffToDropoff: MatrixPairingResult | null },
): PlanFacts {
  const now = new Date();
  const anchor = new Date(now.getTime());

  const sourceA: PlanTripFacts = tripForRoute(a, 'source-a', 'source', anchor);
  const sourceB: PlanTripFacts = tripForRoute(b, 'source-b', 'source', anchor);

  const durA = a.estimatedDurationMins ?? computeDurationProxyMin(a);
  const durB = b.estimatedDurationMins ?? computeDurationProxyMin(b);
  const hasMatrixData = matrixRefinement.pickupToPickup != null || matrixRefinement.dropoffToDropoff != null;
  const mergedDurationMin = hasMatrixData
    ? Math.max(durA, durB) + (matrixRefinement.pickupToPickup?.durationMin ?? 0) + (matrixRefinement.dropoffToDropoff?.durationMin ?? 0)
    : Math.max(durA, durB) + Math.max(0, b.stops.length - 1) * 2; // ~2min per added stop — pre-matrix fallback estimate
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
  // Ascending rankingCost (lower = better). Ties broken by combined-demand
  // descending so higher-impact ties surface first.
  if (x.rankingCost !== y.rankingCost) return x.rankingCost - y.rankingCost;
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
 * Vehicle-reuse-across-sequential-trips ("Case 2") used to be an
 * afterthought attached to each Case 1 candidate here — a coordinate-only
 * heuristic (stopsAreNearby, opposite-direction requirement) checked only
 * for pairs that had already survived Case 1's filters. It's now a
 * standalone all-route-pairs analysis with real matrix distances — see
 * route-consolidation-vehicle-reuse.ts / POST .../vehicle-reuse. Case 1
 * and Case 2 are different resource models (route elimination vs. vehicle
 * reuse across unchanged routes) and don't share eligibility rules, so
 * folding one into the other's recommendation object was the wrong shape.
 */
