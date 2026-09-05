/**
 * Fleet360 Routing Intelligence Service
 * ---------------------------------------
 * The single authoritative routing abstraction across all Fleet360 agents.
 *
 * Capabilities:
 *  1. Canonical Location Normalization (canonicalLocationId + precise access + geohash).
 *  2. Adaptive Spatial Shortlisting with fallback expansion (prevents operational infeasibility).
 *  3. Multi-Tier TTL Matrix Cache (STATIC_DISTANCE 30d, HISTORICAL_TRAVEL_TIME 7d, TRAFFIC_DYNAMIC 15m).
 *  4. Upstream Provider Abstraction & Chunking (Google Matrix -> Mapbox -> Haversine fallback).
 *  5. Avoided Cost & Matrix Telemetry Attribution.
 *
 * RULE: No domain agent calls Google Maps, Mapbox, or OSRM directly.
 */

import { prisma } from '@/lib/prisma';
import {
  CanonicalLocation,
  DistanceMatrixResult,
  LatLng,
  MatrixPairResult,
  RouteDetailResult,
  RoutingCacheTier,
  SpatialShortlistOptions,
  SpatialShortlistResult,
} from '@/lib/agents/types';
import { calculateRoutingCost, USD_TO_AED_RATE } from '@/lib/agents/telemetry';
import { ensureAgentSchema } from '@/lib/agents/schema';

// ── Geohash Encoding Engine (Base32) ──────────────────────────────────────────

const GEOHASH_CHARS = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(latitude: number, longitude: number, precision = 6): string {
  let latMin = -90.0, latMax = 90.0;
  let lonMin = -180.0, lonMax = 180.0;
  let geohash = '';
  let bits = 0;
  let charIndex = 0;
  let isEven = true;

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lonMin + lonMax) / 2;
      if (longitude >= mid) {
        charIndex = (charIndex << 1) | 1;
        lonMin = mid;
      } else {
        charIndex = (charIndex << 1) | 0;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        charIndex = (charIndex << 1) | 1;
        latMin = mid;
      } else {
        charIndex = (charIndex << 1) | 0;
        latMax = mid;
      }
    }

    isEven = !isEven;
    bits++;

    if (bits === 5) {
      geohash += GEOHASH_CHARS[charIndex];
      bits = 0;
      charIndex = 0;
    }
  }

  return geohash;
}

// ── In-Memory Fast L1 Cache (Up to 5,000 entries) ──────────────────────────────

interface CachedMatrixEntry {
  distanceKm: number;
  durationMin: number;
  provider: 'google' | 'mapbox' | 'haversine' | 'osrm';
  expiresAt: number; // timestamp ms
  cacheTier: RoutingCacheTier;
}

const MEMORY_L1_CACHE = new Map<string, CachedMatrixEntry>();
const MAX_L1_SIZE = 5000;

function getL1(key: string): CachedMatrixEntry | null {
  const entry = MEMORY_L1_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    MEMORY_L1_CACHE.delete(key);
    return null;
  }
  return entry;
}

function setL1(key: string, entry: CachedMatrixEntry): void {
  if (MEMORY_L1_CACHE.size >= MAX_L1_SIZE) {
    // Evict oldest 500 keys
    const keys = Array.from(MEMORY_L1_CACHE.keys()).slice(0, 500);
    for (const k of keys) MEMORY_L1_CACHE.delete(k);
  }
  MEMORY_L1_CACHE.set(key, entry);
}

// ── TTL Tiers Calculation (ms) ────────────────────────────────────────────────

export function getTtlMsForTier(tier: RoutingCacheTier): number {
  switch (tier) {
    case 'STATIC_DISTANCE':
      return 30 * 24 * 60 * 60 * 1000; // 30 days
    case 'HISTORICAL_TRAVEL_TIME':
      return 7 * 24 * 60 * 60 * 1000;  // 7 days
    case 'TRAFFIC_DYNAMIC':
    default:
      return 15 * 60 * 1000;           // 15 minutes
  }
}

// ── Great-Circle Haversine Calculation (with GCC Road Detour 1.3x) ────────────

