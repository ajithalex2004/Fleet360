/**
 * Alert domain-event contract.
 *
 * Every module publishes ONE event type — `alert.condition_detected` —
 * with a `code` field identifying which condition tripped. This scales
 * cleaner than one event type per condition: the engine consumer
 * registers exactly once and routes internally, so adding a new
 * condition doesn't require a new consumer registration.
 *
 * Naming vs the module-specific trip events (`trip.departed`, etc.):
 * trip events describe *state transitions the business cares about*
 * (departed / cancelled / completed). Alert-condition events describe
 * *operational anomalies* (bus offline / overdue / breakdown). Some
 * conditions have a corresponding domain event, some don't.
 */

export const ALERT_CONDITION_DETECTED = 'alert.condition_detected' as const;

/**
 * Full catalogue of alert conditions Staff Transport publishes today
 * (plus room for peers). Codes are UPPER_SNAKE_CASE, module-agnostic.
 *
 * Sourcing:
 *   TRIP_OVERDUE           — schedule cron: scheduled arrival + tolerance passed with no completion
 *   VEHICLE_OFFLINE        — GPS ingest: no ping received for N minutes
 *   VEHICLE_BREAKDOWN      — driver-app breakdown report OR ops incident of type BREAKDOWN
 *   CAPACITY_EXCEEDED      — trip create/passenger-add: seated >= capacity
 *   MISSED_STOP            — stop-visit evaluator: bus never entered a scheduled stop's geofence
 *   DRIVER_ABSENT          — pre-trip: no driver check-in within N minutes of departure
 *   PASSENGER_ABSENT       — bus depart: CONFIRMED passengers flipped to NO_SHOW
 *   ROUTE_DEVIATION        — GPS evaluator: bus more than N metres off route corridor
 *   LATE_DEPARTURE         — depart: actual > scheduled + tolerance
 *   LATE_ARRIVAL           — arrive: actual > scheduled + tolerance (or trip.delayed with severity)
 *   VEHICLE_GROUNDED       — fleet expiry sweep: mandatory document past grace period, auto-grounded
 *   VEHICLE_RESTORED       — fleet expiry sweep: all mandatory documents valid again, auto-restored
 */
export const ALERT_CODES = [
  'TRIP_OVERDUE',
  'VEHICLE_OFFLINE',
  'VEHICLE_BREAKDOWN',
  'CAPACITY_EXCEEDED',
  'MISSED_STOP',
  'DRIVER_ABSENT',
  'PASSENGER_ABSENT',
  'ROUTE_DEVIATION',
  'LATE_DEPARTURE',
  'LATE_ARRIVAL',
  'VEHICLE_GROUNDED',
  'VEHICLE_RESTORED',
] as const;

export type AlertCondition = typeof ALERT_CODES[number];

export type AlertSubjectType =
  | 'TripSchedule'
  | 'Vehicle'
  | 'Driver'
  | 'TripPassenger'
  | 'Route'
  | 'RouteStop'
  | 'Other';

export type AlertSeverityOverride = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AlertConditionDetectedPayload {
  /** Machine-readable condition code (AlertCondition or ad-hoc string). */
  code:         string;
  /** e.g. 'bus-ops', 'fleet', 'maintenance'. Same convention as event source. */
  sourceModule: string;
  /** What the alert is *about* — used for filtering and UI grouping. */
  subjectType:  AlertSubjectType;
  subjectId:    string;
  /** Human-readable one-line summary. */
  title:        string;
  /** Optional longer description. */
  description?: string;
  /** Free-form context that gets stored on the Alert for UI + template rendering. */
  context?:     Record<string, unknown>;
  /**
   * Optional override — else the rule's defaultSeverity applies, else 'MEDIUM'.
   * Use when the condition itself carries urgency signal (a CRITICAL
   * breakdown vs. a MEDIUM offline).
   */
  severity?:    AlertSeverityOverride;
  /**
   * Optional dedup key — while an Alert with this key is OPEN, no new
   * one raises. Default: `${code}:${subjectId}`. Pass explicit key to
   * scope wider (e.g. one alert per vehicle per hour: `${code}:${vehicleId}:${hour}`).
   */
  dedupeKey?:   string;
}
