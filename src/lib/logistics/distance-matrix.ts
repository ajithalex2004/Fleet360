/**
 * Distance matrix wrapper — Mapbox primary, haversine fallback.
 *
 * Given N points (lat/lng pairs), returns an N×N matrix of road distances
 * (km) and durations (min). The VRP solver reads this matrix exclusively —
 * it never sees raw lat/lng or vendor-specific shapes.
 *
 * Two providers:
 *   - 'mapbox'    — calls Mapbox Matrix API. Real road network, real
 *                   durations including traffic estimates. Default when
 *                   MAPBOX_TOKEN is set.
 *   - 'haversine' — pure math, no network. Distance = great-circle ×
 *                   detour factor (default 1.3×). Duration estimated at
 *                   60 km/h average. Used when MAPBOX_TOKEN is absent or
 *                   the caller explicitly requests offline mode.
 *
 * Mapbox Matrix has a hard limit of 25 points per call (25×25 = 625 elements
 * per request). For larger matrices we chunk into overlapping windows and
 * stitch results. The chunking is transparent to the caller.
 *
 * The solver should never have to think about which provider produced the
 * matrix — both return the same { distances, durations, provider } shape.
 */

const MAPBOX_BASE = 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving';
const MAPBOX_CHUNK_LIMIT = 25;       // Mapbox per-call point limit
const DEFAULT_DETOUR_FACTOR = 1.3;   // haversine multiplier — calibrated for GCC urban+highway
const DEFAULT_AVG_SPEED_KMH = 60;    // haversine duration estimate

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface DistanceMatrix {
  /** distances[i][j] = km from point i to point j */
  distances: number[][];
  /** durations[i][j] = minutes from point i to point j */
  durations: number[][];
  provider: 'mapbox' | 'haversine';
}

export interface MatrixOptions {
  provider?: 'mapbox' | 'haversine';
  /** Multiplier applied to haversine distance. Ignored when provider='mapbox'. */
  detourFactor?: number;
  /** Average speed for haversine duration estimate. Ignored when provider='mapbox'. */
  avgSpeedKmh?: number;
}

// ── Fetch injection seam (for tests) ──────────────────────────────────────

let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function _setFetchForTests(impl: typeof fetch): void { fetchImpl = impl; }
export function _resetFetchForTests(): void { fetchImpl = (...args) => fetch(...args); }

// ── Haversine ─────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number { return deg * Math.PI / 180; }

/**
 * Great-circle distance between two points in km. Exported for solver
 * tie-breakers and unit tests; production callers should go through
 * computeDistanceMatrix.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildHaversineMatrix(points: LatLng[], opts: MatrixOptions): DistanceMatrix {
  const factor = opts.detourFactor ?? DEFAULT_DETOUR_FACTOR;
  const speed = opts.avgSpeedKmh ?? DEFAULT_AVG_SPEED_KMH;
  const n = points.length;
  const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const durations: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const km = haversineKm(points[i], points[j]) * factor;
      const min = (km / speed) * 60;
      distances[i][j] = distances[j][i] = round(km, 2);
      durations[i][j] = durations[j][i] = round(min, 1);
    }
  }
  return { distances, durations, provider: 'haversine' };
}

// ── Mapbox ────────────────────────────────────────────────────────────────

interface MapboxMatrixResponse {
  code?: string;
  distances?: (number | null)[][];   // metres
  durations?: (number | null)[][];   // seconds
}

/**
 * Single Mapbox Matrix call. Caller guarantees points.length ≤ 25.
 */
async function callMapboxMatrix(points: LatLng[], token: string): Promise<{ distancesKm: number[][]; durationsMin: number[][] }> {
  if (points.length > MAPBOX_CHUNK_LIMIT) {
    throw new Error(`callMapboxMatrix expects ≤${MAPBOX_CHUNK_LIMIT} points, got ${points.length}`);
  }
  const coords = points.map(p => `${p.longitude},${p.latitude}`).join(';');
  const url = `${MAPBOX_BASE}/${coords}?annotations=distance,duration&access_token=${token}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Mapbox matrix failed: ${res.status} ${detail}`);
  }
  const body = await res.json() as MapboxMatrixResponse;
  if (!body.distances || !body.durations) {
    throw new Error(`Mapbox matrix response missing distances/durations: code=${body.code}`);
  }
  // Mapbox returns metres + seconds; we want km + minutes.
  const distancesKm  = body.distances.map(row => row.map(v => v == null ? Infinity : round(v / 1000, 2)));
  const durationsMin = body.durations.map(row => row.map(v => v == null ? Infinity : round(v / 60, 1)));
  return { distancesKm, durationsMin };
}

