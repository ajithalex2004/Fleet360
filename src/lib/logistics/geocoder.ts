/**
 * Mapbox Geocoding wrapper with tenant-scoped caching.
 *
 * Address strings → { latitude, longitude } via Mapbox's forward-geocoding
 * endpoint. Cache hits avoid the API call entirely, which is the difference
 * between staying inside Mapbox's 100k/month free tier and not. Real-world
 * cache hit rates land at 80-95% once a tenant has been operating for a
 * few weeks — most shipments pick up from a small set of repeat warehouses.
 *
 * Surface area:
 *   geocode(addr, tenantId)                — single address, throws on failure
 *   geocodeBatch(addrs, tenantId)          — many at once, returns per-item
 *                                            result/error, never throws
 *   invalidateCache(addr, tenantId)        — drop a cache row when address changes
 *
 * Mode of operation:
 *   - If MAPBOX_TOKEN is set → cache lookup then Mapbox call on miss
 *   - If MAPBOX_TOKEN is missing → cache lookup only; throws on miss with
 *     a clear "no token configured" message. This is the dev/CI mode; tests
 *     pre-populate the cache.
 *
 * Why not a full SDK: Mapbox's official SDK is bulky and bundles
 * client/server in unhealthy ways. The geocoding endpoint is a single GET
 * with documented query params — a 30-line fetch wrapper is correct here.
 */

import { prisma } from '@/lib/prisma';
import { ensureRouteOptimizerSchema } from './route-optimizer-schema';

const MAPBOX_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Mapbox returns "relevance" 0..1; we store and surface it as confidence. */
  confidence: number;
  source: 'cache' | 'mapbox';
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

  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    throw new GeocodeError(
      `MAPBOX_TOKEN not configured and "${rawAddress}" not in cache`,
      'no_token',
    );
  }

  const result = await callMapbox(rawAddress, token);
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
