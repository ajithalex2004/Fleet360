/**
 * Zone-compatibility helper for the Route Consolidation engine.
 *
 * Two candidate routes can only be merged if their pickup ends and their
 * dropoff ends live in "compatible" zones — otherwise the merged route
 * would drag riders across the city. Compatibility is a two-tier decision:
 *
 *   1. Place-id match (preferred). Both sides resolved a `spatial.places`
 *      row and the ids agree → SAME_ZONE.
 *   2. Coordinate fallback. If either side lacks a placeId, fall back to
 *      haversine distance between coord centroids and compare against a
 *      per-side threshold (default 3 km pickup / 1.5 km dropoff — the
 *      values surfaced on the "Objective & thresholds" analysis form).
 *
 * The engine uses `isCompatPassing` to gate candidates before scoring.
 * `UNKNOWN` (missing data on either side) is neither pass nor fail — the
 * candidate is reported to the operator as "ZONE_DATA_UNAVAILABLE" so
 * they know to enrich the underlying route data.
 */

/** One endpoint of a route side — either the pickup end or the dropoff end. */
export interface ZonePoint {
  placeId: string | null;
  lat: number | null;
  lng: number | null;
}

export type ZoneCompatKind =
  | 'SAME_ZONE'          // both sides share the same spatial.places id
  | 'WITHIN_FALLBACK'    // no shared place, coord distance ≤ fallback
  | 'DIFFERENT_ZONES'    // both sides have place ids, ids differ
  | 'OUTSIDE_FALLBACK'   // coord distance > fallback and no shared place
  | 'UNKNOWN';           // one or both sides have neither placeId nor coords

export interface ZoneCompatResult {
  kind: ZoneCompatKind;
  /** Distance in km used when kind is *_FALLBACK. Null when placeId path was taken. */
  distanceKm: number | null;
  /** Explanation surfaced to the operator when the candidate is skipped. */
  reason: string;
}

export const DEFAULT_FALLBACK_KM = {
  PICKUP: 3.0,
  DROPOFF: 1.5,
} as const;

export interface ZoneCompatOptions {
  /** Threshold (km) below which coord-fallback compatibility passes. */
  fallbackKm: number;
}

/**
 * Decide whether two route sides are in compatible zones. Each side is an
 * array of endpoint points; in the current caller (`pickupAndDropoffSides`)
 * these are one-element arrays, but the shape accepts multi-stop sides
 * for future segmented-route support.
 *
 * Rules — first match wins:
 *   • Any shared placeId across the two sides           → SAME_ZONE
 *   • Both sides have at least one placeId, none shared → DIFFERENT_ZONES
 *   • Both sides have coords, min-pair distance ≤ km    → WITHIN_FALLBACK
 *   • Both sides have coords, distance > km             → OUTSIDE_FALLBACK
 *   • Otherwise                                         → UNKNOWN
 */
export function zoneCompatibility(
  sideA: ZonePoint[],
  sideB: ZonePoint[],
  opts: ZoneCompatOptions,
): ZoneCompatResult {
  const placeIdsA = new Set(sideA.map(p => p.placeId).filter((v): v is string => !!v));
  const placeIdsB = new Set(sideB.map(p => p.placeId).filter((v): v is string => !!v));

  // 1. Shared spatial.places match — the strongest signal.
  for (const id of placeIdsA) {
    if (placeIdsB.has(id)) {
      return { kind: 'SAME_ZONE', distanceKm: null, reason: `shared place ${id}` };
    }
  }

  // 2. Both sides carry place ids but none overlap.
  if (placeIdsA.size > 0 && placeIdsB.size > 0) {
    return {
      kind: 'DIFFERENT_ZONES',
      distanceKm: null,
      reason: `A={${[...placeIdsA].join(',')}} vs B={${[...placeIdsB].join(',')}}`,
    };
  }

  // 3. Coord fallback — need coords on both sides.
  const coordsA = sideA.filter(hasCoords);
  const coordsB = sideB.filter(hasCoords);
  if (coordsA.length === 0 || coordsB.length === 0) {
    return { kind: 'UNKNOWN', distanceKm: null, reason: 'missing placeId and coords on at least one side' };
  }

  // Minimum pairwise distance — if any pair falls within the fallback the
  // sides are considered compatible. Sides are small (usually 1 point).
  let minKm = Infinity;
  for (const a of coordsA) {
    for (const b of coordsB) {
      const km = haversineKm(a.lat!, a.lng!, b.lat!, b.lng!);
      if (km < minKm) minKm = km;
    }
  }
  const distanceKm = Math.round(minKm * 100) / 100;
  if (minKm <= opts.fallbackKm) {
    return {
      kind: 'WITHIN_FALLBACK',
      distanceKm,
      reason: `${distanceKm} km ≤ ${opts.fallbackKm} km fallback`,
    };
  }
  return {
    kind: 'OUTSIDE_FALLBACK',
    distanceKm,
    reason: `${distanceKm} km > ${opts.fallbackKm} km fallback`,
  };
}

/**
 * True when the compatibility result gates the pair through to scoring.
 * `UNKNOWN` deliberately fails this check — the engine surfaces those as
 * "ZONE_DATA_UNAVAILABLE" so the data gap is visible to the operator.
 */
export function isCompatPassing(result: ZoneCompatResult): boolean {
  return result.kind === 'SAME_ZONE' || result.kind === 'WITHIN_FALLBACK';
}

// ─── Internals ──────────────────────────────────────────────────────────────

function hasCoords(p: ZonePoint): p is ZonePoint & { lat: number; lng: number } {
  return typeof p.lat === 'number' && typeof p.lng === 'number';
}

const EARTH_RADIUS_KM = 6_371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
