/**
 * src/lib/trip-state.ts
 *
 * The driver-controlled trip lifecycle state machine + late / early /
 * on-time classification.
 *
 * The state machine is intentionally tiny and pure — no DB calls, no
 * Date.now(), just shape transformations. The API endpoints wrap
 * these with the actual transaction logic and side effects. This
 * makes the rules cheap to unit-test (tests/integration imports
 * these helpers directly) and easy to reason about.
 *
 * Allowed transitions:
 *   SCHEDULED  --[START]-->   IN_PROGRESS
 *   IN_PROGRESS --[END]-->    COMPLETED
 *   COMPLETED  --[RESTART]--> IN_PROGRESS
 *
 * Anything else returns { allowed: false, reason }. The API maps
 * that to a 409 Conflict with a clear message for the driver.
 *
 * Late / early / on-time classification uses a 5-minute window by
 * default. A trip is:
 *   - "early"  if actual < scheduled - window
 *   - "late"   if actual > scheduled + window
 *   - "on_time" otherwise
 * The window is per-call (not hardcoded) so tenants can configure
 * tighter rules later.
 */

export type TripStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type TripTransition = 'START' | 'END' | 'RESTART' | 'CANCEL';

export interface TransitionInput {
  currentStatus: TripStatus;
  transition: TripTransition;
}

export interface TransitionResult {
  allowed: boolean;
  nextStatus?: TripStatus;
  reason?: string;
}

export function evaluateTransition(input: TransitionInput): TransitionResult {
  const { currentStatus, transition } = input;

  if (transition === 'START') {
    if (currentStatus === 'SCHEDULED') return { allowed: true, nextStatus: 'IN_PROGRESS' };
    if (currentStatus === 'IN_PROGRESS') {
      // Idempotent: driver tapped Start twice (slow network).
      return { allowed: true, nextStatus: 'IN_PROGRESS' };
    }
    if (currentStatus === 'COMPLETED') {
      // Driver wants to restart a completed trip. They must use RESTART.
      return { allowed: false, reason: 'Trip is already completed. Tap Restart to drive it again.' };
    }
    return { allowed: false, reason: `Cannot start a ${currentStatus.toLowerCase()} trip` };
  }

  if (transition === 'END') {
    if (currentStatus === 'IN_PROGRESS') return { allowed: true, nextStatus: 'COMPLETED' };
    if (currentStatus === 'COMPLETED') {
      // Idempotent.
      return { allowed: true, nextStatus: 'COMPLETED' };
    }
    if (currentStatus === 'SCHEDULED') {
      return { allowed: false, reason: 'Trip has not started yet. Tap Start first.' };
    }
    return { allowed: false, reason: `Cannot end a ${currentStatus.toLowerCase()} trip` };
  }

  if (transition === 'RESTART') {
    if (currentStatus === 'COMPLETED') return { allowed: true, nextStatus: 'IN_PROGRESS' };
    if (currentStatus === 'IN_PROGRESS') {
      return { allowed: true, nextStatus: 'IN_PROGRESS' };
    }
    return { allowed: false, reason: `Cannot restart a ${currentStatus.toLowerCase()} trip` };
  }

  if (transition === 'CANCEL') {
    if (currentStatus === 'CANCELLED') {
      return { allowed: true, nextStatus: 'CANCELLED' };
    }
    return { allowed: true, nextStatus: 'CANCELLED' };
  }

  return { allowed: false, reason: `Unknown transition: ${transition}` };
}

// ──────────────────────────────────────────────────────────────────────
// Late / early / on-time classifier
// ──────────────────────────────────────────────────────────────────────

export type TripTiming = 'on_time' | 'late' | 'early' | 'unknown';

export interface TimingResult {
  timing: TripTiming;
  /** Positive = late, negative = early. Zero = exactly on schedule. */
  deltaMinutes: number;
  /** Human-readable: "5 min late", "2 min early", "on time". */
  label: string;
}

const DEFAULT_WINDOW_MINUTES = 5;

