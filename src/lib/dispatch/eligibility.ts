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

function meetsPassengerConstraints(meta: PassengerMeta | undefined, row: DriverRow, fallbackPax?: number): boolean {
  const capacity = n(row.capacity) || 4;
  const requiredPax = meta?.passengerCount ?? fallbackPax ?? 1;
  if (requiredPax > 0 && capacity < requiredPax) return false;
  if (meta?.requireWheelchair && !b(row.has_wheelchair_ramp)) return false;
  if (meta?.requireChildSeat  && !b(row.has_child_seat))      return false;
  return true;
}

function meetsFreightConstraints(meta: FreightMeta | undefined, row: DriverRow): boolean {
  if (!meta) return true;
  const payloadKg = n(row.payload_kg);
  const volumeCbm = n(row.volume_cbm);
  if (meta.weightKg  > 0 && payloadKg > 0 && payloadKg < meta.weightKg)  return false;
  if (meta.volumeCbm > 0 && volumeCbm > 0 && volumeCbm < meta.volumeCbm) return false;
  if (meta.temperatureControlled && !b(row.has_reefer)) return false;
  if (meta.hazmAt && !b(row.hazmat_certified)) return false;
  if (meta.requiredVehicleType && meta.requiredVehicleType !== 'ANY') {
    const vType = s(row.vehicle_type).toUpperCase();
    if (!vType.includes(meta.requiredVehicleType.toUpperCase())) return false;
  }
  return true;
}

