/**
 * Read-only loaders that give the Compliance, Fleet Workforce Planner and
 * Vehicle Reuse agents their own tenant's data when a run carries none
 * (cron sweeps, "Run analysis" in the UI). Those agents used to evaluate
 * empty arrays and report one item processed.
 *
 * Every query names the tenant, on top of RLS; the loaders run in one tenant
 * transaction. "Today" and "tomorrow" are Gulf Standard Time (+04:00), the
 * operating day of the fleets this serves.
 */
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

type Db = { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> };

export const OPERATING_UTC_OFFSET = '+04:00';
const OFFSET_MS = 4 * 3600000;

/** The operating day `daysAhead` from now: YYYY-MM-DD and its UTC bounds. */
export function operatingDay(daysAhead = 0, now = new Date()): { date: string; from: Date; to: Date } {
  const local = new Date(now.getTime() + OFFSET_MS + daysAhead * 86400000);
  const date = local.toISOString().slice(0, 10);
  const from = new Date(`${date}T00:00:00${OPERATING_UTC_OFFSET}`);
  return { date, from, to: new Date(from.getTime() + 86400000) };
}

export interface FleetVehicleRow {
  id: string;
  code: string;
  plate: string | null;
  category: string | null;
  seats: number | null;
  status: string | null;
  depotId: string | null;
  usage: string | null;
  registrationExpiry: Date | null;
  insuranceExpiry: Date | null;
  mulkiyaExpiry: Date | null;
}

export interface FleetDriverRow {
  id: string;
  name: string;
  licenseType: string | null;
  licenseExpiry: Date | null;
  emiratesIdExpiry: Date | null;
  visaExpiry: Date | null;
  status: string | null;
}

export interface TripRow {
  id: string;
  tripNumber: string | null;
  routeId: string;
  routeName: string | null;
  origin: string | null;
  destination: string | null;
  requiredLicenseType: string | null;
  requiredVehicleGroup: string | null;
  vehicleId: string | null;
  driverId: string | null;
  departure: Date;
  arrival: Date | null;
  /** True when no arrival time is recorded and one hour was assumed. */
  arrivalAssumed: boolean;
  passengers: number;
  status: string | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
}

export interface DepotRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

async function vehicles(db: Db, tenantId: string): Promise<FleetVehicleRow[]> {
  return db.$queryRawUnsafe<FleetVehicleRow[]>(
    `SELECT id::text AS id,
            COALESCE(vehicle_code, license_plate, plate_number, id::text) AS code,
            COALESCE(license_plate, plate_number) AS plate,
            COALESCE(category, type) AS category,
            seating_capacity AS seats,
            status,
            home_depot_id AS "depotId",
            vehicle_usage AS usage,
            registration_expiry AS "registrationExpiry",
            insurance_expiry AS "insuranceExpiry",
            mulkiya_expiry AS "mulkiyaExpiry"
       FROM vehicles
      WHERE tenant_id = $1 AND deleted_at IS NULL
        AND COALESCE(UPPER(status), '') NOT IN ('SOLD', 'INACTIVE')`,
    tenantId,
  );
}

async function drivers(db: Db, tenantId: string): Promise<FleetDriverRow[]> {
  return db.$queryRawUnsafe<FleetDriverRow[]>(
    `SELECT id::text AS id,
            COALESCE(NULLIF(name, ''), TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), id::text) AS name,
            license_type AS "licenseType",
            license_expiry AS "licenseExpiry",
            emirates_id_expiry AS "emiratesIdExpiry",
            visa_expiry AS "visaExpiry",
            status
       FROM drivers
      WHERE tenant_id = $1 AND deleted_at IS NULL
        AND COALESCE(UPPER(status), 'ACTIVE') <> 'INACTIVE'`,
    tenantId,
  );
}

/** Trips departing in [from, to), with route requirements and first/last stop coordinates. */
async function trips(db: Db, tenantId: string, from: Date, to: Date): Promise<TripRow[]> {
  const rows = await db.$queryRawUnsafe<Array<Omit<TripRow, 'arrivalAssumed'>>>(
    `SELECT ts.id::text AS id,
            ts.trip_number AS "tripNumber",
            ts.route_id::text AS "routeId",
            r.name AS "routeName",
            r.origin,
            r.destination,
            r.required_license_type AS "requiredLicenseType",
            r.required_vehicle_group AS "requiredVehicleGroup",
            ts.vehicle_id AS "vehicleId",
            ts.driver_id AS "driverId",
            ts.departure_time AS departure,
            COALESCE(ts.arrival_time, ts.estimated_arrival_time, ts.latest_arrival_time) AS arrival,
            COALESCE(NULLIF(ts.confirmed_count, 0), 0) AS passengers,
            ts.status,
            fs.gps_lat AS "startLat", fs.gps_lng AS "startLng",
            ls.gps_lat AS "endLat", ls.gps_lng AS "endLng"
       FROM trip_schedules ts
       LEFT JOIN bus_routes r ON r.id::text = ts.route_id::text
       LEFT JOIN LATERAL (
         SELECT gps_lat, gps_lng FROM route_stops s
          WHERE s.route_id::text = ts.route_id::text AND s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL
          ORDER BY s.sequence ASC LIMIT 1) fs ON TRUE
       LEFT JOIN LATERAL (
         SELECT gps_lat, gps_lng FROM route_stops s
          WHERE s.route_id::text = ts.route_id::text AND s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL
          ORDER BY s.sequence DESC LIMIT 1) ls ON TRUE
      WHERE ts.tenant_id::text = $1
        AND ts.deleted_at IS NULL
        AND ts.departure_time >= $2::timestamptz AND ts.departure_time < $3::timestamptz
        AND COALESCE(UPPER(ts.status), 'SCHEDULED') NOT IN ('CANCELLED', 'COMPLETED', 'MERGED')
      ORDER BY ts.departure_time ASC
      LIMIT 2000`,
    tenantId,
    from.toISOString(),
    to.toISOString(),
  );
  return rows.map((r) => {
    const departure = new Date(r.departure);
    const arrival = r.arrival ? new Date(r.arrival) : null;
    return {
      ...r,
      departure,
      arrival: arrival ?? new Date(departure.getTime() + 3600000),
      arrivalAssumed: !arrival,
      passengers: Number(r.passengers) || 0,
      startLat: r.startLat === null ? null : Number(r.startLat),
      startLng: r.startLng === null ? null : Number(r.startLng),
      endLat: r.endLat === null ? null : Number(r.endLat),
      endLng: r.endLng === null ? null : Number(r.endLng),
    };
  });
}

