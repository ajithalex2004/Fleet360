import { NextRequest, NextResponse } from 'next/server';
import { requireBusOpsRequest } from '@/lib/bus-ops/access';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { evaluateConsolidationEvidence, type HistoricalTrip } from '@/lib/planning/consolidation-evidence';

export const dynamic = 'force-dynamic';

/** Read-only, aggregate evidence. Only completed, tenant-owned trips; no rider identities. */
export async function POST(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const permError = await requireBusOpsAdminAccess(req, 'route-consolidation');
  if (permError) return permError;

  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const { routeIds, days = 30 } = stripTenantOwnershipFields(input as Record<string, unknown>);
  if (!Array.isArray(routeIds) || routeIds.length !== 2 || routeIds.some(id => typeof id !== 'string' || !id || id.length > 128) || routeIds[0] === routeIds[1]
      || !Number.isInteger(days) || (days as number) < 7 || (days as number) > 90) {
    return NextResponse.json({ error: 'Supply two distinct route IDs and days between 7 and 90' }, { status: 400 });
  }
  const pair = routeIds as [string, string];
  const since = new Date(Date.now() - (days as number) * 86_400_000);

  try {
    const result = await withTenantRls(prisma, authz.tenantId, async tx => {
      const routes = await tx.busRoute.findMany({
        where: { tenantId: authz.tenantId, id: { in: pair }, deletedAt: null },
        select: { id: true, name: true, capacity: true },
      });
      if (routes.length !== 2) return null;
      // 5001st row signals truncation; never certify a partially sampled period.
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
        ORDER BY ts.departure_time, ts.id LIMIT 5001`, authz.tenantId, pair, since, new Date());
      const truncated = rows.length > 5000;
      const trips: HistoricalTrip[] = rows.slice(0, 5000).map(row => ({
        routeId: row.routeId, serviceDay: row.serviceDay, shift: row.shift, direction: row.direction, departureTime: row.departureTime,
        capacity: row.capacity, reserved: Number(row.reserved), boarded: Number(row.boarded),
        attendanceRows: Number(row.attendanceRows), fuelLitres: row.fuelLitres === null ? null : Number(row.fuelLitres),
        distanceKm: row.distanceKm === null ? null : Number(row.distanceKm),
        durationMinutes: row.durationMinutes === null ? null : Number(row.durationMinutes),
      }));
      // Most optimistic existing capacity, disclosed explicitly. A real
      // substitute/merged bus and stop sequence still require approval.
      const capacities = routes.map(route => route.capacity).filter((n): n is number => n !== null && n > 0);
      const capacityAssumption = capacities.length === 2 ? Math.max(...capacities) : null;
      const rate = (key: string, fallback: number) => {
        const value = Number(process.env[key] ?? fallback);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
      };
      const rates = {
        fuelPerLitre: rate('BUS_FUEL_AED_PER_L', 2.95),
        driverPerHour: rate('BUS_DRIVER_AED_PER_HR', 30),
        vehiclePerKm: rate('BUS_VEHICLE_AED_PER_KM', 0.5),
      };
      const evidence = evaluateConsolidationEvidence(trips, pair, capacityAssumption, rates);
      return { windowDays: days, timezone: 'Asia/Dubai', routes, capacityAssumption,
        rates, truncated, ...evidence,
        assessment: truncated ? 'INSUFFICIENT_DATA' : evidence.assessment,
        caveat: 'Observed cost covers complete trip logs only. A historical baseline does not establish realized or future savings, vehicle/driver feasibility, or stop-level timing.',
      };
    });
    return result
      ? NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
      : NextResponse.json({ error: 'Routes not found in tenant' }, { status: 404 });
  } catch (error) {
    console.error('[route-consolidation.evidence]', error);
    return NextResponse.json({ error: 'Historical evidence unavailable' }, { status: 500 });
  }
}