function meetsTechnicianConstraints(meta: TechnicianMeta | undefined, row: DriverRow): boolean {
  if (!meta || !Array.isArray(meta.requiredSkills) || meta.requiredSkills.length === 0) return true;
  const skills = j<string[]>(row.skill_tags, []);
  return meta.requiredSkills.every(reqSkill => skills.includes(reqSkill));
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

  // Fetch available driver–vehicle pairs scoped strictly to job.tenantId
  // and excluding drivers who already rejected or timed out on this job
  const rows = await prisma.$queryRawUnsafe<DriverRow[]>(`
    SELECT
      da.driver_id,
      COALESCE(da.zone_id, v.zone_id::text) AS zone_id,
      da.hours_worked_today,
      v.id::text                                      AS vehicle_id,
      v.type                                          AS vehicle_type,
      COALESCE(v.seating_capacity, v.capacity, 4)     AS capacity,
      COALESCE(v.payload_kg,       0)                 AS payload_kg,
      COALESCE(v.volume_cbm,       0)                 AS volume_cbm,
      COALESCE(v.cost_per_km,      1.5)               AS cost_per_km,
      COALESCE(v.has_wheelchair_ramp, FALSE)          AS has_wheelchair_ramp,
      COALESCE(v.has_child_seat,      FALSE)          AS has_child_seat,
      COALESCE(v.has_reefer,          FALSE)          AS has_reefer,
      COALESCE(v.hazmat_certified,    FALSE)          AS hazmat_certified,
      COALESCE(d.rating,           4.5)               AS driver_rating,
      COALESCE(d.license_type,     '')                AS license_category,
      COALESCE(d.contact_number,   '')                AS driver_phone,
      COALESCE(d.skill_tags,       '[]'::jsonb)       AS skill_tags,
      COALESCE(vl.lat, 0)                             AS lat,
      COALESCE(vl.lng, 0)                             AS lng
    FROM driver_availability da
    LEFT JOIN drivers d ON d.id::text = da.driver_id
                       AND d.deleted_at IS NULL
    JOIN vehicles v     ON (
                             v.id::text = da.vehicle_id
                             OR v.assigned_driver_id::text = da.driver_id
                             OR d.assigned_vehicle_id::text = v.id::text
                           )
                       AND v.status = 'AVAILABLE'
                       AND v.deleted_at IS NULL
                       AND v.tenant_id::text = $1
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = v.id::text
    WHERE da.status = 'AVAILABLE'
      AND (da.tenant_id IS NULL OR da.tenant_id = $1)
      AND (d.id IS NULL OR d.tenant_id::text = $1)
      AND (COALESCE(da.shift_ends_at, da.shift_end) IS NULL OR COALESCE(da.shift_ends_at, da.shift_end) > NOW())
      AND NOT EXISTS (
        SELECT 1 FROM dispatch_attempts da2
        WHERE da2.dispatch_job_id = $2::uuid
          AND da2.driver_id = da.driver_id
          AND da2.response IN ('REJECTED', 'TIMEOUT')
      )
  `, job.tenantId, job.id).catch(() => [] as DriverRow[]);

  const candidates: Candidate[] = [];
  const seenDrivers = new Set<string>();

  for (const row of rows) {
    const driverId = s(row.driver_id);
    if (!driverId || seenDrivers.has(driverId)) continue;

    const loc: GeoPoint = { lat: n(row.lat), lng: n(row.lng) };
    const hasGps = loc.lat !== 0 || loc.lng !== 0;

    const distanceKm = pickup && hasGps ? haversineKm(loc, pickup) : 0;

    // Hard geo constraint when both job pickup and vehicle GPS exist
    if (pickup && hasGps && distanceKm > radiusKm) continue;

    // Service-specific hard constraints
    switch (job.serviceType) {
      case 'PASSENGER':
        if (!meetsPassengerConstraints(meta as unknown as PassengerMeta, row, job.passengerCount)) continue;
        break;
      case 'FREIGHT':
      case 'DELIVERY':
        if (!meetsFreightConstraints(meta as unknown as FreightMeta, row)) continue;
        break;
      case 'TECHNICIAN':
        if (!meetsTechnicianConstraints(meta as unknown as TechnicianMeta, row)) continue;
        break;
    }

    const avgSpeed  = job.serviceType === 'DELIVERY' ? 30 : 40;
    const etaMin    = estimateEtaMin(distanceKm, avgSpeed);

    // Utilization: normalize hours worked today (max 12h shift)
    const hoursWorked = n(row.hours_worked_today);
    const utilizationScore = Math.min(hoursWorked / 12, 1);

    seenDrivers.add(driverId);
    candidates.push({
      driverId,
      vehicleId:       s(row.vehicle_id),
      driverPhone:     s(row.driver_phone) || undefined,
      distanceKm,
      etaMinutes:      etaMin,
      driverRating:    n(row.driver_rating) || 4.5,
      vehicleCapacity: n(row.capacity) || n(row.payload_kg) || 4,
      utilizationScore,
      costPerKm:       n(row.cost_per_km) || 1.5,
      zoneId:          s(row.zone_id) || undefined,
      skillTags:       j<string[]>(row.skill_tags, []),
    });
  }

  // If preferSameZone is true and job specifies a zoneId, prioritize same-zone candidates first
  if (preferSameZone && job.zoneId) {
    const sameZone = candidates.filter(c => c.zoneId === job.zoneId);
    if (sameZone.length > 0) {
      return sameZone;
    }
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
      COALESCE(da.zone_id, v.zone_id::text) AS zone_id,
      da.hours_worked_today,
      COALESCE(vl.lat, 0) AS lat,
      COALESCE(vl.lng, 0) AS lng,
      COALESCE(d.rating, 4.5) AS driver_rating,
      COALESCE(d.contact_number, '') AS driver_phone
    FROM ambulance_capabilities ac
    JOIN vehicles v        ON v.id::text = ac.vehicle_id
                          AND v.status = 'AVAILABLE'
                          AND v.deleted_at IS NULL
                          AND v.tenant_id::text = $1
    JOIN driver_availability da ON (
                                     da.vehicle_id = v.id::text
                                     OR da.driver_id = v.assigned_driver_id::text
                                     OR da.driver_id = ac.paramedic_id
                                   )
                               AND da.status = 'AVAILABLE'
                               AND (da.tenant_id IS NULL OR da.tenant_id = $1)
    LEFT JOIN drivers d    ON d.id::text = da.driver_id
                          AND d.deleted_at IS NULL
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = ac.vehicle_id
    WHERE ac.operational_status = 'READY'
      AND ac.paramedic_certified = TRUE
      AND (ac.expires_at IS NULL OR ac.expires_at > NOW())
      AND (ac.tenant_id IS NULL OR ac.tenant_id = $1)
      AND NOT EXISTS (
        SELECT 1 FROM dispatch_attempts da2
        WHERE da2.dispatch_job_id = $2::uuid
          AND da2.driver_id = da.driver_id
          AND da2.response IN ('REJECTED', 'TIMEOUT')
      )
  `, job.tenantId, job.id).catch(() => [] as DriverRow[]);

  const candidates: Candidate[] = [];
  const seenDrivers = new Set<string>();

  for (const row of rows) {
    const driverId = s(row.driver_id);
    if (!driverId || seenDrivers.has(driverId)) continue;

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

    // ── Hard filter 5: Cross-zone check ─────────────────────
    const candidateZone = s(row.zone_id);
    if (!crossZoneAllowed && job.zoneId && candidateZone && candidateZone !== job.zoneId) {
      continue;
    }

    // ── Hard filter 6: Serviceable geo radius ────────────────
    const loc: GeoPoint = { lat: n(row.lat), lng: n(row.lng) };
    const hasGps = loc.lat !== 0 || loc.lng !== 0;
    const distanceKm = pickup && hasGps ? haversineKm(loc, pickup) : 0;

    // P1/P2 cross-zone: allow up to 3× radius; no cross-zone: strict radius
    const effectiveRadius = crossZoneAllowed ? radiusKm * 3 : radiusKm;
    if (pickup && hasGps && distanceKm > effectiveRadius) continue;

    // Ambulances travel faster (emergency speed)
    const etaMin = estimateEtaMin(distanceKm, 70);

    seenDrivers.add(driverId);
    candidates.push({
      driverId,
      vehicleId:       s(row.vehicle_id),
      driverPhone:     s(row.driver_phone) || undefined,
      distanceKm,
      etaMinutes:      etaMin,
      driverRating:    n(row.driver_rating) || 4.5,
      vehicleCapacity: 1,
      utilizationScore: Math.min(n(row.hours_worked_today) / 12, 1),
      costPerKm:       0,
      zoneId:          candidateZone || undefined,
      equipmentTags:   equipmentOnBoard,
      ambulanceLevel:  available,
    });
  }

  return candidates;
}
