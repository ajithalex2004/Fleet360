/**
 * Fleet Routing — real-data assembler.
 *
 * Given (tenantId, targetDate, optional vehicleIds) this module loads the
 * live BusRoutes / RoutePassengers / Vehicles / Tenant rows and produces
 * ShipmentInput[] + VehicleInput[] the input-builder can turn into a
 * Google request.
 *
 * MVP assumptions (documented TODOs to revisit before B4 ships):
 *   • Depot location = office location (bus starts + ends at the office).
 *     Real world will need a Depot / garage model per tenant.
 *   • Office coord = most-common dropoff stop coord across all active
 *     passengers on the target date. If we can't determine one, we throw
 *     with a specific error the orchestrator maps to VALIDATING failure.
 *   • Vehicle shift = derived from the earliest / latest resolved passenger
 *     windows on the day; tenant-level shift-window config would be a
 *     natural follow-up.
 *   • Enrollment filter: RoutePassenger.effectiveFrom ≤ targetDate ≤
 *     effectiveTo AND status='ACTIVE' AND deletedAt IS NULL.
 */

import { prisma } from '@/lib/prisma';
import { resolveTimeWindow } from './window-resolver';
import type { ShipmentInput, VehicleInput } from './types';

// ── Public API ──────────────────────────────────────────────────────────────

export interface AssembleInput {
  tenantId:    string;
  targetDate:  Date;
  /** Optional subset of vehicles to include. Omit = all active tenant vehicles. */
  vehicleIds?: string[];
}

export interface AssembledInputs {
  shipments:   ShipmentInput[];
  vehicles:    VehicleInput[];
  /** Global time boundaries for the solver. */
  globalStart: string;   // ISO-8601
  globalEnd:   string;   // ISO-8601
  /** For traceability on the run row. */
  meta: {
    officeLat:            number;
    officeLng:            number;
    officeLabel:          string;
    passengerCount:       number;
    vehicleCount:         number;
    routesTouched:        string[];    // BusRoute ids that fed at least one shipment
    droppedPassengerIds:  string[];    // enrolled but excluded (no stop coord etc)
    droppedReason:        Record<string, string>;  // passengerId → why
  };
}

/**
 * Thrown when the assembler can't produce a valid input set — e.g. no
 * office location resolvable, zero active vehicles, zero passengers on
 * the target date. The orchestrator catches these and marks the run
 * FAILED with a status_reason (not INFEASIBLE — no solve was even
 * attempted).
 */
export class AssemblyError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AssemblyError';
  }
}

