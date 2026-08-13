/**
 * src/app/api/driver-app/trips/[id]/geofences/route.ts
 *
 * GET /api/driver-app/trips/[id]/geofences
 *
 * Returns the origin (first stop, lowest sequence) and destination
 * (last stop, highest sequence) of a trip's route, plus the geofence
 * radius for each. The auto-lifecycle watcher uses this to decide
 * when to auto-start (vehicle has left the origin geofence) and
 * auto-end (vehicle has entered the destination geofence).
 *
 * Per-stop `geofence_radius_m` is the source of truth (operations
 * can adjust it per stop); the 100m default below matches the
 * product spec — "moves 100 m away from the origin" — and is
 * returned as `defaultRadiusM` so the client can show it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { privateCacheControl } from '@/lib/server-cache';

const DEFAULT_RADIUS_M = 100;

interface StopRow {
  gps_lat: number | null;
  gps_lng: number | null;
  geofence_radius_m: number | null;
  stop_name: string | null;
  sequence: number;
  // Phase 3.5 — Place link. When present its centerLat/centerLng/radius
  // are preferred over the local columns; the join happens in the SQL
  // below so we don't do a per-stop N+1 round-trip.
  place_center_lat: number | null;
  place_center_lng: number | null;
  place_radius_m: number | null;
  place_name: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  // 1) Load the trip (just the route_id + driver check)
  const trips = await prisma.$queryRaw<Array<{ id: string; route_id: string | null; driver_id: string }>>`
    SELECT id, route_id, driver_id
    FROM trip_schedules
    WHERE id = ${params.id}
      AND tenant_id = ${ctx.tenantId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (trips.length === 0) {
    return NextResponse.json({ error: 'trip not found' }, { status: 404 });
  }
  const trip = trips[0];

  if (trip.driver_id !== ctx.userId) {
    return NextResponse.json(
      { error: 'forbidden: this trip is assigned to a different driver' },
      { status: 403 },
    );
  }

  if (!trip.route_id) {
    return NextResponse.json(
      { error: 'trip has no route assigned; no geofences to watch' },
      { status: 422 },
    );
  }

  // 2) Origin = lowest sequence, destination = highest sequence.
  //    Left-joined to spatial.places so Phase 3.5 can prefer the linked
  //    Place geometry over the denormalized route_stops columns. The
  //    join is optional — pre-Phase-3.5 stops have place_id NULL and
  //    fall back to route_stops.gps_lat/gps_lng.
  const stops = await prisma.$queryRaw<StopRow[]>`
    SELECT s.gps_lat, s.gps_lng, s.geofence_radius_m, s.stop_name, s.sequence,
           p.center_lat AS place_center_lat,
           p.center_lng AS place_center_lng,
           p.radius_m   AS place_radius_m,
           p.name       AS place_name
    FROM route_stops s
    LEFT JOIN spatial.places p ON p.id = s.place_id AND p.deleted_at IS NULL
    WHERE s.route_id = ${trip.route_id}
      AND (COALESCE(p.center_lat, s.gps_lat) IS NOT NULL)
      AND (COALESCE(p.center_lng, s.gps_lng) IS NOT NULL)
    ORDER BY s.sequence ASC
    LIMIT 2
  `;
  if (stops.length === 0) {
    return NextResponse.json(
      { error: 'route has no stops with GPS coordinates' },
      { status: 422 },
    );
  }

  const origin = stops[0];
  const destination = stops.length > 1 ? stops[stops.length - 1] : stops[0];

  // Sanity: if origin and destination are the same point, return 422
  if (origin === destination) {
    return NextResponse.json(
      { error: 'route has only one geocoded stop; need at least two' },
      { status: 422 },
    );
  }

  // Prefer Place fields when the stop is linked (Phase 3.5); fall back
  // to the local columns for pre-migration stops.
  const project = (s: StopRow) => ({
    lat:     s.place_center_lat ?? s.gps_lat,
    lng:     s.place_center_lng ?? s.gps_lng,
    name:    s.place_name       ?? s.stop_name,
    sequence: s.sequence,
    radiusM: s.place_radius_m ?? s.geofence_radius_m ?? DEFAULT_RADIUS_M,
  });

  return NextResponse.json(
    {
      tripId: params.id,
      routeId: trip.route_id,
      defaultRadiusM: DEFAULT_RADIUS_M,
      origin:      project(origin),
      destination: project(destination),
    },
    { headers: { 'Cache-Control': privateCacheControl(300, 300) } },
  );
}
