/**
 * Fleet Routing — shared types for the Google Cloud Route Optimization
 * integration.
 *
 * Two type families:
 *   1. Domain (Fleet360-owned): what our code manipulates. RunStatus,
 *      ResolvedTimeWindow, ShipmentInput, VehicleInput.
 *   2. Google API surface: TypeScript shapes of the OptimizeToursRequest /
 *      OptimizeToursResponse and Routes API v2 responses. Kept minimal
 *      (only fields we consume) — the raw JSON is preserved on
 *      FleetOptimizationRun.rawResponse for full traceability.
 */

// ── Run lifecycle ───────────────────────────────────────────────────────────

export type RunStatus =
  | 'PENDING'      // queued, not started
  | 'VALIDATING'   // checking input data / building matrix
  | 'SOLVING'      // sent to Google, awaiting response
  | 'SUCCESS'      // solver returned optimal/feasible solution
  | 'INFEASIBLE'   // solver returned but no solution exists (math/operational)
  | 'FAILED'       // API/network/auth error
  | 'CANCELLED'    // operator aborted
  | 'PUBLISHED';   // SUCCESS + committed to TripSchedules

export type UnassignedReason =
  | 'NO_VEHICLE_HAS_CAPACITY'
  | 'OUTSIDE_ALL_TIME_WINDOWS'
  | 'CANNOT_MEET_REQUIRED_ARRIVAL'
  | 'WOULD_BREAK_MAX_DRIVE_TIME'
  | 'INFEASIBLE_OTHER';

// ── Time-window resolver output ─────────────────────────────────────────────

/**
 * The resolved effective window for a single passenger, after walking the
 * sourcing hierarchy (RoutePassenger override → BusRoute → Tenant default).
 * All times are ISO-8601 with timezone (UTC storage; tenant TZ is applied
 * upstream when converting HH:MM strings to timestamps).
 */
export interface ResolvedTimeWindow {
  earliestPickup: string;    // ISO-8601
  latestPickup:   string;    // ISO-8601
  /** Hard: solver must ensure the vehicle reaches the workplace by this time. */
  requiredArrival: string;   // ISO-8601
  /** For debugging / audit — which level of the hierarchy provided each field. */
  provenance: {
    earliestPickup: 'passenger' | 'route' | 'tenant' | 'fallback';
    latestPickup:   'passenger' | 'route' | 'tenant' | 'fallback';
    requiredArrival: 'passenger' | 'route' | 'tenant' | 'fallback';
  };
}

// ── Solver input shapes (Fleet360-side, pre-Google translation) ─────────────

export interface ShipmentInput {
  /** Fleet360 RoutePassenger id (or null for ad-hoc). */
  passengerId: string | null;
  /** Where to pick up. */
  pickup: { lat: number; lng: number; label: string; stopId?: string };
  /** Where to drop off (usually the workplace / office). */
  delivery: { lat: number; lng: number; label: string };
  window: ResolvedTimeWindow;
  /** How many seats this shipment consumes (1 per passenger typically). */
  demand: number;
}

export interface VehicleInput {
  /** Fleet360 Vehicle id. */
  vehicleId: string;
  driverId: string | null;
  /** Depot start location — where the bus begins its shift. */
  start: { lat: number; lng: number; label: string };
  /** Depot end location — where the bus finishes. Often == start. */
  end:   { lat: number; lng: number; label: string };
  /** Seat capacity. */
  capacity: number;
  /** Earliest the vehicle can start a shift (ISO-8601). */
  earliestStart: string;
  /** Latest the vehicle must end its shift by (ISO-8601). */
  latestEnd: string;
}

// ── Google Route Optimization API — minimal surface we consume ──────────────
//
// See: https://cloud.google.com/optimization/docs/reference/rest/v1/projects/optimizeTours

