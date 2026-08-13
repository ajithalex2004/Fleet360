/**
 * Distance matrix wrapper — Google primary, Mapbox fallback, haversine last.
 *
 * Given N points (lat/lng pairs), returns an N×N matrix of road distances
 * (km) and durations (min). The VRP solver reads this matrix exclusively —
 * it never sees raw lat/lng or vendor-specific shapes.
 *
 * Three providers:
 *   - 'google'    — calls Google Distance Matrix API. Real road network with
 *                   traffic. Preferred provider when GOOGLE_MAPS_API_KEY is
 *                   set. Per-request limits: 25 origins, 25 destinations,
 *                   100 total elements → we chunk to 10×10 windows.
 *   - 'mapbox'    — calls Mapbox Matrix API. Real road network. Used when
 *                   Google isn't configured or fails transiently. Per-call
 *                   limit 25 points → 25×25 = 625 elements.
 *   - 'haversine' — pure math, no network. Distance = great-circle ×
 *                   detour factor (default 1.3×). Duration estimated at
 *                   60 km/h average. Used when no vendor is available or
 *                   the caller explicitly requests offline mode.
 *
 * The solver should never have to think about which provider produced the
 * matrix — all three return the same { distances, durations, provider } shape.
 */

const MAPBOX_BASE = 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving';
const MAPBOX_CHUNK_LIMIT = 25;       // Mapbox per-call point limit
const GOOGLE_MATRIX_BASE = 'https://maps.googleapis.com/maps/api/distancematrix/json';
// Google per-request limit: 100 elements = 10×10 the largest square we can
// send in one call. 25 origins × 4 destinations would also fit but 10×10 gives
// symmetric chunking that's simpler to stitch.
const GOOGLE_CHUNK_LIMIT = 10;
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
  provider: 'google' | 'mapbox' | 'haversine';
}

export interface MatrixOptions {
  provider?: 'google' | 'mapbox' | 'haversine';
  /** Multiplier applied to haversine distance. Ignored for real providers. */
  detourFactor?: number;
  /** Average speed for haversine duration estimate. Ignored for real providers. */
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

// ── Google Distance Matrix API ────────────────────────────────────────────

interface GoogleElement {
  status?: string;                                    // 'OK' | 'ZERO_RESULTS' | 'NOT_FOUND' | ...
  distance?: { value?: number; text?: string };       // metres
  duration?: { value?: number; text?: string };       // seconds
}
interface GoogleRow { elements?: GoogleElement[] }
interface GoogleMatrixResponse {
  status?: string;
  rows?: GoogleRow[];
  error_message?: string;
}

/**
 * Build an N×N matrix from Google's API. Requests are chunked into 10×10
 * sub-matrices to stay under the 100-element per-request cap. Cell-level
 * ZERO_RESULTS is treated as Infinity (same as Mapbox null) so the solver
 * can treat both providers identically.
 */
async function buildGoogleMatrix(points: LatLng[], key: string): Promise<DistanceMatrix> {
  const n = points.length;
  const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const durations: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  const coord = (p: LatLng) => `${p.latitude},${p.longitude}`;

  for (let iStart = 0; iStart < n; iStart += GOOGLE_CHUNK_LIMIT) {
    for (let jStart = 0; jStart < n; jStart += GOOGLE_CHUNK_LIMIT) {
      const origins      = range(iStart, Math.min(iStart + GOOGLE_CHUNK_LIMIT, n)).map(i => coord(points[i])).join('|');
      const destinations = range(jStart, Math.min(jStart + GOOGLE_CHUNK_LIMIT, n)).map(j => coord(points[j])).join('|');
      const url = `${GOOGLE_MATRIX_BASE}?origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinations)}&mode=driving&units=metric&key=${key}`;
      const res = await fetchImpl(url);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Google matrix HTTP ${res.status}: ${detail}`);
      }
      const body = await res.json() as GoogleMatrixResponse;
      if (body.status !== 'OK') {
        throw new Error(`Google matrix status ${body.status}: ${body.error_message ?? '(no message)'}`);
      }
      const rows = body.rows ?? [];
      for (let i = 0; i < rows.length; i++) {
        const elements = rows[i].elements ?? [];
        for (let j = 0; j < elements.length; j++) {
          const e = elements[j];
          // Only OK elements carry usable data; the rest keep the Infinity
          // sentinel we pre-filled (matches the Mapbox "null → Infinity" rule).
          if (e.status === 'OK' && e.distance?.value != null && e.duration?.value != null) {
            distances[iStart + i][jStart + j] = round(e.distance.value / 1000, 2);
            durations[iStart + i][jStart + j] = round(e.duration.value / 60, 1);
          }
        }
      }
    }
  }
  return { distances, durations, provider: 'google' };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build an N×N distance + duration matrix for the given points.
 *
 * Provider selection:
 *   - opts.provider === 'haversine' → force haversine, no API call
 *   - opts.provider === 'google'    → require Google key, throw if not set
 *   - opts.provider === 'mapbox'    → require Mapbox token, throw if not set
 *   - omitted → try Google → Mapbox → haversine. Transient Google failures
 *     (network / quota / config) fall through to Mapbox so a bad key doesn't
 *     take down the solver mid-request.
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
  const mapboxToken = process.env.MAPBOX_TOKEN;
  const googleKey   = process.env.GOOGLE_MAPS_API_KEY;

  if (explicit === 'haversine') {
    return buildHaversineMatrix(points, opts);
  }
  if (explicit === 'google') {
    if (!googleKey) throw new Error('GOOGLE_MAPS_API_KEY not configured but provider="google" was requested');
    return buildGoogleMatrix(points, googleKey);
  }
  if (explicit === 'mapbox') {
    if (!mapboxToken) throw new Error('MAPBOX_TOKEN not configured but provider="mapbox" was requested');
    return buildMapboxMatrix(points, mapboxToken);
  }
  // Auto ladder: Google → Mapbox → haversine. A transient Google failure
  // falls through to Mapbox — noisy, but keeps the solver running. haversine
  // is the last resort so the app never hard-fails on distance calc.
  if (googleKey) {
    try {
      return await buildGoogleMatrix(points, googleKey);
    } catch (err) {
      console.warn('[distance-matrix] Google failed, falling back:', err instanceof Error ? err.message : err);
    }
  }
  if (mapboxToken) return buildMapboxMatrix(points, mapboxToken);
  return buildHaversineMatrix(points, opts);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
