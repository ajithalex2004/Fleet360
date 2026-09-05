/**
 * Distance Matrix Adapter — Backed by RoutingIntelligenceService
 * ---------------------------------------------------------------
 * Given N points (lat/lng pairs), returns an N×N matrix of road distances (km)
 * and durations (min), backed by the multi-tier matrix cache.
 *
 * Preserves 100% backward compatibility for all logistics and VRP solvers.
 */

import { routingIntelligence } from '@/lib/routing/intelligence-service';
import type { RoutingCacheTier } from '@/lib/agents/types';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface DistanceMatrix {
  /** distances[i][j] = km from point i to point j */
  distances: number[][];
  /** durations[i][j] = minutes from point i to point j */
  durations: number[][];
  provider: 'google' | 'mapbox' | 'haversine' | 'osrm';
}

export interface MatrixOptions {
  provider?: 'google' | 'mapbox' | 'haversine' | 'osrm';
  /** Multiplier applied to haversine distance. Ignored for real providers. */
  detourFactor?: number;
  /** Average speed for haversine duration estimate. Ignored for real providers. */
  avgSpeedKmh?: number;
  /** Multi-tier cache selection (STATIC_DISTANCE, HISTORICAL_TRAVEL_TIME, TRAFFIC_DYNAMIC) */
  tier?: RoutingCacheTier;
  /** Force fresh query bypassing cache */
  forceFresh?: boolean;
}

// ── Great-Circle Haversine Calculation Seam (for solver tie-breakers & unit tests) ──
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Public Matrix Computation API ──────────────────────────────────────────────

export async function computeDistanceMatrix(
  points: LatLng[],
  opts: MatrixOptions = {},
): Promise<DistanceMatrix> {
  if (points.length === 0) {
    return { distances: [], durations: [], provider: opts.provider ?? 'haversine' };
  }
  if (points.length === 1) {
    return { distances: [[0]], durations: [[0]], provider: opts.provider ?? 'haversine' };
  }

  const result = await routingIntelligence.getMatrix(points, points, {
    tier: opts.tier ?? 'HISTORICAL_TRAVEL_TIME',
    preferredProvider: opts.provider,
    avgSpeedKmh: opts.avgSpeedKmh,
    detourFactor: opts.detourFactor,
    forceFresh: opts.forceFresh,
  });

  return {
    distances: result.distances,
    durations: result.durations,
    provider: (result.provider as 'google' | 'mapbox' | 'haversine' | 'osrm') ?? 'haversine',
  };
}
