/**
 * Apply-time PCE gate for the Staff Transport Bulk Planner.
 *
 * A saved plan carries `runs`, `blocks`, and `rosters` — collectively
 * they imply a `tripId → {driverId, vehicleId}` map that /plan/[id]/apply
 * writes back to `trip_schedules`. Before that write happens, this gate
 * evaluates each affected trip through the Planning Constraint Engine
 * with the *post-apply* state (existing trip fields + new driver/vehicle).
 * If any trip returns BLOCK, the whole apply is refused — one bad row
 * shouldn't be silently written just because the other 999 are fine.
 *
 * Aggregation contract (matches the rest of PCE):
 *   verdict = worst per-trip verdict  (BLOCK > WARN > PASS)
 *   totalPenalty = sum across trips
 *   trips: per-trip {tripId, verdict, checks[]}
 *
 * This helper is pure: it consumes explicit inputs and calls the
 * evaluator via `loadPlanFacts` + `evaluatePlan`. The apply route wires
 * it in and decides HTTP semantics (409 on BLOCK, etc).
 */

import type { PrismaClient } from '@prisma/client';
import { loadPlanFacts, type ProposedTripInput } from '@/lib/planning/facts';
import { evaluatePlan, type PlanEvaluationResult, type PlanCheck } from '@/lib/planning/evaluate-plan';

export type AssignmentDelta = {
  /** Only trips that would actually change need gating. */
  tripId: string;
  newDriverId: string | null;
  newVehicleId: string | null;
};

export type PerTripGateResult = {
  tripId: string;
  verdict: PlanEvaluationResult['verdict'];
  checks: PlanCheck[];
  penalty: number;
};

export type ApplyGateResult = {
  verdict: PlanEvaluationResult['verdict'];
  totalPenalty: number;
  trips: PerTripGateResult[];
  /** Convenience: trips whose per-trip verdict is BLOCK. Empty when apply may proceed. */
  blockedTripIds: string[];
  /** Convenience: trips whose per-trip verdict is WARN (never BLOCK). */
  warningTripIds: string[];
};

export type EvaluateApplyInput = {
  tenantId: string;
  tenantTimezone?: string;
  deltas: AssignmentDelta[];
};

/**
 * Fetches each affected trip once, synthesises its post-apply state as a
 * PCE `proposed` trip (role='standalone'), and evaluates. Batching per
 * trip is deliberate: evaluators like PICKUP_TIME_BUFFER and
 * PASSENGER_MAX_DETOUR are merge-specific and shouldn't fire on
 * standalone applies; keeping trips in isolated calls guarantees that.
 */
export async function evaluatePlanApply(
  prismaClient: PrismaClient,
  input: EvaluateApplyInput
): Promise<ApplyGateResult> {
  if (input.deltas.length === 0) {
    return { verdict: 'PASS', totalPenalty: 0, trips: [], blockedTripIds: [], warningTripIds: [] };
  }

  const tripIds = input.deltas.map((d) => d.tripId);
  const rows = await prismaClient.tripSchedule.findMany({
    where: { id: { in: tripIds }, tenantId: input.tenantId, deletedAt: null },
    include: {
      route: {
        select: {
          stops: {
            select: { placeId: true, gpsLat: true, gpsLng: true, sequence: true },
            orderBy: { sequence: 'asc' },
          },
        },
      },
    },
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const trips: PerTripGateResult[] = [];
  let totalPenalty = 0;
  let worstVerdict: PlanEvaluationResult['verdict'] = 'PASS';

  for (const delta of input.deltas) {
    const row = rowById.get(delta.tripId);
    if (!row) {
      // Delta references a trip we can't read (deleted or cross-tenant).
      // Treated as BLOCK because writing to it would either fail the FK
      // check or attempt a cross-tenant update.
      trips.push({
        tripId: delta.tripId,
        verdict: 'BLOCK',
        checks: [
          {
            code: 'GATE_TRIP_NOT_FOUND',
            outcome: 'BLOCK',
            message: `Trip ${delta.tripId} not found or not in this tenant — cannot apply.`,
          },
        ],
        penalty: 0,
      });
      worstVerdict = 'BLOCK';
      continue;
    }

    const proposed: ProposedTripInput = {
      id: row.id,
      role: 'standalone',
      routeId: row.routeId,
      // Apply the delta: new driver/vehicle if the plan sets one, else keep existing.
      vehicleId: delta.newVehicleId ?? row.vehicleId,
      driverId: delta.newDriverId ?? row.driverId,
      departureTime: row.departureTime,
      arrivalTime: row.arrivalTime,
      latestArrivalTime: row.latestArrivalTime,
      confirmedCount: row.confirmedCount ?? 0,
      stops: (row.route.stops ?? [])
        .filter((s) => s.gpsLat != null && s.gpsLng != null && s.placeId != null)
        .map((s) => ({
          placeId: s.placeId as string,
          lat: s.gpsLat as number,
          lng: s.gpsLng as number,
          sequence: s.sequence,
        })),
    };

    const facts = await loadPlanFacts(
      {
        tenantId: input.tenantId,
        tenantTimezone: input.tenantTimezone,
        proposed: [proposed],
      },
      prismaClient
    );
    const result = evaluatePlan(facts);
    trips.push({
      tripId: row.id,
      verdict: result.verdict,
      checks: result.checks,
      penalty: result.totalPenalty,
    });
    totalPenalty += result.totalPenalty;
    if (result.verdict === 'BLOCK') worstVerdict = 'BLOCK';
    else if (result.verdict === 'WARN' && worstVerdict === 'PASS') worstVerdict = 'WARN';
  }

  return {
    verdict: worstVerdict,
    totalPenalty,
    trips,
    blockedTripIds: trips.filter((t) => t.verdict === 'BLOCK').map((t) => t.tripId),
    warningTripIds: trips.filter((t) => t.verdict === 'WARN').map((t) => t.tripId),
  };
}
