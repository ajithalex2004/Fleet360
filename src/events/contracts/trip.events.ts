/**
 * Trip domain event contracts.
 * These types define the `data` payload inside DomainEventEnvelope<T>.
 */

export const TRIP_COMPLETED  = 'trip.completed'  as const;
export const TRIP_DEPARTED   = 'trip.departed'   as const;
export const TRIP_CANCELLED  = 'trip.cancelled'  as const;

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