/**
 * Stitch the full N×N matrix when N > 25 by issuing overlapping chunks.
 * Strategy: split points into windows of size MAPBOX_CHUNK_LIMIT, then for
 * every (window_i, window_j) pair call Mapbox with `sources` and
 * `destinations` query params. For v1 we use the simpler approach: split
 * points and call once per chunk, then merge — the API supports
 * `sources=A;B&destinations=C;D` which we'd use for asymmetric chunks.
 *
 * Below the 25-point threshold this is a single call. Above it we build
 * the full square by repeated calls.
 */
async function buildMapboxMatrix(points: LatLng[], token: string): Promise<DistanceMatrix> {
  const n = points.length;
  if (n <= MAPBOX_CHUNK_LIMIT) {
    const { distancesKm, durationsMin } = await callMapboxMatrix(points, token);
    return { distances: distancesKm, durations: durationsMin, provider: 'mapbox' };
  }

  // For larger N: build the square matrix N×N from sub-matrices. We can't
  // just call the API once. Strategy: process in row-strips of CHUNK_LIMIT
  // rows × N destinations, using sources/destinations query params.
  // Implementation uses the documented endpoint variant:
  //   /{coords}?sources=<idx,idx>&destinations=<idx,idx>
  // where coords is all N points.
  const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const durations: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  const coords = points.map(p => `${p.longitude},${p.latitude}`).join(';');
  for (let srcStart = 0; srcStart < n; srcStart += MAPBOX_CHUNK_LIMIT) {
    for (let dstStart = 0; dstStart < n; dstStart += MAPBOX_CHUNK_LIMIT) {
      const sources = range(srcStart, Math.min(srcStart + MAPBOX_CHUNK_LIMIT, n));
      const destinations = range(dstStart, Math.min(dstStart + MAPBOX_CHUNK_LIMIT, n));
      const url = `${MAPBOX_BASE}/${coords}?annotations=distance,duration&sources=${sources.join(';')}&destinations=${destinations.join(';')}&access_token=${token}`;
      const res = await fetchImpl(url);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Mapbox matrix chunk failed: ${res.status} ${detail}`);
      }
      const body = await res.json() as MapboxMatrixResponse;
      if (!body.distances || !body.durations) {
        throw new Error(`Mapbox matrix chunk response missing data: code=${body.code}`);
      }
      // body.distances is sources.length × destinations.length
      for (let i = 0; i < sources.length; i++) {
        for (let j = 0; j < destinations.length; j++) {
          const d = body.distances[i][j];
          const t = body.durations[i][j];
          distances[sources[i]][destinations[j]]  = d == null ? Infinity : round(d / 1000, 2);
          durations[sources[i]][destinations[j]] = t == null ? Infinity : round(t / 60, 1);
        }
      }
    }
  }
  return { distances, durations, provider: 'mapbox' };
}

function range(start: number, endExclusive: number): number[] {
  const arr: number[] = [];
  for (let i = start; i < endExclusive; i++) arr.push(i);
  return arr;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build an N×N distance + duration matrix for the given points.
 *
 * Provider selection:
 *   - opts.provider === 'haversine' → force haversine, no API call
 *   - opts.provider === 'mapbox'   → require Mapbox, throw if no token
 *   - omitted → use Mapbox when MAPBOX_TOKEN is set, fall back to haversine
 */
export async function computeDistanceMatrix(
  points: LatLng[],
  opts: MatrixOptions = {},
): Promise<DistanceMatrix> {
  if (points.length === 0) {
    return { distances: [], durations: [], provider: opts.provider ?? 'haversine' };
  }
  // Single-point matrix is a degenerate 1×1 of zeros.
  if (points.length === 1) {
    return { distances: [[0]], durations: [[0]], provider: opts.provider ?? 'haversine' };
  }

  const explicit = opts.provider;
  const token = process.env.MAPBOX_TOKEN;

  if (explicit === 'haversine') {
    return buildHaversineMatrix(points, opts);
  }
  if (explicit === 'mapbox') {
    if (!token) throw new Error('MAPBOX_TOKEN not configured but provider="mapbox" was requested');
    return buildMapboxMatrix(points, token);
  }
  // Auto: prefer Mapbox, fall back silently to haversine if no token. This
  // lets dev environments work out of the box; production should always
  // have a token configured.
  if (token) return buildMapboxMatrix(points, token);
  return buildHaversineMatrix(points, opts);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
