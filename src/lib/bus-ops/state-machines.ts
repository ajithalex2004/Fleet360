/**
 * state-machines — pure, tested state-machine helpers for bus-ops
 * lifecycle statuses.
 *
 * Status vocabulary (product language):
 *   SCHEDULED → STARTED → EN_ROUTE → COMPLETED
 *   (CANCELLED is a terminal side-path from non-terminal states)
 *
 * Postgres stores free-text status on trip_schedules; these helpers
 * enforce legal *transitions* that the DB cannot.
 */

export type TripScheduleStatus =
  | 'SCHEDULED'
  | 'STARTED'
  | 'EN_ROUTE'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * Rules:
 * - SCHEDULED  → STARTED (trip began) or CANCELLED
 * - STARTED    → EN_ROUTE (moving between stops), COMPLETED (short trip), or CANCELLED
 * - EN_ROUTE   → COMPLETED or CANCELLED
 * - COMPLETED / CANCELLED → terminal
 */
const TRIP_TRANSITIONS: Readonly<Record<TripScheduleStatus, readonly TripScheduleStatus[]>> = {
  SCHEDULED:  ['STARTED', 'CANCELLED'],
  STARTED:    ['EN_ROUTE', 'COMPLETED', 'CANCELLED'],
  EN_ROUTE:   ['COMPLETED', 'CANCELLED'],
  COMPLETED:  [],
  CANCELLED:  [],
} as const;

export function canTransitionTrip(from: TripScheduleStatus, to: TripScheduleStatus): boolean {
  if (from === to) return true;
  return TRIP_TRANSITIONS[from]?.includes(to) ?? false;
}

export class TripTransitionError extends Error {
  constructor(
    public readonly from: TripScheduleStatus,
    public readonly to: TripScheduleStatus,
    public readonly allowed: readonly TripScheduleStatus[],
  ) {
    super(
      `Illegal trip status transition ${from} → ${to}. ` +
      (allowed.length ? `Allowed from ${from}: ${allowed.join(', ')}.` : `${from} is a terminal state.`),
    );
    this.name = 'TripTransitionError';
  }
}

export function assertTripTransition(from: TripScheduleStatus, to: TripScheduleStatus): void {
  if (!canTransitionTrip(from, to)) {
    throw new TripTransitionError(from, to, TRIP_TRANSITIONS[from] ?? []);
  }
}

/** Map legacy DB values still present mid-migration. */
export function normalizeTripStatus(raw: string | null | undefined): TripScheduleStatus {
  const s = (raw ?? 'SCHEDULED').toUpperCase();
  if (s === 'DEPARTED') return 'STARTED';
  if (s === 'IN_TRANSIT') return 'EN_ROUTE';
  if (
    s === 'SCHEDULED' ||
    s === 'STARTED' ||
    s === 'EN_ROUTE' ||
    s === 'COMPLETED' ||
    s === 'CANCELLED'
  ) {
    return s;
  }
  return 'SCHEDULED';
}

// ── Passenger lifecycle ─────────────────────────────────────────────

export type TripPassengerStatus =
  | 'WAITLISTED'
  | 'CONFIRMED'
  | 'BOARDED'
  | 'ALIGHTED'
  | 'ABSENT'
  | 'NO_SHOW'
  | 'CANCELLED';

/**
 * Rules:
 * - WAITLISTED → CONFIRMED (sweep-waitlist promoted them once capacity
 *                opened) or CANCELLED
 * - CONFIRMED  → BOARDED (checked in / detected by BLE) or ABSENT
 *                (bus reached their stop, they weren't there) or
 *                NO_SHOW (never showed up at all — set by
 *                schedules/[id]/depart) or CANCELLED
 * - BOARDED    → ALIGHTED (got off at drop-off stop)
 * - ABSENT     → BOARDED (caught the same bus at a LATER stop) or
 *                CANCELLED
 * - ALIGHTED, NO_SHOW, CANCELLED → terminal
 *
 * ABSENT vs NO_SHOW: ABSENT is bus-arrived-you-weren't-there — a
 * per-stop miss, recorded when the vehicle leaves the passenger's
 * assigned stop without detecting them. NO_SHOW is
 * trip-departed-without-you, a whole-trip miss.
 *
 * ABSENT is deliberately NOT terminal. Missing one stop says nothing
 * about the rest of the route: a rider who misses their assigned stop
 * can walk to the next one and board the same bus, at which point the
 * BLE gateway detects their tag and they are genuinely aboard. While
 * ABSENT was terminal the manifest stayed permanently wrong for those
 * riders and headcount disagreed with who was physically on the vehicle.
 *
 * The later boarding does not erase the earlier absence. It stays in
 * boarding_events as its own row (direction ABSENT, carrying the stop
 * id), so attendance reporting still sees "missed their assigned stop"
 * while the current status correctly reads BOARDED. Status answers
 * "where are they now"; the event log answers "what happened".
 *
 * BOARDED → ABSENT stays illegal. Someone already aboard cannot become
 * absent from a stop the vehicle has left, and allowing it would
 * conflate a detection correction with a genuine miss — making absence
 * rates unusable for the SLA reporting they feed.
 */
const PASSENGER_TRANSITIONS: Readonly<Record<TripPassengerStatus, readonly TripPassengerStatus[]>> = {
  WAITLISTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:  ['BOARDED', 'ABSENT', 'NO_SHOW', 'CANCELLED'],
  // NOTE: BOARDED → ABSENT is deliberately NOT allowed here. Local work
  // had added it, but unlike the trip-status rename below it isn't backed
  // by a migration or contract — letting a boarded passenger be marked
  // absent is a business-rule decision, not a naming reconciliation. Kept
  // at main's behaviour pending an explicit product call.
  BOARDED:    ['ALIGHTED'],
  ALIGHTED:   [],
  ABSENT:     ['BOARDED', 'CANCELLED'],
  NO_SHOW:    [],
  CANCELLED:  [],
} as const;

export function canTransitionPassenger(from: TripPassengerStatus, to: TripPassengerStatus): boolean {
  if (from === to) return true;
  return PASSENGER_TRANSITIONS[from]?.includes(to) ?? false;
}

export class PassengerTransitionError extends Error {
  constructor(
    public readonly from: TripPassengerStatus,
    public readonly to: TripPassengerStatus,
    public readonly allowed: readonly TripPassengerStatus[],
  ) {
    super(
      `Illegal passenger status transition ${from} → ${to}. ` +
      (allowed.length ? `Allowed from ${from}: ${allowed.join(', ')}.` : `${from} is a terminal state.`),
    );
    this.name = 'PassengerTransitionError';
  }
}

export function assertPassengerTransition(from: TripPassengerStatus, to: TripPassengerStatus): void {
  if (!canTransitionPassenger(from, to)) {
    throw new PassengerTransitionError(from, to, PASSENGER_TRANSITIONS[from] ?? []);
  }
}

export function isPassengerTerminal(status: TripPassengerStatus): boolean {
  return PASSENGER_TRANSITIONS[status].length === 0;
}

/**
 * Get allowed next statuses for a passenger in a given status.
 */
export function allowedPassengerTransitions(status: TripPassengerStatus): readonly TripPassengerStatus[] {
  return PASSENGER_TRANSITIONS[status] ?? [];
}
