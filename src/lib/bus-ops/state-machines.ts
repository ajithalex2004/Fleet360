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
  ABSENT:     [],
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