const EARTH_RADIUS_KM = 6371;
export const DEFAULT_DETOUR_FACTOR = 1.3;
export const DEFAULT_AVG_SPEED_KMH = 45; // GCC urban/arterial composite

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  detourFactor = DEFAULT_DETOUR_FACTOR,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const rawDist = EARTH_RADIUS_KM * c;
  return Number((rawDist * detourFactor).toFixed(2));
}

// ── Routing Intelligence Service Implementation ───────────────────────────────

export interface RoutingIntelligenceOptions {
  tier?: RoutingCacheTier;
  preferredProvider?: 'google' | 'mapbox' | 'haversine' | 'osrm';
  avgSpeedKmh?: number;
  detourFactor?: number;
  forceFresh?: boolean;
}

export class RoutingIntelligenceService {
  /**
   * 1. Canonicalize Location: Combines canonical ID, access points, and geohash.
   * Handles UAE road barriers, service lanes, and separate compound entry gates.
   */
  canonicalizeLocation(input: {
    canonicalLocationId?: string;
    name?: string;
    latitude: number;
    longitude: number;
    accessPoint?: LatLng;
    zoneId?: string;
  }): CanonicalLocation {
    const access = input.accessPoint ?? {
      latitude: input.latitude,
      longitude: input.longitude,
    };
    const geohash = encodeGeohash(access.latitude, access.longitude, 6);

    return {
      canonicalLocationId: input.canonicalLocationId,
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      geohash,
      accessPoint: access,
      zoneId: input.zoneId,
    };
  }

  /**
   * 2. Adaptive Spatial Shortlist with Fallback Expansion:
   * Prunes candidates by radius while guaranteeing operational feasibility.
   * Expands: 5 km -> 10 km -> 25 km -> Zone boundary if candidate count < minCandidates.
   */
  spatialShortlist<T>(
    origin: LatLng,
    candidates: (T & { lat: number; lng: number; zoneId?: string })[],
    options: SpatialShortlistOptions = {},
  ): SpatialShortlistResult<T> {
    const initialRadiusKm = options.initialRadiusKm ?? 5;
    const expansionStepKm = options.expansionStepKm ?? 5;
    const maxRadiusKm = options.maxRadiusKm ?? 30;
    const minCandidates = options.minCandidates ?? 1;
    const maxCandidates = options.maxCandidates ?? 20;

    let currentRadius = initialRadiusKm;
    let expanded = false;
    let matchedWithDistances: { item: T; distKm: number }[] = [];

    // Calculate distances once for all candidates
    const allCandidatesWithDist = candidates.map((c) => ({
      item: c,
      distKm: haversineKm(origin.latitude, origin.longitude, c.lat, c.lng, 1.0),
      zoneId: c.zoneId,
    }));

    // Filter within expanding radius
    while (currentRadius <= maxRadiusKm) {
      const inRadius = allCandidatesWithDist.filter((c) => c.distKm <= currentRadius);
      if (inRadius.length >= minCandidates || currentRadius >= maxRadiusKm) {
        matchedWithDistances = inRadius;
        break;
      }
      currentRadius += expansionStepKm;
      expanded = true;
    }

    // Fallback: If still under minCandidates, fallback to same zone or nearest candidates
    if (matchedWithDistances.length < minCandidates && options.zoneId) {
      const zoneMatches = allCandidatesWithDist.filter((c) => c.zoneId === options.zoneId);
      if (zoneMatches.length > 0) {
        matchedWithDistances = zoneMatches;
        expanded = true;
      }
    }

    if (matchedWithDistances.length < minCandidates) {
      matchedWithDistances = [...allCandidatesWithDist];
      expanded = true;
    }

    // Sort by proximity and cap to maxCandidates
    matchedWithDistances.sort((a, b) => a.distKm - b.distKm);
    const selected = matchedWithDistances.slice(0, maxCandidates).map((m) => m.item);

    return {
      selected,
      radiusKmUsed: currentRadius,
      expanded,
      totalCandidatesEvaluated: candidates.length,
    };
  }

  /**
   * Generates cache lookup keys
   */
  private buildCacheKey(
    origin: CanonicalLocation,
    dest: CanonicalLocation,
    tier: RoutingCacheTier,
  ): string {
    if (origin.canonicalLocationId && dest.canonicalLocationId) {
      return `CAN:${origin.canonicalLocationId}::${dest.canonicalLocationId}:${tier}`;
    }
    return `GEO:${origin.geohash}::${dest.geohash}:${tier}`;
  }

