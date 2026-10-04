import type { TxClient } from '@/lib/rls';
import type { HistoricalTrip } from './consolidation-evidence';

/** A bounded, tenant-scoped read of completed service, attendance and logs. */
export async function loadHistoricalTripEvidence(
  tx: TxClient, tenantId: string, pair: [string, string], since: Date, until: Date,
): Promise<{ trips: HistoricalTrip[]; truncated: boolean }> {
  const rows = await tx.$queryRawUnsafe<Array<{
    routeId: string; serviceDay: string; shift: string | null; direction: string | null; departureTime: Date;
    capacity: number | null; reserved: bigint; boarded: bigint; attendanceRows: bigint;
    fuelLitres: number | null; distanceKm: number | null; durationMinutes: number | null;
  }>>(`SELECT ts.route_id AS "routeId", ts.departure_time AS "departureTime",
      to_char(ts.departure_time AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD') AS "serviceDay",
      ts.shift_type AS shift, ts.direction AS direction, ts.capacity AS capacity,
      COALESCE(att.reserved, 0) AS reserved, COALESCE(att.boarded, 0) AS boarded,
      COALESCE(att.rows, 0) AS "attendanceRows",
      log.fuel_used AS "fuelLitres",
      CASE WHEN log.end_mileage >= log.start_mileage THEN log.end_mileage - log.start_mileage ELSE NULL END AS "distanceKm",
      CASE WHEN log.actual_arrival_time >= log.actual_departure_time
        THEN EXTRACT(EPOCH FROM (log.actual_arrival_time - log.actual_departure_time)) / 60 ELSE NULL END AS "durationMinutes"
    FROM trip_schedules ts
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::bigint AS rows,
        COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'BOARDED'))::bigint AS reserved,
        COUNT(*) FILTER (WHERE status = 'BOARDED')::bigint AS boarded
      FROM trip_passengers tp
      WHERE tp.trip_id = ts.id AND tp.tenant_id = $1::text AND tp.deleted_at IS NULL
    ) att ON TRUE
    LEFT JOIN LATERAL (
      SELECT fuel_used, start_mileage, end_mileage, actual_departure_time, actual_arrival_time
      FROM trip_logs tl WHERE tl.schedule_id = ts.id AND tl.tenant_id = $1::text AND tl.deleted_at IS NULL
      ORDER BY tl.created_at DESC NULLS LAST, tl.id DESC LIMIT 1
    ) log ON TRUE
    WHERE ts.tenant_id = $1::uuid AND ts.route_id = ANY($2::text[])
      AND ts.deleted_at IS NULL AND ts.status = 'COMPLETED'
      AND ts.departure_time >= $3 AND ts.departure_time < $4
    ORDER BY ts.departure_time, ts.id LIMIT 5001`, tenantId, pair, since, until);
  return {
    truncated: rows.length > 5000,
    trips: rows.slice(0, 5000).map(row => ({
      routeId: row.routeId, serviceDay: row.serviceDay, shift: row.shift, direction: row.direction, departureTime: row.departureTime,
      capacity: row.capacity, reserved: Number(row.reserved), boarded: Number(row.boarded),
      attendanceRows: Number(row.attendanceRows), fuelLitres: row.fuelLitres === null ? null : Number(row.fuelLitres),
      distanceKm: row.distanceKm === null ? null : Number(row.distanceKm),
      durationMinutes: row.durationMinutes === null ? null : Number(row.durationMinutes),
    })),
  };
}
