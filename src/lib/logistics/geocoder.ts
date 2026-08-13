/**
 * Geocoding wrapper — Google primary, Mapbox fallback, tenant-scoped cache.
 *
 * Address strings → { latitude, longitude }. Cache hits avoid the API call
 * entirely (real-world hit rates land at 80-95% once a tenant has been
 * operating for a few weeks — most shipments pick up from a small set of
 * repeat warehouses).
 *
 * Provider selection (auto, per-call):
 *   1. Cache hit? → return cached row (source = 'cache')
 *   2. GOOGLE_MAPS_API_KEY set? → try Google Geocoding API (source = 'google')
 *   3. Google unavailable or failed with an operational error? → try Mapbox
 *      (source = 'mapbox')
 *   4. Both unavailable → throw GeocodeError with kind = 'no_token'
 *
 * A `no_match` from either vendor is authoritative — we don't fall through
 * to the other. Only NETWORK / QUOTA / KEY errors trigger the fallback,
 * because a well-formed address that Google can't find is also a well-
 * formed address that Mapbox is unlikely to find, and double-billing every
 * miss to both vendors is wasteful.
 *
 * Surface area (unchanged):
 *   geocode(addr, tenantId)                — single address, throws on failure
 *   geocodeBatch(addrs, tenantId)          — many at once, returns per-item
 *                                            result/error, never throws
 *   invalidateCache(addr, tenantId)        — drop a cache row when address changes
 */

import { prisma } from '@/lib/prisma';
import { ensureRouteOptimizerSchema } from './route-optimizer-schema';

const MAPBOX_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const GOOGLE_GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Normalised confidence 0..1. From Mapbox's "relevance", or derived from
   *  Google's location_type ± partial_match heuristic. */
  confidence: number;
  source: 'cache' | 'google' | 'mapbox';
}

export class GeocodeError extends Error {
  constructor(message: string, public readonly kind: 'no_token' | 'no_match' | 'api_error') {
    super(message);
  }
}

// ── Address normalisation ─────────────────────────────────────────────────

/**
 * Cache key normalisation. The same warehouse address shouldn't generate
 * different cache rows because of whitespace, casing, or punctuation
 * variations. Aggressive enough to dedupe ordinary typos; not so aggressive
 * that semantically different addresses collide.
 */
export function normaliseAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,;'"`()]/g, ' ')      // strip punctuation
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim();
}

// ── Cache helpers ─────────────────────────────────────────────────────────

interface CacheRow {
  latitude: string | number;
  longitude: string | number;
  confidence: string | number | null;
}

async function readCache(tenantId: string, normalised: string): Promise<GeocodeResult | null> {
  const rows = await prisma.$queryRawUnsafe<CacheRow[]>(
    `SELECT latitude::text, longitude::text, confidence::text
       FROM logistics_geocode_cache
      WHERE tenant_id = $1 AND normalised_address = $2
      LIMIT 1`,
    tenantId, normalised,
  ).catch(() => [] as CacheRow[]);
  if (!rows[0]) return null;
  return {
    latitude:  Number(rows[0].latitude),
    longitude: Number(rows[0].longitude),
    confidence: rows[0].confidence != null ? Number(rows[0].confidence) : 0,
    source: 'cache',
  };
}

async function writeCache(args: {
  tenantId: string;
  normalised: string;
  latitude: number;
  longitude: number;
  confidence: number;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_geocode_cache
       (tenant_id, normalised_address, latitude, longitude, confidence, source, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, 'mapbox', NOW())
     ON CONFLICT (tenant_id, normalised_address)
     DO UPDATE SET
       latitude     = EXCLUDED.latitude,
       longitude    = EXCLUDED.longitude,
       confidence   = EXCLUDED.confidence,
       refreshed_at = NOW()`,
    args.tenantId, args.normalised, args.latitude, args.longitude, args.confidence,
  ).catch(() => { /* cache write failures shouldn't block the caller */ });
}

export async function invalidateCache(rawAddress: string, tenantId: string): Promise<void> {
  await ensureRouteOptimizerSchema();
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_geocode_cache
      WHERE tenant_id = $1 AND normalised_address = $2`,
    tenantId, normaliseAddress(rawAddress),
  );
}

// ── Mapbox client ─────────────────────────────────────────────────────────

interface MapboxFeature {
  center?: [number, number];        // [lng, lat]
  relevance?: number;
}
interface MapboxResponse {
  features?: MapboxFeature[];
}