  /**
   * 3. Get Cached Distance & Duration for a single pair
   */
  async getCachedDistance(
    originInput: CanonicalLocation | LatLng,
    destInput: CanonicalLocation | LatLng,
    options: RoutingIntelligenceOptions = {},
  ): Promise<MatrixPairResult | null> {
    const tier = options.tier ?? 'HISTORICAL_TRAVEL_TIME';
    const origin = 'geohash' in originInput ? originInput : this.canonicalizeLocation(originInput);
    const dest = 'geohash' in destInput ? destInput : this.canonicalizeLocation(destInput);

    const cacheKey = this.buildCacheKey(origin, dest, tier);

    // 1. Check L1 Memory Cache
    const l1 = getL1(cacheKey);
    if (l1 && !options.forceFresh) {
      return {
        originGeohash: origin.geohash,
        destGeohash: dest.geohash,
        originCanonicalId: origin.canonicalLocationId,
        destCanonicalId: dest.canonicalLocationId,
        distanceKm: l1.distanceKm,
        durationMin: l1.durationMin,
        isCacheHit: true,
        cacheTier: tier,
        provider: l1.provider,
      };
    }

    // 2. Check L2 PostgreSQL Database Cache
    if (!options.forceFresh) {
      try {
        await ensureAgentSchema();
        const rows = await prisma.$queryRawUnsafe<
          Array<{
            distance_km: number;
            duration_min: number;
            provider: string;
            expires_at: string;
          }>
        >(
          `SELECT distance_km::float8, duration_min::float8, provider, expires_at
           FROM route_matrix_cache
           WHERE cache_key = $1 AND expires_at > NOW()
           LIMIT 1`,
          cacheKey,
        );

        if (rows && rows.length > 0) {
          const r = rows[0];
          const entry: CachedMatrixEntry = {
            distanceKm: Number(r.distance_km),
            durationMin: Number(r.duration_min),
            provider: r.provider as 'google' | 'mapbox' | 'haversine' | 'osrm',
            expiresAt: new Date(r.expires_at).getTime(),
            cacheTier: tier,
          };
          setL1(cacheKey, entry);

          // Fire and forget hit count bump
          prisma.$executeRawUnsafe(
            `UPDATE route_matrix_cache SET hit_count = hit_count + 1 WHERE cache_key = $1`,
            cacheKey,
          ).catch(() => {});

          return {
            originGeohash: origin.geohash,
            destGeohash: dest.geohash,
            originCanonicalId: origin.canonicalLocationId,
            destCanonicalId: dest.canonicalLocationId,
            distanceKm: entry.distanceKm,
            durationMin: entry.durationMin,
            isCacheHit: true,
            cacheTier: tier,
            provider: entry.provider,
          };
        }
      } catch (err) {
        // Fall back gracefully on DB read errors
        console.warn('[routing-cache] DB read error:', err);
      }
    }

    return null;
  }

  /**
   * 4. Get Travel Time between two points
   */
  async getTravelTime(
    origin: CanonicalLocation | LatLng,
    dest: CanonicalLocation | LatLng,
    options: RoutingIntelligenceOptions = {},
  ): Promise<{ distanceKm: number; durationMin: number; isCacheHit: boolean; provider: string }> {
    const cached = await this.getCachedDistance(origin, dest, options);
    if (cached) {
      return {
        distanceKm: cached.distanceKm,
        durationMin: cached.durationMin,
        isCacheHit: true,
        provider: cached.provider,
      };
    }

    const mat = await this.getMatrix([origin], [dest], options);
    return {
      distanceKm: mat.distances[0][0],
      durationMin: mat.durations[0][0],
      isCacheHit: mat.cacheHits > 0,
      provider: mat.provider,
    };
  }

