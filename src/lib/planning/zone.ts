/**
 * Zone geometry helpers for the Planning Constraint Engine (PCE).
 *
 * Zones are pre-loaded from `spatial.places` into a `ZoneShape` — either a
 * closed POLYGON of lat/lng vertices, or a CIRCLE (center + radius in meters).
 * `pathTouchesZone` returns true if any of the given path points fall inside
 * the zone, which is the check the ZONE_RESTRICTION evaluator uses to gate
 * trips whose route stops enter a restricted area.
 *
 * Kept dependency-free (no turf, no geolib) — a small haversine + a ray-cast
 * point-in-polygon is enough for route granularity where stops are frequent.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type ZoneShape =
  | { shape: 'POLYGON'; polygon: LatLng[] }
  | { shape: 'CIRCLE'; centerLat: number; centerLng: number; radiusM: number };

// ─── Polygon JSON parsing ───────────────────────────────────────────────────

/**
 * Parse a polygon out of an arbitrary JSON value. Accepts the two shapes we
 * ingest from `spatial.places.polygon`:
 *   1. GeoJSON-style: [ [lng, lat], [lng, lat], ... ]
 *   2. Object array:  [ { lat, lng }, { lat, lng }, ... ]
 * Returns null when the value isn't a valid polygon with >= 3 points.
 * De-duplicates a trailing closing vertex if present.
 */
export function parsePolygonJson(raw: unknown): LatLng[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;

  const points: LatLng[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number') {
      // GeoJSON order: [lng, lat]
      points.push({ lat: p[1] as number, lng: p[0] as number });
    } else if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      const lat = typeof o.lat === 'number' ? o.lat : typeof o.latitude === 'number' ? o.latitude : null;
      const lng = typeof o.lng === 'number' ? o.lng : typeof o.longitude === 'number' ? o.longitude : null;
      if (lat == null || lng == null) return null;
      points.push({ lat, lng });
    } else {
      return null;
    }
  }

  // Strip trailing closing vertex — ray-cast works on either, but a duplicate
  // vertex breaks some edge iterators.
  if (points.length >= 4) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) points.pop();
  }

  return points.length >= 3 ? points : null;
}

// ─── Membership test ────────────────────────────────────────────────────────

/**
 * True if any point on `path` falls inside `zone`. Point-membership is what
 * the ZONE_RESTRICTION evaluator needs — stops are dense enough that a route
 * crossing a zone will always have a stop inside it.
 */
export function pathTouchesZone(path: LatLng[], zone: ZoneShape): boolean {
  if (path.length === 0) return false;
  if (zone.shape === 'CIRCLE') {
    for (const p of path) {
      if (haversineMeters(p.lat, p.lng, zone.centerLat, zone.centerLng) <= zone.radiusM) return true;
    }
    return false;
  }
  // POLYGON
  for (const p of path) {
    if (pointInPolygon(p, zone.polygon)) return true;
  }
  return false;
}

// ─── Internals ──────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Ray-casting point-in-polygon. Treats the polygon vertices as planar
 * lat/lng — accurate at UAE latitudes for the ~km-scale zones we use.
 */
function pointInPolygon(pt: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    const intersects =
      (yi > pt.lat) !== (yj > pt.lat) &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
