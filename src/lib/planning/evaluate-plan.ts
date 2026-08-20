/**
 * Planning Constraint Engine — pure evaluator.
 *
 * Complements the Resource Validation Engine (RVE, src/lib/bus-ops/
 * validate-assignment.ts). Where RVE validates a single trip on write
 * (does this vehicle+driver assignment obey the compliance rules?), the
 * PCE validates a *plan* on optimisation — one or more candidate trips
 * (typically a merge, a bulk reassignment, or a template expansion) —
 * against ops-configurable rules stored in `planning_constraints`.
 *
 * The evaluator is pure: it consumes pre-loaded Facts, dispatches each
 * enabled rule to its kind-specific evaluator, aggregates verdicts, and
 * returns `{verdict, checks[], totalPenalty}`. No DB access in this file
 * — call `loadPlanFacts()` (src/lib/planning/facts.ts) first.
 *
 * Verdict aggregation:
 *   BLOCK > WARN > PASS (max severity)
 *   PENALTY does NOT worsen the verdict — plans stay legal — but the
 *   score accumulates for the future optimiser.
 */

import type { ZoneShape } from './zone';
import { pathTouchesZone, parsePolygonJson, type LatLng } from './zone';

// ─── Outcome primitives ─────────────────────────────────────────────

export type PlanCheckOutcome = 'PASS' | 'WARN' | 'BLOCK' | 'PENALTY';

export type PlanCheck = {
  /** Rule code — the `kind` from planning_constraints, or ENGINE_* for engine-level checks. */
  code: string;
  /** Constraint row id, when the check was produced by a stored rule. */
  constraintId?: string;
  outcome: PlanCheckOutcome;
  /** Human-readable message shown in ops UI. */
  message: string;
  /** Additive score when outcome=PENALTY. */
  penalty?: number;
  /** Optional extra context (which trip, which stop, computed values). */
  details?: Record<string, unknown>;
};

export type PlanVerdict = 'PASS' | 'WARN' | 'BLOCK';

export type PlanEvaluationResult = {
  verdict: PlanVerdict;
  checks: PlanCheck[];
  totalPenalty: number;
};

// ─── Fact shape (what the engine consumes) ──────────────────────────

/** One trip in a plan — merged, source, or standalone. */
export type PlanTripFacts = {
  /** Client-supplied id for correlating checks back to trips (any string). */
  id: string;
  /** `merged` marks the proposed result trip in a merge plan. `source` marks the pre-merge originals. */
  role: 'merged' | 'source' | 'standalone';
  routeId: string;
  vehicleId: string | null;
  driverId: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  latestArrivalTime: Date | null;
  confirmedCount: number;
  /** Ordered stop coordinates. Empty when the plan is being sketched before stop assignment. */
  stops: Array<{ placeId: string; lat: number; lng: number; sequence: number }>;
  vehicle: {
    id: string;
    seatingCapacity: number | null;
    vehicleGroup: string | null;
  } | null;
};

/** A stored planning_constraints row, normalised to plain JS. */
export type PlanningConstraintFacts = {
  id: string;
  name: string;
  kind: string;
  action: 'BLOCK' | 'WARN' | 'PENALTY';
  penaltyScore: number | null;
  params: Record<string, unknown>;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  reason: string | null;
  isEnabled: boolean;
};

/** Zone geometry pre-loaded from spatial.places, keyed by id. */
export type ZoneFacts = Map<string, ZoneShape & { name: string }>;

export type PlanFacts = {
  trips: PlanTripFacts[];
  constraints: PlanningConstraintFacts[];
  zones: ZoneFacts;
  /** IANA zone for interpreting day-of-week / time-of-day rule windows. */
  tenantTimezone: string;
};

// ─── Public entry point ─────────────────────────────────────────────

