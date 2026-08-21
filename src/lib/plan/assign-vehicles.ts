/**
 * assign-vehicles.ts — smart vehicle assignment for Planning Core's Apply
 * step.
 *
 * What this replaces: Apply used to hand out vehicles by pure alphabetical
 * license-plate order, with no regard for whether the vehicle could
 * actually carry the block's passengers, was the right type, or was
 * anywhere near where the block starts. This module picks the best-fit
 * vehicle per block instead, gated on two hard constraints and ranked by
 * three soft ones:
 *
 *   - Capacity (hard):        vehicle.seatingCapacity >= block's peak
 *                              passenger count. A vehicle that's too small
 *                              is never eligible, full stop.
 *   - Vehicle type (hard):    if any trip on the block declares a required
 *                              vehicle group, the vehicle's group must
 *                              match. If two trips on the same block
 *                              disagree, no vehicle can satisfy both —
 *                              the caller signals this with the CONFLICT
 *                              sentinel and the block is left unassigned.
 *   - Zone (soft, ranked 1st): among vehicles that clear both hard
 *                              gates, a vehicle whose Vehicle.zoneId
 *                              matches the block's route zone ranks
 *                              above a cross-zone one. Never excludes —
 *                              an untagged vehicle or block is just a
 *                              tie at this tier, falling through to fit.
 *                              See lib/plan/assign-vehicles's zone fields
 *                              and the Fleet vehicle / Routes page zone
 *                              pickers.
 *   - Fit (soft, ranked 2nd): among same-zone-tier ties, prefer the
 *                              vehicle with the least *wasted* capacity
 *                              (seatingCapacity - block's peak passenger
 *                              count) — the tightest sufficient vehicle,
 *                              not just any sufficient one. Without this,
 *                              a 27-seat coaster and a 13-seat van both
 *                              clearing the capacity gate for a 12-
 *                              passenger block would be picked between
 *                              arbitrarily (whichever plate sorts first),
 *                              needlessly tying up the larger vehicle.
 *   - Proximity (soft, ranked 3rd): among same-zone, same-fit-tier ties,
 *                              prefer the vehicle nearest the block's
 *                              first pickup. A vehicle with unknown
 *                              position (no fresh GPS, no depot) is
 *                              still eligible, just deprioritised —
 *                              being far away isn't disqualifying, it's
 *                              just worse.
 *
 * Each vehicle is assigned to at most one block (same semantics as the
 * old round-robin — one physical vehicle can't run two blocks on the
 * same day at once). Blocks are processed in the order given by the
 * caller, which should already be date/time order.
 *
 * Kept DB-free and pure so it's unit-testable the same way block.ts is —
 * the caller (apply/route.ts) is responsible for loading fresh vehicle
 * and trip data and shaping it into the inputs below.
 */

/** Sentinel for BlockVehicleRequirement.requiredVehicleGroup meaning
 *  "two or more trips on this block require different, non-null vehicle
 *  groups" — no vehicle can satisfy both, so every candidate fails. */
export const VEHICLE_GROUP_CONFLICT = 'CONFLICT' as const;

export interface VehicleCandidate {
  id: string;
  licensePlate: string | null;
  seatingCapacity: number | null;
  vehicleGroup: string | null;
  /** Place id the vehicle is tagged to (type=OPERATIONAL_ZONE). Null =
   *  untagged — never excluded, just no zone-match bonus. */
  zoneId: string | null;
  /** Best-known current position — fresh GPS ping if recent, else the
   *  vehicle's home depot, else null (caller resolves the fallback). */
  lat: number | null;
  lng: number | null;
}

export interface BlockVehicleRequirement {
  blockId: string;
  /** Peak simultaneous passenger count across the block's trips — the
   *  vehicle only needs to fit the busiest single trip, not the sum. */
  maxPassengers: number;
  /** null = no constraint. VEHICLE_GROUP_CONFLICT = unsatisfiable. */
  requiredVehicleGroup: string | null;
  /** Zone the block's route(s) are tagged to. Null = untagged — the zone
   *  ranking tier is a no-op and every vehicle ties, falling through to
   *  proximity. Like requiredVehicleGroup, a block whose trips disagree
   *  on zone has no single "right" answer — the caller may pass null in
   *  that case (unlike vehicle group, a zone mismatch is never a hard
   *  failure, so there's no conflict sentinel needed here). */
  zoneId: string | null;
  /** The block's first trip's pickup — proximity is ranked against this,
   *  since that's where the vehicle needs to be to start the block. */
  pickupPoint: { lat: number | null; lng: number | null };
}

export type VehicleAssignmentReason =
  | 'NO_VEHICLES_AVAILABLE'
  | 'NO_CAPACITY_MATCH'
  | 'NO_TYPE_MATCH'
  | 'CONFLICTING_VEHICLE_GROUP_REQUIREMENTS';

