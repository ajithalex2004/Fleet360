/**
 * Zone compatibility — polygons-first with haversine fallback.
 *
 * Used by the Route Consolidation Engine to decide whether two routes'
 * pickup ends (or dropoff ends) are close enough to be candidates for
 * consolidation. The polygon path is authoritative when available
 * because operationally-close-but-geographically-separated locations
 * (highways, gates, industrial boundaries, restricted roads) get
 * modelled as different zones — a raw distance test alone would say
 * "these are 500m apart, consolidate" even when a truck can't cross
 * between them.
 *
 * The hierarchy encoded here:
 *   1. Both sides have spatial.places → shared placeId = ZONE_MATCH
 *      no shared placeId              = ZONE_DIFFERENT (fail hard)
 *   2. Missing places, both have coords → haversine test with fallback
 *      distance ≤ threshold           = FALLBACK_DISTANCE (pass)
 *      distance > threshold           = FALLBACK_TOO_FAR (fail)
 *   3. No coords either side          = UNKNOWN (excluded from candidates)
 *
 * Tenant-configurable thresholds are Phase 2. For now a system-level
 * default lives in DEFAULT_FALLBACK_KM.
 */

import { haversineMeters } from './zone';

export type ZoneCompatKind =
  | 'ZONE_MATCH'         // Both sides declared, and they share at least one placeId
  | 'ZONE_DIFFERENT'     // Both sides declared, no overlap — fail
  | 'FALLBACK_DISTANCE'  // Coord fallback within threshold — pass
  | 'FALLBACK_TOO_FAR'   // Coord fallback outside threshold — fail
  | 'UNKNOWN';           // Neither placeIds nor coords available

export type ZoneCompatResult = {
  kind: ZoneCompatKind;
  /** The placeId that matched, when kind === 'ZONE_MATCH'. */
  sharedPlaceId?: string;
  /** Minimum inter-side distance, when a distance was computed. */
  distanceKm?: number;
};

export type PointRef = {
  /** Optional spatial.places id — the authoritative zone identity. */
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
};

/** System-level fallback distance thresholds. Moved to tenant policy later. */
export const DEFAULT_FALLBACK_KM = {
  /** Pickup ends can be a bit further apart — passengers walk to the stop. */
  PICKUP: 3.0,
  /** Dropoff ends must be closer — workplace clusters are tight. */
  DROPOFF: 1.5,
};

export type CompatOptions = {
  /** Override the DEFAULT_FALLBACK_KM value for this specific comparison. */
  fallbackKm?: number;
};

/**
 * Check whether two sides (each a set of PointRef candidates) are
 * compatible. A "side" is typically all of one route's pickup stops
 * (or all of one route's dropoff stops) — passing multiple candidates
 * per side means "any match on either side counts as compatible".
 *
 * The two sides don't have to be symmetrical in how they specify
 * points: side A may have placeIds while side B has only coords. The
 * result tier reflects the weakest evidence used — a mixed comparison
 * degrades to FALLBACK_DISTANCE, never ZONE_MATCH.
 */
export function zoneCompatibility(
  sideA: PointRef[],
  sideB: PointRef[],
  opts: CompatOptions = {}
): ZoneCompatResult {
  const fallbackKm = opts.fallbackKm ?? DEFAULT_FALLBACK_KM.PICKUP;

  // Tier 1: authoritative match by placeId.
  const placesA = new Set(sideA.map((p) => p.placeId).filter((id): id is string => !!id));
  const placesB = new Set(sideB.map((p) => p.placeId).filter((id): id is string => !!id));
  if (placesA.size > 0 && placesB.size > 0) {
    for (const id of placesA) {
      if (placesB.has(id)) {
        return { kind: 'ZONE_MATCH', sharedPlaceId: id };
      }
    }
    // Both sides have place data but no overlap. This is the strongest
    // possible "different zone" signal — don't demote to distance fallback.
    return { kind: 'ZONE_DIFFERENT' };
  }

  // Tier 2: haversine fallback. Compute minimum inter-side distance.
  const coordsA = sideA.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  const coordsB = sideB.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  if (coordsA.length === 0 || coordsB.length === 0) {
    return { kind: 'UNKNOWN' };
  }

  let minMeters = Number.POSITIVE_INFINITY;
  for (const a of coordsA) {
    for (const b of coordsB) {
      const d = haversineMeters(
        { lat: a.lat as number, lng: a.lng as number },
        { lat: b.lat as number, lng: b.lng as number }
      );
      if (d < minMeters) minMeters = d;
    }
  }
  const distanceKm = minMeters / 1000;

  return distanceKm <= fallbackKm
    ? { kind: 'FALLBACK_DISTANCE', distanceKm }
    : { kind: 'FALLBACK_TOO_FAR', distanceKm };
}

/** Whether a compat result should let a candidate proceed to scoring. */
export function isCompatPassing(r: ZoneCompatResult): boolean {
  return r.kind === 'ZONE_MATCH' || r.kind === 'FALLBACK_DISTANCE';
}
