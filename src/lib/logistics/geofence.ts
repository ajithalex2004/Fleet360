/**
 * Geofence evaluation — detects when a shipment enters/leaves a stop's zone
 * or deviates from its route corridor, from successive GPS pings.
 *
 * Gap #5 from the logistics competitive analysis: catch deviations in
 * minutes instead of hours. Three fence kinds:
 *   - PICKUP / DELIVERY / STOP circle: a radius around a stop. Entering it
 *     means "arrived"; leaving it means "departed".
 *   - CORRIDOR: a buffer (width) around the planned route polyline. Leaving
 *     it is a route deviation worth an alert.
 *
 * Geofencing is fundamentally about TRANSITIONS: we don't alert because the
 * truck is far from a stop, we alert the moment it crosses in or out. So the
 * evaluator compares the PREVIOUS ping's inside/outside state against the
 * CURRENT one and emits an event only on a change. That keeps a truck idling
 * inside a delivery zone from spamming "arrived" on every tick.
 *
 * Pure module: no DB, no network. The service layer loads fence definitions
 * + the prior point and persists state. Keeping the geometry pure makes the
 * edge cases (boundary jitter, missing prior point, empty corridor)
 * unit-testable without a database.
 */

import { haversineKm, type LatLng } from './distance-matrix';

// ── Fence definitions ────────────────────────────────────────────────────────

export type StopFenceKind = 'PICKUP' | 'DELIVERY' | 'STOP';

export interface CircleFence {
  /** Stable id (e.g. the stop id) so events can be attributed. */
  id: string;
  kind: StopFenceKind;
  center: LatLng;
  radiusM: number;
  label?: string | null;
}

export interface CorridorFence {
  /** Ordered route waypoints (typically the stop coordinates in sequence). */
  polyline: LatLng[];
  /** Half-width of the corridor in metres — how far off-route is "deviated". */
  widthM: number;
}

// ── Events ───────────────────────────────────────────────────────────────────

export type GeofenceEvent =
  | { type: 'ENTER'; fenceId: string; fenceKind: StopFenceKind; label: string | null; distanceM: number }
  | { type: 'EXIT';  fenceId: string; fenceKind: StopFenceKind; label: string | null; distanceM: number }
  | { type: 'DEVIATION'; offCorridorM: number }
  | { type: 'RETURN';    offCorridorM: number };

// ── Geometry ─────────────────────────────────────────────────────────────────

const EARTH_R_M = 6_371_000;

/** Inside a circular fence if the great-circle distance ≤ radius. */
export function pointInCircle(point: LatLng, fence: CircleFence): boolean {
  return haversineKm(point, fence.center) * 1000 <= fence.radiusM;
}

export function distanceToCircleM(point: LatLng, fence: CircleFence): number {
  return haversineKm(point, fence.center) * 1000;
}

/**
 * Project a lat/lng to local east/north metres relative to a reference point
 * (equirectangular). Accurate to well under a metre over geofencing-scale
 * distances (a few km), which is all we need — and far simpler than a full
 * geodesic cross-track computation.
 */
function toLocalXY(p: LatLng, ref: LatLng): { x: number; y: number } {
  const rad = Math.PI / 180;
  const x = (p.longitude - ref.longitude) * rad * EARTH_R_M * Math.cos(ref.latitude * rad);
  const y = (p.latitude - ref.latitude) * rad * EARTH_R_M;
  return { x, y };
}

/** Shortest distance (m) from a point to a single segment a→b. */
export function distanceToSegmentM(point: LatLng, a: LatLng, b: LatLng): number {
  // Work in a local plane anchored at `a`.
  const p = toLocalXY(point, a);
  const v = toLocalXY(b, a); // segment vector from a(0,0) to b
  const segLenSq = v.x * v.x + v.y * v.y;
  if (segLenSq === 0) {
    // a and b coincide — distance to the point a.
    return Math.hypot(p.x, p.y);
  }
  // Projection factor t of p onto the segment, clamped to [0,1].
  let t = (p.x * v.x + p.y * v.y) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: v.x * t, y: v.y * t };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

/** Shortest distance (m) from a point to a polyline (min over its segments). */
export function distanceToPolylineM(point: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineKm(point, polyline[0]) * 1000;
  let min = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const d = distanceToSegmentM(point, polyline[i - 1], polyline[i]);
    if (d < min) min = d;
  }
  return min;
}

export function withinCorridor(point: LatLng, corridor: CorridorFence): boolean {
  if (corridor.polyline.length === 0) return true; // no corridor defined → never "off"
  return distanceToPolylineM(point, corridor.polyline) <= corridor.widthM;
}

// ── Transition evaluation ────────────────────────────────────────────────────

export interface EvaluateInput {
  /** The new GPS ping. */
  curr: LatLng;
  /** The previous GPS ping, or null if this is the first. */
  prev: LatLng | null;
  circles: CircleFence[];
  corridor?: CorridorFence | null;
}

