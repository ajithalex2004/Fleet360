/**
 * Route Consolidation — Stage 2 matrix batching (Phase 3 Routing Intelligence Integration).
 *
 * Runs after the cheap Stage 1 filters (shift/direction/timing/zone/
 * capacity) have already cut candidates down, and before PCE (Stage 3
 * evaluates using these real numbers instead of a coordinate estimate —
 * see synthesizePlanFacts in route-consolidation.ts). Computes real road
 * distance + travel duration for each surviving candidate's endpoint
 * pairings via RoutingIntelligenceService with multi-tier caching (STATIC_DISTANCE).
 *
 * Exports only the pure building blocks (buildCase1Pairings,
 * resolveMatrixPairings, pairingKey) — the top-level orchestrator lives
 * in route-consolidation.ts's analyzeConsolidations(), which calls these
 * directly rather than through a wrapper here.
 */

import type { PrismaClient } from '@prisma/client';
import { routingIntelligence } from '@/lib/routing/intelligence-service';
import type { RouteFacts } from './route-consolidation-facts';
import { routePickupStop, routeDropoffStop } from './route-consolidation-facts';

// ── Public shapes ────────────────────────────────────────────────────────────

export type MatrixPairingType = 'PICKUP_TO_PICKUP' | 'DROPOFF_TO_DROPOFF' | 'DROPOFF_TO_PICKUP';

export interface MatrixPoint {
  lat: number;
  lng: number;
}

export interface MatrixPairing {
  type: MatrixPairingType;
  routeIdA: string;
  routeIdB: string;
  from: MatrixPoint;
  to: MatrixPoint;
}

export interface MatrixPairingResult {
  distanceKm: number;
  durationMin: number;
}

/** Chunk side length so a square chunk never exceeds the hard element cap. */
const MAX_CHUNK_SIDE = 25;

// ── Building pairings (Case 1: same-side comparisons only) ──────────────────

/**
 * Today's simultaneous-merge model: for each surviving candidate, we need
 * the real distance between the two routes' pickup ends and between their
 * dropoff ends.
 */
export function buildCase1Pairings(
  candidates: Array<{ routeIdA: string; routeIdB: string; a: RouteFacts; b: RouteFacts }>,
): MatrixPairing[] {
  const pairings: MatrixPairing[] = [];
  for (const { routeIdA, routeIdB, a, b } of candidates) {
    const pickupA = toPoint(routePickupStop(a));
    const pickupB = toPoint(routePickupStop(b));
    const dropoffA = toPoint(routeDropoffStop(a));
    const dropoffB = toPoint(routeDropoffStop(b));

    if (pickupA && pickupB) {
      pairings.push({ type: 'PICKUP_TO_PICKUP', routeIdA, routeIdB, from: pickupA, to: pickupB });
    }
    if (dropoffA && dropoffB) {
      pairings.push({ type: 'DROPOFF_TO_DROPOFF', routeIdA, routeIdB, from: dropoffA, to: dropoffB });
    }
  }
  return pairings;
}

function toPoint(s: { lat: number | null; lng: number | null } | undefined): MatrixPoint | null {
  if (!s || typeof s.lat !== 'number' || typeof s.lng !== 'number') return null;
  return { lat: s.lat, lng: s.lng };
}

// ── Clustering + batching ────────────────────────────────────────────────────

/** Rounded to 5dp — matches coordinate-hash rounding, so identical points collide correctly. */
function pointKey(p: MatrixPoint): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/** Minimal union-find over point keys, grouping every pairing's from/to into the same cluster. */
class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Split an oversized cluster into square-friendly chunks of ≤ MAX_CHUNK_SIDE points each. */
function chunkPoints<T>(points: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < points.length; i += size) out.push(points.slice(i, i + size));
  return out;
}

/**
 * Resolve every pairing's real distance/duration via RoutingIntelligenceService,
 * batched by connected component and cached across tiers.
 */
export async function resolveMatrixPairings(
  prisma: PrismaClient,
  tenantId: string,
  pairings: MatrixPairing[],
): Promise<Map<string, MatrixPairingResult>> {
  const results = new Map<string, MatrixPairingResult>();
  if (pairings.length === 0) return results;

  const samePointPairings: MatrixPairing[] = [];
  const distinctPairings: MatrixPairing[] = [];
  for (const p of pairings) {
    (pointKey(p.from) === pointKey(p.to) ? samePointPairings : distinctPairings).push(p);
  }
  for (const p of samePointPairings) {
    results.set(pairingKey(p.type, p.routeIdA, p.routeIdB), { distanceKm: 0, durationMin: 0 });
  }
  if (distinctPairings.length === 0) return results;

  // 1. Dedupe points, build the pairing graph.
  const pointsByKey = new Map<string, MatrixPoint>();
  const uf = new UnionFind();
  for (const p of distinctPairings) {
    const fromKey = pointKey(p.from);
    const toKey = pointKey(p.to);
    pointsByKey.set(fromKey, p.from);
    pointsByKey.set(toKey, p.to);
    uf.union(fromKey, toKey);
  }

  // 2. Group point keys by cluster root.
  const clusters = new Map<string, string[]>();
  for (const key of pointsByKey.keys()) {
    const root = uf.find(key);
    const list = clusters.get(root);
    if (list) list.push(key);
    else clusters.set(root, [key]);
  }

  // 3. One (or a few, if oversized) matrix call per cluster using RoutingIntelligenceService.
  const distanceLookup = new Map<string, Map<string, MatrixPairingResult>>();

  for (const clusterKeys of clusters.values()) {
    const chunks = clusterKeys.length <= MAX_CHUNK_SIDE ? [clusterKeys] : chunkPoints(clusterKeys, MAX_CHUNK_SIDE);
    for (const chunkKeys of chunks) {
      const points = chunkKeys.map(k => ({
        id: k,
        lat: pointsByKey.get(k)!.lat,
        lng: pointsByKey.get(k)!.lng,
      }));

      try {
        const matrixRes = await routingIntelligence.getMatrix(points, points, {
          tier: 'STATIC_DISTANCE',
          tenantId,
        });

        for (let i = 0; i < points.length; i++) {
          const fromKey = chunkKeys[i];
          if (!distanceLookup.has(fromKey)) distanceLookup.set(fromKey, new Map());

          for (let j = 0; j < points.length; j++) {
            const toKey = chunkKeys[j];
            const distKm = matrixRes.distances[i]?.[j] ?? 0;
            const durMin = matrixRes.durations[i]?.[j] ?? 0;

            distanceLookup.get(fromKey)!.set(toKey, {
              distanceKm: parseFloat(distKm.toFixed(2)),
              durationMin: Math.round(durMin),
            });
          }
        }
      } catch (e) {
        console.warn('[route-consolidation-matrix] routingIntelligence.getMatrix failed for a chunk:', e);
      }
    }
  }

  // 4. Map each remaining (distinct-point) pairing to its resolved result, if any.
  for (const p of distinctPairings) {
    const fromKey = pointKey(p.from);
    const toKey = pointKey(p.to);
    const entry = distanceLookup.get(fromKey)?.get(toKey) ?? distanceLookup.get(toKey)?.get(fromKey);
    if (entry) {
      results.set(pairingKey(p.type, p.routeIdA, p.routeIdB), entry);
    }
  }

  return results;
}

export function pairingKey(type: MatrixPairingType, routeIdA: string, routeIdB: string): string {
  return `${type}:${routeIdA}:${routeIdB}`;
}
