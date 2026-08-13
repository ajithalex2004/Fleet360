/**
 * TRIPEXL Eligibility Engine
 * Hard-constraint filtering — candidates that fail ANY check are excluded.
 * No scoring here; this is pure pass/fail.
 */

import { prisma } from '@/lib/prisma';
import type { DispatchJob, Candidate, GeoPoint, AmbulanceLevel, AmbulanceMeta, FreightMeta, PassengerMeta, TechnicianMeta } from './types';

/* ─────────────────────────────────────────────────────────────
   Geo utilities
───────────────────────────────────────────────────────────── */

/** Haversine distance in km between two GPS points */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R    = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Estimate ETA in minutes given distance and average speed */
export function estimateEtaMin(distanceKm: number, avgSpeedKmh = 40): number {
  return Math.round((distanceKm / Math.max(avgSpeedKmh, 1)) * 60);
}

function n(v: unknown): number  { return parseFloat(String(v ?? 0)) || 0; }
function s(v: unknown): string  { return String(v ?? ''); }
function b(v: unknown): boolean { return v === true || v === 'true' || v === 1 || v === '1'; }
function j<T>(v: unknown, fallback: T): T {
  if (!v) return fallback;
  try { return (typeof v === 'string' ? JSON.parse(v) : v) as T; }
  catch { return fallback; }
}

/* ─────────────────────────────────────────────────────────────
   Service-level constraint checks
───────────────────────────────────────────────────────────── */

type DriverRow = Record<string, unknown>;

function meetsPassengerConstraints(meta: PassengerMeta | undefined, row: DriverRow): boolean {
  if (!meta) return true;
  const capacity = n(row.capacity);
  if (meta.passengerCount && capacity < meta.passengerCount) return false;
  if (meta.requireWheelchair && !b(row.has_wheelchair_ramp)) return false;
  if (meta.requireChildSeat  && !b(row.has_child_seat))      return false;
  return true;
}

function meetsFreightConstraints(meta: FreightMeta | undefined, row: DriverRow): boolean {
  if (!meta) return true;
  if (meta.weightKg  > 0 && n(row.payload_kg)  < meta.weightKg)  return false;
  if (meta.volumeCbm > 0 && n(row.volume_cbm)  < meta.volumeCbm) return false;
  if (meta.temperatureControlled && !b(row.has_reefer)) return false;
  if (meta.hazmAt && !b(row.hazmat_certified)) return false;
  if (meta.requiredVehicleType && meta.requiredVehicleType !== 'ANY') {
    const vType = s(row.vehicle_type).toUpperCase();
    if (!vType.includes(meta.requiredVehicleType.toUpperCase())) return false;
  }
  return true;
}

function meetsTechnicianConstraints(meta: TechnicianMeta | undefined, row: DriverRow): boolean {
  if (!meta || meta.requiredSkills.length === 0) return true;
  const skills = j<string[]>(row.skill_tags, []);
  return meta.requiredSkills.every(s => skills.includes(s));
}

/* ─────────────────────────────────────────────────────────────
   STANDARD eligibility (Passenger / Freight / Delivery / Technician)
───────────────────────────────────────────────────────────── */