export async function assembleInputs(input: AssembleInput): Promise<AssembledInputs> {
  const { tenantId, targetDate, vehicleIds } = input;

  // ── Tenant + defaults ────────────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      defaultPickupBufferMin: true,
      defaultRequiredArrivalTime: true,
    },
  });
  if (!tenant) throw new AssemblyError(`Tenant ${tenantId} not found`, 'TENANT_NOT_FOUND');

  // ── Active passengers on the target date ─────────────────────────────────
  //
  // We load the parent BusRoute + pickup RouteStop in one hop so the resolver
  // can walk the sourcing chain without extra round-trips per row.
  const enrollments = await prisma.routePassenger.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      deletedAt: null,
      effectiveFrom: { lte: targetDate },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: targetDate } },
      ],
    },
    select: {
      id: true,
      staffMemberId: true,
      pickupStopId: true,
      pickupTime: true,
      earliestPickup: true,
      latestPickup: true,
      requiredArrivalTime: true,
      pickupBufferMin: true,
      route: {
        select: {
          id: true,
          departureTime: true,
          expectedArrivalTime: true,
          pickupBufferMin: true,
          origin: true,
          destination: true,
          stops: {
            select: { id: true, stopName: true, gpsLat: true, gpsLng: true, sequence: true },
            orderBy: { sequence: 'asc' },
          },
        },
      },
    },
  });
  if (enrollments.length === 0) {
    throw new AssemblyError(
      `No active passenger enrollments on ${targetDate.toISOString().slice(0, 10)}`,
      'NO_PASSENGERS',
    );
  }

  // ── Resolve office coord: mode over all dropoff stops ────────────────────
  //
  // Each route has a `destination` string and a last stop (highest sequence)
  // with coords. We take the last-stop coord as the route's office; then
  // pick the coord that appears on the most passengers' routes.
  const officeVotes = new Map<string, { lat: number; lng: number; label: string; count: number }>();
  for (const e of enrollments) {
    const lastStop = e.route.stops[e.route.stops.length - 1];
    if (!lastStop || lastStop.gpsLat == null || lastStop.gpsLng == null) continue;
    const key = `${lastStop.gpsLat.toFixed(5)}|${lastStop.gpsLng.toFixed(5)}`;
    const existing = officeVotes.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      officeVotes.set(key, {
        lat: lastStop.gpsLat,
        lng: lastStop.gpsLng,
        label: e.route.destination || lastStop.stopName,
        count: 1,
      });
    }
  }
  if (officeVotes.size === 0) {
    throw new AssemblyError(
      'No dropoff stops with GPS coordinates — cannot resolve office location. Pin at least one destination stop on the map.',
      'NO_OFFICE_LOCATION',
    );
  }
  const office = [...officeVotes.values()].sort((a, b) => b.count - a.count)[0];

  // ── Build shipments (drop those without pickup coords) ──────────────────
  const droppedReason: Record<string, string> = {};
  const shipments: ShipmentInput[] = [];
  const routesTouched = new Set<string>();
  let earliestPickupInstant = Infinity;
  let latestArrivalInstant = -Infinity;

  for (const e of enrollments) {
    const pickupStop = e.pickupStopId
      ? e.route.stops.find(s => s.id === e.pickupStopId)
      : e.route.stops[0]; // fall back to first stop when pickupStopId not set
    if (!pickupStop || pickupStop.gpsLat == null || pickupStop.gpsLng == null) {
      droppedReason[e.id] = 'no pickup coord';
      continue;
    }

    const window = resolveTimeWindow(
      {
        pickupTime: e.pickupTime,
        earliestPickup: e.earliestPickup,
        latestPickup: e.latestPickup,
        requiredArrivalTime: e.requiredArrivalTime,
        pickupBufferMin: e.pickupBufferMin,
      },
      {
        departureTime: e.route.departureTime,
        expectedArrivalTime: e.route.expectedArrivalTime,
        pickupBufferMin: e.route.pickupBufferMin,
      },
      {
        defaultPickupBufferMin: tenant.defaultPickupBufferMin,
        defaultRequiredArrivalTime: tenant.defaultRequiredArrivalTime,
      },
      targetDate,
    );

    shipments.push({
      passengerId: e.id,
      pickup: {
        lat:   pickupStop.gpsLat,
        lng:   pickupStop.gpsLng,
        label: pickupStop.stopName,
        stopId: pickupStop.id,
      },
      delivery: { lat: office.lat, lng: office.lng, label: office.label },
      window,
      demand: 1,   // 1 seat per passenger; multi-seat bookings TBD
    });
    routesTouched.add(e.route.id);

    const earliestT = new Date(window.earliestPickup).getTime();
    const arrivalT  = new Date(window.requiredArrival).getTime();
    if (earliestT < earliestPickupInstant) earliestPickupInstant = earliestT;
    if (arrivalT  > latestArrivalInstant)  latestArrivalInstant  = arrivalT;
  }

  if (shipments.length === 0) {
    throw new AssemblyError(
      `All ${enrollments.length} passenger(s) dropped — none have a pickup stop with GPS coords`,
      'NO_VALID_PICKUPS',
    );
  }

  // ── Vehicles ─────────────────────────────────────────────────────────────
  const vehicleWhere: Record<string, unknown> = { tenantId };
  if (vehicleIds && vehicleIds.length > 0) {
    vehicleWhere.id = { in: vehicleIds };
  }
  const vehicleRows = await prisma.vehicle.findMany({
    where: vehicleWhere,
    select: { id: true, seatingCapacity: true },
  });
  if (vehicleRows.length === 0) {
    throw new AssemblyError(
      vehicleIds?.length
        ? `None of the requested vehicles (${vehicleIds.length}) belong to this tenant`
        : 'No vehicles in the tenant fleet',
      'NO_VEHICLES',
    );
  }

  // Global window derived from actual shipment demands, padded 15 min on
  // each side so the solver has slack to serve the earliest and latest.
  const globalStartInstant = earliestPickupInstant - 15 * 60_000;
  const globalEndInstant   = latestArrivalInstant  + 15 * 60_000;
  const globalStart = new Date(globalStartInstant).toISOString();
  const globalEnd   = new Date(globalEndInstant).toISOString();

  const vehicles: VehicleInput[] = vehicleRows.map(v => ({
    vehicleId: v.id,
    driverId: null,                  // driver assignment via separate flow later
    start: { lat: office.lat, lng: office.lng, label: office.label },
    end:   { lat: office.lat, lng: office.lng, label: office.label },
    capacity: v.seatingCapacity ?? 30,   // matches BusRoute.capacity default
    earliestStart: globalStart,
    latestEnd:     globalEnd,
  }));

  return {
    shipments,
    vehicles,
    globalStart,
    globalEnd,
    meta: {
      officeLat:  office.lat,
      officeLng:  office.lng,
      officeLabel: office.label,
      passengerCount: shipments.length,
      vehicleCount:   vehicles.length,
      routesTouched:  [...routesTouched],
      droppedPassengerIds: Object.keys(droppedReason),
      droppedReason,
    },
  };
}