/**
 * Allow tests to inject a stub. Default is the global fetch.
 * Not exported as a config to avoid leaking the seam into production code.
 */
let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function _setFetchForTests(impl: typeof fetch): void { fetchImpl = impl; }
export function _resetFetchForTests(): void { fetchImpl = (...args) => fetch(...args); }

async function callMapbox(address: string, token: string): Promise<GeocodeResult> {
  const url = `${MAPBOX_BASE}/${encodeURIComponent(address)}.json?access_token=${token}&limit=1&types=address,place,poi`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GeocodeError(`Mapbox geocoding failed: ${res.status} ${detail}`, 'api_error');
  }
  const data = await res.json() as MapboxResponse;
  const top = data.features?.[0];
  if (!top?.center || top.center.length !== 2) {
    throw new GeocodeError(`No match for "${address}"`, 'no_match');
  }
  const [lng, lat] = top.center;
  return {
    latitude: lat,
    longitude: lng,
    confidence: top.relevance ?? 0,
    source: 'mapbox',
  };
}

// ── Google Geocoding API ──────────────────────────────────────────────────

interface GoogleGeocodeResult {
  geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
  formatted_address?: string;
  partial_match?: boolean;
}
interface GoogleGeocodeResponse {
  status?: string;
  results?: GoogleGeocodeResult[];
  error_message?: string;
}

/**
 * Map Google's location_type + partial_match flag to a 0..1 confidence
 * comparable to Mapbox's relevance:
 *   ROOFTOP            → 1.0   (exact address point)
 *   RANGE_INTERPOLATED → 0.9   (interpolated between two known addresses)
 *   GEOMETRIC_CENTER   → 0.75  (bounded region, e.g. a street)
 *   APPROXIMATE        → 0.5   (city / country / bounding box)
 *   partial_match=true → ×0.7  (Google matched fewer components than requested)
 */
function googleConfidence(r: GoogleGeocodeResult): number {
  const base = {
    ROOFTOP: 1.0,
    RANGE_INTERPOLATED: 0.9,
    GEOMETRIC_CENTER: 0.75,
    APPROXIMATE: 0.5,
  }[r.geometry?.location_type ?? 'APPROXIMATE'] ?? 0.5;
  return r.partial_match ? base * 0.7 : base;
}