/**
 * Emit geofence events for the transition prev → curr.
 *
 * Circles:
 *   ENTER when curr is inside and prev was outside (or absent).
 *   EXIT  when curr is outside and prev was inside.
 * Corridor:
 *   DEVIATION when curr is outside and prev was inside (or absent — first
 *     ping already off-route is worth flagging).
 *   RETURN    when curr is back inside and prev was outside.
 *
 * No event when the inside/outside state is unchanged — that's what stops a
 * parked truck from re-alerting every tick.
 */
export function evaluateGeofences(input: EvaluateInput): GeofenceEvent[] {
  const events: GeofenceEvent[] = [];

  for (const fence of input.circles) {
    const currInside = pointInCircle(input.curr, fence);
    const prevInside = input.prev ? pointInCircle(input.prev, fence) : false;
    const distanceM = Math.round(distanceToCircleM(input.curr, fence));

    if (currInside && !prevInside) {
      events.push({ type: 'ENTER', fenceId: fence.id, fenceKind: fence.kind, label: fence.label ?? null, distanceM });
    } else if (!currInside && prevInside) {
      events.push({ type: 'EXIT', fenceId: fence.id, fenceKind: fence.kind, label: fence.label ?? null, distanceM });
    }
  }

  if (input.corridor && input.corridor.polyline.length >= 2) {
    const currInside = withinCorridor(input.curr, input.corridor);
    const prevInside = input.prev ? withinCorridor(input.prev, input.corridor) : true;
    const offCorridorM = Math.round(distanceToPolylineM(input.curr, input.corridor.polyline));

    if (!currInside && prevInside) {
      events.push({ type: 'DEVIATION', offCorridorM });
    } else if (currInside && !prevInside) {
      events.push({ type: 'RETURN', offCorridorM });
    }
  }

  return events;
}

// ── Mapping helpers for the service layer ────────────────────────────────────

/** Human-readable title for an alert raised from a geofence event. */
export function geofenceEventTitle(e: GeofenceEvent, shipmentNo: string): string {
  switch (e.type) {
    case 'ENTER':
      return e.fenceKind === 'PICKUP' ? `${shipmentNo} arrived at pickup`
           : e.fenceKind === 'DELIVERY' ? `${shipmentNo} arrived at delivery`
           : `${shipmentNo} arrived at stop`;
    case 'EXIT':
      return e.fenceKind === 'PICKUP' ? `${shipmentNo} departed pickup`
           : e.fenceKind === 'DELIVERY' ? `${shipmentNo} departed delivery`
           : `${shipmentNo} departed stop`;
    case 'DEVIATION':
      return `${shipmentNo} deviated from route (${e.offCorridorM}m off corridor)`;
    case 'RETURN':
      return `${shipmentNo} returned to route`;
  }
}

/** Exception severity for a geofence event. Deviations are the actionable ones. */
export function geofenceEventSeverity(e: GeofenceEvent): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (e.type === 'DEVIATION') return 'HIGH';
  if (e.type === 'EXIT' || e.type === 'ENTER') return 'LOW';
  return 'LOW';
}

/** Stable exception_type code for de-duplication / filtering. */
export function geofenceEventType(e: GeofenceEvent): string {
  switch (e.type) {
    case 'ENTER':     return `GEOFENCE_ARRIVED_${e.fenceKind}`;
    case 'EXIT':      return `GEOFENCE_DEPARTED_${e.fenceKind}`;
    case 'DEVIATION': return 'GEOFENCE_ROUTE_DEVIATION';
    case 'RETURN':    return 'GEOFENCE_ROUTE_RETURN';
  }
}

// ── Rendering helper ─────────────────────────────────────────────────────────

/**
 * Approximate a circular geofence as a closed ring of [lng, lat] points, for
 * drawing on a map. A Mapbox GL `circle` layer sizes in pixels (doesn't scale
 * with zoom), so a metres-accurate geofence has to be a polygon. We walk
 * `segments` points around the centre at the given radius, converting the
 * metre offsets back to lat/lng (inverse of the equirectangular projection).
 *
 * Returns coordinates in GeoJSON order ([lng, lat]) with the first point
 * repeated at the end to close the ring.
 */
export function circleToPolygon(center: LatLng, radiusM: number, segments = 64): Array<[number, number]> {
  const rad = Math.PI / 180;
  const ring: Array<[number, number]> = [];
  const latRad = center.latitude * rad;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const northM = radiusM * Math.cos(theta);
    const eastM = radiusM * Math.sin(theta);
    const dLat = (northM / EARTH_R_M) * (180 / Math.PI);
    const dLng = (eastM / (EARTH_R_M * Math.cos(latRad))) * (180 / Math.PI);
    ring.push([center.longitude + dLng, center.latitude + dLat]);
  }
  return ring;
}
