/**
 * Shared fleet-position upsert, split out of
 * src/app/api/bus-ops/fleet-positions/route.ts so a sibling route
 * (vehicles/[id]/location) can call it directly -- Next.js route.ts files
 * may only export HTTP method handlers, so a business-logic helper can't
 * be exported from one route.ts and imported by another.
 *
 * Table lives in bus_ops_vehicle_positions (created via
 * prisma/raw/add_bus_ops_vehicle_positions.sql).
 */

import { prisma } from '@/lib/prisma';

export type Row = Record<string, unknown>;

export function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
  });
}

export interface FleetPositionInput {
  tenantId: string;
  vehicleId: string;
  vehiclePlate?: string | null;
  routeId?: string | null;
  routeName?: string | null;
  tripId?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  lat: number;
  lng: number;
  speedKmh?: number;
  headingDeg?: number;
  status?: string;
  nextStopName?: string | null;
  nextStopEta?: string | null;
  passengersOnboard?: number;
}

export async function upsertFleetPosition(p: FleetPositionInput) {
  const [row] = await prisma.$queryRawUnsafe<Row[]>(`
    INSERT INTO bus_ops_vehicle_positions
      (tenant_id, vehicle_id, vehicle_plate, route_id, route_name, trip_id,
       driver_id, driver_name,
       lat, lng, speed_kmh, heading_deg, status,
       next_stop_name, next_stop_eta, passengers_onboard,
       last_ping_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
    ON CONFLICT (vehicle_id, tenant_id) DO UPDATE SET
      vehicle_plate     = EXCLUDED.vehicle_plate,
      route_id          = EXCLUDED.route_id,
      route_name        = EXCLUDED.route_name,
      trip_id           = EXCLUDED.trip_id,
      driver_id         = EXCLUDED.driver_id,
      driver_name       = EXCLUDED.driver_name,
      lat               = EXCLUDED.lat,
      lng               = EXCLUDED.lng,
      speed_kmh         = EXCLUDED.speed_kmh,
      heading_deg       = EXCLUDED.heading_deg,
      status            = EXCLUDED.status,
      next_stop_name    = EXCLUDED.next_stop_name,
      next_stop_eta     = EXCLUDED.next_stop_eta,
      passengers_onboard= EXCLUDED.passengers_onboard,
      last_ping_at      = NOW(),
      updated_at        = NOW()
    RETURNING *
  `,
    p.tenantId, p.vehicleId, p.vehiclePlate ?? null,
    p.routeId ?? null, p.routeName ?? null, p.tripId ?? null,
    p.driverId ?? null, p.driverName ?? null,
    p.lat, p.lng,
    Number(p.speedKmh ?? 0), Number(p.headingDeg ?? 0),
    p.status ?? 'EN_ROUTE',
    p.nextStopName ?? null, p.nextStopEta ?? null,
    Number(p.passengersOnboard ?? 0),
  );
  return serialize([row])[0];
}
