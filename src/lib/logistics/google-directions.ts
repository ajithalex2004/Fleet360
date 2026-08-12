/**
 * Google Directions API wrapper.
 *
 * The Distance Matrix API returns pair-wise distance/duration numbers between
 * many points — great for the VRP solver, wrong tool for "what's the actual
 * driving route for this bus." Directions API returns:
 *   - A single best-route polyline for the whole ordered path
 *   - Per-leg distance + duration
 *   - Real road-network guidance (not just crow-flies × detour factor)
 *
 * Used by /api/bus-ops/routes/estimate so the New Route form can display the
 * route on a map, not just show numbers.
 *
 * Note: waypoint order is PRESERVED — we don't pass `optimize:true` because
 * bus stops have a fixed pickup sequence set by the operator.
 */

import type { LatLng } from './distance-matrix';

const GOOGLE_DIRECTIONS_BASE = 'https://maps.googleapis.com/maps/api/directions/json';

export interface DirectionsLeg {
  fromLabel: string;
  toLabel: string;
  km: number;
  min: number;
}

export interface DirectionsResult {
  totalDistanceKm: number;
  totalDurationMin: number;
  /** Google's encoded polyline for the entire route (all legs joined). Decode
   *  client-side with google.maps.geometry.encoding.decodePath(). */
  encodedPolyline: string;
  legs: DirectionsLeg[];
  provider: 'google';
  /** Google's own bounding box for the route — handy for map.fitBounds(). */
  bounds: {
    northeast: LatLng;
    southwest: LatLng;
  };
}

// ── Google Directions response typings (just the shape we consume) ─────────

interface GD_LatLng { lat: number; lng: number }
interface GD_Distance { value?: number; text?: string }
interface GD_Duration { value?: number; text?: string }
interface GD_Leg {
  distance?: GD_Distance;
  duration?: GD_Duration;
  start_address?: string;
  end_address?: string;
  start_location?: GD_LatLng;
  end_location?: GD_LatLng;
}
interface GD_Route {
  legs?: GD_Leg[];
  overview_polyline?: { points?: string };
  bounds?: { northeast?: GD_LatLng; southwest?: GD_LatLng };
}
interface GD_Response {
  status?: string;
  routes?: GD_Route[];
  error_message?: string;
}

// ── Fetch injection seam for tests (mirrors the pattern in distance-matrix) ──

let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function _setFetchForTests(impl: typeof fetch): void { fetchImpl = impl; }
export function _resetFetchForTests(): void { fetchImpl = (...args) => fetch(...args); }

/**
 * Compute a driving route through the given sequence of coordinates. `points`
 * must be at least 2 (origin + destination); anything in the middle is a
 * waypoint. Waypoint order is preserved (no `optimize:true`).
 *
 * `labels` (optional) are used to tag each leg — Origin / Stop 1 / Destination.
 * If omitted, generic "Point N" labels are used.
 */
export async function computeGoogleDirections(
  points: LatLng[],
  labels?: string[],
): Promise<DirectionsResult> {
  if (points.length < 2) {
    throw new Error('computeGoogleDirections needs at least 2 points (origin + destination)');
  }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error('GOOGLE_MAPS_API_KEY not configured');
  }

  const origin = points[0];
  const destination = points[points.length - 1];
  const waypoints = points.slice(1, -1);

  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    // Match the geocoder's region bias — driving directions are less
    // sensitive to this than geocoding but harmless.
    region: (process.env.GEOCODER_REGION_BIAS?.trim().toLowerCase() || 'ae'),
    key,
  });
  if (waypoints.length > 0) {
    // "via:" prefix means "route through this point without adding it as a
    // stop that shows in the leg breakdown." We DON'T want via: — each stop
    // IS a real leg in the bus route, so we need per-stop distance/duration.
    params.set(
      'waypoints',
      waypoints.map(w => `${w.latitude},${w.longitude}`).join('|'),
    );
  }

  const res = await fetchImpl(`${GOOGLE_DIRECTIONS_BASE}?${params.toString()}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Directions HTTP ${res.status}: ${detail}`);
  }
  const body = await res.json() as GD_Response;
  if (body.status !== 'OK') {
    const msg = body.error_message ?? body.status ?? 'unknown';
    // ZERO_RESULTS is a semantic "no route exists between these points"
    // (e.g. across a body of water without a ferry). Bubble up as-is so
    // the caller can show a friendlier 422 rather than 500.
    throw new Error(`Google Directions status ${body.status}: ${msg}`);
  }
  const route = body.routes?.[0];
  const legs = route?.legs ?? [];
  const polyline = route?.overview_polyline?.points;
  if (!route || legs.length === 0 || !polyline) {
    throw new Error('Google Directions returned OK but no usable route');
  }

  const totalMeters  = legs.reduce((s, l) => s + (l.distance?.value ?? 0), 0);
  const totalSeconds = legs.reduce((s, l) => s + (l.duration?.value ?? 0), 0);

  const roundedLegs: DirectionsLeg[] = legs.map((l, i) => ({
    fromLabel: labels?.[i]     ?? `Point ${i + 1}`,
    toLabel:   labels?.[i + 1] ?? `Point ${i + 2}`,
    km:  Math.round(((l.distance?.value ?? 0) / 1000) * 10) / 10,
    min: Math.round((l.duration?.value ?? 0) / 60),
  }));

  const ne = route.bounds?.northeast;
  const sw = route.bounds?.southwest;
  const bounds = {
    northeast: { latitude: ne?.lat ?? 0, longitude: ne?.lng ?? 0 },
    southwest: { latitude: sw?.lat ?? 0, longitude: sw?.lng ?? 0 },
  };

  return {
    totalDistanceKm:  Math.round((totalMeters / 1000) * 10) / 10,
    totalDurationMin: Math.round(totalSeconds / 60),
    encodedPolyline:  polyline,
    legs: roundedLegs,
    provider: 'google',
    bounds,
  };
}