export async function getEligibleCandidates(
  job: DispatchJob,
  radiusKm: number,
  preferSameZone: boolean,
): Promise<Candidate[]> {
  const pickup: GeoPoint | null =
    job.pickupLat != null && job.pickupLng != null
      ? { lat: job.pickupLat, lng: job.pickupLng }
      : null;

  const meta = job.metadata as Record<string, unknown> | undefined;

  // Fetch available driver–vehicle pairs with location
  const rows = await prisma.$queryRawUnsafe<DriverRow[]>(`
    SELECT
      da.driver_id,
      da.zone_id,
      da.hours_worked_today,
      v.id::text           AS vehicle_id,
      v.type               AS vehicle_type,
      COALESCE(v.capacity,         0)     AS capacity,
      COALESCE(v.payload_kg,       0)     AS payload_kg,
      COALESCE(v.volume_cbm,       0)     AS volume_cbm,
      COALESCE(v.cost_per_km,      1.0)   AS cost_per_km,
      COALESCE(v.has_wheelchair_ramp, FALSE) AS has_wheelchair_ramp,
      COALESCE(v.has_child_seat,      FALSE) AS has_child_seat,
      COALESCE(v.has_reefer,          FALSE) AS has_reefer,
      COALESCE(v.hazmat_certified,    FALSE) AS hazmat_certified,
      COALESCE(d.rating,           4.0)   AS driver_rating,
      COALESCE(d.license_category, '')    AS license_category,
      COALESCE(d.skill_tags,       '[]')  AS skill_tags,
      COALESCE(vl.lat, 0)                 AS lat,
      COALESCE(vl.lng, 0)                 AS lng
    FROM driver_availability da
    JOIN vehicles v        ON v.driver_id::text = da.driver_id
                          AND v.status = 'AVAILABLE'
                          AND v.deleted_at IS NULL
    LEFT JOIN drivers d    ON d.id::text = da.driver_id
                          AND d.deleted_at IS NULL
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = v.id::text
    WHERE da.status = 'AVAILABLE'
      AND (da.shift_end IS NULL OR da.shift_end > NOW())
  `).catch(() => [] as DriverRow[]);

  const candidates: Candidate[] = [];

  for (const row of rows) {
    const loc: GeoPoint = { lat: n(row.lat), lng: n(row.lng) };

    // Skip if no GPS and pickup is required
    if (pickup && loc.lat === 0 && loc.lng === 0) continue;

    const distanceKm = pickup ? haversineKm(loc, pickup) : 0;

    // Hard geo constraint
    if (pickup && distanceKm > radiusKm) continue;

    // Service-specific hard constraints
    switch (job.serviceType) {
      case 'PASSENGER':
        if (!meetsPassengerConstraints(meta as unknown as PassengerMeta, row)) continue;
        break;
      case 'FREIGHT':
      case 'DELIVERY':
        if (!meetsFreightConstraints(meta as unknown as FreightMeta, row)) continue;
        break;
      case 'TECHNICIAN':
        if (!meetsTechnicianConstraints(meta as unknown as TechnicianMeta, row)) continue;
        break;
    }

    const sameZone  = !job.zoneId || !row.zone_id || job.zoneId === s(row.zone_id);
    const avgSpeed  = job.serviceType === 'DELIVERY' ? 30 : 40;
    const etaMin    = estimateEtaMin(distanceKm, avgSpeed);

    // Utilization: normalize hours worked today (max 12h shift)
    const hoursWorked = n(row.hours_worked_today);
    const utilizationScore = Math.min(hoursWorked / 12, 1);

    candidates.push({
      driverId:        s(row.driver_id),
      vehicleId:       s(row.vehicle_id),
      distanceKm,
      etaMinutes:      etaMin,
      driverRating:    n(row.driver_rating),
      vehicleCapacity: n(row.capacity) || n(row.payload_kg),
      utilizationScore,
      costPerKm:       n(row.cost_per_km),
      zoneId:          s(row.zone_id),
      skillTags:       j<string[]>(row.skill_tags, []),
    });
  }

  return candidates;
}

/* ─────────────────────────────────────────────────────────────
   AMBULANCE eligibility  (strict hard filters — never bypassed)
───────────────────────────────────────────────────────────── */

/** BLS ≤ ALS ≤ ICU: higher level satisfies lower requirement */
function meetsAmbulanceLevel(required: AmbulanceLevel, available: AmbulanceLevel): boolean {
  const rank: Record<AmbulanceLevel, number> = { BLS: 0, ALS: 1, ICU: 2 };
  return (rank[available] ?? 0) >= (rank[required] ?? 0);
}

