/**
 * RAC Telematics, Cross-Border Geofence Compliance (UAE / Oman / KSA),
 * and Road-Safety Interlocked Starter-Kill Immobilizer Service.
 *
 * Key Operational & Safety Invariants:
 *   1. All database queries run sequentially inside `tx` via `withSavepoint` so
 *      optional telemetry tables/columns never abort an outer PostgreSQL transaction.
 *   2. Cross-border geofence checks cross-reference `rental_cross_border_permits`
 *      (`status = 'ISSUED'`, `NOW() BETWEEN departure_date AND return_date`, matching
 *      `destination_country`) before raising `HIGH` / `CRITICAL` alerts.
 *   3. Mandatory Road-Safety Interlock on `IMMOBILIZE`:
 *      - NEVER cuts power on a moving (`speedKmh > 0`) or running (`ignitionOn === true`) vehicle!
 *      - When `speedKmh > 0 || ignitionOn === true`, sets `safetyInterlockPassed = false` and
 *        queues the starter-kill latch as `PENDING_SAFE_STOP` (engages ONLY once speed = 0 & ignition = OFF).
 *      - Only when `speedKmh === 0 && ignitionOn === false` does `safetyInterlockPassed = true`
 *        and `status = 'EXECUTED'`.
 */

import { randomUUID } from 'node:crypto';
import type { TxClient } from '@/lib/rls';
import { withRentalLock, withSavepoint } from '@/lib/rental/locks';
import {
  RentalSecurityError,
  assertRentalForeignKeysInTenant,
} from '@/lib/rental/security-guards';

export type TelemetrySource = 'LIVE_CANBUS' | 'VEHICLE_LEDGER_FALLBACK';

export type ImmobilizerStatus =
  | 'PENDING_SAFE_STOP'
  | 'EXECUTED'
  | 'RESTORED'
  | 'SUPERSEDED_BY_RESTORE';

export interface VehicleCanBusSnapshot {
  vehicleId: string;
  tenantId: string;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  category: string | null;
  vehicleStatus: string | null;
  telematicsDeviceId: string | null;
  telemetrySource: TelemetrySource;
  odometerKm: number;
  fuelPct: number;
  speedKmh: number;
  ignitionOn: boolean;
  latitude: number | null;
  longitude: number | null;
  headingDeg: number | null;
  lastPingAt: string | null;
  immobilizerState: 'IMMOBILIZED' | 'PENDING_SAFE_STOP' | 'NORMAL';
}

export type GeofenceZoneStatus =
  | 'INSIDE_UAE'
  | 'APPROACHING_BORDER'
  | 'CROSS_BORDER_BREACH';

export interface BorderCrossingPoint {
  code: string;
  name: string;
  destinationCountry: 'OMAN' | 'SAUDI_ARABIA';
  latitude: number;
  longitude: number;
  bufferRadiusKm: number;
}

export const UAE_INTERNATIONAL_BORDERS: readonly BorderCrossingPoint[] = [
  {
    code: 'HATTA_WAJAJAH',
    name: 'Hatta / Al Wajajah Border (E44 Dubai–Muscat)',
    destinationCountry: 'OMAN',
    latitude: 24.7933,
    longitude: 56.115,
    bufferRadiusKm: 8,
  },
  {
    code: 'MEZYAD_HAFEET',
    name: 'Mezyad / Jebel Hafeet Border (Al Ain–Nizwa)',
    destinationCountry: 'OMAN',
    latitude: 24.0419,
    longitude: 55.8386,
    bufferRadiusKm: 8,
  },
  {
    code: 'AL_AIN_BURAIMI',
    name: 'Hili / Al Madheef – Al Buraimi Border',
    destinationCountry: 'OMAN',
    latitude: 24.2589,
    longitude: 55.7697,
    bufferRadiusKm: 5,
  },
  {
    code: 'KHATMAT_MALAHA',
    name: 'Khatmat Malaha Border (Kalba–Sohar)',
    destinationCountry: 'OMAN',
    latitude: 24.9781,
    longitude: 56.3644,
    bufferRadiusKm: 8,
  },
  {
    code: 'DIBBA_MUSANDAM',
    name: 'Dibba Border (Fujairah–Musandam)',
    destinationCountry: 'OMAN',
    latitude: 25.6195,
    longitude: 56.262,
    bufferRadiusKm: 6,
  },
  {
    code: 'AL_DARAH_KHASAB',
    name: 'Al Darah Border (Ras Al Khaimah–Khasab)',
    destinationCountry: 'OMAN',
    latitude: 26.0505,
    longitude: 56.0865,
    bufferRadiusKm: 8,
  },
  {
    code: 'GHUWAIFAT_BATHA',
    name: 'Al Ghuwaifat / Al Batha Border (E11 UAE–Saudi Arabia)',
    destinationCountry: 'SAUDI_ARABIA',
    latitude: 24.1292,
    longitude: 51.5656,
    bufferRadiusKm: 12,
  },
] as const;

