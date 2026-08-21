/**
 * Fleet Routing — DB → Google OptimizeToursRequest translator.
 *
 * Takes Fleet360-owned ShipmentInput[] + VehicleInput[] plus the target
 * date and produces the exact JSON payload Google's Route Optimization
 * API expects.
 *
 * Design notes:
 *   • Every passenger is modelled as a single "shipment" with a pickup
 *     visit (window = resolved earliest/latest pickup) and a delivery
 *     visit (window ending at requiredArrival — the HARD constraint).
 *   • Vehicles carry a single loadDemand dimension called 'seats' —
 *     matches the ShipmentInput.demand semantics (1 seat per passenger
 *     usually, but overridable for family-together bookings later).
 *   • globalStartTime / globalEndTime bound the whole day so Google
 *     doesn't consider unreasonable start times.
 *   • timeout is set to 30 seconds — plenty for 100 shipments per our
 *     scale target; bumps up needed for larger fleets.
 */

import type {
  GoogleOptimizeToursRequest,
  GoogleShipment,
  GoogleVehicle,
  ShipmentInput,
  VehicleInput,
} from './types';

export interface BuildInput {
  projectId:     string;
  shipments:     ShipmentInput[];
  vehicles:      VehicleInput[];
  /** ISO-8601 lower bound for any vehicle activity that day. */
  globalStart:   string;
  /** ISO-8601 upper bound for any vehicle activity that day. */
  globalEnd:     string;
  /** Solver wall-clock budget. Default '30s'. */
  timeout?:      string;
}

export function buildOptimizeToursRequest(input: BuildInput): GoogleOptimizeToursRequest {
  const { projectId, shipments, vehicles, globalStart, globalEnd, timeout = '30s' } = input;

  const googleShipments: GoogleShipment[] = shipments.map((s, idx) => ({
    // The label ties this shipment back to our domain model. The parser
    // uses it to reattach the passengerId when reading the response.
    label: shipmentLabel(idx, s.passengerId),
    loadDemands: { seats: { amount: String(s.demand) } },
    pickups: [{
      arrivalLocation: { latitude: s.pickup.lat, longitude: s.pickup.lng },
      duration: '30s',                       // ~30s to board a bus stop
      label:    s.pickup.label,
      timeWindows: [{
        startTime: s.window.earliestPickup,
        endTime:   s.window.latestPickup,
      }],
    }],
    deliveries: [{
      arrivalLocation: { latitude: s.delivery.lat, longitude: s.delivery.lng },
      duration: '30s',
      label:    s.delivery.label,
      // HARD arrival constraint: window ends at requiredArrival. If solver
      // can't drop the passenger by then, the shipment is skipped and
      // surfaced as CANNOT_MEET_REQUIRED_ARRIVAL by the parser.
      timeWindows: [{
        endTime: s.window.requiredArrival,
      }],
    }],
  }));

  const googleVehicles: GoogleVehicle[] = vehicles.map((v, idx) => ({
    label:         vehicleLabel(idx, v.vehicleId),
    startLocation: { latitude: v.start.lat, longitude: v.start.lng },
    endLocation:   { latitude: v.end.lat,   longitude: v.end.lng },
    startTimeWindows: [{ startTime: v.earliestStart }],
    endTimeWindows:   [{ endTime:   v.latestEnd     }],
    loadLimits: { seats: { maxLoad: String(v.capacity) } },
    // Cost knobs — kept modest. High enough that solver dislikes long
    // routes; low enough that it isn't more scared of driving than of
    // skipping passengers (which have `penaltyCost` implicit via being
    // unassigned).
    costPerHour:       50,
    costPerKilometer:  2,
  }));

  return {
    parent: `projects/${projectId}`,
    model: {
      shipments: googleShipments,
      vehicles:  googleVehicles,
      globalStartTime: globalStart,
      globalEndTime:   globalEnd,
    },
    timeout,
    populatePolylines: false,   // we fetch per-route polylines separately via computeRoutes
  };
}

// ── Label helpers — encode our ids in Google's label field so the parser
//    can reconstruct the mapping without extra state.

export function shipmentLabel(index: number, passengerId: string | null): string {
  return `s${index}:${passengerId ?? 'anon'}`;
}
export function parseShipmentLabel(label: string | undefined): { index: number; passengerId: string | null } | null {
  if (!label) return null;
  const m = label.match(/^s(\d+):(.+)$/);
  if (!m) return null;
  return { index: Number(m[1]), passengerId: m[2] === 'anon' ? null : m[2] };
}

export function vehicleLabel(index: number, vehicleId: string): string {
  return `v${index}:${vehicleId}`;
}
export function parseVehicleLabel(label: string | undefined): { index: number; vehicleId: string } | null {
  if (!label) return null;
  const m = label.match(/^v(\d+):(.+)$/);
  if (!m) return null;
  return { index: Number(m[1]), vehicleId: m[2] };
}
