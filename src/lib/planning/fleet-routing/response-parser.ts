/**
 * Fleet Routing — Google response → structured tables.
 *
 * Google's OptimizeToursResponse is a nested JSON blob. We keep it raw on
 * FleetOptimizationRun.rawResponse for traceability, AND parse it into
 * the FleetOptimizationRunRoute / RunStop / RunUnassigned tables so it's
 * queryable, indexable, and RLS-friendly.
 *
 * Two paths:
 *   parseSuccess() — when Google returned 200 and produced routes/skips
 *   normaliseSkipReason() — maps Google's reason codes to our enum so
 *                            the UI can render targeted remediation copy
 */

import type {
  GoogleOptimizeToursResponse,
  GoogleRoute,
  GoogleSkippedShipment,
  ShipmentInput,
  UnassignedReason,
} from './types';
import { parseShipmentLabel, parseVehicleLabel } from './input-builder';

export interface ParsedRoute {
  vehicleId:        string;
  driverId:         string | null;
  sequenceInRun:    number;
  totalDistanceKm:  number;
  totalDurationMin: number;
  totalPassengers:  number;
  encodedPolyline:  string;
  startTime:        Date;
  endTime:          Date;
  stops:            ParsedStop[];
}

export interface ParsedStop {
  sequence:       number;
  stopId:         string | null;
  lat:            number;
  lng:            number;
  label:          string;
  arrivalTime:    Date;
  departureTime:  Date;
  passengerCount: number;
  passengerIds:   string[];
}

export interface ParsedUnassigned {
  passengerId:  string | null;
  stopLat:      number;
  stopLng:      number;
  stopLabel:    string;
  reason:       UnassignedReason;
  reasonDetail: string | null;
}

