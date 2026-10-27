/**
 * One vocabulary for trip_schedules.status.
 *
 * Two state machines write this column: Bus Ops (src/lib/bus-ops/
 * state-machines.ts — SCHEDULED → STARTED → EN_ROUTE → COMPLETED) and the
 * driver app (src/lib/trip-state.ts — SCHEDULED → IN_PROGRESS → COMPLETED).
 * Older rows also carry DEPARTED / IN_TRANSIT. Every reader used its own
 * subset, so a trip started by one side was invisible to the other: the
 * driver app could not end a STARTED trip, auto-close only swept
 * IN_PROGRESS, the overdue alert skipped IN_PROGRESS, and telematics never
 * matched pings to an IN_PROGRESS trip.
 *
 * Writers keep their own words; readers go through these sets so every
 * spelling of "under way" means the same thing everywhere.
 */

/** Every stored spelling of "the trip is under way". */
export const TRIP_IN_FLIGHT_STATUSES = ['STARTED', 'EN_ROUTE', 'IN_PROGRESS', 'DEPARTED', 'IN_TRANSIT'] as const;

/** Not yet finished: scheduled or under way. */
export const TRIP_OPEN_STATUSES = ['SCHEDULED', ...TRIP_IN_FLIGHT_STATUSES] as const;

const IN_FLIGHT = new Set<string>(TRIP_IN_FLIGHT_STATUSES);

export function isTripInFlight(status: string | null | undefined): boolean {
  return IN_FLIGHT.has((status ?? '').trim().toUpperCase());
}

/** SQL list literal for raw queries, e.g. `status IN (${TRIP_IN_FLIGHT_SQL})`. */
export const TRIP_IN_FLIGHT_SQL = TRIP_IN_FLIGHT_STATUSES.map((s) => `'${s}'`).join(', ');
export const TRIP_OPEN_SQL = TRIP_OPEN_STATUSES.map((s) => `'${s}'`).join(', ');