export interface GoogleOptimizeToursRequest {
  parent: string;                      // 'projects/{project_id}'
  model: {
    shipments: GoogleShipment[];
    vehicles: GoogleVehicle[];
    globalStartTime?: string;          // ISO-8601
    globalEndTime?: string;
    globalDurationCostPerHour?: number;
  };
  /** Wall-clock budget for the solver. */
  timeout?: string;                    // e.g. '30s'
  populatePolylines?: boolean;
}

export interface GoogleShipment {
  pickups?: GoogleVisitRequest[];
  deliveries?: GoogleVisitRequest[];
  loadDemands?: Record<string, { amount: string }>;  // Google uses stringified numbers
  penaltyCost?: number;
  label?: string;
}

export interface GoogleVisitRequest {
  arrivalLocation?: { latitude: number; longitude: number };
  duration?: string;                   // e.g. '60s' service time
  timeWindows?: GoogleTimeWindow[];
  cost?: number;
  label?: string;
}

export interface GoogleTimeWindow {
  startTime?: string;                  // ISO-8601
  endTime?: string;
}

export interface GoogleVehicle {
  startLocation: { latitude: number; longitude: number };
  endLocation?: { latitude: number; longitude: number };
  startTimeWindows?: GoogleTimeWindow[];
  endTimeWindows?: GoogleTimeWindow[];
  loadLimits?: Record<string, { maxLoad: string }>;
  costPerHour?: number;
  costPerKilometer?: number;
  label?: string;
}

export interface GoogleOptimizeToursResponse {
  routes?: GoogleRoute[];
  skippedShipments?: GoogleSkippedShipment[];
  metrics?: {
    aggregatedRouteMetrics?: {
      totalDistanceMeters?: number;
      totalDuration?: string;
      travelDuration?: string;
    };
    skippedMandatoryShipmentCount?: number;
  };
  requestLabel?: string;
  /** Google's status enum for the overall solve. */
  totalCost?: number;
}

export interface GoogleRoute {
  vehicleIndex?: number;
  vehicleLabel?: string;
  visits?: GoogleVisit[];
  routePolyline?: { points?: string };  // encoded polyline
  metrics?: {
    totalDistanceMeters?: number;
    totalDuration?: string;
    travelDuration?: string;
  };
  vehicleStartTime?: string;
  vehicleEndTime?: string;
}

export interface GoogleVisit {
  shipmentIndex?: number;
  shipmentLabel?: string;
  isPickup?: boolean;
  visitRequestIndex?: number;
  startTime?: string;
  loadDemands?: Record<string, { amount: string }>;
}

export interface GoogleSkippedShipment {
  index?: number;
  label?: string;
  /** Google's reason enum: WRONG_FORMAT | INDEX_OUT_OF_BOUNDS | ...
   *  or infeasibility codes. Full list is broad; we normalise to
   *  UnassignedReason in the parser. */
  reasons?: Array<{ code?: string; example?: string }>;
}

// ── Google Routes API v2 (computeRouteMatrix + computeRoutes) ──────────────

export interface RouteMatrixOrigin {
  waypoint: {
    location: { latLng: { latitude: number; longitude: number } };
  };
  routeModifiers?: {
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    avoidFerries?: boolean;
  };
}

export interface RouteMatrixDestination {
  waypoint: {
    location: { latLng: { latitude: number; longitude: number } };
  };
}

export interface RouteMatrixRequest {
  origins: RouteMatrixOrigin[];
  destinations: RouteMatrixDestination[];
  travelMode: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
  routingPreference?: 'TRAFFIC_UNAWARE' | 'TRAFFIC_AWARE' | 'TRAFFIC_AWARE_OPTIMAL';
  departureTime?: string;              // ISO-8601 — required for traffic-aware
}

export interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  status?: { code?: number; message?: string };
  distanceMeters?: number;
  duration?: string;                    // e.g. '600s'
  condition?: 'ROUTE_EXISTS' | 'ROUTE_NOT_FOUND';
}