export interface ParsedRunResult {
  routes:     ParsedRoute[];
  unassigned: ParsedUnassigned[];
  metrics: {
    totalDistanceKm:  number;
    totalDurationMin: number;
    unassignedCount:  number;
    solveSec:         number;
  };
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Parse a Google response into structured tables. `originalShipments` is
 * the same array we sent in the request — needed to reattach pickup
 * coords + driver-id lookup since Google's visits don't echo them back.
 */
export function parseSuccess(
  raw: GoogleOptimizeToursResponse,
  originalShipments: ShipmentInput[],
  vehicleDriverLookup: Map<string, string | null>,   // vehicleId → driverId
  solveSec: number,
): ParsedRunResult {
  const routes = (raw.routes ?? [])
    .map((r, i) => parseRoute(r, i, originalShipments, vehicleDriverLookup))
    .filter((r): r is ParsedRoute => r !== null);

  const unassigned = (raw.skippedShipments ?? [])
    .map(s => parseSkip(s, originalShipments))
    .filter((u): u is ParsedUnassigned => u !== null);

  return {
    routes,
    unassigned,
    metrics: {
      totalDistanceKm:  metersToKmRounded(raw.metrics?.aggregatedRouteMetrics?.travelDistanceMeters),
      totalDurationMin: durationToMinRounded(raw.metrics?.aggregatedRouteMetrics?.totalDuration),
      unassignedCount:  unassigned.length,
      solveSec,
    },
  };
}

/**
 * Public helper: given a Google skip reason (from raw response) return the
 * normalised Fleet360 enum + free-text detail. Used both by parseSkip and
 * by the spike endpoint for infeasibility diagnostics.
 */
export function normaliseSkipReason(reasons?: Array<{ code?: string; example?: string }>): {
  reason: UnassignedReason;
  detail: string | null;
} {
  const codes = (reasons ?? []).map(r => r.code ?? '').join(',');
  const detail = (reasons ?? []).map(r => r.example ?? r.code ?? '').filter(Boolean).join('; ') || null;

  if (/CAPACITY|LOAD_LIMIT/i.test(codes)) return { reason: 'NO_VEHICLE_HAS_CAPACITY', detail };
  if (/TIME_WINDOW|OUTSIDE.*WINDOW/i.test(codes)) return { reason: 'OUTSIDE_ALL_TIME_WINDOWS', detail };
  if (/ARRIVAL|DELIVERY.*DEADLINE/i.test(codes)) return { reason: 'CANNOT_MEET_REQUIRED_ARRIVAL', detail };
  if (/MAX_DRIVING|DURATION_LIMIT/i.test(codes)) return { reason: 'WOULD_BREAK_MAX_DRIVE_TIME', detail };
  return { reason: 'INFEASIBLE_OTHER', detail };
}

// ── Internals ───────────────────────────────────────────────────────────────

function parseRoute(
  r: GoogleRoute,
  fallbackIdx: number,
  originalShipments: ShipmentInput[],
  vehicleDriverLookup: Map<string, string | null>,
): ParsedRoute | null {
  const vehicleInfo = parseVehicleLabel(r.vehicleLabel);
  if (!vehicleInfo) return null; // shouldn't happen with our labels

  // Fold visits into per-stop aggregates. Two consecutive visits at the same
  // stop (pickup + delivery for one passenger) collapse into one stop row
  // with the passenger's id in passengerIds and count += 1.
  const stops: ParsedStop[] = [];
  let currentStopKey = '';
  let currentStop: ParsedStop | null = null;
  let sequenceCounter = 0;

  for (const v of r.visits ?? []) {
    const label = v.shipmentLabel;
    const shipInfo = parseShipmentLabel(label);
    const shipment = shipInfo != null ? originalShipments[shipInfo.index] : null;
    if (!shipment || !v.startTime) continue;

    // The visit's arrival location isn't echoed back by Google — we look
    // it up from our own input via the shipment index + isPickup flag.
    const loc = v.isPickup ? shipment.pickup : shipment.delivery;
    const key = `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;

    if (key !== currentStopKey) {
      // New stop — commit the previous one.
      if (currentStop) stops.push(currentStop);
      sequenceCounter += 1;
      currentStop = {
        sequence:       sequenceCounter,
        stopId:         v.isPickup ? (shipment.pickup.stopId ?? null) : null,
        lat:            loc.lat,
        lng:            loc.lng,
        label:          loc.label,
        arrivalTime:    new Date(v.startTime),
        departureTime:  new Date(v.startTime),  // updated below when we see the next visit's start
        passengerCount: 0,
        passengerIds:   [],
      };
      currentStopKey = key;
    }

    if (currentStop && v.isPickup && shipment.passengerId) {
      currentStop.passengerIds.push(shipment.passengerId);
      currentStop.passengerCount += shipment.demand;
    }
    if (currentStop) currentStop.departureTime = new Date(v.startTime);
  }
  if (currentStop) stops.push(currentStop);

  const totalPassengers = stops.reduce((n, s) => n + s.passengerCount, 0);

  return {
    vehicleId:        vehicleInfo.vehicleId,
    driverId:         vehicleDriverLookup.get(vehicleInfo.vehicleId) ?? null,
    sequenceInRun:    fallbackIdx + 1,
    totalDistanceKm:  metersToKmRounded(r.metrics?.travelDistanceMeters),
    totalDurationMin: durationToMinRounded(r.metrics?.totalDuration),
    totalPassengers,
    encodedPolyline:  r.routePolyline?.points ?? '',
    startTime:        r.vehicleStartTime ? new Date(r.vehicleStartTime) : new Date(),
    endTime:          r.vehicleEndTime   ? new Date(r.vehicleEndTime)   : new Date(),
    stops,
  };
}

function parseSkip(
  s: GoogleSkippedShipment,
  originalShipments: ShipmentInput[],
): ParsedUnassigned | null {
  const info = parseShipmentLabel(s.label);
  const shipment = info ? originalShipments[info.index] : null;
  if (!shipment) return null;
  const { reason, detail } = normaliseSkipReason(s.reasons);
  return {
    passengerId:  shipment.passengerId,
    stopLat:      shipment.pickup.lat,
    stopLng:      shipment.pickup.lng,
    stopLabel:    shipment.pickup.label,
    reason,
    reasonDetail: detail,
  };
}

/**
 * Google returns distance in meters, duration in Go-style '600s' strings.
 */
function metersToKmRounded(m: number | undefined): number {
  if (typeof m !== 'number') return 0;
  return Math.round((m / 1000) * 100) / 100;
}
function durationToMinRounded(d: string | undefined): number {
  if (!d) return 0;
  const secs = Number(d.replace(/s$/, ''));
  if (!Number.isFinite(secs)) return 0;
  return Math.round(secs / 60);
}
