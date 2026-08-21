/**
 * src/lib/mapbox.ts
 *
 * Historically-named routing helper. All three routing calls (optimize,
 * directions, geocode) now go through Google — Mapbox was swapped out.
 * The filename is a legacy artifact; ~15 files across the codebase import
 * from `@/lib/mapbox`, so keeping the path avoids incidental churn. The
 * exported interface (Waypoint / OptimizedRoute / RouteLeg / GeocodeResult /
 * estimateFuelCost) is preserved so every caller works unchanged.
 *
 * The Google auth machinery + fetch wrappers live in
 * `src/lib/planning/fleet-routing/google-client.ts` — placed there
 * because Fleet Routing shipped first. Fine as-is; renaming that folder
 * (say to `src/lib/google/`) is a purely cosmetic follow-up.
 *
 * Server-only. Never import into a client component — Google Cloud
 * credentials must stay server-side.
 */

import { computeRoutes, computeRouteMatrix as _computeRouteMatrix } from '@/lib/planning/fleet-routing/google-client';
import { decodePolyline } from '@/lib/planning/fleet-routing/polyline';
import type { ComputeRoutesLocation } from '@/lib/planning/fleet-routing/types';

export const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

// Silence lint on the legacy re-export — kept for callers still reading the
// env var name from this module. New code should read GOOGLE_MAPS_API_KEY
// directly.
export const MAPBOX_TOKEN = '';

// ── Types (preserved for backward compat) ───────────────────────────────────

export interface Waypoint {
  id: string;
  label: string;         // Human-readable address
  lng: number;
  lat: number;
  type: 'origin' | 'stop' | 'destination';
  metadata?: Record<string, string>;
}

export interface OptimizedRoute {
  orderedWaypoints: Waypoint[];    // Re-ordered for optimal travel
  totalDistanceKm: number;
  totalDurationMin: number;
  geometry: GeoJSON.LineString;    // Route polyline for map rendering
  legs: RouteLeg[];
}

export interface RouteLeg {
  from: string;
  to: string;
  distanceKm: number;
  durationMin: number;
}

export interface GeocodeResult {
  label: string;
  lng: number;
  lat: number;
  /** 'google' only now that the Mapbox fallback is retired. Union kept so
   *  callers that pattern-match on this field don't need a type update. */
  source: 'google' | 'mapbox';
}

// ── Route optimization — Google Routes API v2 with optimizeWaypointOrder ───
//
// Origin (first) and destination (last) stay fixed; only intermediate stops
// are reordered. Matches the Mapbox constraint model this replaced, so the
// solver's "savings" numbers stay directly comparable to historical runs.

export async function optimizeRoute(waypoints: Waypoint[]): Promise<OptimizedRoute> {
  if (waypoints.length < 2) {
    throw new Error('At least 2 waypoints (origin + destination) required.');
  }

  const asLoc = (w: Waypoint): ComputeRoutesLocation => ({
    location: { latLng: { latitude: w.lat, longitude: w.lng } },
  });
  const intermediates = waypoints.slice(1, -1);
  const req = {
    origin:        asLoc(waypoints[0]),
    destination:   asLoc(waypoints[waypoints.length - 1]),
    intermediates: intermediates.length > 0 ? intermediates.map(asLoc) : undefined,
    travelMode:    'DRIVE' as const,
    routingPreference: 'TRAFFIC_AWARE' as const,
    optimizeWaypointOrder: intermediates.length > 1,
  };

  const data = await computeRoutes(req);
  const route = data.routes?.[0];
  if (!route) throw new Error('Google Routes returned no routes.');

  // Reconstruct the ordered waypoints. When Google reordered the
  // intermediates it returns optimizedIntermediateWaypointIndex — value at
  // position i is the ORIGINAL index of the intermediate now at position i
  // in the optimized route. Origin stays first, destination stays last.
  let ordered: Waypoint[];
  if (route.optimizedIntermediateWaypointIndex?.length) {
    const reorderedIntermediates = route.optimizedIntermediateWaypointIndex
      .map(originalIdx => intermediates[originalIdx])
      .filter(Boolean);
    ordered = [waypoints[0], ...reorderedIntermediates, waypoints[waypoints.length - 1]];
  } else {
    // No reordering happened (0 or 1 intermediates → nothing to permute).
    ordered = [...waypoints];
  }

  // GeoJSON LineString from Google's encoded polyline — matches the shape
  // the old Mapbox response carried, so map renderers don't change.
  const points = decodePolyline(route.polyline?.encodedPolyline ?? '');
  const geometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: points.map(p => [p.lng, p.lat] as [number, number]),
  };

  const legs: RouteLeg[] = (route.legs ?? []).map((leg, i) => ({
    from:        ordered[i]?.label ?? `Stop ${i + 1}`,
    to:          ordered[i + 1]?.label ?? `Stop ${i + 2}`,
    distanceKm:  metersToKm(leg.distanceMeters),
    durationMin: durationToMin(leg.duration),
  }));

  return {
    orderedWaypoints:  ordered,
    totalDistanceKm:   metersToKm(route.distanceMeters),
    totalDurationMin:  durationToMin(route.duration),
    geometry,
    legs,
  };
}