export interface VehicleAssignmentResult {
  blockId: string;
  vehicleId: string | null;
  vehicleLicensePlate: string | null;
  /** Distance (km) from the chosen vehicle to the block's pickup point.
   *  Null when unassigned, or when neither side had known coordinates. */
  distanceKm: number | null;
  /** True when the chosen vehicle's zone matched the block's zone (both
   *  tagged and equal). False when unassigned, untagged either side, or
   *  a genuine cross-zone pick (zone is soft, so this can still happen). */
  zoneMatched: boolean;
  /** Set only when vehicleId is null. */
  reason?: VehicleAssignmentReason;
}

const EARTH_RADIUS_KM = 6_371;

/** Same haversine formula as zone-compat.ts — kept as a small local copy
 *  rather than a cross-module import, matching this codebase's existing
 *  pattern of self-contained planning-engine helpers (see block.ts's own
 *  local ymd/minsBetween). */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function distanceOrInfinity(
  v: VehicleCandidate,
  p: { lat: number | null; lng: number | null },
): number {
  if (v.lat == null || v.lng == null || p.lat == null || p.lng == null) return Number.POSITIVE_INFINITY;
  return haversineKm(v.lat, v.lng, p.lat, p.lng);
}

export function assignVehiclesToBlocks(
  blocks: BlockVehicleRequirement[],
  vehicles: VehicleCandidate[],
): VehicleAssignmentResult[] {
  const used = new Set<string>();
  const results: VehicleAssignmentResult[] = [];

  for (const req of blocks) {
    const unusedVehicles = vehicles.filter((v) => !used.has(v.id));
    if (unusedVehicles.length === 0) {
      results.push({ blockId: req.blockId, vehicleId: null, vehicleLicensePlate: null, distanceKm: null, zoneMatched: false, reason: 'NO_VEHICLES_AVAILABLE' });
      continue;
    }
    if (req.requiredVehicleGroup === VEHICLE_GROUP_CONFLICT) {
      results.push({ blockId: req.blockId, vehicleId: null, vehicleLicensePlate: null, distanceKm: null, zoneMatched: false, reason: 'CONFLICTING_VEHICLE_GROUP_REQUIREMENTS' });
      continue;
    }

    const capacityOk = unusedVehicles.filter((v) => (v.seatingCapacity ?? 0) >= req.maxPassengers);
    if (capacityOk.length === 0) {
      results.push({ blockId: req.blockId, vehicleId: null, vehicleLicensePlate: null, distanceKm: null, zoneMatched: false, reason: 'NO_CAPACITY_MATCH' });
      continue;
    }

    const typeOk = req.requiredVehicleGroup == null
      ? capacityOk
      : capacityOk.filter((v) => v.vehicleGroup === req.requiredVehicleGroup);
    if (typeOk.length === 0) {
      results.push({ blockId: req.blockId, vehicleId: null, vehicleLicensePlate: null, distanceKm: null, zoneMatched: false, reason: 'NO_TYPE_MATCH' });
      continue;
    }

    // Same zone first, then tightest capacity fit, then distance, then
    // license plate / id as a final deterministic tiebreaker — otherwise
    // a tie (e.g. two vehicles both with unknown position and no zone
    // match) would resolve on incidental array/DB row order.
    //
    // Zone score: 0 = matches the block's zone, 1 = everything else
    // (untagged vehicle, untagged block, or a real cross-zone mismatch)
    // — never excludes, just deprioritises.
    //
    // Fit waste: seatingCapacity - maxPassengers, lower is better (0 =
    // exact fit). typeOk already guarantees seatingCapacity clears
    // maxPassengers except in the maxPassengers <= 0 edge case (a block
    // with no confirmedCount data), where a null-capacity vehicle can
    // slip through the `?? 0` gate check — treat that as worst-possible
    // fit here rather than a false "perfect fit" (0 - 0), since we
    // genuinely don't know it fits at all.
    //
    // Distance compared with !== rather than subtraction: Infinity -
    // Infinity is NaN, which would short-circuit the next tiebreaker for
    // the (common) case of two vehicles that both lack position data or
    // both lack seating capacity data.
    const zoneScore = (v: VehicleCandidate) => (req.zoneId != null && v.zoneId === req.zoneId ? 0 : 1);
    const fitWaste = (v: VehicleCandidate) =>
      v.seatingCapacity == null ? Number.POSITIVE_INFINITY : v.seatingCapacity - req.maxPassengers;
    const ranked = [...typeOk].sort((a, b) => {
      const za = zoneScore(a);
      const zb = zoneScore(b);
      if (za !== zb) return za - zb;
      const fa = fitWaste(a);
      const fb = fitWaste(b);
      if (fa !== fb) return fa - fb;
      const da = distanceOrInfinity(a, req.pickupPoint);
      const db = distanceOrInfinity(b, req.pickupPoint);
      if (da !== db) return da - db;
      return (a.licensePlate ?? a.id).localeCompare(b.licensePlate ?? b.id);
    });
    const chosen = ranked[0];
    const dist = distanceOrInfinity(chosen, req.pickupPoint);
    used.add(chosen.id);
    results.push({
      blockId: req.blockId,
      vehicleId: chosen.id,
      vehicleLicensePlate: chosen.licensePlate,
      distanceKm: Number.isFinite(dist) ? Math.round(dist * 10) / 10 : null,
      zoneMatched: zoneScore(chosen) === 0,
    });
  }

  return results;
}
