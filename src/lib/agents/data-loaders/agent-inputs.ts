/**
 * Turns a tenant snapshot (tenant-operations.ts) into the inputs the
 * Compliance, Fleet Workforce Planner and Vehicle Reuse agents already take.
 * Pure functions: no database access, so they are tested directly.
 */
import type {
  DocumentRecord,
  DriverReadinessRequest,
  FleetWorkforcePlanningRequest,
  TripScheduleItem,
  VehicleResource,
  DriverResource,
} from '../types';
import { licenceClassesFor, type FleetVehicleRow, type TenantOperationsSnapshot, type TripRow } from './tenant-operations';

/** Planner vehicle tier from seats. */
export function vehicleTier(seats: number | null | undefined): string {
  const n = Number(seats) || 0;
  if (n >= 40) return 'COACH_50';
  if (n >= 20) return 'COASTER_30';
  if (n >= 8) return 'MINIVAN_14';
  return 'SEDAN';
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : undefined);

function tripItem(t: TripRow, vehiclesById: Map<string, FleetVehicleRow>): TripScheduleItem {
  const assigned = t.vehicleId ? vehiclesById.get(t.vehicleId) : undefined;
  return {
    id: t.id,
    tripNumber: t.tripNumber ?? undefined,
    routeId: t.routeId,
    clientName: t.routeName ?? undefined,
    startLocation: { lat: t.startLat ?? undefined, lng: t.startLng ?? undefined, addressName: t.origin ?? undefined },
    endLocation: { lat: t.endLat ?? undefined, lng: t.endLng ?? undefined, addressName: t.destination ?? undefined },
    plannedPickupTime: iso(t.departure),
    plannedDropoffTime: iso(t.arrival),
    passengerCount: t.passengers,
    vehicleCategoryRequired: assigned ? vehicleTier(assigned.seats) : vehicleTier(t.passengers),
    requiredLicenseType: t.requiredLicenseType ?? undefined,
    assignedVehicleId: t.vehicleId ?? undefined,
    assignedDriverId: t.driverId ?? undefined,
  };
}

// ── Compliance ──────────────────────────────────────────────────────────────

export interface ComplianceInput {
  documents: DocumentRecord[];
  readinessRequests: DriverReadinessRequest[];
  /** Vehicles / drivers with no expiry recorded for a document: not checkable. */
  missingExpiries: { vehicles: number; drivers: number };
}

export function complianceInput(s: TenantOperationsSnapshot): ComplianceInput {
  const documents: DocumentRecord[] = [];
  let vehiclesMissing = 0;
  let driversMissing = 0;

  for (const v of s.vehicles) {
    const registration = v.mulkiyaExpiry ?? v.registrationExpiry;
    if (registration) {
      documents.push({ id: `veh-reg-${v.id}`, entityId: v.id, entityType: 'VEHICLE', entityCode: v.code, documentType: 'MULKIYA_REGISTRATION', expiryDate: registration, issuingAuthority: 'RTA' });
    }
    if (v.insuranceExpiry) {
      documents.push({ id: `veh-ins-${v.id}`, entityId: v.id, entityType: 'VEHICLE', entityCode: v.code, documentType: 'MOTOR_INSURANCE', expiryDate: v.insuranceExpiry });
    }
    if (!registration || !v.insuranceExpiry) vehiclesMissing++;
  }
  for (const d of s.drivers) {
    if (d.licenseExpiry) {
      documents.push({ id: `drv-lic-${d.id}`, entityId: d.id, entityType: 'DRIVER', entityCode: d.name, documentType: 'DRIVER_LICENSE', expiryDate: d.licenseExpiry, issuingAuthority: 'RTA' });
    }
    if (d.emiratesIdExpiry) {
      documents.push({ id: `drv-eid-${d.id}`, entityId: d.id, entityType: 'DRIVER', entityCode: d.name, documentType: 'EMIRATES_ID', expiryDate: d.emiratesIdExpiry, issuingAuthority: 'ICP' });
    }
    if (d.visaExpiry) {
      documents.push({ id: `drv-visa-${d.id}`, entityId: d.id, entityType: 'DRIVER', entityCode: d.name, documentType: 'RESIDENCE_VISA', expiryDate: d.visaExpiry, issuingAuthority: 'ICP' });
    }
    if (!d.licenseExpiry || !d.emiratesIdExpiry) driversMissing++;
  }

  // Today's roster: every driver on a trip today, checked before dispatch.
  const vehiclesById = new Map(s.vehicles.map((v) => [v.id, v]));
  const tripsByDriver = new Map<string, TripRow[]>();
  for (const t of s.tripsToday) {
    if (t.driverId) tripsByDriver.set(t.driverId, [...(tripsByDriver.get(t.driverId) ?? []), t]);
  }
  const readinessRequests: DriverReadinessRequest[] = [];
  for (const d of s.drivers) {
    const rostered = tripsByDriver.get(d.id);
    if (!rostered?.length) continue;
    const first = rostered[0];
    const last = rostered[rostered.length - 1];
    const plannedMin = rostered.reduce((m, t) => m + Math.round(((t.arrival ?? t.departure).getTime() - t.departure.getTime()) / 60000), 0);
    const needs = rostered.map((t) => (t.vehicleId ? vehicleTier(vehiclesById.get(t.vehicleId)?.seats) : vehicleTier(t.passengers)));
    const heaviest = needs.find((c) => c === 'COACH_50') ?? needs.find((c) => c === 'COASTER_30') ?? needs[0];
    readinessRequests.push({
      driverId: d.id,
      driverName: d.name,
      vehicleCategoryRequired: rostered.some((t) => (t.requiredLicenseType ?? '').toUpperCase() === 'BUS') ? 'BUS' : heaviest,
      jobStartTime: first.departure,
      jobEndTime: last.arrival ?? last.departure,
      estimatedDurationMin: plannedMin,
      licenseExpiry: d.licenseExpiry ?? undefined,
      emiratesIdExpiry: d.emiratesIdExpiry ?? undefined,
      licenseClasses: licenceClassesFor(d.licenseType),
      dailyDutyMinutesUsed: s.dutyToday.get(d.id) ?? 0,
      rosterStatus: (d.status ?? '').toUpperCase() === 'SUSPENDED' ? 'OFF_DUTY' : 'ON_DUTY',
      assignedVehicleId: first.vehicleId ?? undefined,
    });
  }

  return { documents, readinessRequests, missingExpiries: { vehicles: vehiclesMissing, drivers: driversMissing } };
}

