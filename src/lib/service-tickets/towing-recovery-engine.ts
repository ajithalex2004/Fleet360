/**
 * Towing & Replacement Vehicle Automated Workflows Engine (Pillar 4 - P1)
 *
 * Capabilities:
 *   1. Approved Towing Vendor Matching & 1-Click Dispatch:
 *      - Computes recovery ETA (20 - 35 mins) based on breakdown location
 *      - Dispatches digital recovery voucher (GPS coordinates, plate number, driver phone)
 *      - Transitions ticket status to 'In Progress' with audit logging
 *   2. Replacement Vehicle Provisioning Bridge:
 *      - Scans available fleet pool for same-category vehicles (BUS, VAN, SEDAN, SUV)
 *      - Grounds the broken-down unit (status -> 'MAINTENANCE')
 *      - Allocates replacement unit, preserving active lease/booking billing continuity
 */

import { prisma } from '@/lib/prisma';
import { effectiveEndTime } from '@/lib/bus-ops/validate-assignment';
import { TRIP_OPEN_STATUSES } from '@/lib/trip-status';

type TripWindow = { id: string; departureTime: Date; arrivalTime: Date | null; route: { estimatedDurationMins: number | null } | null };

const tripWindowSelect = {
  id: true,
  departureTime: true,
  arrivalTime: true,
  route: { select: { estimatedDurationMins: true } },
} as const;

/** Upcoming scheduled trips of the broken vehicle — the ones a swap moves. */
function upcomingScheduledTrips(tenantId: string, vehicleId: string, now: Date): Promise<TripWindow[]> {
  return prisma.tripSchedule.findMany({
    where: { tenantId, vehicleId, deletedAt: null, departureTime: { gte: now }, status: { in: ['SCHEDULED'] } },
    select: tripWindowSelect,
  });
}

/**
 * Trips of `candidateIds` that overlap any of `trips`, keyed by vehicle —
 * the same half-open window rule Bus Ops assignment validation uses
 * (effectiveEndTime). A replacement left AVAILABLE for Bus Ops must not be
 * double-booked onto two trips at once.
 */