// ── Directions (2-point) — same computeRoutes call, no intermediates ───────

export async function getDirections(
  from: Pick<Waypoint, 'lng' | 'lat'>,
  to:   Pick<Waypoint, 'lng' | 'lat'>,
): Promise<{ distanceKm: number; durationMin: number; geometry: GeoJSON.LineString }> {
  const data = await computeRoutes({
    origin:        { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination:   { location: { latLng: { latitude: to.lat,   longitude: to.lng   } } },
    travelMode:    'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  });
  const route = data.routes?.[0];
  if (!route) throw new Error('Google Routes returned no route for directions request.');
  const points = decodePolyline(route.polyline?.encodedPolyline ?? '');
  return {
    distanceKm:  metersToKm(route.distanceMeters),
    durationMin: durationToMin(route.duration),
    geometry: {
      type: 'LineString',
      coordinates: points.map(p => [p.lng, p.lat] as [number, number]),
    },
  };
}

// ── Geocoding — Google only (Mapbox fallback retired) ──────────────────────

export async function geocodeAddress(address: string): Promise<GeocodeResult[]> {
  if (!GOOGLE_MAPS_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured — geocoding is unavailable.');
  }
  const params = new URLSearchParams({ address, region: 'ae', key: GOOGLE_MAPS_KEY });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  const data = await res.json() as {
    status: string;
    results: Array<{
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };
  if (data.status !== 'OK') return [];
  return data.results.slice(0, 5).map(r => ({
    label:  r.formatted_address,
    lng:    r.geometry.location.lng,
    lat:    r.geometry.location.lat,
    source: 'google' as const,
  }));
}

// ── Fuel estimate ────────────────────────────────────────────────────────
// Consumption rate is still a per-vehicle-type heuristic (no per-vehicle MPG
// data to draw on). Price is no longer hardcoded — callers pass the fleet's
// own most-recent pump price (see getLatestFuelPrice in the optimize route);
// DEFAULT_FUEL_PRICE_AED is only the fallback when no fuel log exists yet.

/**
 * Fallback pump price (AED/litre), used when no real fuel-log price is
 * available. Route Consolidation imports this for exactly that fallback
 * (see fuelPricePerLitreAED in route-consolidation.ts).
 */
export const DEFAULT_FUEL_PRICE_AED = 3.0;

export function estimateFuelCost(
  distanceKm: number,
  vehicleType: 'van' | 'truck' | 'bus' = 'van',
  pricePerLitreAED: number = DEFAULT_FUEL_PRICE_AED,
) {
  const consumption = vehicleType === 'truck' ? 15 : vehicleType === 'bus' ? 18 : 10; // L/100km
  const litres = (distanceKm / 100) * consumption;
  const cost   = litres * pricePerLitreAED;
  return { litres: Math.round(litres * 10) / 10, costAED: Math.round(cost), pricePerLitreAED };
}

/**
 * Distance-matrix passthrough — some callers used mapbox.ts as their
 * one-stop routing shim. Re-export the Google Routes matrix caller
 * for backward-compat imports; new code should hit the fleet-routing
 * matrix cache directly for read-through caching.
 */
export const computeRouteMatrix = _computeRouteMatrix;

// ── Internals ──────────────────────────────────────────────────────────────

function metersToKm(m: number | undefined): number {
  if (typeof m !== 'number') return 0;
  return Math.round((m / 1000) * 10) / 10;
}
function durationToMin(d: string | undefined): number {
  if (!d) return 0;
  const secs = Number(d.replace(/s$/, ''));
  if (!Number.isFinite(secs)) return 0;
  return Math.round(secs / 60);
}