// ── Fleet Workforce Planner ─────────────────────────────────────────────────

const GROUNDED_STATUSES = new Set(['MAINTENANCE', 'PENDING_INSPECTION', 'RENTED', 'RESERVED']);
const NO_DEPOT = 'UNASSIGNED';

/** Tomorrow's plan: its trips, vehicles that can legally run, drivers who may drive. */
export function plannerRequest(s: TenantOperationsSnapshot): FleetWorkforcePlanningRequest & { excluded: { vehicles: number; drivers: number } } {
  const planDay = new Date(`${s.tomorrow}T12:00:00+04:00`).getTime();
  const valid = (d: Date | null) => !d || new Date(d).getTime() > planDay;
  const vehiclesById = new Map(s.vehicles.map((v) => [v.id, v]));

  let excludedVehicles = 0;
  const vehicles: FleetWorkforcePlanningRequest['vehicles'] = [];
  for (const v of s.vehicles) {
    const grounded = GROUNDED_STATUSES.has((v.status ?? '').toUpperCase()) || !valid(v.mulkiyaExpiry ?? v.registrationExpiry) || !valid(v.insuranceExpiry);
    if (grounded) {
      excludedVehicles++;
      continue;
    }
    vehicles.push({
      id: v.id,
      vehicleId: v.id,
      vehicleCode: v.code,
      seatingCapacity: v.seats ?? undefined,
      capacity: v.seats ?? undefined,
      category: vehicleTier(v.seats),
      currentDepotId: v.depotId ?? NO_DEPOT,
    } as VehicleResource & { currentDepotId: string });
  }

  let excludedDrivers = 0;
  const drivers: FleetWorkforcePlanningRequest['drivers'] = [];
  for (const d of s.drivers) {
    if ((d.status ?? '').toUpperCase() === 'SUSPENDED' || !valid(d.licenseExpiry)) {
      excludedDrivers++;
      continue;
    }
    drivers.push({
      id: d.id,
      driverId: d.id,
      driverName: d.name,
      licenseClasses: licenceClassesFor(d.licenseType),
      licenseCategory: d.licenseType ?? undefined,
      dutyMinutesUsed: 0, // a fresh operating day
      historicalWeeklyDutyMin: s.dutyLast7Days.get(d.id) ?? 0,
      currentDepotId: NO_DEPOT,
      rosterStatus: 'ON_DUTY',
    } as DriverResource & { currentDepotId: string; licenseClasses?: string[]; historicalWeeklyDutyMin?: number; rosterStatus?: string });
  }

  return {
    scheduleDate: s.tomorrow,
    horizon: 'T_PLUS_1_OPERATIONAL',
    trips: s.tripsTomorrow.map((t) => tripItem(t, vehiclesById)),
    vehicles,
    drivers,
    depots: s.depots,
    excluded: { vehicles: excludedVehicles, drivers: excludedDrivers },
  };
}

// ── Vehicle Reuse ───────────────────────────────────────────────────────────

export interface ReuseInput {
  activeTrips: Array<{ trip: TripScheduleItem; vehicle: VehicleResource }>;
  unassignedTrips: TripScheduleItem[];
  /** Every booked interval per vehicle, to refuse a chain that collides with another trip. */
  bookings: Map<string, Array<{ start: number; end: number; tripId: string }>>;
}

export function reuseInput(s: TenantOperationsSnapshot): ReuseInput {
  const vehiclesById = new Map(s.vehicles.map((v) => [v.id, v]));
  const all = [...s.tripsToday, ...s.tripsTomorrow];
  const activeTrips: ReuseInput['activeTrips'] = [];
  const unassignedTrips: TripScheduleItem[] = [];
  const bookings: ReuseInput['bookings'] = new Map();

  for (const t of all) {
    const item = tripItem(t, vehiclesById);
    const v = t.vehicleId ? vehiclesById.get(t.vehicleId) : undefined;
    if (v) {
      activeTrips.push({
        trip: item,
        vehicle: { id: v.id, vehicleId: v.id, vehicleCode: v.code, capacity: v.seats ?? undefined, seatingCapacity: v.seats ?? undefined, category: vehicleTier(v.seats) },
      });
      bookings.set(v.id, [...(bookings.get(v.id) ?? []), { start: t.departure.getTime(), end: (t.arrival ?? t.departure).getTime(), tripId: t.id }]);
    } else if (!t.vehicleId && (t.status ?? 'SCHEDULED').toUpperCase() === 'SCHEDULED') {
      unassignedTrips.push(item);
    }
  }
  return { activeTrips, unassignedTrips, bookings };
}
