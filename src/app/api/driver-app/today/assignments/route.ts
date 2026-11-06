export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/today/assignments/route.ts
 *
 * GET /api/driver-app/today/assignments
 *
 * Returns the trips and drayage jobs assigned to the current driver.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { privateCacheControl } from '@/lib/server-cache';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
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

type DrayageJobRow = {
  id: string;
  jobCode: string;
  jobPhase: string;
  shipmentType: string;
  status: string;
  priority: string;
  customerName: string | null;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  terminalId: string | null;
  terminalName: string;
  tokenNumber?: string | null;
  pcsTokenNumber?: string | null;
  pcsSlotStart?: Date | string | null;
  pcsSlotEnd?: Date | string | null;
  customsInspection?: boolean;
  inspectionStatus?: string | null;
  doStatus?: string | null;
  warehouseId: string | null;
  warehouseName: string;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  assignedVehiclePlate: string | null;
  assignedTrailerPlate: string | null;
  placementLocation: string | null;
  trailerDetached: boolean;
  etcTime: Date | string | null;
  etcAlertStatus: string;
  rateAmountAed: number | null;
  driverAllowanceAed: number | null;
  notes: string | null;
  podSignatureName?: string | null;
  podSignedAt?: Date | string | null;
  podPhotoUrl?: string | null;
  updatedAt?: Date | string | null;
};

type DrayageMessageRow = {
  id: string;
  job_id: string;
  sender_role: string;
  sender_name: string;
  message: string;
  is_urgent: boolean;
  created_at: Date | string;
};

type DrayageGeofenceRow = {
  id: string;
  terminal_id: string | null;
  terminal_name: string | null;
  name: string | null;
  type: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  coordinates_json: string | null;
};

type DrayageTerminalRow = {
  id: string;
  name: string | null;
  code: string | null;
  lat: number | null;
  lng: number | null;
  geofence_radius_meters: number | null;
};

type DrayageWarehouseRow = {
  id: string;
  name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  zone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geofence_type: string | null;
  geofence_radius_meters: number | null;
  geofence_coordinates_json: string | null;
};

