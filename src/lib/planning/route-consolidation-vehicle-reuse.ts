/**
 * Route Consolidation — vehicle reuse analysis ("Case 2"), advisory-only v1.
 *
 * Distinct resource model from Case 1 (route-consolidation.ts): nothing
 * about either route changes here — both keep their own stops, passengers,
 * and schedule. What's being evaluated is whether the SAME vehicle+driver
 * could serve route A's trip and then route B's trip back-to-back instead
 * of needing two vehicles. There's no route retirement, no stop merging,
 * no enrolment migration, and (for v1) no Apply mutation — this surfaces
 * an opportunity; ops completes the actual reassignment manually via the
 * existing Schedules/Dispatch screens.
 *
 * Eligibility funnel (all ordered pairs, since "does A free the vehicle in
 * time for B" is directional — A→B and B→A are different candidates):
 *   1. Both routes have parseable representativeArrivalTime(A) /
 *      representativeDepartureTime(B)
 *   2. A.arrival < B.departure (sequential, same "day" — no midnight
 *      wraparound in v1)
 *   3. availableGapMinutes <= MAX_VEHICLE_REUSE_WINDOW — exceeding this
 *      isn't "infeasible," it's just not a meaningful back-to-back
 *      candidate at all (an 08:00 arrival and a 16:00 departure), so it's
 *      excluded from results entirely rather than shown as NOT_FEASIBLE
 *   4. A's dropoff end and B's pickup end are zone-compatible (reuses
 *      zone-compat.ts, same SAME_ZONE / WITHIN_FALLBACK rule as Case 1)
 *
 * Surviving candidates get a real DROPOFF_TO_PICKUP matrix lookup (same
 * batching/clustering machinery Case 1's Stage 2 uses) for repositioning
 * distance/time, then:
 *
 *   requiredGapMinutes = minimumTurnaroundMinutes + repositionDurationMinutes
 *   remainingSlackMinutes = availableGapMinutes - requiredGapMinutes
 *
 * classified into STRONG / FEASIBLE / TIGHT / NOT_FEASIBLE by slack. A
 * negative-slack pair still appears in the results (unlike an
 * out-of-window pair) — "these two are close in time but don't have
 * enough turnaround" is useful information for ops, unlike unrelated
 * trips hours apart.
 */

import type { PrismaClient } from '@prisma/client';
import type { ConsolidationFacts, RouteFacts } from './route-consolidation-facts';
import { routePickupStop, routeDropoffStop } from './route-consolidation-facts';
import type { MatrixPairing, MatrixPairingResult } from './route-consolidation-matrix';
import { resolveMatrixPairings, pairingKey } from './route-consolidation-matrix';
import { zoneCompatibility, isCompatPassing, DEFAULT_FALLBACK_KM, type ZoneCompatResult } from './zone-compat';

// ─── Public shapes ──────────────────────────────────────────────────

export type VehicleReuseFeasibility = 'STRONG' | 'FEASIBLE' | 'TIGHT' | 'NOT_FEASIBLE';

export type AssignmentComparisonStatus = 'SAME' | 'DIFFERENT' | 'UNASSIGNED';

export type VehicleReuseSkipReason =
  | 'MISSING_TIMING_DATA'
  | 'NOT_SEQUENTIAL'
  | 'OUTSIDE_REUSE_WINDOW'
  | 'ZONE_DATA_UNAVAILABLE'
  | 'ZONE_INCOMPATIBLE'
  | 'INSUFFICIENT_ROUTE_DATA';

export interface SkippedReusePair {
  firstRouteId: string;
  secondRouteId: string;
  reason: VehicleReuseSkipReason;
  detail?: string;
}

export interface VehicleReuseOpportunity {
  firstRouteId: string;
  firstRouteName: string;
  secondRouteId: string;
  secondRouteName: string;
  firstArrivalTime: string;
  secondDepartureTime: string;
  availableGapMinutes: number;
  minimumTurnaroundMinutes: number;
  repositionDistanceMeters: number;
  repositionDurationMinutes: number;
  requiredGapMinutes: number;
  remainingSlackMinutes: number;
  dropoffPickupZoneCompatibility: ZoneCompatResult;
  feasibility: VehicleReuseFeasibility;
  vehicleAssignmentStatus: AssignmentComparisonStatus;
  driverAssignmentStatus: AssignmentComparisonStatus;
  warnings: string[];
}

export interface VehicleReuseAnalysis {
  opportunities: VehicleReuseOpportunity[];
  skipped: SkippedReusePair[];
  totals: {
    routesAnalysed: number;
    orderedPairsConsidered: number;
    opportunitiesFound: number;
  };
}

