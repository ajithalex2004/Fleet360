/**
 * Fleet Routing — Google Routes API matrix cache.
 *
 * Read-through cache for computeRouteMatrix responses. Same input in
 * every dimension = same matrix; reuse instead of paying Google again.
 *
 * Cache identity (all axes MUST be in the hash, or we silently serve
 * stale data to the solver):
 *   - origins       : sorted [{lat, lng}] rounded to 5 dp
 *   - destinations  : same, kept SEPARATE (mixed origin/destination
 *                     sets are common — same 10 stops used as both)
 *   - routingMode   : DRIVE | WALK | BICYCLE | TWO_WHEELER
 *   - trafficBucket : off-peak | am-peak | midday | pm-peak | evening
 *   - routeModifiers: JSON of {avoidTolls, avoidHighways, avoidFerries}
 *   - apiVersion    : bumps invalidate cache when Google's response
 *                     shape changes (or when we change how we call it)
 *
 * TTL is enforced by the caller — this module doesn't age rows out
 * automatically; a nightly sweep in operations/maintenance is a
 * follow-up task, not a hot-path concern.
 */

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { computeRouteMatrix } from './google-client';
import type {
  RouteMatrixRequest,
  RouteMatrixElement,
} from './types';

/** Bump this whenever the request shape or response contract changes. */
export const MATRIX_CACHE_API_VERSION = 'routes/v2-2026-08';

export type TrafficBucket = 'off-peak' | 'am-peak' | 'midday' | 'pm-peak' | 'evening';

export interface RouteModifiersInput {
  avoidTolls?:    boolean;
  avoidHighways?: boolean;
  avoidFerries?:  boolean;
}

export interface MatrixInput {
  tenantId:      string;
  origins:       Array<{ id: string; lat: number; lng: number }>;
  destinations:  Array<{ id: string; lat: number; lng: number }>;
  routingMode:   'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
  /** Local wall-clock; used for departureTime (traffic-aware) + bucket derivation. */
  departureTime: Date;
  modifiers?:    RouteModifiersInput;
}

export interface MatrixLookupResult {
  matrix: RouteMatrixElement[];
  fromCache: boolean;
  cacheKey: string;
}

/**
 * Read-through: check cache, return hit; on miss, call Google, persist,
 * return. Callers should always go through this, never directly through
 * computeRouteMatrix — the cache is the whole point.
 */
export async function getRouteMatrix(input: MatrixInput): Promise<MatrixLookupResult> {
  const {
    tenantId, origins, destinations, routingMode, departureTime, modifiers = {},
  } = input;

  const originsHash      = hashCoordSet(origins);
  const destinationsHash = hashCoordSet(destinations);
  const trafficBucket    = bucketFor(departureTime);
  const routeModifiers   = canonicalJson(modifiers);
  const cacheKey         = buildCacheKey({
    originsHash,
    destinationsHash,
    routingMode,
    trafficBucket,
    routeModifiers,
    apiVersion: MATRIX_CACHE_API_VERSION,
  });

  // Cache hit path.
  const cached = await prisma.fleetRouteMatrixCache.findUnique({
    where: { tenantId_cacheKey: { tenantId, cacheKey } },
  });
  if (cached) {
    return {
      matrix: cached.matrix as unknown as RouteMatrixElement[],
      fromCache: true,
      cacheKey,
    };
  }

  // Miss — build the Google request. Traffic-aware routing needs a future
  // departureTime; if the caller passed a past instant (fixture / re-solve
  // of a historical day), fall back to TRAFFIC_UNAWARE so Google doesn't
  // reject it. This preserves cache identity because the bucket still
  // rounds to the same value.
  const now = Date.now();
  const useTrafficAware = departureTime.getTime() > now + 60_000;

  const req: RouteMatrixRequest = {
    origins: origins.map(o => ({
      waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
      routeModifiers: modifiers as RouteModifiersInput | undefined,
    })),
    destinations: destinations.map(d => ({
      waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    })),
    travelMode: routingMode,
    ...(useTrafficAware
      ? {
          routingPreference: 'TRAFFIC_AWARE',
          departureTime: departureTime.toISOString(),
        }
      : { routingPreference: 'TRAFFIC_UNAWARE' }),
  };

  const matrix = await computeRouteMatrix(req);

  // Persist for next lookup. Failure to persist is non-fatal — return
  // the fresh matrix so the current solve can still complete.
  try {
    await prisma.fleetRouteMatrixCache.create({
      data: {
        tenantId,
        cacheKey,
        originsHash,
        destinationsHash,
        routingMode,
        trafficBucket,
        routeModifiers,
        apiVersion: MATRIX_CACHE_API_VERSION,
        origins:      origins as unknown as object,
        destinations: destinations as unknown as object,
        matrix:       matrix as unknown as object,
      },
    });
  } catch (e) {
    console.warn('[fleet-routing/matrix-cache] cache write failed (non-fatal):', e);
  }

  return { matrix, fromCache: false, cacheKey };
}

// ── Key + hash helpers ─────────────────────────────────────────────────────

/**
 * Sha256 hex over a canonical serialization of a coord set. Sorted +
 * rounded to 5 decimal places so trivial float noise (~1m at UAE lat)
 * doesn't blow the cache.
 */
function hashCoordSet(coords: Array<{ id: string; lat: number; lng: number }>): string {
  const canonical = coords
    .map(c => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`)
    .sort()
    .join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalJson(obj: object): string {
  // Sort keys deterministically so { avoidTolls: true, avoidHighways: false }
  // and { avoidHighways: false, avoidTolls: true } produce the same string.
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

interface CacheKeyParts {
  originsHash:      string;
  destinationsHash: string;
  routingMode:      string;
  trafficBucket:    string;
  routeModifiers:   string;
  apiVersion:       string;
}

function buildCacheKey(parts: CacheKeyParts): string {
  const joined = [
    parts.originsHash,
    parts.destinationsHash,
    parts.routingMode,
    parts.trafficBucket,
    parts.routeModifiers,
    parts.apiVersion,
  ].join('||');
  return createHash('sha256').update(joined).digest('hex');
}

/**
 * Map a wall-clock time to one of our five traffic buckets. Coarse enough
 * to keep the cache useful, fine enough to prevent an 07:00 matrix from
 * being reused for a 15:00 solve where traffic differs meaningfully.
 */
export function bucketFor(t: Date): TrafficBucket {
  const h = t.getHours();
  if (h >= 22 || h < 6) return 'off-peak';
  if (h < 10) return 'am-peak';
  if (h < 15) return 'midday';
  if (h < 21) return 'pm-peak';
  return 'evening';
}
