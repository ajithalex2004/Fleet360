/**
 * runcut.ts — Runcutting algorithm.
 *
 * What runcutting is:
 *   Take a set of vehicle trips (TripSchedule rows) and package them into
 *   "runs" (driver pieces-of-work). Each run is what one driver does in one
 *   shift — start with a trip from a depot, drive it, layover/deadhead to
 *   the next trip, drive it, etc. The output respects operator pay rules:
 *     - Max work hours per day (e.g. 8h)
 *     - Min break between trips (e.g. 30 min)
 *     - Max spread hours (e.g. 12h, from sign-on to sign-off)
 *     - Overtime threshold (e.g. >8h/day is paid at 1.5x)
 *
 * Algorithm (first-fit decreasing, with pay-rule validation):
 *   1. Sort trips by (date, departure time, route origin)
 *   2. For each trip, try to add it to an existing open run:
 *      - same date
 *      - enough spare work-time budget
 *      - departure time fits the run's open window
 *      - min break satisfied from previous trip's arrival
 *   3. If no run fits, open a new run starting at the depot for this trip
 *   4. Compute run metrics: pay hours, straight-time hours, OT hours, cost
 *
 * This is the standard textbook runcutting heuristic. It's optimal-ish for
 * the under-100-bus operators Fleet360 sells to today, and is the right
 * baseline before investing in constraint-programming solvers.
 */

export type ShiftType = 'MORNING' | 'EVENING' | 'NIGHT' | 'SPLIT';

/** A trip endpoint for zone-compatibility checks — mirrors ZonePoint in
 *  lib/planning/zone-compat.ts (kept as a separate type so this module
 *  doesn't need to import the planning layer just for a shape). */