export interface VehicleReusePolicy {
  minimumTurnaroundMinutes: number;
  maxReuseWindowMinutes: number;
}

// ─── Pure feasibility math (no I/O — unit-testable in isolation) ────

/** Presentation-only thresholds — not eligibility rules, just how remainingSlackMinutes buckets into a label. */
export function classifyReuseFeasibility(remainingSlackMinutes: number): VehicleReuseFeasibility {
  if (remainingSlackMinutes >= 20) return 'STRONG';
  if (remainingSlackMinutes >= 10) return 'FEASIBLE';
  if (remainingSlackMinutes >= 0) return 'TIGHT';
  return 'NOT_FEASIBLE';
}

export interface ReuseGapInput {
  arrivalMinutes: number;
  departureMinutes: number;
  minimumTurnaroundMinutes: number;
  repositionDurationMinutes: number;
}

export interface ReuseGapResult {
  availableGapMinutes: number;
  requiredGapMinutes: number;
  remainingSlackMinutes: number;
  feasibility: VehicleReuseFeasibility;
}

/** Caller guarantees departureMinutes > arrivalMinutes (sequential, same-day) — see NOT_SEQUENTIAL filtering below. */
export function computeReuseGap(input: ReuseGapInput): ReuseGapResult {
  const availableGapMinutes = input.departureMinutes - input.arrivalMinutes;
  const requiredGapMinutes = input.minimumTurnaroundMinutes + input.repositionDurationMinutes;
  const remainingSlackMinutes = availableGapMinutes - requiredGapMinutes;
  return {
    availableGapMinutes,
    requiredGapMinutes,
    remainingSlackMinutes,
    feasibility: classifyReuseFeasibility(remainingSlackMinutes),
  };
}

export function compareAssignment(a: string | null, b: string | null): AssignmentComparisonStatus {
  if (a == null || b == null) return 'UNASSIGNED';
  return a === b ? 'SAME' : 'DIFFERENT';
}

function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// ─── Orchestrator ───────────────────────────────────────────────────

