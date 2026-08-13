/**
 * state-machines — pure, tested state-machine helpers for bus-ops
 * lifecycle statuses.
 *
 * Postgres enums enforce the vocabulary (values that ARE allowed) but
 * nothing at the DB layer stops an illegal *transition* — e.g. going
 * ALIGHTED → CONFIRMED or COMPLETED → SCHEDULED. These helpers add that
 * missing guard: call `assertTripTransition(from, to)` (or the
 * passenger equivalent) in every PATCH before writing.
 *
 * Terminal states have empty allowed-next arrays. Attempting to
 * transition FROM a terminal state throws even if `to` looks valid.
 *
 * Pure module — no DB, no network, no Prisma import. Test with a truth
 * table (see tests/unit/bus-ops-state-machines.test.ts) so the entire
 * transition matrix is exercised on every CI run.
 */

// ── Trip lifecycle ──────────────────────────────────────────────────

export type TripScheduleStatus =
  | 'SCHEDULED'
  | 'DEPARTED'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * Rules:
 * - SCHEDULED  → DEPARTED (bus left) or CANCELLED (trip called off).
 *                SCHEDULED → COMPLETED is intentionally blocked — that
 *                path skips no-show marking + audit trail (audit risk).
 * - DEPARTED   → IN_TRANSIT (first stop reached / driver confirmed
 *                moving), COMPLETED (short/express trips with no
 *                intermediate stops), or CANCELLED
 * - IN_TRANSIT → COMPLETED (all stops visited) or CANCELLED
 * - COMPLETED  → terminal
 * - CANCELLED  → terminal
 */
const TRIP_TRANSITIONS: Readonly<Record<TripScheduleStatus, readonly TripScheduleStatus[]>> = {
  SCHEDULED:  ['DEPARTED', 'CANCELLED'],
  DEPARTED:   ['IN_TRANSIT', 'COMPLETED', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED', 'CANCELLED'],
  COMPLETED:  [],
  CANCELLED:  [],
} as const;

export function canTransitionTrip(from: TripScheduleStatus, to: TripScheduleStatus): boolean {
  if (from === to) return true; // idempotent no-op
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
  if (canTransitionTrip(from, to)) return;
  throw new TripTransitionError(from, to, TRIP_TRANSITIONS[from]);
}

// ── Passenger lifecycle ────────────────────────────────────────────

export type TripPassengerStatus =
  | 'CONFIRMED'
  | 'BOARDED'
  | 'ALIGHTED'
  | 'ABSENT'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'WAITLISTED';

/**
 * Rules:
 * - WAITLISTED → CONFIRMED (sweep-waitlist promoted them once capacity
 *                opened) or CANCELLED
 * - CONFIRMED  → BOARDED (checked in / detected by BLE) or ABSENT
 *                (bus reached their stop, they weren't there) or
 *                NO_SHOW (never showed up at all — set by
 *                schedules/[id]/depart) or CANCELLED
 * - BOARDED    → ALIGHTED (got off at drop-off stop)
 * - ALIGHTED, ABSENT, NO_SHOW, CANCELLED → terminal
 *
 * Note: ABSENT vs NO_SHOW split — ABSENT is bus-arrived-you-weren't-
 * there (per-stop miss); NO_SHOW is trip-departed-without-you (whole
 * trip miss). Both terminal.
 */
const PASSENGER_TRANSITIONS: Readonly<Record<TripPassengerStatus, readonly TripPassengerStatus[]>> = {
  WAITLISTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:  ['BOARDED', 'ABSENT', 'NO_SHOW', 'CANCELLED'],
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
  if (canTransitionPassenger(from, to)) return;
  throw new PassengerTransitionError(from, to, PASSENGER_TRANSITIONS[from]);
}

// ── Introspection helpers (used by tests + admin UIs) ──────────────

export function allowedTripTransitions(from: TripScheduleStatus): readonly TripScheduleStatus[] {
  return TRIP_TRANSITIONS[from];
}
export function allowedPassengerTransitions(from: TripPassengerStatus): readonly TripPassengerStatus[] {
  return PASSENGER_TRANSITIONS[from];
}
export function isTripTerminal(s: TripScheduleStatus): boolean {
  return TRIP_TRANSITIONS[s].length === 0;
}
export function isPassengerTerminal(s: TripPassengerStatus): boolean {
  return PASSENGER_TRANSITIONS[s].length === 0;
}