async function callGoogle(address: string, key: string): Promise<GeocodeResult> {
  // Regional biasing.
  //   `region`     — SOFT hint (top-level ccTLD ranking bias). Cheap; too weak
  //                  on its own for ambiguous names like "Emirates Private
  //                  School" which Google also matches in Algeria.
  //   `components=country:XX` — HARD filter, rejects results outside the country.
  //                             Reliable; the trade-off is cross-border routes
  //                             fail if the country is wrong.
  //
  // Defaults for Fleet360's typical tenant (UAE-based):
  //   region       = 'ae'
  //   restrictTo   = 'AE'  ← HARD RESTRICT by default; ambiguous global matches
  //                          were the top cause of wildly wrong distances.
  //
  // Overrides (add to .env.local):
  //   GEOCODER_REGION_BIAS=sa
  //   GEOCODER_RESTRICT_COUNTRY=SA        (or a comma list: SA,AE,OM)
  //   GEOCODER_RESTRICT_COUNTRY=""        (empty string disables hard restrict)
  const region = process.env.GEOCODER_REGION_BIAS?.trim().toLowerCase() || 'ae';
  // `undefined` env var → default AE. Empty string → no restriction (escape hatch).
  const restrictSetting = process.env.GEOCODER_RESTRICT_COUNTRY;
  const restrictCountry = restrictSetting === undefined
    ? 'AE'
    : restrictSetting.trim().toUpperCase();
  const params = new URLSearchParams({ address, key, region });
  if (restrictCountry) params.set('components', `country:${restrictCountry}`);
  const url = `${GOOGLE_GEOCODE_BASE}?${params.toString()}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GeocodeError(`Google geocoding HTTP ${res.status}: ${detail}`, 'api_error');
  }
  const data = await res.json() as GoogleGeocodeResponse;
  // Google returns a machine-readable `status` field inside a 200 response —
  // treat non-OK as an API error so the fallback can trigger. ZERO_RESULTS is
  // authoritative (no fallback) — Mapbox almost never finds what Google can't.
  if (data.status === 'ZERO_RESULTS') {
    throw new GeocodeError(`No match for "${address}"`, 'no_match');
  }
  if (data.status !== 'OK') {
    const msg = data.error_message ?? data.status ?? 'unknown';
    throw new GeocodeError(`Google geocoding failed: ${msg}`, 'api_error');
  }
  const top = data.results?.[0];
  const lat = top?.geometry?.location?.lat;
  const lng = top?.geometry?.location?.lng;
  if (top == null || lat == null || lng == null) {
    throw new GeocodeError(`Google returned OK but no usable result for "${address}"`, 'api_error');
  }
  return {
    latitude: lat,
    longitude: lng,
    confidence: googleConfidence(top),
    source: 'google',
  };
}

// ── Public API ────────────────────────────────────────────────────────────

export async function geocode(rawAddress: string, tenantId: string): Promise<GeocodeResult> {
  if (!rawAddress?.trim()) {
    throw new GeocodeError('Empty address', 'no_match');
  }
  await ensureRouteOptimizerSchema();
  const normalised = normaliseAddress(rawAddress);

  // Cache hit short-circuits the API call.
  const cached = await readCache(tenantId, normalised);
  if (cached) return cached;

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const mapboxToken = process.env.MAPBOX_TOKEN;

  if (!googleKey && !mapboxToken) {
    throw new GeocodeError(
      `No geocoding provider configured (set GOOGLE_MAPS_API_KEY or MAPBOX_TOKEN) and "${rawAddress}" not in cache`,
      'no_token',
    );
  }

  // Provider ladder: Google → Mapbox. A no_match from Google is authoritative
  // (Mapbox almost never finds what Google can't) so we DON'T fall through on
  // that kind — only on transient errors (network, quota, key issues). This
  // avoids double-billing every unfindable address.
  let result: GeocodeResult | null = null;
  let lastError: unknown = null;
  if (googleKey) {
    try {
      result = await callGoogle(rawAddress, googleKey);
    } catch (err) {
      lastError = err;
      // Authoritative "no result" → stop; don't try Mapbox.
      if (err instanceof GeocodeError && err.kind === 'no_match') throw err;
      // Otherwise fall through to Mapbox (transient / quota / config error).
    }
  }
  if (!result && mapboxToken) {
    try {
      result = await callMapbox(rawAddress, mapboxToken);
    } catch (err) {
      // If Google already errored transiently AND Mapbox now errors too,
      // surface the Mapbox error but include a hint that Google also failed.
      if (lastError) {
        const g = lastError instanceof Error ? lastError.message : String(lastError);
        const m = err instanceof Error ? err.message : String(err);
        throw new GeocodeError(`Both providers failed. Google: ${g}. Mapbox: ${m}`, 'api_error');
      }
      throw err;
    }
  }
  if (!result) {
    // We had Google but it failed transiently and no Mapbox fallback available.
    if (lastError instanceof Error) throw lastError;
    throw new GeocodeError('All geocoding providers failed', 'api_error');
  }

  await writeCache({
    tenantId,
    normalised,
    latitude: result.latitude,
    longitude: result.longitude,
    confidence: result.confidence,
  });
  return result;
}

export interface BatchOutcome {
  address: string;
  result: GeocodeResult | null;
  error: string | null;
}

/**
 * Geocode many addresses with bounded concurrency. Per-item failures don't
 * abort the batch — the caller sees which addresses failed via the `error`
 * field and decides how to handle them (block the optimize, fall back to
 * approximate centroid, etc.).
 *
 * Concurrency is fixed at 6: Mapbox's rate limit on the free tier is 600
 * req/min, so 6 parallel calls leaves comfortable headroom for other
 * geocoding consumers (shipper-portal, customer creation flows).
 */
export async function geocodeBatch(
  addresses: string[],
  tenantId: string,
): Promise<BatchOutcome[]> {
  const outcomes: BatchOutcome[] = addresses.map(a => ({ address: a, result: null, error: null }));
  const queue = addresses.map((_, i) => i);
  const workers = Array.from({ length: Math.min(6, addresses.length) }, async () => {
    while (queue.length) {
      const i = queue.shift();
      if (i === undefined) return;
      try {
        outcomes[i].result = await geocode(addresses[i], tenantId);
      } catch (e) {
        outcomes[i].error = e instanceof Error ? e.message : String(e);
      }
    }
  });
  await Promise.all(workers);
  return outcomes;
}