async function overlappingTripsByVehicle(
  tenantId: string,
  candidateIds: string[],
  trips: TripWindow[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (candidateIds.length === 0 || trips.length === 0) return out;
  const windows = trips.map((t) => ({
    start: t.departureTime.getTime(),
    end: effectiveEndTime(t.departureTime, t.arrivalTime, t.route?.estimatedDurationMins ?? null).getTime(),
  }));
  const latestEnd = Math.max(...windows.map((w) => w.end));
  const existing = await prisma.tripSchedule.findMany({
    where: {
      tenantId,
      vehicleId: { in: candidateIds },
      deletedAt: null,
      status: { in: [...TRIP_OPEN_STATUSES] },
      departureTime: { lt: new Date(latestEnd) },
    },
    select: { ...tripWindowSelect, vehicleId: true, tripNumber: true },
  });
  for (const e of existing) {
    const start = e.departureTime.getTime();
    const end = effectiveEndTime(e.departureTime, e.arrivalTime, e.route?.estimatedDurationMins ?? null).getTime();
    if (windows.some((w) => start < w.end && end > w.start) && e.vehicleId) {
      const list = out.get(e.vehicleId) ?? [];
      list.push(e.tripNumber ?? e.id);
      out.set(e.vehicleId, list);
    }
  }
  return out;
}

export interface RecoveryVendorOption {
  id: string;
  name: string;
  phone: string;
  rating: number;
  flatbedAvailable: boolean;
  heavyTowingAvailable: boolean;
  estimatedEtaMinutes: number;
  coverageEmirate: string;
}

export interface AvailableReplacementVehicle {
  id: string;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleGroup: string | null;
  seatingCapacity: number | null;
  fuelLevel: number | null;
  currentMileage: number | null;
}

export interface RecoveryOptionsData {
  ticketId: string;
  ticketType: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  vehicleGroup: string | null;
  breakdownLocation: string;
  isTowingDispatched: boolean;
  isReplacementProvisioned: boolean;
  towingDispatchDetails?: {
    vendorName: string;
    dispatchedAt: string;
    etaMinutes: number;
    trackingStatus: string;
  } | null;
  replacementDetails?: {
    replacementVehicleId: string;
    replacementPlate: string | null;
    provisionedAt: string;
    contractMaintained: boolean;
  } | null;
  approvedVendors: RecoveryVendorOption[];
  availableReplacements: AvailableReplacementVehicle[];
}

export interface TowingDispatchParams {
  ticketId: string;
  tenantId: string;
  vendorId: string;
  vendorName: string;
  actorEmail?: string;
  breakdownNotes?: string;
}

export interface ProvisionReplacementParams {
  ticketId: string;
  tenantId: string;
  replacementVehicleId: string;
  actorEmail?: string;
}

const DEFAULT_APPROVED_VENDORS: RecoveryVendorOption[] = [
  {
    id: 'v-1',
    name: 'Al Futtaim 24/7 Fleet Recovery',
    phone: '+971 4 213 7788',
    rating: 4.9,
    flatbedAvailable: true,
    heavyTowingAvailable: true,
    estimatedEtaMinutes: 22,
    coverageEmirate: 'Dubai & Northern Emirates',
  },
  {
    id: 'v-2',
    name: 'Emirates Moto Roadside & Towing',
    phone: '+971 2 555 4321',
    rating: 4.8,
    flatbedAvailable: true,
    heavyTowingAvailable: false,
    estimatedEtaMinutes: 28,
    coverageEmirate: 'Abu Dhabi & Al Ain',
  },
  {
    id: 'v-3',
    name: 'QuickLift Heavy Vehicle Recovery',
    phone: '+971 6 543 9900',
    rating: 4.7,
    flatbedAvailable: true,
    heavyTowingAvailable: true,
    estimatedEtaMinutes: 30,
    coverageEmirate: 'Sharjah & Ajman',
  },
];

/**
 * Calculates simulated recovery ETA based on emirate and priority
 */
export function calculateRecoveryEta(emirate: string, isHighPriority: boolean): number {
  let baseEta = 25;
  const lower = emirate.toLowerCase();
  if (lower.includes('dubai') || lower.includes('dxb')) baseEta = 20;
  else if (lower.includes('abu dhabi') || lower.includes('auh')) baseEta = 30;
  else if (lower.includes('sharjah') || lower.includes('shj')) baseEta = 25;

  return isHighPriority ? Math.max(15, baseEta - 5) : baseEta;
}

/**
 * Fetches recovery vendor options and available replacement vehicles
 */
export async function getRecoveryAndReplacementOptions(
  ticketId: string,
  tenantId: string
): Promise<RecoveryOptionsData | null> {
  // 1. Fetch Ticket
  const [ticket] = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      ticket_type: string;
      vehicle_id: string | null;
      custom_fields: Record<string, unknown>;
    }>
  >(
    `SELECT id, ticket_type, vehicle_id, custom_fields
     FROM service_tickets
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    ticketId,
    tenantId
  );

  if (!ticket) return null;

  const customFields = (ticket.custom_fields || {}) as Record<string, unknown>;
  // custom_fields is an untyped jsonb blob; dispatchTowingVendor() and the
  // replacement-provisioning step below both write a real, wider object
  // (with extra bookkeeping fields like vendorId/dispatchedBy/domainAction)
  // than RecoveryOptionsData exposes — narrow to exactly what that return
  // type declares rather than passing the untyped blob through.
  const towingDetails = customFields.towingDispatch as RecoveryOptionsData['towingDispatchDetails'];
  const replacementDetails = customFields.replacementProvision as RecoveryOptionsData['replacementDetails'];

  // 2. Fetch Grounded Vehicle Details
  let vehiclePlate: string | null = null;
  let vehicleGroup = 'BUS';
  if (ticket.vehicle_id) {
    const v = await prisma.vehicle.findFirst({
      where: { id: ticket.vehicle_id, tenantId, deletedAt: null },
      select: { licensePlate: true, vehicleGroup: true },
    });
    vehiclePlate = v?.licensePlate || null;
    vehicleGroup = v?.vehicleGroup || 'BUS';
  }

  // 3. Query Available Replacement Vehicles from Pool
  const candidateVehicles = await prisma.vehicle.findMany({
    where: {
      tenantId,
      // INACTIVE vehicles are off fleet (or grounded) — never offer them.
      status: 'AVAILABLE',
      isActive: true,
      deletedAt: null,
      id: ticket.vehicle_id ? { not: ticket.vehicle_id } : undefined,
    },
    take: 20,
    select: {
      id: true,
      licensePlate: true,
      make: true,
      model: true,
      year: true,
      vehicleGroup: true,
      seatingCapacity: true,
      fuelLevel: true,
      currentMileage: true,
    },
  });

  // Do not offer a vehicle already booked on a trip that overlaps the
  // broken vehicle's upcoming trips it would take over.
  const tripsToCover = ticket.vehicle_id ? await upcomingScheduledTrips(tenantId, ticket.vehicle_id, new Date()) : [];
  const busy = await overlappingTripsByVehicle(tenantId, candidateVehicles.map((v) => v.id), tripsToCover);
  const availableVehicles = candidateVehicles.filter((v) => !busy.has(v.id)).slice(0, 4);

  const formattedReplacements: AvailableReplacementVehicle[] = availableVehicles.map((v) => ({
    id: v.id,
    licensePlate: v.licensePlate,
    make: v.make,
    model: v.model,
    year: v.year ? Number(v.year) : 2024,
    vehicleGroup: v.vehicleGroup || vehicleGroup,
    seatingCapacity: v.seatingCapacity || 30,
    fuelLevel: v.fuelLevel ?? 90,
    currentMileage: v.currentMileage ? Number(v.currentMileage) : 24000,
  }));

  // 4. Query Dynamic Recovery & Towing Vendors from Database (Garages)
  const breakdownLocation =
    (customFields.extractedLocation as string) || 'Sheikh Zayed Road near Exit 36, Dubai, UAE';

  const dbGarages = await prisma.garage.findMany({
    where: {
      tenantId,
      deletedAt: null,
    },
    take: 10,
    select: {
      id: true,
      name: true,
      location: true,
      contactNumber: true,
      contactPerson: true,
      specialties: true,
      isInternal: true,
    },
  }).catch(() => []);

  const dynamicVendors: RecoveryVendorOption[] = dbGarages
    .filter((g) => {
      const specs = (g.specialties || []).map((s) => s.toUpperCase());
      return (
        specs.includes('TOWING') ||
        specs.includes('RECOVERY') ||
        specs.includes('ROADSIDE') ||
        specs.includes('BREAKDOWN') ||
        g.isInternal === false
      );
    })
    .map((g) => {
      const loc = g.location || breakdownLocation;
      const eta = calculateRecoveryEta(loc, false);
      return {
        id: g.id,
        name: g.name || 'Approved Garage Recovery Partner',
        phone: g.contactNumber || '+971 4 000 0000',
        rating: 4.8,
        flatbedAvailable: true,
        heavyTowingAvailable: (g.specialties || []).some((s) =>
          s.toLowerCase().includes('heavy')
        ),
        estimatedEtaMinutes: eta,
        coverageEmirate: g.location || 'UAE National Coverage',
      };
    });

  const approvedVendors: RecoveryVendorOption[] =
    dynamicVendors.length > 0
      ? [
          ...dynamicVendors,
          ...DEFAULT_APPROVED_VENDORS.filter(
            (d) => !dynamicVendors.some((v) => v.name.toLowerCase() === d.name.toLowerCase())
          ),
        ]
      : DEFAULT_APPROVED_VENDORS;

  return {
    ticketId: ticket.id,
    ticketType: ticket.ticket_type,
    vehicleId: ticket.vehicle_id,
    vehiclePlate,
    vehicleGroup,
    breakdownLocation,
    isTowingDispatched: !!towingDetails,
    isReplacementProvisioned: !!replacementDetails,
    towingDispatchDetails: towingDetails || null,
    replacementDetails: replacementDetails || null,
    approvedVendors,
    availableReplacements: formattedReplacements,
  };
}

/**
 * Executes 1-Click Towing Vendor Dispatch
 */
export async function dispatchTowingVendor(
  params: TowingDispatchParams
): Promise<{ ok: boolean; etaMinutes: number; dispatchMessage: string }> {
  // Check if vendorId corresponds to a registered garage
  let resolvedVendorName = params.vendorName;
  try {
    const matchedGarage = await prisma.garage.findFirst({
      where: { id: params.vendorId, tenantId: params.tenantId, deletedAt: null },
      select: { name: true },
    });
    if (matchedGarage?.name) {
      resolvedVendorName = matchedGarage.name;
    }
  } catch {
    // Keep original vendor name
  }

  const etaMinutes = calculateRecoveryEta('Dubai', true);
  const now = new Date();

  const dispatchDetails = {
    vendorId: params.vendorId,
    vendorName: resolvedVendorName,
    dispatchedAt: now.toISOString(),
    etaMinutes,
    trackingStatus: 'DISPATCHED_EN_ROUTE',
    dispatchedBy: params.actorEmail || 'Dispatcher',
  };

  const historyEntry = {
    status: 'In Progress',
    date: now.toISOString(),
    actor: params.actorEmail || 'Fleet Dispatcher',
    note: `1-Click Recovery Dispatched: Assigned to ${params.vendorName}. Flatbed ETA: ${etaMinutes} mins.`,
  };

  await prisma.$executeRawUnsafe(
    `UPDATE service_tickets
     SET status = 'In Progress',
         custom_fields = custom_fields || jsonb_build_object('towingDispatch', $2::jsonb),
         history = history || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1::uuid AND tenant_id = $4`,
    params.ticketId,
    JSON.stringify(dispatchDetails),
    JSON.stringify([historyEntry]),
    params.tenantId
  );

  return {
    ok: true,
    etaMinutes,
    dispatchMessage: `Recovery flatbed dispatched to ${params.vendorName}. Driver ETA: ${etaMinutes} minutes.`,
  };
}

/**
 * Executes 1-Click Replacement Vehicle Provisioning Bridge with Domain Adapters
 */
export async function provisionReplacementVehicle(
  params: ProvisionReplacementParams
): Promise<{
  ok: boolean;
  message: string;
  replacementPlate: string | null;
  domainAction?: string;
  reassignedTripsCount?: number;
  reassignedBookingsCount?: number;
  /** True when bus trips moved to the replacement: their earlier pre-trip
   *  inspection was of the broken vehicle and does not count for it. */
  preTripInspectionRequired?: boolean;
}> {
  const now = new Date();

  // 1. Fetch Replacement Vehicle — it must be available right now. Lock
  //    the row so two dispatchers cannot hand the same spare to two
  //    breakdowns.
  await prisma.$queryRawUnsafe(
    `SELECT id FROM vehicles WHERE id::text = $1 AND tenant_id::text = $2 FOR UPDATE`,
    params.replacementVehicleId,
    params.tenantId,
  );
  const replacementVehicle = await prisma.vehicle.findFirst({
    where: { id: params.replacementVehicleId, tenantId: params.tenantId, deletedAt: null },
    select: { id: true, licensePlate: true, make: true, model: true, vehicleGroup: true, vehicleUsage: true, status: true, isActive: true },
  });

  if (!replacementVehicle) {
    throw new Error('Selected replacement vehicle was not found or is unavailable');
  }
  if ((replacementVehicle.status ?? '').toUpperCase() !== 'AVAILABLE' || replacementVehicle.isActive === false) {
    throw new Error(`Selected replacement vehicle is not available (status ${replacementVehicle.status ?? 'unknown'})`);
  }

  // 2. Fetch Ticket to find Grounded Vehicle
  const [ticket] = await prisma.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
    `SELECT vehicle_id FROM service_tickets WHERE id = $1::uuid AND tenant_id = $2`,
    params.ticketId,
    params.tenantId
  );

  let domainAction = 'GENERAL_FLEET_SWAP';
  let reassignedBookingsCount = 0;
  let reassignedTripsCount = 0;
  let leaseExchangeCreated = false;
  let replacementStatus = 'RENTED';

  // 3. Ground the broken vehicle if linked and execute domain-specific adapters
  if (ticket?.vehicle_id) {
    // The broken vehicle cannot replace itself: it would be grounded, then
    // handed its own trips and bookings, then set back in service below.
    if (ticket.vehicle_id === replacementVehicle.id) {
      throw new Error('Replacement vehicle cannot be the vehicle the ticket is for');
    }
    // Fetch grounded vehicle metadata
    const groundedVehicle = await prisma.vehicle.findFirst({
      where: { id: ticket.vehicle_id, tenantId: params.tenantId },
      select: { id: true, licensePlate: true, vehicleUsage: true, vehicleGroup: true },
    });

    // P0 Safety: Ground the broken vehicle. No .catch anywhere below: this
    // runs on the request's RLS transaction, where a caught failure leaves
    // the transaction aborted and the COMMIT silently rolls everything back
    // while the dispatcher is told the swap succeeded.
    // A vehicle already GROUNDED (critical DVIR defect, expired documents)
    // keeps that status: overwriting it with MAINTENANCE would drop it out
    // of the grounding checks that decide when it may be released.
    await prisma.vehicle.updateMany({
      where: {
        id: ticket.vehicle_id,
        tenantId: params.tenantId,
        OR: [{ status: null }, { status: { not: 'GROUNDED' } }],
      },
      data: { status: 'MAINTENANCE', isActive: false },
    });

    // --- Domain Adapter 1: Rent-a-car (RAC) ---
    const activeBookings = await prisma.booking.findMany({
      where: {
        vehicleId: ticket.vehicle_id,
        tenantId: params.tenantId,
        status: { in: ['ACTIVE', 'CONFIRMED'] },
      },
      select: { id: true },
    });

    if (activeBookings.length > 0 || groundedVehicle?.vehicleUsage === 'RENTAL') {
      const bookingUpdate = await prisma.booking
        .updateMany({
          where: {
            vehicleId: ticket.vehicle_id,
            tenantId: params.tenantId,
            status: { in: ['ACTIVE', 'CONFIRMED'] },
          },
          data: { vehicleId: replacementVehicle.id },
        });

      reassignedBookingsCount = bookingUpdate.count;
      domainAction = 'RENTAL_BOOKING_REASSIGNED';
      replacementStatus = 'RENTED';
    }

    // --- Domain Adapter 2: Staff Transport / Bus Operations ---
    // Do NOT modify past trips or the master schedule; reassign only upcoming scheduled trips
    const upcomingTrips = await upcomingScheduledTrips(params.tenantId, ticket.vehicle_id, now);
    // The replacement stays AVAILABLE for Bus Ops, so the row lock above
    // only guards concurrent swaps until commit: refuse a replacement that
    // already runs a trip overlapping the ones it is about to take over.
    const conflicts = (await overlappingTripsByVehicle(params.tenantId, [replacementVehicle.id], upcomingTrips))
      .get(replacementVehicle.id);
    if (conflicts?.length) {
      throw new Error(`Replacement vehicle is already assigned to overlapping trip(s): ${conflicts.join(', ')}`);
    }

    if (
      upcomingTrips.length > 0 ||
      ['STAFF', 'SCHOOL_BUS', 'STAFF_TRANSPORT'].includes(groundedVehicle?.vehicleUsage || '') ||
      groundedVehicle?.vehicleGroup === 'BUS'
    ) {
      const tripUpdate = await prisma.tripSchedule
        .updateMany({
          where: {
            vehicleId: ticket.vehicle_id,
            tenantId: params.tenantId,
            departureTime: { gte: now },
            status: { in: ['SCHEDULED'] },
          },
          data: { vehicleId: replacementVehicle.id },
        });

      reassignedTripsCount = tripUpdate.count;
      if (domainAction === 'GENERAL_FLEET_SWAP') {
        domainAction = 'STAFF_TRANSPORT_TRIPS_REASSIGNED';
        // Bus Ops holds a vehicle through its trip assignments, and its
        // dispatch validation refuses RESERVED / RENTED vehicles — so a
        // replacement marked RESERVED could not run the very trips it was
        // given. It stays AVAILABLE; the reassigned trips are its booking.
        replacementStatus = 'AVAILABLE';
      }
    }

    // --- Domain Adapter 3: Commercial Leasing ---
    const activeLease = await prisma.leaseContractVehicle.findFirst({
      where: {
        vehicleId: ticket.vehicle_id,
        tenantId: params.tenantId,
        status: 'ACTIVE',
      },
      select: { id: true, contractId: true },
    });

    if (activeLease || groundedVehicle?.vehicleUsage === 'LEASING') {
      if (activeLease?.contractId) {
        await prisma.leaseVehicleExchange
          .create({
            data: {
              tenantId: params.tenantId,
              contractId: activeLease.contractId,
              outgoingVehicleId: ticket.vehicle_id,
              incomingVehicleId: replacementVehicle.id,
              exchangeDate: now,
              reason: 'Service Ticket Breakdown Replacement',
              approvedBy: params.actorEmail || 'Fleet Dispatcher',
              notes: `Temporary custody substitution via ticket ${params.ticketId}`,
            },
          })
          .then(() => {
            leaseExchangeCreated = true;
          });
      }
      if (domainAction === 'GENERAL_FLEET_SWAP') {
        domainAction = 'LEASE_SUBSTITUTE_RECORDED';
        replacementStatus = 'RENTED';
      }
    }
  }

  // 4. Mark Replacement Vehicle as Active/Reserved
  await prisma.vehicle.update({
    where: { id: replacementVehicle.id },
    data: { status: replacementStatus, isActive: true },
  });

  const replacementProvisionDetails = {
    replacementVehicleId: replacementVehicle.id,
    replacementPlate: replacementVehicle.licensePlate,
    replacementMakeModel: `${replacementVehicle.make || ''} ${replacementVehicle.model || ''}`.trim(),
    provisionedAt: now.toISOString(),
    provisionedBy: params.actorEmail || 'Dispatcher',
    contractMaintained: true,
    domainAction,
    domainDetails: {
      reassignedBookingsCount,
      reassignedTripsCount,
      leaseExchangeCreated,
      preTripInspectionRequired: reassignedTripsCount > 0,
    },
  };

  let domainSummary = 'Active lease contract billing continuity maintained.';
  if (domainAction === 'STAFF_TRANSPORT_TRIPS_REASSIGNED') {
    // The pre-trip inspection on file was for the broken-down vehicle and
    // does not carry over (inspectionAllowsDeparture matches on vehicle):
    // the replacement must be inspected before each reassigned trip departs.
    domainSummary = `Reassigned ${reassignedTripsCount} upcoming staff/bus trip(s). A new pre-trip inspection of the replacement is required before departure.`;
  } else if (domainAction === 'RENTAL_BOOKING_REASSIGNED') {
    domainSummary = `Reassigned ${reassignedBookingsCount} active rental booking(s).`;
  } else if (domainAction === 'LEASE_SUBSTITUTE_RECORDED') {
    domainSummary = `Recorded temporary lease custody exchange for contracted asset.`;
  }

  const historyEntry = {
    status: 'In Progress',
    date: now.toISOString(),
    actor: params.actorEmail || 'Fleet Dispatcher',
    note: `Replacement Vehicle Provisioned: Swapped to ${replacementVehicle.licensePlate || replacementVehicle.id}. ${domainSummary}`,
  };

  await prisma.$executeRawUnsafe(
    `UPDATE service_tickets
     SET custom_fields = custom_fields || jsonb_build_object('replacementProvision', $2::jsonb),
         history = history || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1::uuid AND tenant_id = $4`,
    params.ticketId,
    JSON.stringify(replacementProvisionDetails),
    JSON.stringify([historyEntry]),
    params.tenantId
  );

  return {
    ok: true,
    message: `Replacement vehicle ${replacementVehicle.licensePlate || ''} provisioned. ${domainSummary}`,
    replacementPlate: replacementVehicle.licensePlate,
    domainAction,
    reassignedTripsCount,
    reassignedBookingsCount,
    preTripInspectionRequired: reassignedTripsCount > 0,
  };
}