/** On-duty and driving minutes per driver since `from` (hos_logs). */
async function dutyMinutes(db: Db, tenantId: string, from: Date, to: Date): Promise<Map<string, number>> {
  const rows = await db.$queryRawUnsafe<Array<{ driverId: string; minutes: number }>>(
    `SELECT driver_id AS "driverId",
            COALESCE(SUM(COALESCE(duration_mins,
              EXTRACT(EPOCH FROM (LEAST(COALESCE(ended_at, NOW()), $3::timestamptz) - started_at)) / 60)), 0)::float8 AS minutes
       FROM hos_logs
      WHERE tenant_id = $1
        AND started_at >= $2::timestamptz AND started_at < $3::timestamptz
        AND UPPER(duty_status) IN ('ON_DUTY', 'DRIVING')
      GROUP BY driver_id`,
    tenantId,
    from.toISOString(),
    to.toISOString(),
  );
  return new Map(rows.map((r) => [r.driverId, Math.max(0, Math.round(Number(r.minutes) || 0))]));
}

async function depots(db: Db, tenantId: string): Promise<DepotRow[]> {
  const rows = await db.$queryRawUnsafe<DepotRow[]>(
    `SELECT id::text AS id, name, center_lat AS lat, center_lng AS lng
       FROM spatial.places
      WHERE tenant_id::text = $1 AND deleted_at IS NULL AND UPPER(type) = 'DEPOT'
        AND center_lat IS NOT NULL AND center_lng IS NOT NULL`,
    tenantId,
  );
  return rows.map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
}

/** Everything the three agents read, for one tenant. */
export interface TenantOperationsSnapshot {
  vehicles: FleetVehicleRow[];
  drivers: FleetDriverRow[];
  tripsToday: TripRow[];
  tripsTomorrow: TripRow[];
  dutyToday: Map<string, number>;
  dutyLast7Days: Map<string, number>;
  depots: DepotRow[];
  today: string;
  tomorrow: string;
  /** Parts that could not be read (e.g. a module whose tables this tenant lacks). */
  unavailable: string[];
}

export async function loadTenantOperations(
  tenantId: string,
  parts: { trips?: boolean; duty?: boolean; depots?: boolean } = { trips: true, duty: true, depots: true },
  now = new Date(),
): Promise<TenantOperationsSnapshot> {
  const today = operatingDay(0, now);
  const tomorrow = operatingDay(1, now);
  const weekAgo = new Date(today.from.getTime() - 6 * 86400000);
  const unavailable: string[] = [];
  // Each part in its own tenant transaction: a missing table (a module the
  // tenant does not use) must not abort the others.
  const read = async <T>(name: string, fallback: T, fn: (db: Db) => Promise<T>): Promise<T> => {
    try {
      return await withTenantRls(prisma, tenantId, (tx) => fn(tx as unknown as Db));
    } catch (err) {
      console.warn(`[agent-data] ${name} unavailable for tenant ${tenantId}:`, err instanceof Error ? err.message : err);
      unavailable.push(name);
      return fallback;
    }
  };
  const v = await read('vehicles', [] as FleetVehicleRow[], (db) => vehicles(db, tenantId));
  const d = await read('drivers', [] as FleetDriverRow[], (db) => drivers(db, tenantId));
  const tripsToday = parts.trips ? await read('trips', [] as TripRow[], (db) => trips(db, tenantId, today.from, today.to)) : [];
  const tripsTomorrow = parts.trips ? await read('trips', [] as TripRow[], (db) => trips(db, tenantId, tomorrow.from, tomorrow.to)) : [];
  const dutyToday = parts.duty ? await read('hours of service', new Map<string, number>(), (db) => dutyMinutes(db, tenantId, today.from, today.to)) : new Map<string, number>();
  const dutyLast7Days = parts.duty ? await read('hours of service', new Map<string, number>(), (db) => dutyMinutes(db, tenantId, weekAgo, today.to)) : new Map<string, number>();
  const depotRows = parts.depots ? await read('depots', [] as DepotRow[], (db) => depots(db, tenantId)) : [];
  return {
    vehicles: v,
    drivers: d,
    tripsToday,
    tripsTomorrow,
    dutyToday,
    dutyLast7Days,
    depots: depotRows,
    today: today.date,
    tomorrow: tomorrow.date,
    unavailable: [...new Set(unavailable)],
  };
}

/** Licences implied by a driver's licence type (drivers.license_type). */
export function licenceClassesFor(licenseType: string | null | undefined): string[] {
  const t = (licenseType ?? '').toUpperCase();
  if (!t) return [];
  if (t === 'BUS' || t === 'HEAVY_BUS') return ['BUS', 'HEAVY_BUS'];
  if (t === 'HEAVY') return ['HEAVY'];
  return [t];
}
