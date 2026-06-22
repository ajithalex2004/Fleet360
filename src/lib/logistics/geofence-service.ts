/**
 * Geofence service — evaluates a shipment's latest GPS ping against its
 * stop zones + route corridor and raises an exception (and optionally an
 * ops alert) when the truck crosses a boundary.
 *
 * Called from the GPS-ingest path right after the ping is stored, next to
 * the ETA recompute. Everything here is best-effort: a failure to raise an
 * alert or notify never breaks ingestion.
 *
 * Design notes:
 *   - Transitions are derived purely from the last two pings (curr vs prev),
 *     so we store no extra geofence state — the geometry module decides what
 *     changed. (See geofence.ts.)
 *   - The route corridor in v1 is the straight line through the ordered stop
 *     coordinates with a GENEROUS default half-width (5km). Without real road
 *     geometry a tight corridor would false-positive on normal road
 *     curvature, so v1 only flags gross "wrong-direction" deviations. When
 *     the route-optimizer's actual polyline is available on shipment
 *     metadata.routePolyline we use that instead and a tighter width.
 *   - Light de-dup: we skip raising an alert if an OPEN exception of the same
 *     type was raised in the last few minutes, so boundary jitter can't spam.
 */

import { prisma } from '@/lib/prisma';
import { sendSms } from '@/lib/sms';
import { sendEmail } from '@/lib/email';
import { ensureGeofenceSchema } from './geofence-schema';
import {
  evaluateGeofences,
  geofenceEventType,
  geofenceEventSeverity,
  geofenceEventTitle,
  type CircleFence,
  type CorridorFence,
  type GeofenceEvent,
} from './geofence';
import type { LatLng } from './distance-matrix';

const DEFAULT_STOP_RADIUS_M = 200;
const STRAIGHT_LINE_CORRIDOR_WIDTH_M = 5000;  // generous — gross deviation only
const ROUTE_POLYLINE_CORRIDOR_WIDTH_M = 800;  // tight — when real geometry exists
const DEDUP_WINDOW_MINUTES = 5;

export interface GeofenceResult {
  events: GeofenceEvent[];
  raised: number;
  notified: number;
  reason: string;
}

const EMPTY: GeofenceResult = { events: [], raised: 0, notified: 0, reason: '' };

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface StopRow {
  id: string;
  stop_type: string;
  sequence_no: number;
  latitude: string | number | null;
  longitude: string | number | null;
  location_name: string | null;
  geofence_radius_m: number | null;
}