export function classifyTiming(
  scheduledIso: string,
  actualIso: string,
  windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): TimingResult {
  const sched = new Date(scheduledIso).getTime();
  const actual = new Date(actualIso).getTime();
  if (Number.isNaN(sched) || Number.isNaN(actual)) {
    return { timing: 'unknown', deltaMinutes: 0, label: 'unknown' };
  }
  const deltaMs = actual - sched;
  const deltaMinutes = Math.round(deltaMs / 60_000);
  if (deltaMinutes > windowMinutes) {
    return { timing: 'late', deltaMinutes, label: `${deltaMinutes} min late` };
  }
  if (deltaMinutes < -windowMinutes) {
    return { timing: 'early', deltaMinutes, label: `${Math.abs(deltaMinutes)} min early` };
  }
  return { timing: 'on_time', deltaMinutes, label: 'on time' };
}

// ──────────────────────────────────────────────────────────────────────
// Trip-card UI helpers (used by the today page + tests)
// ──────────────────────────────────────────────────────────────────────

export interface StartButtonState {
  label: string;
  variant: 'primary' | 'secondary' | 'disabled';
  /** The action the button triggers. NULL means no action — e.g. for
   *  a completed trip (read-only) or a cancelled trip. The RESTART
   *  transition is intentionally not exposed to the driver app —
   *  the dispatcher can re-open a trip via the admin if needed. */
  action: 'START' | 'END' | null;
  helperLine: string | null;
  timing: TripTiming;
  deltaMinutes: number;
  actualIso: string | null;
}

export function startButtonState(input: {
  status: TripStatus;
  scheduledDeparture: string;
  actualDeparture: string | null;
  actualArrival: string | null;
  durationMinutes: number | null;
  windowMinutes?: number;
}): StartButtonState {
  const { status, scheduledDeparture, actualDeparture, actualArrival, durationMinutes } = input;
  const w = input.windowMinutes ?? DEFAULT_WINDOW_MINUTES;

  if (status === 'SCHEDULED') {
    return {
      label: '▶ Start trip',
      variant: 'primary',
      action: 'START',
      helperLine: 'Tap when you begin the trip. We\'ll record the actual departure time.',
      timing: 'unknown',
      deltaMinutes: 0,
      actualIso: null,
    };
  }

  if (status === 'IN_PROGRESS') {
    const timing = actualDeparture
      ? classifyTiming(scheduledDeparture, actualDeparture, w)
      : { timing: 'unknown' as TripTiming, deltaMinutes: 0, label: 'unknown' };
    return {
      label: '■ End trip',
      variant: 'primary',
      action: 'END',
      helperLine: actualDeparture
        ? `Started ${new Date(actualDeparture).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${timing.label}. Tap when all passengers are dropped off.`
        : 'Tap when all passengers are dropped off.',
      timing: timing.timing,
      deltaMinutes: timing.deltaMinutes,
      actualIso: actualDeparture,
    };
  }

  if (status === 'COMPLETED') {
    return {
      label: '✓ Completed',
      variant: 'secondary',
      action: null,  // no restart from the driver app — the dispatcher
                     // can re-open a trip via the admin if needed
      helperLine: actualArrival
        ? `Completed ${new Date(actualArrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${durationMinutes != null ? ` · ${durationMinutes} min` : ''}.`
        : 'Completed.',
      timing: 'unknown',
      deltaMinutes: 0,
      actualIso: actualArrival,
    };
  }

  if (status === 'CANCELLED') {
    return {
      label: 'Cancelled',
      variant: 'disabled',
      action: null,
      helperLine: 'This trip was cancelled by the dispatcher.',
      timing: 'unknown',
      deltaMinutes: 0,
      actualIso: null,
    };
  }

  return {
    label: 'Unknown',
    variant: 'disabled',
    action: null,
    helperLine: null,
    timing: 'unknown',
    deltaMinutes: 0,
    actualIso: null,
  };
}

/** CSS classes for the timing chip on the trip card. */
export function timingChipClass(timing: TripTiming): string {
  if (timing === 'late') return 'bg-rose-500/15 text-rose-300';
  if (timing === 'early') return 'bg-sky-500/15 text-sky-300';
  if (timing === 'on_time') return 'bg-emerald-500/15 text-emerald-300';
  return 'bg-slate-500/15 text-slate-300';
}
