/**
 * Trip domain event contracts.
 * These types define the `data` payload inside DomainEventEnvelope<T>.
 *
 * The full trip-lifecycle event surface Staff Transport publishes:
 *   trip.scheduled       — (implicit today; add if a consumer needs it)
 *   trip.cancelled       — Ops cancelled before departure
 *   trip.departed        — Bus rolled from origin
 *   trip.arriving        — Bus within N minutes of a stop / destination
 *   trip.delayed         — Bus behind schedule beyond tolerance
 *   trip.completed       — Bus reached final stop, trip log finalised
 *   vehicle.changed      — Assigned vehicle swapped mid-trip or pre-departure
 *   driver.changed       — Assigned driver swapped mid-trip or pre-departure
 *   boarding.missed      — Passenger's stop passed without a BOARDED event
 *
 * The Notification Engine (src/events/consumers/trip-notification.consumer.ts)
 * turns these into Push / SMS / WhatsApp / Email / In-app messages via the
 * NotificationRule table.
 */

export const TRIP_COMPLETED  = 'trip.completed'  as const;
export const TRIP_DEPARTED   = 'trip.departed'   as const;
export const TRIP_CANCELLED  = 'trip.cancelled'  as const;
export const TRIP_ARRIVING   = 'trip.arriving'   as const;
export const TRIP_DELAYED    = 'trip.delayed'    as const;
export const VEHICLE_CHANGED = 'vehicle.changed' as const;
export const DRIVER_CHANGED  = 'driver.changed'  as const;
export const BOARDING_MISSED = 'boarding.missed' as const;

export interface TripCompletedPayload {
  /** trip_schedules.id */
  scheduleId:          string;
  tripNumber:          string | null;
  vehicleId:           string | null;
  driverId:            string | null;
  /** trip_logs.id — the log row written on completion */
  tripLogId:           string;
  fuelUsed:            number | null;
  passengersBoarded:   number | null;
  /** AED per head — 0 when no fare is collected (staff transport) */
  farePerHead:         number;
  actualDepartureTime: string | null;  // ISO 8601
  actualArrivalTime:   string | null;
  endMileage:          number | null;
}

export interface TripDepartedPayload {
  scheduleId:          string;
  tripNumber:          string | null;
  vehicleId:           string | null;
  driverId:            string | null;
  /** trip_logs.id created at departure */
  tripLogId:           string;
  actualDepartureTime: string;   // ISO 8601
  startMileage:        number | null;
  /** Passengers auto-flipped to NO_SHOW at bus door-close */
  noShowsMarked:       number;
}

export interface TripCancelledPayload {
  scheduleId:  string;
  tripNumber:  string | null;
  vehicleId:   string | null;
  driverId:    string | null;
  reason:      string | null;
  cancelledAt: string;  // ISO 8601
}

/**
 * Bus is approaching a stop or the final destination. Published by the
 * ETA evaluator when the bus enters a "notify window" (minutes-to-arrival
 * crosses a threshold — default 5 min). Sent once per stop per trip.
 */
export interface TripArrivingPayload {
  scheduleId:  string;
  tripNumber:  string | null;
  vehicleId:   string | null;
  driverId:    string | null;
  routeId:     string | null;
  /** Stop the bus is approaching. Null when the trip has a single destination. */
  stopId:      string | null;
  stopName:    string | null;
  /** ETA at that stop (ISO 8601). */
  etaAt:       string;
  /** Distance remaining in metres (approx). Null when unknown. */
  distanceM:   number | null;
  minutesToArrival: number;
}

/**
 * Bus is running late. Published by the ETA evaluator when
 * (predicted arrival - scheduled arrival) exceeds the delay tolerance
 * (default 5 min). Sent at most once per stop per trip to avoid spam.
 */
export interface TripDelayedPayload {
  scheduleId:  string;
  tripNumber:  string | null;
  vehicleId:   string | null;
  driverId:    string | null;
  routeId:     string | null;
  /** Stop being missed. Null when the delay is for final arrival. */
  stopId:      string | null;
  stopName:    string | null;
  scheduledAt: string;    // ISO 8601
  predictedAt: string;    // ISO 8601
  delayMinutes: number;
  /** Why we think it's delayed — 'traffic' | 'gps-lost' | 'unknown'. */
  reason:      'traffic' | 'gps-lost' | 'unknown';
}

/**
 * Assigned vehicle changed. Published from the trip PATCH handler when
 * `vehicleId` changes on a TripSchedule. Passengers, driver, and ops
 * all care about this — the actual bus is different from the one they
 * were told about.
 */
export interface VehicleChangedPayload {
  scheduleId:  string;
  tripNumber:  string | null;
  previousVehicleId: string | null;
  newVehicleId:      string | null;
  driverId:    string | null;
  /** Free-text reason ops entered when swapping (breakdown, etc.). */
  reason:      string | null;
  changedAt:   string;    // ISO 8601
}

/**
 * Assigned driver changed. Same trigger pattern as VehicleChangedPayload
 * but for driverId.
 */
export interface DriverChangedPayload {
  scheduleId:  string;
  tripNumber:  string | null;
  vehicleId:   string | null;
  previousDriverId: string | null;
  newDriverId:      string | null;
  reason:      string | null;
  changedAt:   string;    // ISO 8601
}

/**
 * A passenger's stop passed without a BOARDED event. Published by the
 * stop-visit evaluator when a bus leaves a stop and there are
 * still-CONFIRMED passengers for that stop. Fires per (passenger, stop)
 * so the notification engine can route to that passenger's channels.
 */
export interface BoardingMissedPayload {
  scheduleId:  string;
  tripNumber:  string | null;
  vehicleId:   string | null;
  passengerId: string;
  staffMemberId: string | null;
  employeeId:  string | null;
  employeeName: string | null;
  stopId:      string | null;
  stopName:    string | null;
  /** When the bus left the stop without boarding this passenger. */
  missedAt:    string;    // ISO 8601
}
