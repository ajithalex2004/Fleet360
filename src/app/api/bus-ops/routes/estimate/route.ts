/**
 * GET /api/bus-ops/routes/estimate?origin=<addr>&destination=<addr>&waypoints=<a>|<b>|<c>
 *
 * Given origin + destination and optional pipe-separated waypoints, returns
 * the driving distance (km) and duration (min) for the sequential path:
 *
 *   origin → waypoint₁ → waypoint₂ → … → destination
 *
 * The waypoint order is preserved (bus stops have a fixed pickup sequence)
 * — we don't re-optimise. Total distance = Σ leg[i→i+1].
 *
 * Reuses the existing infrastructure:
 *   - geocode() — Google Geocoding primary, Mapbox fallback, tenant-cached
 *   - computeDistanceMatrix() — Google Distance Matrix primary, Mapbox fallback,
 *     haversine last resort
 *
 * For an N-point sequence we build a full N×N matrix and sum matrix[i][i+1]
 * for i in 0..N-2. One API round-trip regardless of stop count (within the
 * vendor's chunking limits).
 *
 * Response shape:
 *   {
 *     totalDistanceKm, estimatedDurationMins,
 *     provider,                    // 'google' | 'mapbox' | 'haversine' | 'noop'
 *     waypointCount,               // 0 when direct O→D, else number of intermediate stops
 *     legs: [{ fromLabel, toLabel, km, min }],
 *     minGeocodeConfidence,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { geocode, GeocodeError, type GeocodeResult } from '@/lib/logistics/geocoder';
import { computeDistanceMatrix } from '@/lib/logistics/distance-matrix';
import { computeGoogleDirections } from '@/lib/logistics/google-directions';

export const runtime = 'nodejs';

interface Leg { fromLabel: string; toLabel: string; km: number; min: number }

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const origin = searchParams.get('origin')?.trim();
  const destination = searchParams.get('destination')?.trim();
  if (!origin || !destination) {
    return NextResponse.json({ error: 'Both origin and destination are required' }, { status: 400 });
  }
  // Waypoints come as pipe-separated string. Each entry is either a name
  // (which we geocode) OR a "lat,lng" pair (which we use directly, skipping
  // geocoding). Coordinate short-circuits are what let a stop the operator
  // pinned on the map keep its exact position instead of being re-resolved
  // by the geocoder to a different nearby place.
  const waypointsRaw = (searchParams.get('waypoints') ?? '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 20);

  // Full path in order: origin, all waypoints, destination.
  const path = [origin, ...waypointsRaw, destination];
  const labels = ['Origin', ...waypointsRaw.map((_, i) => `Stop ${i + 1}`), 'Destination'];

  // Detect "lat,lng" entries. Regex must catch signed decimals within a
  // reasonable earth-coordinate range, but not so strict that a valid coord
  // like "-25,55" (no decimal) fails.
  const COORD_RE = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;
  const parseCoord = (s: string): { latitude: number; longitude: number } | null => {
    if (!COORD_RE.test(s)) return null;
    const [latStr, lngStr] = s.split(',').map(x => x.trim());
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { latitude: lat, longitude: lng };
  };

  // Degenerate case: direct O→D with same string both sides.
  if (path.length === 2 && origin.toLowerCase() === destination.toLowerCase()) {
    return NextResponse.json({
      totalDistanceKm: 0,
      estimatedDurationMins: 0,
      provider: 'noop',
      waypointCount: 0,
      legs: [],
      warning: 'Origin and destination are identical.',
    });
  }

  try {
    // Resolve every path entry to coordinates. Entries that are already
    // "lat,lng" (from a map-picked stop / origin / destination) SKIP the
    // geocoder entirely — the operator's pinned position is the source of
    // truth, and re-geocoding a name could resolve to somewhere else.
    // Entries that are addresses/names get geocoded as before.
    const geos: GeocodeResult[] = await Promise.all(path.map(async (entry) => {
      const coord = parseCoord(entry);
      if (coord) {
        // Confidence 1.0 — the operator picked this pin themselves. The
        // source label makes the debug output honest about who resolved it.
        return { latitude: coord.latitude, longitude: coord.longitude, confidence: 1.0, source: 'cache' as const };
      }
      return geocode(entry, tenantId);
    }));

    const points = geos.map(g => ({ latitude: g.latitude, longitude: g.longitude }));

    // Prefer Google Directions API — it returns the ACTUAL driving route
    // (real road network, real traffic-aware duration, and an encoded
    // polyline the frontend can render on a map). Falls back to the
    // pair-wise Distance Matrix if Directions fails (bad key, no route,
    // network hiccup) — still gives accurate numbers, just no polyline.
    if (process.env.GOOGLE_MAPS_API_KEY) {
      try {
        const dir = await computeGoogleDirections(points, labels);
        return NextResponse.json({
          totalDistanceKm: dir.totalDistanceKm,
          estimatedDurationMins: dir.totalDurationMin,
          provider: 'google-directions',
          waypointCount: waypointsRaw.length,
          legs: dir.legs,
          // Encoded polyline for the map component. Decode client-side via
          // google.maps.geometry.encoding.decodePath (loaded lazily).
          encodedPolyline: dir.encodedPolyline,
          bounds: dir.bounds,
          originCoords: { latitude: geos[0].latitude, longitude: geos[0].longitude },
          destinationCoords: { latitude: geos[geos.length - 1].latitude, longitude: geos[geos.length - 1].longitude },
          // Intermediate stops in order — used by the map component to drop
          // numbered markers along the route. Empty when there are no stops.
          stopCoords: geos.slice(1, -1).map((g, i) => ({
            latitude: g.latitude,
            longitude: g.longitude,
            label: waypointsRaw[i],
          })),
          minGeocodeConfidence: Math.min(...geos.map(g => g.confidence)),
        });
      } catch (dirErr) {
        console.warn('[bus-ops/routes/estimate] Google Directions failed, falling back to Distance Matrix:', dirErr instanceof Error ? dirErr.message : dirErr);
        // fall through to Distance Matrix path
      }
    }

    // Fallback path — Distance Matrix. No polyline, but accurate numbers.
    const matrix = await computeDistanceMatrix(points);

    // Sum sequential legs: origin→stop1, stop1→stop2, …, stopN→destination.
    // Any Infinity leg (vendor couldn't route between two points) surfaces
    // as an error rather than pretending the route is possible.
    const legs: Leg[] = [];
    let totalKm = 0;
    let totalMin = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const km  = matrix.distances[i][i + 1];
      const min = matrix.durations[i][i + 1];
      if (!Number.isFinite(km) || !Number.isFinite(min)) {
        // Include the geocoded coordinates so the user can see immediately
        // if either address was resolved to a wildly wrong location — the
        // most common reason we get an "unreachable" result on obviously
        // routable pairs like Dubai Marina → any Dubai office.
        const from = geos[i];
        const to = geos[i + 1];
        return NextResponse.json({
          error: `Could not compute a driving leg from "${path[i]}" to "${path[i + 1]}". `
               + `Geocoded to origin ${from.latitude.toFixed(4)},${from.longitude.toFixed(4)} and destination ${to.latitude.toFixed(4)},${to.longitude.toFixed(4)}. `
               + `If either coordinate is far from where you expected, the address was ambiguous — try a more specific address (e.g. include city + emirate), or use the map picker to drop a pin exactly.`,
          debug: {
            provider: matrix.provider,
            geocodedPoints: geos.map((g, idx) => ({
              label: labels[idx],
              query: path[idx],
              latitude: g.latitude,
              longitude: g.longitude,
              source: g.source,
              confidence: g.confidence,
            })),
          },
        }, { status: 422 });
      }
      totalKm += km;
      totalMin += min;
      legs.push({
        fromLabel: labels[i],
        toLabel: labels[i + 1],
        km: Math.round(km * 10) / 10,
        min: Math.round(min),
      });
    }

    return NextResponse.json({
      totalDistanceKm: Math.round(totalKm * 10) / 10,
      estimatedDurationMins: Math.round(totalMin),
      provider: matrix.provider,
      waypointCount: waypointsRaw.length,
      legs,
      encodedPolyline: null, // Distance Matrix path — no polyline available
      originCoords: { latitude: geos[0].latitude, longitude: geos[0].longitude },
      destinationCoords: { latitude: geos[geos.length - 1].latitude, longitude: geos[geos.length - 1].longitude },
      stopCoords: geos.slice(1, -1).map((g, i) => ({
        latitude: g.latitude,
        longitude: g.longitude,
        label: waypointsRaw[i],
      })),
      minGeocodeConfidence: Math.min(...geos.map(g => g.confidence)),
    });
  } catch (e) {
    if (e instanceof GeocodeError) {
      if (e.kind === 'no_match') {
        return NextResponse.json({ error: `Could not find a location. Check origin, destination, or any of the stop names.` }, { status: 422 });
      }
      if (e.kind === 'no_token') {
        return NextResponse.json({ error: 'Geocoding is not configured (set GOOGLE_MAPS_API_KEY or MAPBOX_TOKEN).' }, { status: 503 });
      }
      return NextResponse.json({ error: `Geocoding failed: ${e.message}` }, { status: 502 });
    }
    console.error('[bus-ops/routes/estimate GET]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to estimate route' }, { status: 500 });
  }
}