export async function analyzeVehicleReuseOpportunities(
  prisma: PrismaClient,
  tenantId: string,
  facts: ConsolidationFacts,
  policy: VehicleReusePolicy,
): Promise<VehicleReuseAnalysis> {
  const skipped: SkippedReusePair[] = [];
  type Survivor = {
    a: RouteFacts;
    b: RouteFacts;
    arrivalMinutes: number;
    departureMinutes: number;
    availableGapMinutes: number;
    zoneCompat: ZoneCompatResult;
  };
  const survivors: Survivor[] = [];

  let orderedPairsConsidered = 0;
  for (const a of facts.routes) {
    for (const b of facts.routes) {
      if (a.id === b.id) continue;
      orderedPairsConsidered++;

      if (a.stops.length < 1 || b.stops.length < 1) {
        skipped.push({ firstRouteId: a.id, secondRouteId: b.id, reason: 'INSUFFICIENT_ROUTE_DATA', detail: 'route has no stops' });
        continue;
      }
      if (!a.representativeArrivalTime || !b.representativeDepartureTime) {
        skipped.push({ firstRouteId: a.id, secondRouteId: b.id, reason: 'MISSING_TIMING_DATA' });
        continue;
      }
      const arrivalMinutes = parseTimeToMinutes(a.representativeArrivalTime);
      const departureMinutes = parseTimeToMinutes(b.representativeDepartureTime);
      if (arrivalMinutes === null || departureMinutes === null) {
        skipped.push({ firstRouteId: a.id, secondRouteId: b.id, reason: 'MISSING_TIMING_DATA' });
        continue;
      }
      if (departureMinutes <= arrivalMinutes) {
        skipped.push({ firstRouteId: a.id, secondRouteId: b.id, reason: 'NOT_SEQUENTIAL', detail: `${a.representativeArrivalTime} -> ${b.representativeDepartureTime}` });
        continue;
      }
      const availableGapMinutes = departureMinutes - arrivalMinutes;
      if (availableGapMinutes > policy.maxReuseWindowMinutes) {
        skipped.push({
          firstRouteId: a.id, secondRouteId: b.id, reason: 'OUTSIDE_REUSE_WINDOW',
          detail: `${availableGapMinutes} min apart (max ${policy.maxReuseWindowMinutes})`,
        });
        continue;
      }

      const dropoffA = routeDropoffStop(a);
      const pickupB = routePickupStop(b);
      const zoneCompat = zoneCompatibility(
        [{ placeId: dropoffA?.placeId ?? null, lat: dropoffA?.lat ?? null, lng: dropoffA?.lng ?? null }],
        [{ placeId: pickupB?.placeId ?? null, lat: pickupB?.lat ?? null, lng: pickupB?.lng ?? null }],
        { fallbackKm: DEFAULT_FALLBACK_KM.PICKUP },
      );
      if (zoneCompat.kind === 'UNKNOWN') {
        skipped.push({ firstRouteId: a.id, secondRouteId: b.id, reason: 'ZONE_DATA_UNAVAILABLE' });
        continue;
      }
      if (!isCompatPassing(zoneCompat)) {
        skipped.push({ firstRouteId: a.id, secondRouteId: b.id, reason: 'ZONE_INCOMPATIBLE', detail: zoneCompat.kind });
        continue;
      }

      survivors.push({ a, b, arrivalMinutes, departureMinutes, availableGapMinutes, zoneCompat });
    }
  }

  // Real reposition distance/time for survivors, batched via the same
  // matrix machinery Case 1's Stage 2 uses (clustering, chunking, the
  // same-point shortcut) — resolved once for the whole run.
  const pairings: MatrixPairing[] = [];
  for (const s of survivors) {
    const dropoffA = routeDropoffStop(s.a);
    const pickupB = routePickupStop(s.b);
    if (dropoffA?.lat == null || dropoffA?.lng == null || pickupB?.lat == null || pickupB?.lng == null) continue;
    pairings.push({
      type: 'DROPOFF_TO_PICKUP',
      routeIdA: s.a.id,
      routeIdB: s.b.id,
      from: { lat: dropoffA.lat, lng: dropoffA.lng },
      to: { lat: pickupB.lat, lng: pickupB.lng },
    });
  }
  const matrixResults = await resolveMatrixPairings(prisma, tenantId, pairings);

  const opportunities: VehicleReuseOpportunity[] = survivors.map((s) => {
    const matrixEntry: MatrixPairingResult | undefined = matrixResults.get(pairingKey('DROPOFF_TO_PICKUP', s.a.id, s.b.id));
    // No matrix data (e.g. Google API call failed for this chunk) — treat
    // reposition as 0 rather than dropping the opportunity, same
    // tolerance Case 1 shows for a matrix miss (falls back, doesn't sink
    // the candidate). The gap fields make the estimate's basis visible.
    const repositionDistanceKm = matrixEntry?.distanceKm ?? 0;
    const repositionDurationMin = matrixEntry?.durationMin ?? 0;

    const gap = computeReuseGap({
      arrivalMinutes: s.arrivalMinutes,
      departureMinutes: s.departureMinutes,
      minimumTurnaroundMinutes: policy.minimumTurnaroundMinutes,
      repositionDurationMinutes: repositionDurationMin,
    });

    const vehicleAssignmentStatus = compareAssignment(s.a.assignedVehicleId, s.b.assignedVehicleId);
    const driverAssignmentStatus = compareAssignment(s.a.assignedDriverId, s.b.assignedDriverId);
    const warnings: string[] = [];
    if (vehicleAssignmentStatus === 'DIFFERENT') warnings.push('Vehicle assignments differ — manual scheduling review required.');
    if (driverAssignmentStatus === 'DIFFERENT') warnings.push('Driver assignments differ — manual scheduling review required.');
    if (!matrixEntry) warnings.push('Reposition distance/time unavailable — showing 0 as a placeholder, not a verified estimate.');

    return {
      firstRouteId: s.a.id,
      firstRouteName: s.a.name,
      secondRouteId: s.b.id,
      secondRouteName: s.b.name,
      firstArrivalTime: s.a.representativeArrivalTime!,
      secondDepartureTime: s.b.representativeDepartureTime!,
      availableGapMinutes: gap.availableGapMinutes,
      minimumTurnaroundMinutes: policy.minimumTurnaroundMinutes,
      repositionDistanceMeters: Math.round(repositionDistanceKm * 1000),
      repositionDurationMinutes: repositionDurationMin,
      requiredGapMinutes: gap.requiredGapMinutes,
      remainingSlackMinutes: gap.remainingSlackMinutes,
      dropoffPickupZoneCompatibility: s.zoneCompat,
      feasibility: gap.feasibility,
      vehicleAssignmentStatus,
      driverAssignmentStatus,
      warnings,
    };
  });

  opportunities.sort((x, y) => y.remainingSlackMinutes - x.remainingSlackMinutes);

  return {
    opportunities,
    skipped,
    totals: {
      routesAnalysed: facts.routes.length,
      orderedPairsConsidered,
      opportunitiesFound: opportunities.length,
    },
  };
}