export interface CrossBorderEvaluationResult {
  vehicleId: string;
  agreementId: string | null;
  latitude: number;
  longitude: number;
  speedKmh: number;
  zoneStatus: GeofenceZoneStatus;
  detectedCountry: 'UAE' | 'OMAN' | 'SAUDI_ARABIA' | 'INTERNATIONAL';
  nearestBorderPost: string | null;
  nearestBorderName: string | null;
  distanceToBorderKm: number | null;
  authorized: boolean;
  breachDetected: boolean;
  severity: 'INFO' | 'HIGH' | 'CRITICAL';
  permitNo: string | null;
  permitValidUntil: string | null;
  alertId: string | null;
  message: string;
  evaluatedAt: string;
}

export interface ImmobilizerCommandInput {
  vehicleId: string;
  agreementId?: string | null;
  action: 'IMMOBILIZE' | 'RESTORE';
  reason: string;
  requestedBy: string;
  approvedBy?: string | null;
  notes?: string | null;
  telemetryOverride?: {
    speedKmh?: number | null;
    ignitionOn?: boolean | null;
  } | null;
}

export interface ImmobilizerCommandRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  agreementId: string | null;
  action: 'IMMOBILIZE' | 'RESTORE';
  status: ImmobilizerStatus;
  reason: string;
  speedAtRequestKmh: number;
  ignitionAtRequest: boolean;
  safetyInterlockPassed: boolean;
  safetyInterlockMessage: string;
  requestedBy: string;
  approvedBy: string | null;
  providerCommandRef: string | null;
  executedAt: string | null;
  restoredAt: string | null;
  notes: string | null;
  createdAt: string;
}

/**
 * Normalizes raw CAN-bus or ledger fuel readings to an integer percentage `0..100`.
 * Supports fractional ratios (`0 < val < 1` -> `val * 100`) and direct percentages (`0..100`).
 */
