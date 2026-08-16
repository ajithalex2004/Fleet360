/**
 * Helper primitives for the Route Consolidation apply/revert engine.
 *
 * Kept out of the main engine file so tests can exercise them
 * directly and the transactional apply/revert paths stay focused on
 * orchestration.
 *
 * Contents:
 *   - computeAppliedStateHash — fingerprint the merged route + stops
 *     immediately after apply, so revert can detect drift.
 *   - resolveEnrollmentStopMapping — map an old (routeId, stopId) to
 *     a stop on the merged route via EXACT_STOP → EXACT_PLACE_ID →
 *     OPERATOR_RESOLVED. Never falls back to a null mapping.
 *   - suggestMergedStopOrder — greedy nearest-neighbor over union of
 *     source stops with fixed origin/destination. UI-only suggestion.
 */

import { createHash } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';

// ─── State-hash for revert-drift detection ─────────────────────────

export type HashableStop = {
  id: string;
  placeId: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  sequence: number;
  updatedAt: Date | null;
};

/**
 * Fingerprint the merged route's essential state for revert-drift
 * detection. Not cryptographically strong — just change-detection.
 * The hash covers: route name/isActive/retiredReason/updatedAt +
 * every stop's identity and sequence. A hand-edit to the route or
 * any stop changes the hash; revert then refuses (operator must
 * resolve or force).
 *
 * We deliberately DON'T hash the enrollment migration rows because
 * those are effectively immutable after apply — an FK protects them
 * from cascading deletes.
 */