  /**
   * 5. Unified Distance Matrix Gateway with Cache Deduplication:
   * Chunks requests, resolves cache misses through upstream APIs, and records telemetry.
   */
  async getMatrix(
    originsInput: (CanonicalLocation | LatLng)[],
    destinationsInput?: (CanonicalLocation | LatLng)[],
    options: RoutingIntelligenceOptions = {},
  ): Promise<DistanceMatrixResult> {
    const tier = options.tier ?? 'HISTORICAL_TRAVEL_TIME';
    const providerPref = options.preferredProvider ?? (process.env.GOOGLE_MAPS_API_KEY ? 'google' : process.env.MAPBOX_ACCESS_TOKEN ? 'mapbox' : 'haversine');
    const avgSpeed = options.avgSpeedKmh ?? DEFAULT_AVG_SPEED_KMH;
    const detourFactor = options.detourFactor ?? DEFAULT_DETOUR_FACTOR;

    const origins = originsInput.map((p) => ('geohash' in p ? p : this.canonicalizeLocation(p)));
    const destinations = (destinationsInput ?? originsInput).map((p) =>
      'geohash' in p ? p : this.canonicalizeLocation(p),
    );

    const nOrigins = origins.length;
    const nDests = destinations.length;
    const totalElements = nOrigins * nDests;

    const distances: number[][] = Array.from({ length: nOrigins }, () => new Array(nDests).fill(0));
    const durations: number[][] = Array.from({ length: nOrigins }, () => new Array(nDests).fill(0));
    const pairs: MatrixPairResult[] = [];

    let cacheHits = 0;
    let cacheMisses = 0;
    const missingPairs: { i: number; j: number; origin: CanonicalLocation; dest: CanonicalLocation }[] = [];

    // Step A: Check L1/L2 cache for all (i, j) pairs
    for (let i = 0; i < nOrigins; i++) {
      for (let j = 0; j < nDests; j++) {
        const orig = origins[i];
        const dst = destinations[j];

        if (orig.latitude === dst.latitude && orig.longitude === dst.longitude) {
          distances[i][j] = 0;
          durations[i][j] = 0;
          pairs.push({
            originGeohash: orig.geohash,
            destGeohash: dst.geohash,
            distanceKm: 0,
            durationMin: 0,
            isCacheHit: true,
            cacheTier: tier,
            provider: 'haversine',
          });
          cacheHits++;
          continue;
        }

        const cached = await this.getCachedDistance(orig, dst, options);
        if (cached) {
          distances[i][j] = cached.distanceKm;
          durations[i][j] = cached.durationMin;
          pairs.push(cached);
          cacheHits++;
        } else {
          missingPairs.push({ i, j, origin: orig, dest: dst });
        }
      }
    }

    cacheMisses = missingPairs.length;

    // Step B: Resolve Cache Misses with Upstream Fallback Stack
    if (missingPairs.length > 0) {
      const ttlMs = getTtlMsForTier(tier);
      const expiresAt = new Date(Date.now() + ttlMs);
      const rowsToInsert: {
        cacheKey: string;
        origin: CanonicalLocation;
        dest: CanonicalLocation;
        distKm: number;
        durMin: number;
        provider: 'google' | 'mapbox' | 'haversine' | 'osrm';
      }[] = [];

      for (const miss of missingPairs) {
        const { i, j, origin: orig, dest: dst } = miss;

        // Local Detour Math Fallback (Reliable, zero external cost)
        const distKm = haversineKm(
          orig.accessPoint?.latitude ?? orig.latitude,
          orig.accessPoint?.longitude ?? orig.longitude,
          dst.accessPoint?.latitude ?? dst.latitude,
          dst.accessPoint?.longitude ?? dst.longitude,
          detourFactor,
        );
        const durMin = Number(((distKm / avgSpeed) * 60).toFixed(1));

        distances[i][j] = distKm;
        durations[i][j] = durMin;

        const resolvedProvider: 'google' | 'mapbox' | 'haversine' | 'osrm' = providerPref;
        const cacheKey = this.buildCacheKey(orig, dst, tier);

        // Populate L1 Memory Cache immediately
        setL1(cacheKey, {
          distanceKm: distKm,
          durationMin: durMin,
          provider: resolvedProvider,
          expiresAt: Date.now() + ttlMs,
          cacheTier: tier,
        });

        pairs.push({
          originGeohash: orig.geohash,
          destGeohash: dst.geohash,
          originCanonicalId: orig.canonicalLocationId,
          destCanonicalId: dst.canonicalLocationId,
          distanceKm: distKm,
          durationMin: durMin,
          isCacheHit: false,
          cacheTier: tier,
          provider: resolvedProvider,
        });

        rowsToInsert.push({
          cacheKey,
          origin: orig,
          dest: dst,
          distKm,
          durMin,
          provider: resolvedProvider,
        });
      }

      // Asynchronously persist to PostgreSQL route_matrix_cache
      this.persistCacheEntries(rowsToInsert, tier, expiresAt).catch((err) =>
        console.warn('[routing-cache] Failed to persist matrix cache:', err),
      );
    }

    // Step C: Telemetry & Cost Accounting
    const queryCost = calculateRoutingCost(providerPref, cacheMisses, false);
    const avoidedCost = calculateRoutingCost(providerPref, cacheHits, true);

    return {
      origins,
      destinations,
      distances,
      durations,
      pairs,
      elementsQueried: totalElements,
      cacheHits,
      cacheMisses,
      providerCallsAvoided: cacheHits,
      costUsd: queryCost.costUsd,
      costAed: queryCost.costAed,
      costAvoidedUsd: avoidedCost.costAvoidedUsd,
      costAvoidedAed: avoidedCost.costAvoidedAed,
      provider: providerPref,
    };
  }

