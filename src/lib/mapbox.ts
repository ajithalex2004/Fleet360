/**
 * src/lib/mapbox.ts
 * Server-side Mapbox utility — NEVER import this in client components.
 * Token stays server-side for Optimization & Directions API calls.
 * The public map-rendering token (NEXT_PUBLIC_MAPBOX_TOKEN) is separate
 * and safe to expose to the browser (Mapbox pk. tokens are domain-restricted).
 */

export const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN ?? '';
export const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Waypoint {
  id: string;
  label: string;         // Human-readable address
  lng: number;
  lat: number;
  type: 'origin' | 'stop' | 'destination';
  metadata?: Record<string, string>; // e.g. { studentName, stopTime, cargoDesc }
}

export interface OptimizedRoute {
  orderedWaypoints: Waypoint[];  // Re-ordered for optimal travel
  totalDistanceKm: number;
  totalDurationMin: number;
  geometry: GeoJSON.LineString;  // Route polyline for map rendering
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
  source: 'google' | 'mapbox';
}

// ── Mapbox Optimization API ───────────────────────────────────────────────────
// Calls the Mapbox Optimized Trips v1 API to reorder intermediate stops.
// Origin and destination are fixed; only intermediate stops are reordered.

export async function optimizeRoute(waypoints: Waypoint[]): Promise<OptimizedRoute> {
  if (waypoints.length < 2) {
    throw new Error('At least 2 waypoints (origin + destination) required.');
  }
  if (!MAPBOX_TOKEN) {
    throw new Error('MAPBOX_TOKEN is not configured in environment variables.');
  }

  const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    source: 'first',
    destination: 'last',
    roundtrip: 'false',
    geometries: 'geojson',
    overview: 'full',
    steps: 'false',
  });

  // Use driving-traffic for real-time, traffic-aware route optimization
  const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving-traffic/${coords}?${params}`;
  const res = await fetch(url, { next: { revalidate: 0 } });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mapbox Optimization API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    code: string;
    trips: Array<{
      geometry: GeoJSON.LineString;
      distance: number;   // metres
      duration: number;   // seconds
      legs: Array<{ distance: number; duration: number }>;
    }>;
    waypoints: Array<{
      waypoint_index: number;
      trips_index: number;
    }>;
  };

  if (data.code !== 'Ok' || !data.trips?.length) {
    throw new Error(`Mapbox returned: ${data.code}`);
  }

  const trip = data.trips[0];

  // Re-order original waypoints according to Mapbox's optimal sequence
  const indexMap = data.waypoints.map((w, i) => ({ original: i, optimal: w.waypoint_index }));
  indexMap.sort((a, b) => a.optimal - b.optimal);
  const orderedWaypoints = indexMap.map(m => waypoints[m.original]);

  // Build per-leg summary
  const legs: RouteLeg[] = trip.legs.map((leg, i) => ({
    from: orderedWaypoints[i]?.label ?? `Stop ${i + 1}`,
    to:   orderedWaypoints[i + 1]?.label ?? `Stop ${i + 2}`,
    distanceKm:  Math.round((leg.distance / 1000) * 10) / 10,
    durationMin: Math.round(leg.duration / 60),
  }));

  return {
    orderedWaypoints,
    totalDistanceKm:  Math.round((trip.distance / 1000) * 10) / 10,
    totalDurationMin: Math.round(trip.duration / 60),
    geometry: trip.geometry,
    legs,
  };
}

// ── Mapbox Directions API (2-point, fast) ─────────────────────────────────────

export async function getDirections(
  from: Pick<Waypoint, 'lng' | 'lat'>,
  to: Pick<Waypoint, 'lng' | 'lat'>,
): Promise<{ distanceKm: number; durationMin: number; geometry: GeoJSON.LineString }> {
  if (!MAPBOX_TOKEN) throw new Error('MAPBOX_TOKEN not configured');

  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    geometries: 'geojson',
    overview: 'full',
  });

  // driving-traffic = real-time traffic awareness
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?${params}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Mapbox Directions error ${res.status}`);

  const data = await res.json() as {
    routes: Array<{ distance: number; duration: number; geometry: GeoJSON.LineString }>;
  };

  const route = data.routes[0];
  return {
    distanceKm:  Math.round((route.distance / 1000) * 10) / 10,
    durationMin: Math.round(route.duration / 60),
    geometry:    route.geometry,
  };
}

// ── Geocoding ─────────────────────────────────────────────────────────────────
// Primary: Google Geocoding API (best UAE address accuracy)
// Fallback: Mapbox Geocoding API

export async function geocodeAddress(address: string): Promise<GeocodeResult[]> {
  // Try Google first
  if (GOOGLE_MAPS_KEY) {
    try {
      const results = await geocodeGoogle(address);
      if (results.length) return results;
    } catch { /* fall through to Mapbox */ }
  }
  // Fallback to Mapbox
  return geocodeMapbox(address);
}

async function geocodeGoogle(address: string): Promise<GeocodeResult[]> {
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

async function geocodeMapbox(address: string): Promise<GeocodeResult[]> {
  if (!MAPBOX_TOKEN) return [];
  const query = encodeURIComponent(address);
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    country: 'ae',
    language: 'en',
    limit: '5',
  });
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?${params}`,
  );
  const data = await res.json() as {
    features: Array<{ place_name: string; center: [number, number] }>;
  };

  return (data.features ?? []).map(f => ({
    label:  f.place_name,
    lng:    f.center[0],
    lat:    f.center[1],
    source: 'mapbox' as const,
  }));
}

// ── Fuel estimate ─────────────────────────────────────────────────────────────
// Rough estimate: UAE average 10L/100km for vans/trucks, AED 3.00/L (approx)

export function estimateFuelCost(distanceKm: number, vehicleType: 'van' | 'truck' | 'bus' = 'van') {
  const consumption = vehicleType === 'truck' ? 15 : vehicleType === 'bus' ? 18 : 10; // L/100km
  const pricePerLitre = 3.0; // AED
  const litres = (distanceKm / 100) * consumption;
  const cost   = litres * pricePerLitre;
  return { litres: Math.round(litres * 10) / 10, costAED: Math.round(cost) };
}
