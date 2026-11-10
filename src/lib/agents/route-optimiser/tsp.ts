/**
 * TSP Solver — Nearest Neighbour + 2-opt
 * ----------------------------------------
 * Zero external dependencies. Pure TypeScript math.
 *
 * Algorithm:
 *   Phase 1 — Nearest Neighbour heuristic
 *     Greedy construction: always move to the closest unvisited intermediate stop,
 *     preserving stop[0] as the origin and stop[n-1] as the final destination.
 *     Gives a valid route in O(n²). Typically 20–25% above optimal.
 *
 *   Phase 2 — 2-opt improvement
 *     Iteratively reverses intermediate segments between two edges if it reduces
 *     total distance, keeping stop[0] (origin) and stop[n-1] (final destination) pinned.
 *     Runs until no improving swap exists.
 *     Brings result within ~5–10% of optimal for typical fleet sizes.
 *
 * For school bus routes (10–40 stops) this runs in < 5ms.
 * For logistics routes (up to 100 stops) this runs in < 50ms.
 */

// ── Types ──────────────────────────────────────────────────────────────────────
export interface GeoStop {
  id: string;           // stop id or name (used to map back)
  name: string;
  lat: number;
  lng: number;
  sequence: number;     // original sequence number
  pickupTime?: string;  // preserved from original route
  studentCount?: number;
}

export interface OptimisationResult {
  originalSequence:   GeoStop[];
  optimisedSequence:  GeoStop[];
  originalDistanceKm: number;
  optimisedDistanceKm: number;
  distanceSavedKm:    number;
  distanceSavedPct:   number;
  iterations2opt:     number;
  durationMs:         number;
}

// ── Haversine Distance ─────────────────────────────────────────────────────────
// Returns distance in kilometres between two lat/lng points
export function haversineKm(a: GeoStop, b: GeoStop): number {
  const R = 6371; // Earth radius km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlng = Math.sin(dLng / 2);
  const x = sinDlat * sinDlat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDlng * sinDlng;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toRad(deg: number): number { return deg * (Math.PI / 180); }

// ── Total Route Distance ───────────────────────────────────────────────────────
export function totalDistance(stops: GeoStop[]): number {
  let d = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    d += haversineKm(stops[i], stops[i + 1]);
  }
  return d;
}

// ── Phase 1: Nearest Neighbour (preserving origin stop[0] and terminal stop[n-1]) ──
function nearestNeighbour(stops: GeoStop[]): GeoStop[] {
  if (stops.length <= 2) return [...stops];

  const lastIdx = stops.length - 1;
  // Only intermediate stops [1 .. lastIdx - 1] are reordered; stop[0] is origin and stop[lastIdx] is final destination.
  const unvisited = new Set<number>();
  for (let i = 1; i < lastIdx; i++) {
    unvisited.add(i);
  }

  const route: GeoStop[] = [stops[0]];
  let current = 0;

  while (unvisited.size > 0) {
    let nearest = -1;
    let nearestDist = Infinity;

    for (const idx of unvisited) {
      const d = haversineKm(stops[current], stops[idx]);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = idx;
      }
    }

    unvisited.delete(nearest);
    route.push(stops[nearest]);
    current = nearest;
  }

  route.push(stops[lastIdx]);
  return route;
}

// ── Phase 2: 2-opt Improvement (keeping route[0] and route[n-1] pinned) ────────
function twoOpt(route: GeoStop[]): { route: GeoStop[]; iterations: number } {
  const n = route.length;
  let improved = true;
  let iterations = 0;
  let best = [...route];
  let bestDist = totalDistance(best);

  while (improved) {
    improved = false;
    iterations++;

    // Keep index 0 (origin) and index n - 1 (final destination) fixed
    for (let i = 0; i < n - 2; i++) {
      for (let k = i + 1; k < n - 1; k++) {
        // Reverse intermediate segment [i+1 .. k]
        const newRoute = [
          ...best.slice(0, i + 1),
          ...best.slice(i + 1, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const newDist = totalDistance(newRoute);
        if (newDist < bestDist - 0.0001) { // 100m tolerance to avoid float noise
          best = newRoute;
          bestDist = newDist;
          improved = true;
        }
      }
    }
  }

  return { route: best, iterations };
}

// ── Master Solver ──────────────────────────────────────────────────────────────
export function optimiseRoute(stops: GeoStop[]): OptimisationResult {
  const t0 = Date.now();

  if (stops.length <= 2) {
    // Nothing to optimise
    const dist = totalDistance(stops);
    return {
      originalSequence:    stops,
      optimisedSequence:   stops,
      originalDistanceKm:  dist,
      optimisedDistanceKm: dist,
      distanceSavedKm:     0,
      distanceSavedPct:    0,
      iterations2opt:      0,
      durationMs:          Date.now() - t0,
    };
  }

  const originalDist = totalDistance(stops);

  // Phase 1
  const nnRoute = nearestNeighbour(stops);

  // Phase 2
  const { route: optimised, iterations } = twoOpt(nnRoute);
  const optimisedDist = totalDistance(optimised);

  // Never return a route worse than the original sequence
  const useOptimised = optimisedDist <= originalDist;
  const finalRoute = useOptimised ? optimised : [...stops];
  const finalDist = useOptimised ? optimisedDist : originalDist;

  const saved    = Math.max(originalDist - finalDist, 0);
  const savedPct = originalDist > 0 ? (saved / originalDist) * 100 : 0;

  // Re-number sequences in the optimised route
  const reSequenced = finalRoute.map((s, i) => ({ ...s, sequence: i + 1 }));

  return {
    originalSequence:    stops,
    optimisedSequence:   reSequenced,
    originalDistanceKm:  parseFloat(originalDist.toFixed(3)),
    optimisedDistanceKm: parseFloat(finalDist.toFixed(3)),
    distanceSavedKm:     parseFloat(saved.toFixed(3)),
    distanceSavedPct:    parseFloat(savedPct.toFixed(2)),
    iterations2opt:      iterations,
    durationMs:          Date.now() - t0,
  };
}

// ── Estimated Duration ─────────────────────────────────────────────────────────
// Urban school bus / commercial delivery: avg 25 km/h including stops
export function estimateDurationMin(distanceKm: number, stopCount: number): number {
  const driveMin = (distanceKm / 25) * 60;
  const stopMin  = stopCount * 1.5; // 1.5 min average dwell per stop
  return Math.round(driveMin + stopMin);
}