export async function getAmbulanceEligibleCandidates(
  job: DispatchJob,
  radiusKm: number,
  crossZoneAllowed: boolean,
): Promise<Candidate[]> {
  const pickup: GeoPoint | null =
    job.pickupLat != null && job.pickupLng != null
      ? { lat: job.pickupLat, lng: job.pickupLng }
      : null;

  const ambulanceMeta = (job.metadata ?? {}) as AmbulanceMeta;
  const requiredLevel    = (ambulanceMeta.requiredAmbulanceLevel ?? 'BLS') as AmbulanceLevel;
  const requiredEquip    = ambulanceMeta.requiredEquipment ?? [];

  const rows = await prisma.$queryRawUnsafe<DriverRow[]>(`
    SELECT
      ac.vehicle_id,
      ac.level,
      ac.equipment,
      ac.operational_status,
      ac.expires_at,
      ac.paramedic_certified,
      da.driver_id,
      da.zone_id,
      da.hours_worked_today,
      COALESCE(vl.lat, 0) AS lat,
      COALESCE(vl.lng, 0) AS lng,
      COALESCE(d.rating,  4.0) AS driver_rating
    FROM ambulance_capabilities ac
    JOIN vehicles v        ON v.id::text = ac.vehicle_id
                          AND v.status = 'AVAILABLE'
                          AND v.deleted_at IS NULL
    JOIN driver_availability da ON da.driver_id::text = v.driver_id::text
                               AND da.status = 'AVAILABLE'
    LEFT JOIN drivers d    ON d.id::text = da.driver_id
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = ac.vehicle_id
    WHERE ac.operational_status = 'READY'
      AND ac.paramedic_certified = TRUE
      AND (ac.expires_at IS NULL OR ac.expires_at > NOW())
  `).catch(() => [] as DriverRow[]);

  const candidates: Candidate[] = [];

  for (const row of rows) {
    // ── Hard filter 1: Ambulance level ──────────────────────
    const available = s(row.level).toUpperCase() as AmbulanceLevel;
    if (!meetsAmbulanceLevel(requiredLevel, available)) continue;

    // ── Hard filter 2: Required equipment present ────────────
    const equipmentOnBoard = j<string[]>(row.equipment, []);
    const equipOk = requiredEquip.every(eq => equipmentOnBoard.includes(eq));
    if (!equipOk) continue;

    // ── Hard filter 3: Paramedic certification valid ─────────
    if (!b(row.paramedic_certified)) continue;

    // ── Hard filter 4: Operational status = READY ───────────
    if (s(row.operational_status) !== 'READY') continue;

    // ── Hard filter 5: Serviceable geo radius ────────────────
    const loc: GeoPoint = { lat: n(row.lat), lng: n(row.lng) };
    const distanceKm = pickup ? haversineKm(loc, pickup) : 0;

    // P1 cross-zone: allow up to 3× radius; no cross-zone: strict radius
    const effectiveRadius = crossZoneAllowed ? radiusKm * 3 : radiusKm;
    if (pickup && distanceKm > effectiveRadius) continue;

    // Ambulances travel faster (emergency speed)
    const etaMin = estimateEtaMin(distanceKm, 70);

    // Equipment match score (for scoring layer input)
    const equipMatchScore = requiredEquip.length > 0
      ? requiredEquip.filter(eq => equipmentOnBoard.includes(eq)).length / requiredEquip.length
      : 1;

    candidates.push({
      driverId:        s(row.driver_id),
      vehicleId:       s(row.vehicle_id),
      distanceKm,
      etaMinutes:      etaMin,
      driverRating:    n(row.driver_rating),
      vehicleCapacity: 1,
      utilizationScore: Math.min(n(row.hours_worked_today) / 12, 1),
      costPerKm:       0,
      zoneId:          s(row.zone_id),
      equipmentTags:   equipmentOnBoard,
      ambulanceLevel:  available,
    });
  }

  return candidates;
}
