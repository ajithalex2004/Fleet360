/**
 * Zone membership helpers for the Planning Constraint Engine.
 *
 * A "zone" is a `spatial.places` row of shape POLYGON or CIRCLE. Zone-scoped
 * rules ask: does this trip's route touch this zone?  Answered by testing
 * every stop of the trip (and optionally departure/arrival points) against
 * the zone geometry using ray-casting for polygons and haversine for circles.
 *
 * Runs in-process — no PostGIS dependency. Fast enough for the O(stops×zones)
 * evaluation loop in Phase 1; if that changes, migrate the geometry column to
 * PostGIS and let the DB do it.
 */

export type LatLng = { lat: number; lng: number };

export type ZoneShape =
  | { shape: 'POLYGON'; polygon: LatLng[] }
  | { shape: 'CIRCLE'; centerLat: number; centerLng: number; radiusM: number };

/**
 * Point-in-polygon test (ray-casting).
 *
 * Correct for arbitrary simple polygons in lat/lng space. Not correct for
 * polygons that cross the antimeridian — Fleet360 operates in the UAE so
 * that's not a concern here; guard callers explicitly if that changes.
 * Boundary points may flip depending on floating-point rounding; treat as
 * a rule the operator authored, not a legal cadastral boundary.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Haversine distance in metres between two lat/lng points. Standard formula;
 * accurate to ~0.5% at 100km which is plenty for zone membership tests.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Does the point fall inside the zone? Delegates to the correct geometry
 * primitive by shape. Returns false for POINT-typed places — a zone must
 * enclose area to have "inside" semantics.
 */
export function pointInZone(point: LatLng, zone: ZoneShape): boolean {
  if (zone.shape === 'POLYGON') {
    return pointInPolygon(point, zone.polygon);
  }
  const d = haversineMeters(point, { lat: zone.centerLat, lng: zone.centerLng });
  return d <= zone.radiusM;
}

/**
 * Does any point of a path (typically a trip's ordered stops) enter the
 * zone?  Used by ZONE_VEHICLE_RESTRICTION — the ban fires if the trip
 * *routes through* the zone, not just endpoints.
 *
 * Segment-crosses-polygon is intentionally NOT modelled: stops are dense
 * enough on the routes we operate that a segment cannot fully skip a zone
 * without at least one endpoint being inside. If that becomes false (very
 * long segments across a small ban zone), upgrade the test with a segment
 * intersection check.
 */
export function pathTouchesZone(path: LatLng[], zone: ZoneShape): boolean {
  return path.some((p) => pointInZone(p, zone));
}

/**
 * Parse a spatial.places row's `polygon` JSON into typed vertices. The
 * column stores `[{lat, lng}, ...]` — see comment on the Place model.
 * Returns null when the payload is malformed so evaluators can skip the
 * rule cleanly rather than throw.
 */
export function parsePolygonJson(raw: unknown): LatLng[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LatLng[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') return null;
    const lat = (v as Record<string, unknown>).lat;
    const lng = (v as Record<string, unknown>).lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    out.push({ lat, lng });
  }
  return out.length >= 3 ? out : null;
}