export async function evaluateShipmentGeofences(args: {
  tenantId: string;
  shipmentOrderId: string;
  /** Skip the actual ops/customer sends (events still raised). For tests. */
  suppressNotifications?: boolean;
}): Promise<GeofenceResult> {
  await ensureGeofenceSchema();

  // Shipment header (number + contact + metadata for route polyline).
  const shipRows = await prisma.$queryRawUnsafe<Array<{
    shipment_no: string | null; cargo_owner_email: string | null; cargo_owner_phone: string | null;
    metadata: Record<string, unknown> | null;
  }>>(
    `SELECT shipment_no, cargo_owner_email, cargo_owner_phone, metadata
       FROM logistics_shipment_orders
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
    args.shipmentOrderId, args.tenantId,
  ).catch(() => []);
  const ship = shipRows[0];
  if (!ship) return { ...EMPTY, reason: 'shipment not found' };
  const shipmentNo = ship.shipment_no ?? args.shipmentOrderId.slice(0, 8);

  // Stops with coordinates → circle fences + corridor polyline.
  const stops = await prisma.$queryRawUnsafe<StopRow[]>(
    `SELECT id, stop_type, sequence_no, latitude::text, longitude::text, location_name, geofence_radius_m
       FROM logistics_shipment_stops
      WHERE shipment_order_id = $1 AND tenant_id = $2
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY sequence_no ASC`,
    args.shipmentOrderId, args.tenantId,
  ).catch(() => []);

  const circles: CircleFence[] = stops.map(s => {
    const kind = s.stop_type.toUpperCase() === 'PICKUP' ? 'PICKUP'
               : s.stop_type.toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'STOP';
    return {
      id: s.id,
      kind,
      center: { latitude: num(s.latitude)!, longitude: num(s.longitude)! },
      radiusM: s.geofence_radius_m ?? DEFAULT_STOP_RADIUS_M,
      label: s.location_name,
    } as CircleFence;
  });

  // Corridor: prefer a real route polyline from metadata; else the straight
  // line through the stops with a generous width.
  let corridor: CorridorFence | null = null;
  const routePolyline = ship.metadata?.routePolyline as Array<{ latitude: number; longitude: number }> | undefined;
  if (Array.isArray(routePolyline) && routePolyline.length >= 2) {
    corridor = { polyline: routePolyline, widthM: ROUTE_POLYLINE_CORRIDOR_WIDTH_M };
  } else if (circles.length >= 2) {
    corridor = { polyline: circles.map(c => c.center), widthM: STRAIGHT_LINE_CORRIDOR_WIDTH_M };
  }

  // Last two GPS pings: [0]=curr (just ingested), [1]=prev.
  const pings = await prisma.$queryRawUnsafe<Array<{ latitude: string | number; longitude: string | number }>>(
    `SELECT latitude::text, longitude::text
       FROM logistics_tracking_events
      WHERE shipment_order_id = $1 AND tenant_id = $2
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY occurred_at DESC LIMIT 2`,
    args.shipmentOrderId, args.tenantId,
  ).catch(() => []);

  if (!pings.length) return { ...EMPTY, reason: 'no GPS pings' };
  const curr: LatLng = { latitude: num(pings[0].latitude)!, longitude: num(pings[0].longitude)! };
  const prev: LatLng | null = pings[1]
    ? { latitude: num(pings[1].latitude)!, longitude: num(pings[1].longitude)! } : null;

  const events = evaluateGeofences({ curr, prev, circles, corridor });
  if (!events.length) return { ...EMPTY, reason: 'no geofence transitions' };

  let raised = 0;
  let notified = 0;

  for (const ev of events) {
    const exType = geofenceEventType(ev);

    // De-dup: skip if an OPEN exception of this type was raised very recently.
    const recent = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM logistics_shipment_exceptions
        WHERE shipment_order_id = $1 AND tenant_id = $2
          AND exception_type = $3 AND status = 'OPEN'
          AND raised_at > NOW() - ($4 || ' minutes')::interval
        LIMIT 1`,
      args.shipmentOrderId, args.tenantId, exType, String(DEDUP_WINDOW_MINUTES),
    ).catch(() => []);
    if (recent.length) continue;

    const severity = geofenceEventSeverity(ev);
    const title = geofenceEventTitle(ev, shipmentNo);

    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_shipment_exceptions
         (tenant_id, shipment_order_id, exception_type, severity, status, title, description, raised_at, metadata)
       VALUES ($1,$2,$3,$4,'OPEN',$5,$6,NOW(),$7::jsonb)`,
      args.tenantId, args.shipmentOrderId, exType, severity, title,
      title, JSON.stringify({ geofence: ev }),
    ).catch(() => { /* non-fatal */ });
    raised += 1;

    // Notify ops/customer for the actionable ones (route deviation).
    if (ev.type === 'DEVIATION' && !args.suppressNotifications) {
      const body = `Fleet360 alert: ${title}. Check the dispatch board.`;
      if (ship.cargo_owner_phone) {
        const r = await sendSms({ to: ship.cargo_owner_phone, body }).catch(() => ({ sent: false }));
        if (r?.sent) notified += 1;
      }
      if (ship.cargo_owner_email) {
        const r = await sendEmail({ to: ship.cargo_owner_email, subject: title, text: body }).catch(() => ({ sent: false }));
        if (r?.sent) notified += 1;
      }
    }
  }

  return { events, raised, notified, reason: `raised ${raised} of ${events.length} geofence event(s)` };
}