export function normalizeFuelPct(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const val = Number(raw);
  if (!Number.isFinite(val)) return null;
  if (val <= 0) return 0;
  if (val > 0 && val < 1) {
    return Math.min(100, Math.max(0, Math.round(val * 100)));
  }
  return Math.min(100, Math.max(0, Math.round(val)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function countryAliasesForPermit(country: 'OMAN' | 'SAUDI_ARABIA' | 'INTERNATIONAL'): string[] {
  if (country === 'OMAN') {
    return ['OMAN', 'OM', 'SULTANATE OF OMAN', 'MUSANDAM', 'GCC'];
  }
  if (country === 'SAUDI_ARABIA') {
    return ['SAUDI_ARABIA', 'SAUDI ARABIA', 'KSA', 'SA', 'GCC'];
  }
  return ['GCC', 'INTERNATIONAL'];
}

/**
 * Pure geographic classifier for UAE mainland vs UAE–Oman & UAE–KSA border buffers
 * and neighbouring country territories.
 */
export function classifyUaeCrossBorderCoordinates(
  latitude: number,
  longitude: number,
): {
  zoneStatus: GeofenceZoneStatus;
  detectedCountry: 'UAE' | 'OMAN' | 'SAUDI_ARABIA' | 'INTERNATIONAL';
  nearestBorder: BorderCrossingPoint;
  distanceToBorderKm: number;
} {
  let nearest = UAE_INTERNATIONAL_BORDERS[0];
  let minDistanceKm = Infinity;
  for (const post of UAE_INTERNATIONAL_BORDERS) {
    const dist = haversineKm(latitude, longitude, post.latitude, post.longitude);
    if (dist < minDistanceKm) {
      minDistanceKm = dist;
      nearest = post;
    }
  }
  const distanceToBorderKm = round2(minDistanceKm);

  // 1. Check Saudi Arabia territory (west of Ghuwaifat / south into Rub' al Khali)
  const inSaudiTerritory =
    (longitude < 51.565 && latitude <= 24.55) ||
    (latitude < 22.63 && longitude < 55.2) ||
    (longitude < 52.5 && latitude < 22.95);

  if (inSaudiTerritory) {
    const ksaPost =
      UAE_INTERNATIONAL_BORDERS.find((b) => b.code === 'GHUWAIFAT_BATHA') ?? nearest;
    return {
      zoneStatus: 'CROSS_BORDER_BREACH',
      detectedCountry: 'SAUDI_ARABIA',
      nearestBorder: ksaPost,
      distanceToBorderKm: round2(
        haversineKm(latitude, longitude, ksaPost.latitude, ksaPost.longitude),
      ),
    };
  }

  // 2. Check Sultanate of Oman territory (Musandam north, Buraimi enclave, Batinah/Muscat/Dhahirah east & south)
  const inOmanMusandam = latitude > 26.055 && longitude >= 55.95 && longitude <= 56.65;
  const inOmanBuraimi =
    latitude >= 24.18 && latitude <= 24.3 && longitude >= 55.775 && longitude <= 55.95;
  const inOmanEastOrProper =
    (longitude > 56.375 && latitude <= 25.15) ||
    (latitude < 24.785 && longitude > 56.13) ||
    (latitude < 24.03 && longitude >= 55.72) ||
    (latitude < 23.95 && longitude >= 55.2);

  if (inOmanMusandam || inOmanBuraimi || inOmanEastOrProper) {
    return {
      zoneStatus: 'CROSS_BORDER_BREACH',
      detectedCountry: 'OMAN',
      nearestBorder: nearest,
      distanceToBorderKm,
    };
  }

  // 3. Outside overall UAE bounding box fallback
  if (latitude < 22.6 || latitude > 26.15 || longitude < 51.5 || longitude > 56.4) {
    const inferredCountry =
      longitude < 53.5
        ? 'SAUDI_ARABIA'
        : longitude >= 55.2 || latitude > 25.6
          ? 'OMAN'
          : 'INTERNATIONAL';
    return {
      zoneStatus: 'CROSS_BORDER_BREACH',
      detectedCountry: inferredCountry,
      nearestBorder: nearest,
      distanceToBorderKm,
    };
  }

  // 4. Inside UAE, check proximity buffer to nearest international border crossing
  if (distanceToBorderKm <= nearest.bufferRadiusKm) {
    return {
      zoneStatus: 'APPROACHING_BORDER',
      detectedCountry: nearest.destinationCountry,
      nearestBorder: nearest,
      distanceToBorderKm,
    };
  }

  return {
    zoneStatus: 'INSIDE_UAE',
    detectedCountry: 'UAE',
    nearestBorder: nearest,
    distanceToBorderKm,
  };
}

/**
 * Reads live CAN-bus telemetry (odometer, fuel %, speed, ignition, GPS coordinates)
 * for a tenant vehicle with clean fallback to the `vehicles` ledger.
 */
export async function readVehicleCanBusSnapshotInTx(
  tx: TxClient,
  tenantId: string,
  vehicleId: string,
): Promise<VehicleCanBusSnapshot> {
  const vehRows = await withSavepoint<Array<{ v: Record<string, unknown> }> | null>(
    tx,
    'rac_canbus_veh',
    () =>
      tx.$queryRawUnsafe<Array<{ v: Record<string, unknown> }>>(
        `SELECT to_jsonb(v) AS v
           FROM vehicles v
          WHERE v.id::text = $1
            AND v.tenant_id::text = $2
            AND v.deleted_at IS NULL
          LIMIT 1`,
        vehicleId,
        tenantId,
      ),
    null,
  );

  if (vehRows !== null && vehRows.length === 0) {
    throw new RentalSecurityError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found in tenant');
  }

  const v = vehRows?.[0]?.v ?? {};
  const licensePlate =
    (v.license_plate as string | null) ?? (v.plate_number as string | null) ?? null;
  const make = (v.make as string | null) ?? null;
  const model = (v.model as string | null) ?? null;
  const category =
    (v.category as string | null) ??
    (v.vehicle_group as string | null) ??
    (v.vehicle_class as string | null) ??
    (v.type as string | null) ??
    null;
  const vehicleStatus = (v.status as string | null) ?? null;
  const ledgerDeviceId =
    (v.telematics_device_id as string | null) ?? (v.device_id as string | null) ?? null;

  const ledgerOdometer = Number(v.odometer_reading ?? v.current_mileage ?? 0);
  const ledgerFuel = normalizeFuelPct(v.fuel_level_pct ?? v.fuel_level);
  const ledgerLat = v.current_lat != null ? Number(v.current_lat) : null;
  const ledgerLng = v.current_lng != null ? Number(v.current_lng) : null;
  const ledgerSpeed = v.speed_kmh != null ? Number(v.speed_kmh) : null;
  const ledgerIgnition =
    typeof v.ignition_on === 'boolean' ? v.ignition_on : null;
  const ledgerPingAt = (v.last_ping_at as string | null) ?? null;

  // Optional live GPS ping in fleet.bus_gps_pings
  const gpsPings = await withSavepoint<
    Array<{
      latitude: number;
      longitude: number;
      speed_kmh: number | null;
      heading_deg: number | null;
      occurred_at: Date | string;
    }>
  >(
    tx,
    'rac_canbus_gps_ping',
    () =>
      tx.$queryRawUnsafe(
        `SELECT latitude, longitude, speed_kmh, heading_deg, occurred_at
           FROM fleet.bus_gps_pings
          WHERE vehicle_id::text = $1
            AND (tenant_id IS NULL OR tenant_id::text = $2)
          ORDER BY occurred_at DESC
          LIMIT 1`,
        vehicleId,
        tenantId,
      ),
    [],
  );
  const gpsPing = gpsPings[0];

  // Optional CAN-bus event in public.logistics_telematics_events
  const canEvents = await withSavepoint<
    Array<{
      device_id: string | null;
      latitude: number | string | null;
      longitude: number | string | null;
      speed_kph: number | string | null;
      heading: number | string | null;
      odometer_km: number | string | null;
      event_time: Date | string;
      raw_payload: Record<string, unknown> | null;
    }>
  >(
    tx,
    'rac_canbus_tel_event',
    () =>
      tx.$queryRawUnsafe(
        `SELECT device_id, latitude, longitude, speed_kph, heading, odometer_km, event_time, raw_payload
           FROM logistics_telematics_events
          WHERE vehicle_id::text = $1
            AND tenant_id::text = $2
          ORDER BY event_time DESC
          LIMIT 1`,
        vehicleId,
        tenantId,
      ),
    [],
  );
  const canEv = canEvents[0];

  // Optional lease_telematics tracker state
  const trackerRows = await withSavepoint<
    Array<{
      device_id: string | null;
      last_odometer: number | null;
      last_lat: number | null;
      last_lng: number | null;
      last_update_at: Date | string | null;
    }>
  >(
    tx,
    'rac_canbus_lease_tel',
    () =>
      tx.$queryRawUnsafe(
        `SELECT device_id, last_odometer, last_lat, last_lng, last_update_at
           FROM lease_telematics
          WHERE vehicle_id::text = $1
            AND tenant_id::text = $2
          ORDER BY last_update_at DESC NULLS LAST
          LIMIT 1`,
        vehicleId,
        tenantId,
      ),
    [],
  );
  const tracker = trackerRows[0];

  // Latest immobilizer command state
  const immobRows = await withSavepoint<Array<{ action: string; status: string }>>(
    tx,
    'rac_canbus_immob_state',
    () =>
      tx.$queryRawUnsafe(
        `SELECT action, status
           FROM rental_immobilizer_commands
          WHERE tenant_id::text = $1
            AND vehicle_id::text = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        tenantId,
        vehicleId,
      ),
    [],
  );
  const latestImmob = immobRows[0];
  let immobilizerState: 'IMMOBILIZED' | 'PENDING_SAFE_STOP' | 'NORMAL' = 'NORMAL';
  if (latestImmob) {
    const st = String(latestImmob.status ?? '').toUpperCase();
    if (st === 'EXECUTED') immobilizerState = 'IMMOBILIZED';
    else if (st === 'PENDING_SAFE_STOP') immobilizerState = 'PENDING_SAFE_STOP';
  }

  const hasLiveSignal = Boolean(
    gpsPing || canEv || tracker || ledgerDeviceId || ledgerPingAt,
  );
  const telemetrySource: TelemetrySource = hasLiveSignal
    ? 'LIVE_CANBUS'
    : 'VEHICLE_LEDGER_FALLBACK';

  const telematicsDeviceId =
    canEv?.device_id ?? tracker?.device_id ?? ledgerDeviceId ?? null;

  const rawOdo =
    (canEv?.odometer_km != null ? Number(canEv.odometer_km) : null) ??
    (tracker?.last_odometer != null ? Number(tracker.last_odometer) : null) ??
    (Number.isFinite(ledgerOdometer) ? ledgerOdometer : 0);
  const odometerKm = Math.max(0, Math.round(rawOdo));

  const payloadFuel = normalizeFuelPct(canEv?.raw_payload?.fuelPct ?? canEv?.raw_payload?.fuel_pct);
  const fuelPct = payloadFuel ?? ledgerFuel ?? 100;

  const rawSpeed =
    (gpsPing?.speed_kmh != null ? Number(gpsPing.speed_kmh) : null) ??
    (canEv?.speed_kph != null ? Number(canEv.speed_kph) : null) ??
    ledgerSpeed ??
    0;
  const speedKmh = Math.max(0, round2(Number.isFinite(rawSpeed) ? rawSpeed : 0));

  const payloadIgnition =
    typeof canEv?.raw_payload?.ignitionOn === 'boolean'
      ? canEv.raw_payload.ignitionOn
      : typeof canEv?.raw_payload?.ignition === 'boolean'
        ? canEv.raw_payload.ignition
        : null;
  const ignitionOn =
    speedKmh > 0 ? true : (payloadIgnition ?? ledgerIgnition ?? false);

  const latitude =
    (gpsPing?.latitude != null ? Number(gpsPing.latitude) : null) ??
    (canEv?.latitude != null ? Number(canEv.latitude) : null) ??
    (tracker?.last_lat != null ? Number(tracker.last_lat) : null) ??
    (ledgerLat != null && Number.isFinite(ledgerLat) ? ledgerLat : null);

  const longitude =
    (gpsPing?.longitude != null ? Number(gpsPing.longitude) : null) ??
    (canEv?.longitude != null ? Number(canEv.longitude) : null) ??
    (tracker?.last_lng != null ? Number(tracker.last_lng) : null) ??
    (ledgerLng != null && Number.isFinite(ledgerLng) ? ledgerLng : null);

  const headingDeg =
    (gpsPing?.heading_deg != null ? Number(gpsPing.heading_deg) : null) ??
    (canEv?.heading != null ? Number(canEv.heading) : null);

  const rawPingTime =
    gpsPing?.occurred_at ?? canEv?.event_time ?? tracker?.last_update_at ?? ledgerPingAt;
  const lastPingAt = rawPingTime
    ? rawPingTime instanceof Date
      ? rawPingTime.toISOString()
      : String(rawPingTime)
    : null;

  return {
    vehicleId,
    tenantId,
    licensePlate,
    make,
    model,
    category,
    vehicleStatus,
    telematicsDeviceId,
    telemetrySource,
    odometerKm,
    fuelPct,
    speedKmh,
    ignitionOn,
    latitude,
    longitude,
    headingDeg,
    lastPingAt,
    immobilizerState,
  };
}

/**
 * Evaluates a vehicle's live GPS coordinates against UAE mainland & international
 * UAE–Oman / UAE–Saudi Arabia borders, cross-checking `rental_cross_border_permits`.
 * Persists a `HIGH` / `CRITICAL` alert if approaching or breaching a border without an active NOC.
 */
export async function evaluateCrossBorderGeofenceInTx(
  tx: TxClient,
  tenantId: string,
  args: {
    vehicleId: string;
    agreementId?: string | null;
    latitude: number;
    longitude: number;
    speedKmh?: number;
    persistAlert?: boolean;
  },
): Promise<CrossBorderEvaluationResult> {
  const lat = Number(args.latitude);
  const lng = Number(args.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RentalSecurityError(
      400,
      'INVALID_COORDINATES',
      'latitude (-90..90) and longitude (-180..180) must be valid coordinates',
    );
  }

  await assertRentalForeignKeysInTenant(tx, tenantId, {
    vehicleId: args.vehicleId,
    agreementId: args.agreementId ?? null,
  });

  let effectiveAgreementId = args.agreementId ?? null;
  if (!effectiveAgreementId) {
    const activeAgrRows = await withSavepoint<Array<{ id: string }>>(
      tx,
      'geofence_active_agr',
      () =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text AS id
             FROM rental_agreements
            WHERE tenant_id::text = $1
              AND vehicle_id = $2
              AND deleted_at IS NULL
              AND status = 'ACTIVE'
            ORDER BY start_date DESC
            LIMIT 1`,
          tenantId,
          args.vehicleId,
        ),
      [],
    );
    effectiveAgreementId = activeAgrRows[0]?.id ?? null;
  }

  const speedKmh = Math.max(0, round2(Number(args.speedKmh ?? 0) || 0));
  const classification = classifyUaeCrossBorderCoordinates(lat, lng);
  const evaluatedAt = new Date().toISOString();

  if (classification.zoneStatus === 'INSIDE_UAE') {
    return {
      vehicleId: args.vehicleId,
      agreementId: effectiveAgreementId,
      latitude: lat,
      longitude: lng,
      speedKmh,
      zoneStatus: 'INSIDE_UAE',
      detectedCountry: 'UAE',
      nearestBorderPost: classification.nearestBorder.code,
      nearestBorderName: classification.nearestBorder.name,
      distanceToBorderKm: classification.distanceToBorderKm,
      authorized: true,
      breachDetected: false,
      severity: 'INFO',
      permitNo: null,
      permitValidUntil: null,
      alertId: null,
      message: `Vehicle is operating within UAE mainland (${classification.distanceToBorderKm} km from ${classification.nearestBorder.name}).`,
      evaluatedAt,
    };
  }

  // Check active Cross-Border NOC Permit in `rental_cross_border_permits`
  const acceptedCountries = countryAliasesForPermit(
    classification.detectedCountry === 'UAE' ? 'INTERNATIONAL' : classification.detectedCountry,
  );

  const permitRows = await withSavepoint<
    Array<{
      permit_no: string;
      destination_country: string;
      return_date: Date | string;
    }>
  >(
    tx,
    'geofence_chk_permit',
    () =>
      tx.$queryRawUnsafe(
        `SELECT permit_no, destination_country, return_date
           FROM rental_cross_border_permits
          WHERE tenant_id::text = $1
            AND vehicle_id::text = $2
            AND status = 'ISSUED'
            AND revoked_at IS NULL
            AND NOW() BETWEEN departure_date AND return_date
            AND UPPER(TRIM(destination_country)) = ANY($3::text[])
            ${effectiveAgreementId ? 'AND (agreement_id IS NULL OR agreement_id::text = $4)' : ''}
          ORDER BY return_date DESC
          LIMIT 1`,
        ...(effectiveAgreementId
          ? [tenantId, args.vehicleId, acceptedCountries, effectiveAgreementId]
          : [tenantId, args.vehicleId, acceptedCountries]),
      ),
    [],
  );

  const activePermit = permitRows[0];
  if (activePermit) {
    const validUntil =
      activePermit.return_date instanceof Date
        ? activePermit.return_date.toISOString()
        : String(activePermit.return_date);
    return {
      vehicleId: args.vehicleId,
      agreementId: effectiveAgreementId,
      latitude: lat,
      longitude: lng,
      speedKmh,
      zoneStatus: classification.zoneStatus,
      detectedCountry: classification.detectedCountry,
      nearestBorderPost: classification.nearestBorder.code,
      nearestBorderName: classification.nearestBorder.name,
      distanceToBorderKm: classification.distanceToBorderKm,
      authorized: true,
      breachDetected: false,
      severity: 'INFO',
      permitNo: activePermit.permit_no,
      permitValidUntil: validUntil,
      alertId: null,
      message: `Authorized cross-border movement covered by active NOC permit ${activePermit.permit_no} (${activePermit.destination_country}).`,
      evaluatedAt,
    };
  }

  // Unauthorized border approach or breach — raise HIGH / CRITICAL alert!
  const severity: 'HIGH' | 'CRITICAL' =
    classification.zoneStatus === 'CROSS_BORDER_BREACH' ? 'CRITICAL' : 'HIGH';
  const alertCode =
    classification.zoneStatus === 'CROSS_BORDER_BREACH'
      ? 'RAC_CROSS_BORDER_BREACH'
      : 'RAC_BORDER_APPROACH_NO_NOC';
  const alertTitle =
    classification.zoneStatus === 'CROSS_BORDER_BREACH'
      ? `Unauthorized Cross-Border Breach (${classification.detectedCountry})`
      : `Vehicle Approaching ${classification.nearestBorder.name} Without NOC`;
  const message =
    classification.zoneStatus === 'CROSS_BORDER_BREACH'
      ? `CRITICAL: Vehicle crossed into ${classification.detectedCountry} near ${classification.nearestBorder.name} (${lat.toFixed(4)}, ${lng.toFixed(4)}) without a valid Cross-Border NOC / Orange Card permit.`
      : `HIGH: Vehicle is within ${classification.distanceToBorderKm} km of ${classification.nearestBorder.name} without an issued ${classification.detectedCountry} Cross-Border NOC permit.`;

  let alertId: string | null = null;
  if (args.persistAlert !== false) {
    const dedupeKey = `rac-geofence:${args.vehicleId}:${alertCode}:${classification.nearestBorder.code}`;
    const existingOpen = await withSavepoint<Array<{ id: string }>>(
      tx,
      'geofence_dedup_alert',
      () =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text AS id
             FROM alerts
            WHERE tenant_id::text = $1
              AND dedupe_key = $2
              AND deleted_at IS NULL
              AND COALESCE(UPPER(status), 'OPEN') = 'OPEN'
            LIMIT 1`,
          tenantId,
          dedupeKey,
        ),
      [],
    );

    if (existingOpen[0]?.id) {
      alertId = existingOpen[0].id;
    } else {
      const candidateId = randomUUID();
      const inserted = await withSavepoint<Array<{ id: string }>>(
        tx,
        'geofence_insert_alert',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `INSERT INTO alerts (
               id,
               tenant_id,
               type,
               code,
               title,
               description,
               severity,
               status,
               source_module,
               subject_type,
               subject_id,
               related_entity_id,
               dedupe_key,
               context,
               date_created,
               created_at,
               updated_at
             )
             VALUES (
               $1, $2, 'GEOFENCE_BREACH', $3, $4, $5, $6, 'OPEN', 'rental',
               'Vehicle', $7, $8, $9, $10::jsonb, NOW(), NOW(), NOW()
             )
             RETURNING id::text AS id`,
            candidateId,
            tenantId,
            alertCode,
            alertTitle,
            message,
            severity,
            args.vehicleId,
            effectiveAgreementId ?? args.vehicleId,
            dedupeKey,
            JSON.stringify({
              vehicleId: args.vehicleId,
              agreementId: effectiveAgreementId,
              latitude: lat,
              longitude: lng,
              speedKmh,
              detectedCountry: classification.detectedCountry,
              borderPost: classification.nearestBorder.code,
              distanceToBorderKm: classification.distanceToBorderKm,
            }),
          ),
        [],
      );
      alertId = inserted[0]?.id ?? null;
    }
  }

  return {
    vehicleId: args.vehicleId,
    agreementId: effectiveAgreementId,
    latitude: lat,
    longitude: lng,
    speedKmh,
    zoneStatus: classification.zoneStatus,
    detectedCountry: classification.detectedCountry,
    nearestBorderPost: classification.nearestBorder.code,
    nearestBorderName: classification.nearestBorder.name,
    distanceToBorderKm: classification.distanceToBorderKm,
    authorized: false,
    breachDetected: true,
    severity,
    permitNo: null,
    permitValidUntil: null,
    alertId,
    message,
    evaluatedAt,
  };
}

/**
 * Executes a starter-kill `IMMOBILIZE` or `RESTORE` command with Mandatory Road-Safety Interlock:
 *   - NEVER cuts power on a moving (`speedKmh > 0`) or running (`ignitionOn === true`) vehicle!
 *   - Queues `PENDING_SAFE_STOP` when moving/ignition-on so starter-kill latches ONLY after safe park.
 */
export async function executeSafeImmobilizerCommandInTx(
  tx: TxClient,
  tenantId: string,
  input: ImmobilizerCommandInput,
): Promise<ImmobilizerCommandRecord> {
  const action = String(input.action ?? '').trim().toUpperCase();
  if (action !== 'IMMOBILIZE' && action !== 'RESTORE') {
    throw new RentalSecurityError(
      400,
      'INVALID_IMMOBILIZER_ACTION',
      'action must be IMMOBILIZE or RESTORE',
    );
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3) {
    throw new RentalSecurityError(
      400,
      'IMMOBILIZER_REASON_REQUIRED',
      'A clear audit reason (minimum 3 characters) is required for immobilizer commands',
    );
  }

  const requestedBy = String(input.requestedBy ?? '').trim();
  if (!requestedBy) {
    throw new RentalSecurityError(
      401,
      'REQUESTER_REQUIRED',
      'Authenticated supervisor userId is required',
    );
  }

  await assertRentalForeignKeysInTenant(tx, tenantId, {
    vehicleId: input.vehicleId,
    agreementId: input.agreementId ?? null,
  });

  return withRentalLock(
    tx,
    tenantId,
    {
      entityKey: `rac-immobilizer:${input.vehicleId}`,
      vehicleIds: [input.vehicleId],
    },
    async () => {
      const snapshot = await readVehicleCanBusSnapshotInTx(tx, tenantId, input.vehicleId);

      const overrideSpeed =
        input.telemetryOverride?.speedKmh != null
          ? Number(input.telemetryOverride.speedKmh)
          : null;
      const speedAtRequestKmh =
        overrideSpeed != null && Number.isFinite(overrideSpeed)
          ? Math.max(0, round2(overrideSpeed))
          : snapshot.speedKmh;

      const overrideIgnition =
        typeof input.telemetryOverride?.ignitionOn === 'boolean'
          ? input.telemetryOverride.ignitionOn
          : null;
      // Physical safety rule: a moving vehicle (speed > 0) is NEVER treated as ignition-off
      const ignitionAtRequest =
        speedAtRequestKmh > 0
          ? true
          : (overrideIgnition ?? snapshot.ignitionOn);

      let safetyInterlockPassed = false;
      let status: ImmobilizerStatus = 'PENDING_SAFE_STOP';
      let executedAt: Date | null = null;
      let restoredAt: Date | null = null;
      let safetyInterlockMessage: string;

      if (action === 'IMMOBILIZE') {
        if (speedAtRequestKmh > 0 || ignitionAtRequest === true) {
          safetyInterlockPassed = false;
          status = 'PENDING_SAFE_STOP';
          executedAt = null;
          safetyInterlockMessage = `Road-safety interlock engaged (speed=${speedAtRequestKmh} km/h, ignition=${ignitionAtRequest ? 'ON' : 'OFF'}). Starter-kill armed in PENDING_SAFE_STOP and will latch ONLY after speed = 0 km/h and ignition = OFF.`;
        } else {
          safetyInterlockPassed = true;
          status = 'EXECUTED';
          executedAt = new Date();
          safetyInterlockMessage =
            'Road-safety interlock passed (vehicle stationary at 0 km/h with ignition OFF). Starter-kill latch EXECUTED.';
        }
      } else {
        safetyInterlockPassed = true;
        status = 'RESTORED';
        restoredAt = new Date();
        safetyInterlockMessage = 'Starter-kill latch released; normal vehicle ignition RESTORED.';

        // Disarm any previously queued PENDING_SAFE_STOP commands on this vehicle
        await withSavepoint(
          tx,
          'immob_disarm_pending',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE rental_immobilizer_commands
                  SET status = 'RESTORED',
                      restored_at = NOW(),
                      updated_at = NOW()
                WHERE tenant_id::text = $1
                  AND vehicle_id::text = $2
                  AND status IN ('PENDING_SAFE_STOP', 'EXECUTED')`,
              tenantId,
              input.vehicleId,
            ),
          0,
        );
      }

      const approvedBy = input.approvedBy ?? requestedBy;
      const notes = input.notes ? String(input.notes).trim() : null;
      const fallbackId = randomUUID();
      const nowIso = new Date().toISOString();

      const insertedRows = await withSavepoint<
        Array<{ id: string; created_at: Date | string }>
      >(
        tx,
        'immob_insert_cmd',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string; created_at: Date | string }>>(
            `INSERT INTO rental_immobilizer_commands (
               tenant_id,
               vehicle_id,
               agreement_id,
               action,
               status,
               reason,
               speed_at_request_kmh,
               ignition_at_request,
               safety_interlock_passed,
               requested_by,
               approved_by,
               executed_at,
               restored_at,
               notes,
               created_at,
               updated_at
             )
             VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12::timestamptz, $13::timestamptz, $14, NOW(), NOW()
             )
             RETURNING id::text AS id, created_at`,
            tenantId,
            input.vehicleId,
            input.agreementId ?? null,
            action,
            status,
            reason,
            speedAtRequestKmh,
            ignitionAtRequest,
            safetyInterlockPassed,
            requestedBy,
            approvedBy,
            executedAt ? executedAt.toISOString() : null,
            restoredAt ? restoredAt.toISOString() : null,
            notes,
          ),
        [{ id: fallbackId, created_at: nowIso }],
      );

      const persisted = insertedRows[0] ?? { id: fallbackId, created_at: nowIso };
      const createdAtIso =
        persisted.created_at instanceof Date
          ? persisted.created_at.toISOString()
          : String(persisted.created_at);

      return {
        id: persisted.id,
        tenantId,
        vehicleId: input.vehicleId,
        agreementId: input.agreementId ?? null,
        action,
        status,
        reason,
        speedAtRequestKmh,
        ignitionAtRequest,
        safetyInterlockPassed,
        safetyInterlockMessage,
        requestedBy,
        approvedBy,
        providerCommandRef: null,
        executedAt: executedAt ? executedAt.toISOString() : null,
        restoredAt: restoredAt ? restoredAt.toISOString() : null,
        notes,
        createdAt: createdAtIso,
      };
    },
  );
}