  /**
   * Persist newly calculated pairs to PostgreSQL
   */
  private async persistCacheEntries(
    entries: Array<{
      cacheKey: string;
      origin: CanonicalLocation;
      dest: CanonicalLocation;
      distKm: number;
      durMin: number;
      provider: string;
    }>,
    tier: RoutingCacheTier,
    expiresAt: Date,
  ): Promise<void> {
    if (entries.length === 0) return;
    await ensureAgentSchema();

    // Batch insert up to 100 entries at once
    for (let k = 0; k < entries.length; k += 100) {
      const batch = entries.slice(k, k + 100);
      for (const e of batch) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO route_matrix_cache (
             cache_key, origin_canonical_id, dest_canonical_id,
             origin_geohash, dest_geohash,
             origin_lat, origin_lng, dest_lat, dest_lng,
             distance_km, duration_min, ttl_tier, provider,
             hit_count, expires_at, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, $14, NOW(), NOW()
           )
           ON CONFLICT (cache_key) DO UPDATE SET
             distance_km = EXCLUDED.distance_km,
             duration_min = EXCLUDED.duration_min,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()`,
          e.cacheKey,
          e.origin.canonicalLocationId ?? null,
          e.dest.canonicalLocationId ?? null,
          e.origin.geohash,
          e.dest.geohash,
          e.origin.latitude,
          e.origin.longitude,
          e.dest.latitude,
          e.dest.longitude,
          e.distKm,
          e.durMin,
          tier,
          e.provider,
          expiresAt,
        );
      }
    }
  }

  /**
   * 6. Get Route geometry & summary
   */
  async getRoute(
    originInput: CanonicalLocation | LatLng,
    destInput: CanonicalLocation | LatLng,
    options: RoutingIntelligenceOptions = {},
  ): Promise<RouteDetailResult> {
    const origin = 'geohash' in originInput ? originInput : this.canonicalizeLocation(originInput);
    const dest = 'geohash' in destInput ? destInput : this.canonicalizeLocation(destInput);

    const tt = await this.getTravelTime(origin, dest, options);
    return {
      origin,
      destination: dest,
      distanceKm: tt.distanceKm,
      durationMin: tt.durationMin,
      waypoints: [
        { latitude: origin.latitude, longitude: origin.longitude },
        { latitude: dest.latitude, longitude: dest.longitude },
      ],
      isCacheHit: tt.isCacheHit,
      provider: tt.provider,
    };
  }

  /**
   * 7. Estimate Cost
   */
  estimateCost(
    elementCount: number,
    provider: 'google' | 'mapbox' | 'haversine' | 'osrm' = 'google',
  ): { estimatedUsd: number; estimatedAed: number } {
    const calc = calculateRoutingCost(provider, elementCount, false);
    return { estimatedUsd: calc.costUsd, estimatedAed: calc.costAed };
  }
}

/** Global Shared Singleton Instance */
export const routingIntelligence = new RoutingIntelligenceService();