export async function computeAppliedStateHash(
  tx: Prisma.TransactionClient | PrismaClient,
  mergedRouteId: string
): Promise<string> {
  const route = await tx.busRoute.findUnique({
    where: { id: mergedRouteId },
    select: {
      name: true,
      isActive: true,
      retiredReason: true,
      updatedAt: true,
      capacity: true,
      requiredVehicleGroup: true,
    },
  });
  if (!route) throw new Error(`route not found for hash: ${mergedRouteId}`);

  const stops = await tx.routeStop.findMany({
    where: { routeId: mergedRouteId },
    select: {
      id: true,
      placeId: true,
      gpsLat: true,
      gpsLng: true,
      sequence: true,
    },
    orderBy: { sequence: 'asc' },
  });

  // Canonical JSON — key order is fixed by the object literal order
  // above; Date values serialize deterministically.
  const canonical = JSON.stringify({
    route: {
      name: route.name,
      isActive: route.isActive,
      retiredReason: route.retiredReason,
      updatedAt: route.updatedAt?.toISOString() ?? null,
      capacity: route.capacity,
      requiredVehicleGroup: route.requiredVehicleGroup,
    },
    stops: stops.map((s) => ({
      id: s.id,
      placeId: s.placeId,
      gpsLat: s.gpsLat,
      gpsLng: s.gpsLng,
      sequence: s.sequence,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// ─── Enrollment stop mapping ────────────────────────────────────────

export type EnrollmentStopMapping =
  | { method: 'EXACT_STOP'; newStopId: string }
  | { method: 'EXACT_PLACE_ID'; newStopId: string }
  | { method: 'OPERATOR_RESOLVED'; newStopId: string | null };

export type StopOnMergedRoute = {
  id: string;
  placeId: string | null;
};

/**
 * Map an old stop to a stop on the merged route.
 *
 *   EXACT_STOP        — the same stop id exists on the merged route
 *                       (only possible if the merged route reuses the
 *                       source route's stop rows, which the current
 *                       apply flow does not — but supported for future
 *                       flows that might).
 *   EXACT_PLACE_ID    — a different stop row on the merged route has
 *                       the same placeId. This is the common case: a
 *                       new stop record for the merged route referring
 *                       to the same spatial.places anchor.
 *   OPERATOR_RESOLVED — no deterministic match; caller must supply a
 *                       resolution or apply refuses.
 *
 * Never returns a null-stop match automatically — per the D5 decision,
 * null-migration is dangerous and would silently break enrollments.
 */
export function resolveEnrollmentStopMapping(
  oldStopId: string | null,
  oldStopPlaceId: string | null,
  mergedRouteStops: StopOnMergedRoute[],
  operatorSuppliedStopId?: string | null
): EnrollmentStopMapping {
  if (oldStopId == null) {
    // Enrollment had no pickup/dropoff stop set to begin with — the
    // migrated row keeps null. Not a resolution failure.
    return { method: 'OPERATOR_RESOLVED', newStopId: null };
  }

  // Tier 1: exact stop id match on merged route
  const exact = mergedRouteStops.find((s) => s.id === oldStopId);
  if (exact) return { method: 'EXACT_STOP', newStopId: exact.id };

  // Tier 2: same placeId on merged route
  if (oldStopPlaceId) {
    const byPlace = mergedRouteStops.find((s) => s.placeId === oldStopPlaceId);
    if (byPlace) return { method: 'EXACT_PLACE_ID', newStopId: byPlace.id };
  }

  // Tier 3: operator-supplied resolution wins
  if (operatorSuppliedStopId !== undefined) {
    // Validate the supplied id belongs to the merged route
    const supplied = mergedRouteStops.find((s) => s.id === operatorSuppliedStopId);
    if (operatorSuppliedStopId === null || supplied) {
      return { method: 'OPERATOR_RESOLVED', newStopId: operatorSuppliedStopId ?? null };
    }
    // Caller supplied a stopId that isn't on the merged route — treat
    // as unresolved rather than silently accepting.
  }

  return { method: 'OPERATOR_RESOLVED', newStopId: null };
}

// ─── Stop ordering suggestion (greedy nearest-neighbor) ────────────

export type OrderableStop = {
  id: string;
  placeId: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  /** Which source route this stop came from — informational; not used by NN. */
  sourceRouteId: string;
};

/**
 * Greedy nearest-neighbor ordering starting from a fixed origin,
 * ending at a fixed destination. Intermediate stops are visited in
 * nearest-first order.
 *
 * Suggestion only — UI must let the operator reorder. Not a TSP
 * solver; produces a plausible seed that the operator can refine.
 * Deduplicates by placeId (or by lat/lng when placeId is null) so a
 * stop shared by both source routes appears once.
 */
export function suggestMergedStopOrder(
  origin: OrderableStop,
  destination: OrderableStop,
  intermediates: OrderableStop[]
): OrderableStop[] {
  // Dedupe intermediates
  const seen = new Set<string>();
  const uniq: OrderableStop[] = [];
  for (const s of intermediates) {
    const key = s.placeId ?? `${s.gpsLat},${s.gpsLng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Also skip if same as origin or destination
    const originKey = origin.placeId ?? `${origin.gpsLat},${origin.gpsLng}`;
    const destKey = destination.placeId ?? `${destination.gpsLat},${destination.gpsLng}`;
    if (key === originKey || key === destKey) continue;
    uniq.push(s);
  }

  const ordered: OrderableStop[] = [origin];
  const remaining = [...uniq];
  let current: OrderableStop = origin;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const d = squaredDistance(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current);
  }

  ordered.push(destination);
  return ordered;
}

/**
 * Squared Euclidean distance in lat/lng space. Suitable for
 * nearest-neighbor comparisons only — order-preserving, not a real
 * geographic distance. Missing coords sort last (POSITIVE_INFINITY).
 */
function squaredDistance(a: OrderableStop, b: OrderableStop): number {
  if (a.gpsLat == null || a.gpsLng == null || b.gpsLat == null || b.gpsLng == null) {
    return Number.POSITIVE_INFINITY;
  }
  const dLat = a.gpsLat - b.gpsLat;
  const dLng = a.gpsLng - b.gpsLng;
  return dLat * dLat + dLng * dLng;
}