export interface TripZonePoint {
  placeId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PlanTrip {
  id: string;
  routeId: string;
  routeName?: string;
  routeOrigin?: string;
  routeDestination?: string;
  departureTime: string;       // ISO
  arrivalTime: string | null;  // ISO
  durationMins: number;        // from arrival - departure
  distanceKm: number | null;
  shiftType: ShiftType | null;
  vehicleId: string | null;    // for blocking compatibility
  /** First/last stop coordinates — used by block.ts's optional zone-
   *  compatibility gate (only enforced when BlockOptions.zoneFallbackKm
   *  is set). Undefined here resolves to UNKNOWN in zoneCompatibility(),
   *  which fails the gate just like Case 2 (Vehicle/Resource
   *  Optimization) does — missing data doesn't get a free pass. */
  pickupPoint?: TripZonePoint;
  dropoffPoint?: TripZonePoint;
}

export interface WorkRules {
  maxWorkHoursPerDay: number;       // straight-time cap (e.g. 8)
  maxSpreadHoursPerDay: number;     // sign-on to sign-off (e.g. 12)
  minBreakBetweenTripsMins: number; // gap required between trip arrivals and next departures (e.g. 30)
  overtimeThresholdHours: number;   // hours over which OT kicks in (e.g. 8)
  overtimeRate: number;             // multiplier (e.g. 1.5)
  hourlyRate: number;               // AED per straight-time hour
  reportTimeMins: number;           // pre-trip report time (e.g. 15)
  wrapTimeMins: number;             // post-trip wrap time (e.g. 10)
  deadheadMinsBetweenTrips: number; // paid deadhead between trips (e.g. 15)
  maxTripsPerRun: number;           // hard cap, prevents runaway runs (e.g. 12)
}

export const DEFAULT_WORK_RULES: WorkRules = {
  maxWorkHoursPerDay: 8,
  maxSpreadHoursPerDay: 12,
  minBreakBetweenTripsMins: 30,
  overtimeThresholdHours: 8,
  overtimeRate: 1.5,
  hourlyRate: 25,
  reportTimeMins: 15,
  wrapTimeMins: 10,
  deadheadMinsBetweenTrips: 15,
  maxTripsPerRun: 12,
};

export interface RunTrip {
  tripId: string;
  routeId: string;
  routeName?: string;
  routeOrigin?: string;
  routeDestination?: string;
  departureTime: string;       // ISO
  arrivalTime: string | null;  // ISO
  durationMins: number;
  // Deadhead from the previous trip's arrival to this trip's departure
  deadheadMinsBefore: number;
}

export interface Run {
  id: string;                  // synthetic
  date: string;                // YYYY-MM-DD
  shiftType: ShiftType | null;
  tripIds: string[];           // ordered
  trips: RunTrip[];            // ordered, with metadata
  signOnMins: number;          // total paid minutes from report to last wrap
  workMins: number;            // sum of (trip duration + report + wrap) — actual driving + paid deadhead
  spreadMins: number;          // signOn to signOff (largest window)
  straightTimeMins: number;    // paid up to overtime threshold
  overtimeMins: number;        // paid over overtime threshold
  payMins: number;             // straightTimeMins + overtimeMins (without pay multiplier)
  payCost: number;             // AED
  notes: string[];             // human-readable pay-rule warnings
}

export interface RuncutResult {
  runs: Run[];
  unassignedTripIds: string[]; // trips that didn't fit in any run
  summary: {
    tripCount: number;
    runCount: number;
    avgTripsPerRun: number;
    avgWorkHours: number;
    totalPayHours: number;
    totalPayCost: number;
    overtimeHours: number;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

function minsBetween(aIso: string, bIso: string): number {
  return Math.max(0, Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000));
}

// A run's "work minutes" is the sum of:
//   - reportTimeMins (paid, once per run)
//   - each trip's durationMins (paid driving)
//   - wrapTimeMins (paid, once per run)
//   - deadhead between consecutive trips (paid)
function computeRunCost(run: RunTrip[], rules: WorkRules): {
  workMins: number; spreadMins: number; straightTimeMins: number; overtimeMins: number; payCost: number; payMins: number;
} {
  if (run.length === 0) return { workMins: 0, spreadMins: 0, straightTimeMins: 0, overtimeMins: 0, payCost: 0, payMins: 0 };

  // Work mins = report + each trip + deadhead + wrap
  const report = rules.reportTimeMins;
  const wrap = rules.wrapTimeMins;
  const drive = run.reduce((s, t) => s + t.durationMins, 0);
  const deadhead = run.reduce((s, t) => s + t.deadheadMinsBefore, 0);
  const workMins = report + drive + deadhead + wrap;

  // Spread mins = first departure to last arrival (sign-on to sign-off)
  const firstDep = new Date(run[0].departureTime).getTime();
  const lastArr  = new Date(run[run.length - 1].arrivalTime ?? run[run.length - 1].departureTime).getTime();
  // Add report (before first dep) and wrap (after last arr)
  const spreadMins = Math.round((lastArr - firstDep) / 60000) + report + wrap;

  // Pay: straight time up to threshold, then OT
  const thresholdMins = rules.overtimeThresholdHours * 60;
  const straightTimeMins = Math.min(workMins, thresholdMins);
  const overtimeMins = Math.max(0, workMins - thresholdMins);
  // Cost: straight paid at hourlyRate, OT at hourlyRate * overtimeRate
  const payCost =
    (straightTimeMins / 60) * rules.hourlyRate +
    (overtimeMins    / 60) * rules.hourlyRate * rules.overtimeRate;
  const payMins = straightTimeMins + overtimeMins;
  return { workMins, spreadMins, straightTimeMins, overtimeMins, payCost, payMins };
}

// ── Main algorithm ──────────────────────────────────────────────────────────

/**
 * Runcut a set of trips into driver pieces-of-work.
 *
 * @param trips   All trip candidates for the planning window. Should be
 *                sorted by departureTime in the caller (we re-sort here
 *                defensively).
 * @param rules   Operator pay rules. Defaults to DEFAULT_WORK_RULES.
 * @returns       A RuncutResult with runs, unassigned trips, and a summary.
 */
export function runcut(trips: PlanTrip[], rules: WorkRules = DEFAULT_WORK_RULES): RuncutResult {
  // 1. Defensive sort
  const sorted = [...trips].sort(
    (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime(),
  );

  // 2. State: open runs, indexed by date+shift for fast lookup
  type OpenRun = { date: string; shift: ShiftType; trips: RunTrip[]; };
  const open: OpenRun[] = [];
  let runCounter = 0;
  const newRunId = () => `run_${++runCounter}_${Date.now().toString(36)}`;
  const unassigned: string[] = [];

  // Group trips by date+shift so the inner loop only considers compatible runs
  for (const trip of sorted) {
    const tripDate = ymd(trip.departureTime);
    const tripShift = trip.shiftType ?? 'MORNING';
    const arrival = trip.arrivalTime ?? trip.departureTime;
    const tripDur = minsBetween(trip.departureTime, arrival);

    // Try to fit into an existing run (same date, same shift, no time conflict)
    let placed = false;
    for (const r of open) {
      if (r.date !== tripDate) continue;
      if (r.shift !== tripShift) continue;
      if (r.trips.length >= rules.maxTripsPerRun) continue;

      const last = r.trips[r.trips.length - 1];
      const lastArr = last.arrivalTime ?? last.departureTime;
      const breakMins = minsBetween(lastArr, trip.departureTime);
      if (breakMins < rules.minBreakBetweenTripsMins) continue;

      // Compute prospective cost if we add this trip
      const newTrip: RunTrip = {
        tripId: trip.id,
        routeId: trip.routeId,
        routeName: trip.routeName,
        routeOrigin: trip.routeOrigin,
        routeDestination: trip.routeDestination,
        departureTime: trip.departureTime,
        arrivalTime: arrival,
        durationMins: tripDur,
        deadheadMinsBefore: rules.deadheadMinsBetweenTrips,
      };
      const candidate = [...r.trips, newTrip];
      const cost = computeRunCost(candidate, rules);

      // Validate pay rules
      if (cost.workMins / 60 > rules.maxWorkHoursPerDay) continue;
      if (cost.spreadMins / 60 > rules.maxSpreadHoursPerDay) continue;

      r.trips.push(newTrip);
      placed = true;
      break;
    }

    if (!placed) {
      // Open a new run for this date+shift
      const firstTrip: RunTrip = {
        tripId: trip.id,
        routeId: trip.routeId,
        routeName: trip.routeName,
        routeOrigin: trip.routeOrigin,
        routeDestination: trip.routeDestination,
        departureTime: trip.departureTime,
        arrivalTime: arrival,
        durationMins: tripDur,
        deadheadMinsBefore: 0,
      };
      open.push({ date: tripDate, shift: tripShift, trips: [firstTrip] });
    }
  }

  // 3. Materialize open runs into Run objects
  const runs: Run[] = open.map((r) => {
    const cost = computeRunCost(r.trips, rules);
    const notes: string[] = [];
    if (cost.overtimeMins > 0) {
      notes.push(`${(cost.overtimeMins / 60).toFixed(1)}h overtime at ${rules.overtimeRate}× rate`);
    }
    if (r.trips.length === rules.maxTripsPerRun) {
      notes.push(`Run hit max-trip cap of ${rules.maxTripsPerRun}`);
    }
    return {
      id: newRunId(),
      date: r.date,
      shiftType: r.shift,
      tripIds: r.trips.map((t) => t.tripId),
      trips: r.trips,
      signOnMins: cost.workMins,
      workMins: cost.workMins,
      spreadMins: cost.spreadMins,
      straightTimeMins: cost.straightTimeMins,
      overtimeMins: cost.overtimeMins,
      payMins: cost.payMins,
      payCost: Math.round(cost.payCost * 100) / 100,
      notes,
    };
  });

  // 4. Summary
  const totalPayHours = runs.reduce((s, r) => s + r.payMins, 0) / 60;
  const totalPayCost = runs.reduce((s, r) => s + r.payCost, 0);
  const overtimeHours = runs.reduce((s, r) => s + r.overtimeMins, 0) / 60;
  const tripCount = sorted.length - unassigned.length;
  const avgWork = runs.length === 0 ? 0 : runs.reduce((s, r) => s + r.workMins, 0) / runs.length / 60;

  return {
    runs,
    unassignedTripIds: unassigned,
    summary: {
      tripCount,
      runCount: runs.length,
      avgTripsPerRun: runs.length === 0 ? 0 : tripCount / runs.length,
      avgWorkHours: Math.round(avgWork * 10) / 10,
      totalPayHours: Math.round(totalPayHours * 10) / 10,
      totalPayCost: Math.round(totalPayCost * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 10) / 10,
    },
  };
}