export function evaluatePlan(facts: PlanFacts): PlanEvaluationResult {
  const checks: PlanCheck[] = [];

  for (const constraint of facts.constraints) {
    if (!constraint.isEnabled) continue;
    if (!isConstraintInEffect(constraint, facts.trips)) continue;

    const evaluator = EVALUATORS[constraint.kind];
    if (!evaluator) {
      checks.push({
        code: 'ENGINE_UNKNOWN_KIND',
        constraintId: constraint.id,
        outcome: 'WARN',
        message: `Unknown constraint kind "${constraint.kind}" (rule "${constraint.name}") — skipped.`,
      });
      continue;
    }

    try {
      const kindChecks = evaluator(constraint, facts);
      for (const c of kindChecks) checks.push(c);
    } catch (err) {
      checks.push({
        code: 'ENGINE_EVALUATOR_ERROR',
        constraintId: constraint.id,
        outcome: 'WARN',
        message: `Rule "${constraint.name}" (${constraint.kind}) failed to evaluate: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  return aggregate(checks);
}

// ─── Verdict aggregation ────────────────────────────────────────────

function aggregate(checks: PlanCheck[]): PlanEvaluationResult {
  let verdict: PlanVerdict = 'PASS';
  let totalPenalty = 0;
  for (const c of checks) {
    if (c.outcome === 'BLOCK') verdict = 'BLOCK';
    else if (c.outcome === 'WARN' && verdict === 'PASS') verdict = 'WARN';
    if (c.outcome === 'PENALTY') totalPenalty += c.penalty ?? 0;
  }
  return { verdict, checks, totalPenalty };
}

// ─── Time-window gating ─────────────────────────────────────────────

/**
 * A constraint is only "in effect" if any trip's departureTime falls
 * within [effectiveFrom, effectiveTo]. Null on either side = unbounded
 * that direction. Trips are date objects; effectiveFrom/To are DATEs
 * (midnight semantics) — compared inclusively.
 */
function isConstraintInEffect(
  constraint: PlanningConstraintFacts,
  trips: PlanTripFacts[]
): boolean {
  if (!constraint.effectiveFrom && !constraint.effectiveTo) return true;
  for (const trip of trips) {
    const t = trip.departureTime.getTime();
    const fromOk = !constraint.effectiveFrom || t >= constraint.effectiveFrom.getTime();
    // End-of-day for effectiveTo (inclusive): add 24h - 1ms
    const toOk =
      !constraint.effectiveTo ||
      t <= constraint.effectiveTo.getTime() + 24 * 60 * 60 * 1000 - 1;
    if (fromOk && toOk) return true;
  }
  return false;
}

// ─── Evaluator dispatch table ───────────────────────────────────────

type Evaluator = (rule: PlanningConstraintFacts, facts: PlanFacts) => PlanCheck[];

const EVALUATORS: Record<string, Evaluator> = {
  ZONE_VEHICLE_RESTRICTION: evalZoneVehicleRestriction,
  PICKUP_TIME_BUFFER: evalPickupTimeBuffer,
  TRIP_MAX_DURATION: evalTripMaxDuration,
  // PASSENGER_MAX_DETOUR and ROUTE_STOP_DEVIATION_MAX share the same
  // duration-detour math (merged.duration vs each source.duration). They
  // exist as separate kinds so ops can author them with different
  // thresholds and semantics — one for trip-time passenger experience,
  // one for network-design route deviation — and enable/disable each
  // independently. See docstring on evalDurationDetour.
  PASSENGER_MAX_DETOUR: evalDurationDetour,
  ROUTE_STOP_DEVIATION_MAX: evalDurationDetour,
  MERGED_ARRIVAL_SLA: evalMergedArrivalSla,
  ROUTE_STOP_RESTRICTION: evalRouteStopRestriction,
  VEHICLE_CAPACITY_HARD: evalVehicleCapacityHard,
  // DEPARTURE_TIME_PROXIMITY / ARRIVAL_TIME_PROXIMITY aren't PCE checks —
  // they're pure config (maxMinutes) read directly by
  // resolveEligibilityPolicy() during Stage 1 filtering, before a
  // candidate ever reaches PCE. Registered here as explicit no-ops so an
  // enabled row of either kind doesn't fall through to ENGINE_UNKNOWN_KIND
  // and show as a spurious WARN on every merge.
  DEPARTURE_TIME_PROXIMITY: () => [],
  ARRIVAL_TIME_PROXIMITY: () => [],
  // Same reasoning — VEHICLE_MIN_TURNAROUND / MAX_VEHICLE_REUSE_WINDOW are
  // pure config read by route-consolidation-vehicle-reuse-policy.ts for
  // the standalone Case 2 vehicle-reuse analysis, not PCE checks. Case 2
  // itself never calls evaluatePlan() (it doesn't synthesize a merged
  // trip), but Case 1's evaluatePlan() call scans every enabled
  // PlanningConstraint row tenant-wide regardless of kind relevance — so
  // without these two entries, enabling either kind would make every
  // Case 1 candidate show a spurious ENGINE_UNKNOWN_KIND WARN too.
  VEHICLE_MIN_TURNAROUND: () => [],
  MAX_VEHICLE_REUSE_WINDOW: () => [],
};

// ─── Shared helpers ─────────────────────────────────────────────────

function outcomeCheck(
  rule: PlanningConstraintFacts,
  message: string,
  details?: Record<string, unknown>
): PlanCheck {
  return {
    code: rule.kind,
    constraintId: rule.id,
    outcome: rule.action,
    message: rule.reason ? `${message} — ${rule.reason}` : message,
    penalty: rule.action === 'PENALTY' ? rule.penaltyScore ?? 0 : undefined,
    details,
  };
}

function vehicleFilterMatches(
  vehicle: PlanTripFacts['vehicle'],
  params: {
    minSeats?: number;
    maxSeats?: number;
    vehicleGroups?: string[];
  }
): boolean {
  if (!vehicle) return false;
  if (typeof params.minSeats === 'number') {
    if ((vehicle.seatingCapacity ?? 0) < params.minSeats) return false;
  }
  if (typeof params.maxSeats === 'number') {
    if ((vehicle.seatingCapacity ?? Number.POSITIVE_INFINITY) > params.maxSeats) return false;
  }
  if (params.vehicleGroups && params.vehicleGroups.length > 0) {
    const g = (vehicle.vehicleGroup ?? '').toLowerCase();
    const set = params.vehicleGroups.map((s) => s.toLowerCase());
    if (!set.includes(g)) return false;
  }
  return true;
}

/** Minutes since local midnight for a Date in the tenant timezone (0-1439). */
function localMinutesOfDay(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** Day-of-week (0=Sun … 6=Sat) for a Date in the tenant timezone. */
function localDayOfWeek(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const abbr = fmt.format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[abbr] ?? 0;
}

function withinWindow(
  when: Date,
  params: { fromHm?: number; toHm?: number; dayMask?: number },
  tz: string
): boolean {
  if (typeof params.dayMask === 'number') {
    const bit = 1 << localDayOfWeek(when, tz);
    if ((params.dayMask & bit) === 0) return false;
  }
  const from = params.fromHm;
  const to = params.toHm;
  if (typeof from !== 'number' && typeof to !== 'number') return true;
  const m = localMinutesOfDay(when, tz);
  const a = typeof from === 'number' ? from : 0;
  const b = typeof to === 'number' ? to : 24 * 60;
  return a <= b ? m >= a && m < b : m >= a || m < b; // wraps midnight
}

function tripPath(trip: PlanTripFacts): LatLng[] {
  return trip.stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({ lat: s.lat, lng: s.lng }));
}

function durationMinutes(trip: PlanTripFacts): number | null {
  if (!trip.arrivalTime) return null;
  return Math.round((trip.arrivalTime.getTime() - trip.departureTime.getTime()) / 60000);
}

// ─── Evaluators ─────────────────────────────────────────────────────

/**
 * ZONE_VEHICLE_RESTRICTION — the "no heavy buses in Al Khail 07:00-10:00" rule.
 *
 * Fires when: trip path enters `zonePlaceId` AND vehicle matches the seats/
 * group filter AND departureTime falls in the fromHm/toHm/dayMask window.
 * Outcome per rule.action. Filter shape mirrors ROUTE_STOP_RESTRICTION.
 */
function evalZoneVehicleRestriction(rule: PlanningConstraintFacts, facts: PlanFacts): PlanCheck[] {
  const params = rule.params as {
    zonePlaceId?: string;
    minSeats?: number;
    maxSeats?: number;
    vehicleGroups?: string[];
    fromHm?: number;
    toHm?: number;
    dayMask?: number;
  };
  if (!params.zonePlaceId) return [];
  const zone = facts.zones.get(params.zonePlaceId);
  if (!zone) return []; // Zone referenced but not loaded — treated as absent (silent).

  const out: PlanCheck[] = [];
  for (const trip of facts.trips) {
    if (!vehicleFilterMatches(trip.vehicle, params)) continue;
    if (!withinWindow(trip.departureTime, params, facts.tenantTimezone)) continue;
    if (!pathTouchesZone(tripPath(trip), zone)) continue;
    out.push(
      outcomeCheck(rule, `Trip ${trip.id} enters restricted zone "${zone.name}" with a matching vehicle.`, {
        tripId: trip.id,
        zonePlaceId: params.zonePlaceId,
      })
    );
  }
  return out;
}

/**
 * PICKUP_TIME_BUFFER — merge candidates whose pickup times are too close
 * violate operator expectations of driver gap between pickups.
 *
 * Only fires on merge plans (needs ≥2 source trips). Computes minimum
 * pairwise |departureTime| across sources and compares to minBufferMin.
 */
function evalPickupTimeBuffer(rule: PlanningConstraintFacts, facts: PlanFacts): PlanCheck[] {
  const params = rule.params as { minBufferMin?: number };
  const minBuffer = params.minBufferMin ?? 0;
  const sources = facts.trips.filter((t) => t.role === 'source');
  if (sources.length < 2) return [];

  let minDiff = Number.POSITIVE_INFINITY;
  let pair: [string, string] = ['', ''];
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const diff =
        Math.abs(sources[i].departureTime.getTime() - sources[j].departureTime.getTime()) / 60000;
      if (diff < minDiff) {
        minDiff = diff;
        pair = [sources[i].id, sources[j].id];
      }
    }
  }
  if (minDiff >= minBuffer) return [];
  return [
    outcomeCheck(
      rule,
      `Merge candidates ${pair[0]} and ${pair[1]} pickup times differ by ${Math.round(minDiff)}min (< ${minBuffer}min required).`,
      { pair, diffMin: Math.round(minDiff), minBufferMin: minBuffer }
    ),
  ];
}

/**
 * TRIP_MAX_DURATION — hard ceiling on trip length.
 *
 * Applies to each trip in the plan with a known arrivalTime. Trips
 * without arrivalTime are skipped (can't compute duration).
 */
function evalTripMaxDuration(rule: PlanningConstraintFacts, facts: PlanFacts): PlanCheck[] {
  const params = rule.params as { maxMinutes?: number };
  const max = params.maxMinutes;
  if (typeof max !== 'number') return [];
  const out: PlanCheck[] = [];
  for (const trip of facts.trips) {
    const d = durationMinutes(trip);
    if (d === null) continue;
    if (d <= max) continue;
    out.push(
      outcomeCheck(rule, `Trip ${trip.id} duration ${d}min exceeds max ${max}min.`, {
        tripId: trip.id,
        durationMin: d,
        maxMinutes: max,
      })
    );
  }
  return out;
}

/**
 * Duration-detour math shared by two constraint kinds:
 *
 *   PASSENGER_MAX_DETOUR      — trip-execution context: how much extra
 *                               travel-time can a merged trip inflict
 *                               on the passengers of a source trip?
 *   ROUTE_STOP_DEVIATION_MAX  — network-design context: how much extra
 *                               traversal-time can a consolidated route
 *                               add over a source route's typical run?
 *
 * The math is identical: for each `source` trip, compare its duration
 * against the `merged` trip's duration. Threshold is absolute
 * (maxMinutes) or relative (maxPercent); the more restrictive fires.
 * Requires both source(s) and a merged trip in the plan facts.
 *
 * Kept as one function because the check output uses `rule.kind` as
 * the code, so the check's identity always reflects which rule
 * authored it — no branching needed inside the evaluator.
 */
function evalDurationDetour(rule: PlanningConstraintFacts, facts: PlanFacts): PlanCheck[] {
  const params = rule.params as { maxMinutes?: number; maxPercent?: number };
  const merged = facts.trips.find((t) => t.role === 'merged');
  if (!merged) return [];
  const mergedDur = durationMinutes(merged);
  if (mergedDur === null) return [];

  const out: PlanCheck[] = [];
  for (const source of facts.trips.filter((t) => t.role === 'source')) {
    const origDur = durationMinutes(source);
    if (origDur === null) continue;
    const detourMin = mergedDur - origDur;
    if (detourMin <= 0) continue;

    const absExceeds = typeof params.maxMinutes === 'number' && detourMin > params.maxMinutes;
    const pctVal = origDur > 0 ? (detourMin / origDur) * 100 : Number.POSITIVE_INFINITY;
    const pctExceeds = typeof params.maxPercent === 'number' && pctVal > params.maxPercent;
    if (!absExceeds && !pctExceeds) continue;

    out.push(
      outcomeCheck(
        rule,
        `Trip ${source.id} passengers detour by ${detourMin}min (${Math.round(pctVal)}%) — exceeds threshold.`,
        {
          sourceTripId: source.id,
          detourMin,
          detourPct: Math.round(pctVal),
          maxMinutes: params.maxMinutes,
          maxPercent: params.maxPercent,
        }
      )
    );
  }
  return out;
}

/**
 * MERGED_ARRIVAL_SLA — the trip must arrive by its committed
 * latestArrivalTime (with an optional tolerance).
 *
 * Silent when latestArrivalTime is null — trips without a stated SLA are
 * unconstrained. Toleranced comparison so operators can allow small slips.
 */
function evalMergedArrivalSla(rule: PlanningConstraintFacts, facts: PlanFacts): PlanCheck[] {
  const params = rule.params as { toleranceMin?: number };
  const tol = params.toleranceMin ?? 0;
  const out: PlanCheck[] = [];
  for (const trip of facts.trips) {
    if (!trip.latestArrivalTime || !trip.arrivalTime) continue;
    const slipMin = Math.round(
      (trip.arrivalTime.getTime() - trip.latestArrivalTime.getTime()) / 60000
    );
    if (slipMin <= tol) continue;
    out.push(
      outcomeCheck(
        rule,
        `Trip ${trip.id} arrives ${slipMin}min after SLA (tolerance ${tol}min).`,
        { tripId: trip.id, slipMin, toleranceMin: tol }
      )
    );
  }
  return out;
}

/**
 * ROUTE_STOP_RESTRICTION — filter vehicles from serving specific stops.
 *
 * Same filter shape as ZONE_VEHICLE_RESTRICTION but keyed by a stop
 * `placeId` on the trip's stops list rather than by zone geometry.
 * Useful for "no coach at Marina Walk stop — access clearance" rules
 * without needing to draw a polygon around one stop.
 */
function evalRouteStopRestriction(rule: PlanningConstraintFacts, facts: PlanFacts): PlanCheck[] {
  const params = rule.params as {
    stopPlaceId?: string;
    minSeats?: number;
    maxSeats?: number;
    vehicleGroups?: string[];
  };
  if (!params.stopPlaceId) return [];
  const out: PlanCheck[] = [];
  for (const trip of facts.trips) {
    if (!vehicleFilterMatches(trip.vehicle, params)) continue;
    if (!trip.stops.some((s) => s.placeId === params.stopPlaceId)) continue;
    out.push(
      outcomeCheck(rule, `Trip ${trip.id} uses restricted stop with a matching vehicle.`, {
        tripId: trip.id,
        stopPlaceId: params.stopPlaceId,
      })
    );
  }
  return out;
}

/**
 * VEHICLE_CAPACITY_HARD — legal ceiling.
 *
 * confirmedCount must not exceed vehicle.seatingCapacity. This is the
 * "you cannot legally seat more passengers than seats" rule; sits alongside
 * RVE's V4 (which is roster-vs-capacity for a single trip on write).
 * PCE re-checks it in plan context because merges can push a trip over
 * capacity even when both source trips were individually legal.
 */
function evalVehicleCapacityHard(rule: PlanningConstraintFacts, facts: PlanFacts): PlanCheck[] {
  const out: PlanCheck[] = [];
  for (const trip of facts.trips) {
    if (!trip.vehicle || trip.vehicle.seatingCapacity == null) continue;
    if (trip.confirmedCount <= trip.vehicle.seatingCapacity) continue;
    out.push(
      outcomeCheck(
        rule,
        `Trip ${trip.id} has ${trip.confirmedCount} passengers but vehicle seats ${trip.vehicle.seatingCapacity}.`,
        {
          tripId: trip.id,
          confirmedCount: trip.confirmedCount,
          seatingCapacity: trip.vehicle.seatingCapacity,
        }
      )
    );
  }
  return out;
}

// ─── Zone loader helper (re-exported for facts loader) ──────────────

export function normaliseZoneFromPlaceRow(row: {
  id: string;
  name: string;
  shape: string;
  polygon: unknown;
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
}): (ZoneShape & { name: string }) | null {
  if (row.shape === 'POLYGON') {
    const poly = parsePolygonJson(row.polygon);
    if (!poly) return null;
    return { name: row.name, shape: 'POLYGON', polygon: poly };
  }
  if (row.shape === 'CIRCLE') {
    if (row.centerLat == null || row.centerLng == null || row.radiusM == null) return null;
    return {
      name: row.name,
      shape: 'CIRCLE',
      centerLat: row.centerLat,
      centerLng: row.centerLng,
      radiusM: row.radiusM,
    };
  }
  return null;
}
