export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/today/assignments/route.ts
 *
 * GET /api/driver-app/today/assignments
 *
 * Returns the trips assigned to the current driver for today, with
 * per-trip behaviour score + breakdown. Powers the today page's
 * trip cards (#14 in the driver-app roadmap).
 *
 * The score is computed in a single batch query — we group
 * behavior_events by trip_id and run the same formula as the
 * per-trip /api/driver-app/behavior-events?tripId=... endpoint.
 *
 * Cache strategy: private (driver-scoped), 30s. After a trip ends
 * or behaviour data is uploaded, callers revalidate by refetching.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { privateCacheControl } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { toDriverTripStatus } from '@/lib/trip-state';
interface TripRow {
  id: string;
  status: string;
  departure_time: Date;
  arrival_time: Date;
  direction: string | null;
  trip_number: string | null;
  capacity: number | null;
  confirmed_count: number | null;
  route_id: string;
  route_name: string | null;
  vehicle_plate: string | null;
  // Driver-controlled lifecycle (see /api/driver-app/trips/[id]/start + /end)
  actual_departure_at: Date | null;
  actual_arrival_at: Date | null;
  started_by_driver_id: string | null;
  ended_by_driver_id: string | null;
  late_minutes: number | null;
  duration_minutes: number | null;
}

interface ScoreRow {
  trip_id: string;
  type: string;
  occurred_at: Date;
}

interface ScoreBreakdown {
  score: number;
  harshBrake: number;
  harshAccel: number;
  speeding: number;
  idleMinutes: number;
}

function computeScore(rows: ScoreRow[]): ScoreBreakdown {
  let harshBrake = 0;
  let harshAccel = 0;
  let speeding = 0;
  let idleMs = 0;
  let openIdle: number | null = null;
  for (const r of rows) {
    if (r.type === 'HARSH_BRAKE') harshBrake++;
    else if (r.type === 'HARSH_ACCEL') harshAccel++;
    else if (r.type === 'SPEEDING') speeding++;
    else if (r.type === 'IDLE_START') openIdle = r.occurred_at.getTime();
    else if (r.type === 'IDLE_END' && openIdle != null) {
      idleMs += r.occurred_at.getTime() - openIdle;
      openIdle = null;
    }
  }
  if (openIdle != null && rows.length > 0) {
    idleMs += rows[rows.length - 1].occurred_at.getTime() - openIdle;
  }
  const idleMinutes = Math.round(idleMs / 60_000);
  const score = Math.max(
    0,
    100
      - 5 * harshBrake
      - 5 * harshAccel
      - 2 * idleMinutes
      - 0.5 * speeding,
  );
  return { score, harshBrake, harshAccel, speeding, idleMinutes };
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      // 1) Today's trips for this driver
      const trips = await tx.$queryRaw<TripRow[]>`
        SELECT
          ts.id,
          ts.status,
          ts.departure_time,
          ts.arrival_time,
          ts.direction,
          ts.trip_number,
          ts.capacity,
          ts.confirmed_count,
          ts.route_id,
          ts.actual_departure_at,
          ts.actual_arrival_at,
          ts.started_by_driver_id,
          ts.ended_by_driver_id,
          ts.late_minutes,
          ts.duration_minutes,
          br.name AS route_name,
          COALESCE(
            v.license_plate,
            NULLIF(TRIM(COALESCE(v.plate_code, '') || ' ' || COALESCE(v.plate_number, '')), ''),
            v.registration_no
          ) AS vehicle_plate
        FROM trip_schedules ts
        LEFT JOIN bus_routes br ON br.id = ts.route_id
        LEFT JOIN vehicles v ON v.id = ts.vehicle_id
        WHERE ts.tenant_id = ${ctx.tenantId}::uuid
          AND ts.driver_id = ${ctx.userId}::text
          AND ts.deleted_at IS NULL
          AND DATE(ts.departure_time AT TIME ZONE 'UTC') = DATE(NOW() AT TIME ZONE 'UTC')
        ORDER BY ts.departure_time ASC
      `;

      // 1b) Port Container Drayage assignments for this driver
      let drayageJobs: any[] = [];
      try {
        const drayageRows = await tx.$queryRawUnsafe<any[]>(`
          SELECT
            id,
            job_code AS "jobCode",
            job_phase AS "jobPhase",
            shipment_type AS "shipmentType",
            status,
            priority,
            container_number AS "containerNumber",
            container_size AS "containerSize",
            container_type AS "containerType",
            warehouse_name AS "warehouseName",
            terminal_name AS "terminalName",
            assigned_vehicle_plate AS "assignedVehiclePlate",
            assigned_trailer_plate AS "assignedTrailerPlate",
            placement_location AS "placementLocation",
            trailer_detached AS "trailerDetached",
            etc_time AS "etcTime",
            etc_alert_status AS "etcAlertStatus",
            rate_amount_aed AS "rateAmountAed",
            driver_allowance_aed AS "driverAllowanceAed",
            notes
          FROM logistics_drayage_jobs
          WHERE tenant_id = $1
            AND (
              assigned_driver_id = $2
              OR assigned_driver_id IS NULL
              OR assigned_driver_name = $2
            )
            AND status NOT IN ('CANCELLED')
          ORDER BY
            CASE
              WHEN status IN ('IN_TRANSIT', 'LOADED', 'ACCEPTED', 'PLACED_AT_RAMP') THEN 1
              WHEN status = 'PENDING' THEN 2
              ELSE 3
            END,
            created_at DESC
          LIMIT 10
        `, tenantId, ctx.userId);

        drayageJobs = drayageRows.map((j) => ({
          ...j,
          rateAmountAed: Number(j.rateAmountAed || 0),
          driverAllowanceAed: Number(j.driverAllowanceAed || 0),
          etcTime: j.etcTime ? new Date(j.etcTime).toISOString() : null,
        }));
      } catch (drayageErr) {
        console.warn('[today/assignments] Drayage query skipped or failed:', drayageErr);
      }

      if (trips.length === 0) {
        return NextResponse.json(
          { trips: [], drayageJobs, generatedAt: new Date().toISOString() },
          { headers: { 'Cache-Control': privateCacheControl(30, 30) } },
        );
      }

      // 2) Per-trip behaviour events — single batch query
      const tripIds = trips.map((t) => t.id);
      const events = await tx.$queryRaw<ScoreRow[]>`
        SELECT trip_id, type, occurred_at
        FROM behavior_events
        WHERE tenant_id = ${ctx.tenantId}::uuid
          AND driver_id = ${ctx.userId}::uuid
          AND trip_id = ANY(${tripIds}::uuid[])
        ORDER BY trip_id, occurred_at ASC
      `;

      // 3) Group by trip + score
      const byTrip = new Map<string, ScoreRow[]>();
      for (const e of events) {
        if (!e.trip_id) continue;
        const arr = byTrip.get(e.trip_id) ?? [];
        arr.push(e);
        byTrip.set(e.trip_id, arr);
      }

      const result = trips.map((t) => {
        const tripEvents = byTrip.get(t.id) ?? [];
        const breakdown = computeScore(tripEvents);
        return {
          id: t.id,
          // Driver-facing vocabulary: a trip started from Bus Ops (STARTED /
          // EN_ROUTE) must show the End button, not an unknown state.
          status: toDriverTripStatus(t.status) ?? t.status,
          departureTime: t.departure_time.toISOString(),
          arrivalTime: t.arrival_time.toISOString(),
          direction: t.direction,
          tripNumber: t.trip_number,
          routeId: t.route_id,
          routeName: t.route_name,
          vehiclePlate: t.vehicle_plate,
          capacity: t.capacity,
          confirmedCount: t.confirmed_count,
          // Driver-controlled lifecycle
          actualDepartureAt: t.actual_departure_at?.toISOString() ?? null,
          actualArrivalAt: t.actual_arrival_at?.toISOString() ?? null,
          startedByDriverId: t.started_by_driver_id,
          endedByDriverId: t.ended_by_driver_id,
          lateMinutes: t.late_minutes,
          durationMinutes: t.duration_minutes,
          score: breakdown,
          eventCount: tripEvents.length,
        };
      });

      return NextResponse.json(
        { trips: result, drayageJobs, generatedAt: new Date().toISOString() },
        { headers: { 'Cache-Control': privateCacheControl(30, 30) } },
      );
  });
}