type DrayageClientRow = {
  id: string;
  name: string | null;
  street_address: string | null;
  city: string | null;
};

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
    if (ctx instanceof NextResponse) return ctx;

    // Resolve driver identity (name / email prefix) so jobs matched by ID or name are returned accurately
    let driverFullName = '';
    let driverNameToken = '';
    try {
      const userRows = await tx.$queryRawUnsafe<
        Array<{ email: string | null; firstName: string | null; lastName: string | null }>
      >(
        `SELECT email, "firstName", "lastName" FROM "User" WHERE id = $1 LIMIT 1`,
        ctx.userId,
      );
      if (userRows[0]) {
        const first = (userRows[0].firstName || '').trim();
        const last = (userRows[0].lastName || '').trim();
        driverFullName = `${first} ${last}`.trim();
        const emailPrefix = (userRows[0].email || '').split('@')[0]?.trim() || '';
        driverNameToken = first || emailPrefix;
      }
      if (!driverFullName) {
        const drvRows = await tx.$queryRawUnsafe<Array<{ name: string | null; first_name: string | null }>>(
          `SELECT name, first_name FROM drivers WHERE id = $1 LIMIT 1`,
          ctx.userId,
        );
        if (drvRows[0]) {
          driverFullName = (drvRows[0].name || drvRows[0].first_name || '').trim();
          driverNameToken = (drvRows[0].first_name || driverFullName.split(' ')[0] || '').trim();
        }
      }

      // Sync 1-minute telemetry heartbeat for the driver's logged-in vehicle on poll
      const qLat = Number(req.nextUrl.searchParams.get('lat'));
      const qLng = Number(req.nextUrl.searchParams.get('lng'));
      const qSpeed = Number(req.nextUrl.searchParams.get('speedKmh') || 0);
      const qHeading = Number(req.nextUrl.searchParams.get('heading') || 0);
      const hasValidQueryCoords =
        !Number.isNaN(qLat) &&
        !Number.isNaN(qLng) &&
        (qLat !== 0 || qLng !== 0) &&
        !(Math.abs(qLat - 25.2048) < 0.0005 && Math.abs(qLng - 55.2708) < 0.0005);

      const loggedInVehicles = await tx
        .$queryRawUnsafe<
          Array<{
            id: string;
            current_lat: number | null;
            current_lng: number | null;
            last_ping_at: Date | null;
          }>
        >(
          `SELECT
              v.id::text AS id,
              v.current_lat,
              v.current_lng,
              (
                SELECT MAX(p.occurred_at)
                  FROM fleet.bus_gps_pings p
                 WHERE p.vehicle_id = v.id::text
              ) AS last_ping_at
             FROM vehicles v
             LEFT JOIN drivers d ON d.id = v.assigned_driver_id AND d.tenant_id = v.tenant_id
            WHERE v.tenant_id = $1
              AND v.deleted_at IS NULL
              AND (
                v.assigned_driver_id = $2
                OR d.user_id = $2
                OR ($3 <> '' AND LOWER(COALESCE(d.name, '')) = LOWER($3))
              )
            ORDER BY v.updated_at DESC
            LIMIT 1`,
          tenantId,
          ctx.userId,
          driverFullName,
        )
        .catch(() => []);

      const activeVeh = loggedInVehicles[0];
      if (activeVeh) {
        const effLat = hasValidQueryCoords ? qLat : activeVeh.current_lat;
        const effLng = hasValidQueryCoords ? qLng : activeVeh.current_lng;
        const lastPingMs = activeVeh.last_ping_at ? new Date(activeVeh.last_ping_at).getTime() : 0;
        const movedSignificantly =
          hasValidQueryCoords &&
          activeVeh.current_lat != null &&
          activeVeh.current_lng != null &&
          (Math.abs(qLat - Number(activeVeh.current_lat)) > 0.0002 ||
            Math.abs(qLng - Number(activeVeh.current_lng)) > 0.0002);

        if (
          effLat != null &&
          effLng != null &&
          (Date.now() - lastPingMs >= 60_000 || movedSignificantly)
        ) {
          await tx.busGpsPing
            .create({
              data: {
                tenantId,
                vehicleId: activeVeh.id,
                latitude: Number(effLat),
                longitude: Number(effLng),
                speedKmh: hasValidQueryCoords && !Number.isNaN(qSpeed) && qSpeed >= 0 ? qSpeed : 0,
                headingDeg: hasValidQueryCoords && !Number.isNaN(qHeading) ? qHeading : 0,
                accuracyM: 5,
                occurredAt: new Date(),
                source: 'DRIVER_APP',
              },
            })
            .catch(() => {});

          await tx
            .$executeRawUnsafe(
              `UPDATE vehicles
                  SET current_lat = $1,
                      current_lng = $2,
                      updated_at = NOW()
                WHERE id = $3
                  AND tenant_id = $4`,
              Number(effLat),
              Number(effLng),
              activeVeh.id,
              tenantId,
            )
            .catch(() => {});
        }
      }
    } catch {
      // ignore lookup error
    }

    // 1) Today's passenger/shuttle trips for this driver
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

    // 1b) Port Container Drayage assignments strictly for this logged-in driver
    let drayageJobs: Array<Record<string, unknown>> = [];
    let broadcastMessages: Array<Record<string, unknown>> = [];
    try {
      // Automatically erase any messages older than 12 hours
      await tx
        .$executeRawUnsafe(
          `DELETE FROM logistics_drayage_messages WHERE tenant_id = $1 AND created_at < NOW() - INTERVAL '12 hours'`,
          tenantId,
        )
        .catch(() => {});

      const [drayageRows, gfRows, termRows, whRows, clientRows, msgRows, broadcastAckRows] = await Promise.all([
        tx.$queryRawUnsafe<DrayageJobRow[]>(
          `
            SELECT
              id,
              job_code AS "jobCode",
              job_phase AS "jobPhase",
              shipment_type AS "shipmentType",
              status,
              priority,
              customer_name AS "customerName",
              container_number AS "containerNumber",
              container_size AS "containerSize",
              container_type AS "containerType",
              terminal_id AS "terminalId",
              terminal_name AS "terminalName",
              token_number AS "tokenNumber",
              pcs_token_number AS "pcsTokenNumber",
              pcs_slot_start AS "pcsSlotStart",
              pcs_slot_end AS "pcsSlotEnd",
              customs_inspection AS "customsInspection",
              inspection_status AS "inspectionStatus",
              do_status AS "doStatus",
              warehouse_id AS "warehouseId",
              warehouse_name AS "warehouseName",
              assigned_driver_id AS "assignedDriverId",
              assigned_driver_name AS "assignedDriverName",
              assigned_vehicle_plate AS "assignedVehiclePlate",
              assigned_trailer_plate AS "assignedTrailerPlate",
              placement_location AS "placementLocation",
              trailer_detached AS "trailerDetached",
              etc_time AS "etcTime",
              etc_alert_status AS "etcAlertStatus",
              rate_amount_aed AS "rateAmountAed",
              driver_allowance_aed AS "driverAllowanceAed",
              pod_signature_name AS "podSignatureName",
              pod_signed_at AS "podSignedAt",
              pod_photo_url AS "podPhotoUrl",
              notes,
              updated_at AS "updatedAt"
            FROM logistics_drayage_jobs
            WHERE tenant_id = $1
              AND status NOT IN ('PENDING', 'CANCELLED')
              AND (
                assigned_driver_id = $2
                OR ($3 <> '' AND LOWER(COALESCE(assigned_driver_name, '')) = LOWER($3))
                OR ($4 <> '' AND LOWER(COALESCE(assigned_driver_name, '')) LIKE '%' || LOWER($4) || '%')
              )
            ORDER BY
              CASE
                WHEN job_phase = 'L2' AND status NOT IN ('COMPLETED', 'EMPTY_DEPOSITED', 'CONTAINER_DROPPED') THEN 0
                WHEN status IN ('RE-ASSIGNED', 'TRAILER_ATTACHED', 'REASSIGN_PLACED_AT_RAMP', 'REASSIGN_PLACED_AT_YARD') THEN 1
                WHEN status IN ('ASSIGNED', 'ACCEPTED', 'CONTAINER_PICKED', 'AT_PORT', 'UNDER_INSPECTION', 'LOADED', 'IN_TRANSIT', 'EN_ROUTE_WAREHOUSE', 'EN_ROUTE_TERMINAL', 'ARRIVED_AT_PORT', 'PLACED_AT_RAMP', 'PLACED_AT_YARD') THEN 2
                ELSE 3
              END,
              updated_at DESC
            LIMIT 50
          `,
          tenantId,
          ctx.userId,
          driverFullName,
          driverNameToken,
        ),
        tx
          .$queryRawUnsafe<DrayageGeofenceRow[]>(
            `
            SELECT id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
            FROM logistics_drayage_geofences
            WHERE tenant_id = $1
          `,
            tenantId,
          )
          .catch(() => []),
        tx
          .$queryRawUnsafe<DrayageTerminalRow[]>(
            `
            SELECT id, name, code, lat, lng, geofence_radius_meters
            FROM logistics_drayage_terminals
            WHERE tenant_id = $1
          `,
            tenantId,
          )
          .catch(() => []),
        tx
          .$queryRawUnsafe<DrayageWarehouseRow[]>(
            `
            SELECT id, name, customer_id, customer_name, zone, address, lat, lng, geofence_type, geofence_radius_meters, geofence_coordinates_json
            FROM logistics_drayage_warehouses
            WHERE tenant_id = $1
          `,
            tenantId,
          )
          .catch(() => []),
        tx
          .$queryRawUnsafe<DrayageClientRow[]>(
            `
            SELECT id, name, street_address, city
            FROM logistics_drayage_clients
            WHERE tenant_id = $1
          `,
            tenantId,
          )
          .catch(() => []),
        tx
          .$queryRawUnsafe<DrayageMessageRow[]>(
            `
            SELECT id, job_id, sender_role, sender_name, message, is_urgent, created_at
            FROM logistics_drayage_messages
            WHERE tenant_id = $1
              AND created_at >= NOW() - INTERVAL '12 hours'
            ORDER BY created_at ASC
          `,
            tenantId,
          )
          .catch(() => []),
        tx
          .$queryRawUnsafe<Array<{ alert_key: string }>>(
            `
            SELECT alert_key
            FROM logistics_drayage_alerts
            WHERE tenant_id = $1
              AND acknowledged = TRUE
              AND alert_key LIKE 'BROADCAST_ACK:%'
          `,
            tenantId,
          )
          .catch(() => []),
      ]);

      const ackedBroadcastIds = new Set<string>();
      for (const row of broadcastAckRows) {
        const key = String(row.alert_key || '');
        if (key.startsWith(`BROADCAST_ACK:${ctx.userId}:`)) {
          ackedBroadcastIds.add(key.slice(`BROADCAST_ACK:${ctx.userId}:`.length));
        } else if (key.startsWith('BROADCAST_ACK:msg-')) {
          ackedBroadcastIds.add(key.slice('BROADCAST_ACK:'.length));
        }
      }

      const parseGeofenceCoords = (raw?: string | null): Array<{ lat: number; lng: number }> => {
        if (!raw) return [];
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0 && typeof arr[0].lat === 'number') {
            return arr;
          }
        } catch {}
        return [];
      };

      drayageJobs = drayageRows.map((j) => {
        const matchedTermGf = gfRows.find(
          (g) =>
            (g.terminal_id && g.terminal_id === j.terminalId) ||
            (g.terminal_name && g.terminal_name === j.terminalName) ||
            (g.name && j.terminalName && g.name.toLowerCase().includes(j.terminalName.toLowerCase().slice(0, 12))),
        );
        const matchedTerm = termRows.find(
          (t) =>
            (t.id && t.id === j.terminalId) ||
            (t.name && t.name === j.terminalName) ||
            (t.name && j.terminalName && t.name.toLowerCase().includes(j.terminalName.toLowerCase().slice(0, 12))),
        );

        const terminalGeofence = {
          name: matchedTermGf?.name || matchedTerm?.name || j.terminalName,
          type: (matchedTermGf?.type || 'CIRCLE') as 'CIRCLE' | 'POLYGON',
          lat: Number(matchedTermGf?.center_lat || matchedTerm?.lat || 25.0112),
          lng: Number(matchedTermGf?.center_lng || matchedTerm?.lng || 55.0612),
          radiusMeters: Number(matchedTermGf?.radius_meters || matchedTerm?.geofence_radius_meters || 1800),
          coordinates: parseGeofenceCoords(matchedTermGf?.coordinates_json),
        };

        const matchedWhGf = gfRows.find(
          (g) =>
            (g.terminal_name && g.terminal_name === j.warehouseName) ||
            (g.name && j.warehouseName && g.name.toLowerCase().includes(j.warehouseName.toLowerCase().slice(0, 10))),
        );
        const matchedWh = whRows.find(
          (w) =>
            (w.id && w.id === j.warehouseId) ||
            (w.name && w.name === j.warehouseName) ||
            (w.name && j.warehouseName && w.name.toLowerCase().includes(j.warehouseName.toLowerCase().slice(0, 10))),
        );

        const matchedClient = clientRows.find(
          (c) =>
            (matchedWh?.customer_id && c.id === matchedWh.customer_id) ||
            (matchedWh?.customer_name &&
              c.name &&
              c.name.trim().toLowerCase() === matchedWh.customer_name.trim().toLowerCase()),
        );

        const clientName =
          matchedClient?.name?.trim() ||
          matchedWh?.customer_name?.trim() ||
          j.warehouseName ||
          'N/A';

        const clientDestination =
          j.warehouseName ||
          matchedWh?.name?.trim() ||
          matchedWh?.address?.trim() ||
          matchedClient?.street_address?.trim() ||
          'N/A';

        const warehouseGeofence = {
          name: matchedWhGf?.name || matchedWh?.name || j.warehouseName,
          type: (matchedWhGf?.type || matchedWh?.geofence_type || 'POLYGON') as 'CIRCLE' | 'POLYGON',
          lat: Number(matchedWhGf?.center_lat || matchedWh?.lat || 24.9642),
          lng: Number(matchedWhGf?.center_lng || matchedWh?.lng || 55.0915),
          radiusMeters: Number(matchedWhGf?.radius_meters || matchedWh?.geofence_radius_meters || 850),
          coordinates: parseGeofenceCoords(matchedWhGf?.coordinates_json || matchedWh?.geofence_coordinates_json),
        };

        const jobMessages = msgRows
          .filter(
            (m) =>
              m.job_id === j.id ||
              (m.job_id === 'BROADCAST' && !ackedBroadcastIds.has(m.id)),
          )
          .map((m) => ({
            id: m.id,
            senderRole: m.sender_role,
            senderName: m.sender_name,
            message: m.message,
            isUrgent: Boolean(m.is_urgent),
            isBroadcast: m.job_id === 'BROADCAST',
            createdAt: m.created_at ? new Date(m.created_at).toISOString() : new Date().toISOString(),
          }));

        const rawStatusUpper = (j.status || 'ASSIGNED').toUpperCase();
        const normalizedStatus = ['CONTAINER_DROPPED', 'EMPTY_DEPOSITED', 'CONTAINER_DELIVERED'].includes(rawStatusUpper)
          ? 'COMPLETED'
          : j.status;

        const resolvedToken = (j.tokenNumber || j.pcsTokenNumber || '').trim() || null;
        let resolvedSlotStartIso =
          j.pcsSlotStart && !Number.isNaN(new Date(j.pcsSlotStart).getTime())
            ? new Date(j.pcsSlotStart).toISOString()
            : null;
        let resolvedSlotEndIso =
          j.pcsSlotEnd && !Number.isNaN(new Date(j.pcsSlotEnd).getTime())
            ? new Date(j.pcsSlotEnd).toISOString()
            : null;

        if (resolvedToken && !resolvedSlotStartIso) {
          const refBase = j.updatedAt ? new Date(j.updatedAt) : new Date();
          const uaeRef = new Date(
            (Number.isNaN(refBase.getTime()) ? Date.now() : refBase.getTime()) + 4 * 60 * 60 * 1000,
          );
          const uaeHr = uaeRef.getUTCHours();
          const fallbackStart = new Date(
            Date.UTC(
              uaeRef.getUTCFullYear(),
              uaeRef.getUTCMonth(),
              uaeRef.getUTCDate(),
              uaeHr - 4,
              0,
              0,
              0,
            ),
          );
          const fallbackEnd = new Date(fallbackStart.getTime() + 2 * 60 * 60 * 1000);
          resolvedSlotStartIso = fallbackStart.toISOString();
          resolvedSlotEndIso = fallbackEnd.toISOString();
        } else if (resolvedSlotStartIso && !resolvedSlotEndIso) {
          resolvedSlotEndIso = new Date(
            new Date(resolvedSlotStartIso).getTime() + 2 * 60 * 60 * 1000,
          ).toISOString();
        }

        const formatUaeSlotTime = (iso: string): string => {
          const dt = new Date(iso);
          const uaeTotalHours = (dt.getUTCHours() + 4) % 24;
          const mins = dt.getUTCMinutes();
          const ampm = uaeTotalHours >= 12 ? 'PM' : 'AM';
          const hr12 = uaeTotalHours % 12 === 0 ? 12 : uaeTotalHours % 12;
          return `${String(hr12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${ampm}`;
        };

        const tokenTimeSlot =
          resolvedSlotStartIso && resolvedSlotEndIso
            ? `${formatUaeSlotTime(resolvedSlotStartIso)} – ${formatUaeSlotTime(resolvedSlotEndIso)}`
            : null;

        return {
          ...j,
          status: normalizedStatus,
          tokenNumber: resolvedToken,
          pcsTokenNumber: resolvedToken,
          pcsSlotStart: resolvedSlotStartIso,
          pcsSlotEnd: resolvedSlotEndIso,
          tokenTimeSlot,
          clientName,
          clientDestination,
          rateAmountAed: Number(j.rateAmountAed || 0),
          driverAllowanceAed: Number(j.driverAllowanceAed || 0),
          etcTime: j.etcTime ? new Date(j.etcTime).toISOString() : null,
          podSignedAt: j.podSignedAt ? new Date(j.podSignedAt).toISOString() : null,
          updatedAt: j.updatedAt ? new Date(j.updatedAt).toISOString() : null,
          terminalGeofence,
          warehouseGeofence,
          messages: jobMessages,
        };
      });

      broadcastMessages = msgRows
        .filter((m) => m.job_id === 'BROADCAST' && !ackedBroadcastIds.has(m.id))
        .map((m) => ({
          id: m.id,
          senderRole: m.sender_role,
          senderName: m.sender_name,
          message: m.message,
          isUrgent: Boolean(m.is_urgent),
          isBroadcast: true,
          createdAt: m.created_at ? new Date(m.created_at).toISOString() : new Date().toISOString(),
        }));
    } catch (drayageErr) {
      console.warn('[today/assignments] Drayage query skipped or failed:', drayageErr);
    }

    if (trips.length === 0) {
      return NextResponse.json(
        { trips: [], drayageJobs, broadcastMessages, generatedAt: new Date().toISOString() },
        { headers: { 'Cache-Control': privateCacheControl(5, 5) } },
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
      { trips: result, drayageJobs, broadcastMessages, generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': privateCacheControl(5, 5) } },
    );
  });
}
