/**
 * Planning optimizer — Phase 1 (scoring + ranking).
 *
 * Given N candidate plans, computes an operating cost and a PCE
 * penalty for each and returns them ranked by
 *
 *   totalCost = operatingCost + penaltyLambda × pcePenalty
 *
 * Infeasible plans (PCE verdict=BLOCK) sink to the bottom regardless
 * of totalCost. Callers get a scored shortlist; they choose what to
 * apply. Deliberately NOT a search algorithm — no local-search moves,
 * no plan mutation. Phase 2 can layer that on top when the ranking
 * surface has proven itself in production.
 *
 * Why this composition:
 *   - Operating cost comes from the plan's own `summary` (the
 *     runcut/block algorithm already computed pay hours, deadhead,
 *     etc.). No re-derivation, no drift.
 *   - PCE penalty comes from evaluatePlanApply — the exact same
 *     evaluation the /plan/[id]/apply endpoint runs. Guarantees the
 *     "optimizer's #1 pick" is also the plan that apply will accept.
 *   - Delta building goes through buildAssignmentDeltasFromPlan
 *     which /apply also uses — one place, two consumers.
 */

import type { PrismaClient } from '@prisma/client';
import { evaluatePlanApply, type ApplyGateResult } from './apply-gate';
import {
  buildAssignmentDeltasFromPlan,
  loadVehiclePool,
  type PlanBlock,
  type PlanRun,
  type DriverRoster,
} from './plan-deltas';

// ─── Objective ──────────────────────────────────────────────────────

/**
 * How much a plan "costs" to run, and how heavily to weight compliance
 * penalties against operating cost. Units are unit-less currency; use
 * whatever the tenant standardises on (AED, USD, …) and keep it
 * consistent across the objective fields.
 */
export type Objective = {
  /**
   * Weight applied to PCE totalPenalty. Higher = optimizer prefers
   * "cleaner" plans even when they cost more to operate. Default 1.
   */
  penaltyLambda?: number;
  /**
   * Optional multipliers on the plan's summary metrics. When present
   * they override the plan's own totalPayCost estimate — useful when
   * the tenant's actual cost basis differs from what the runcut
   * algorithm modelled.
   */
  costPerPayHour?: number;
  costPerDeadheadHour?: number;
  /** Per-vehicle-per-day fixed cost. Multiplied by blockCount. */
  costPerVehicleDay?: number;
  /** Per-driver-per-day fixed cost. Multiplied by driverCount. */
  costPerDriverDay?: number;
};

// ─── Plan shape (subset of StaffTransportPlan we depend on) ─────────

export type ScorablePlan = {
  id: string;
  name: string;
  runs: PlanRun[] | null;
  blocks: PlanBlock[] | null;
  rosters: DriverRoster[] | null;
  summary: PlanSummary | null;
};

/**
 * Subset of the plan's summary the optimizer reads. Fields are optional
 * because the plan may have been computed at a time when the algorithm
 * didn't populate all of them; missing values are treated as 0.
 */
export type PlanSummary = {
  totalPayCost?: number;
  totalPayHours?: number;
  totalDeadheadHours?: number;
  blockCount?: number;
  driverCount?: number;
};

// ─── Result shapes ──────────────────────────────────────────────────

export type PlanScore = {
  planId: string;
  planName: string;
  operatingCost: number;
  pcePenalty: number;
  totalCost: number;
  feasible: boolean;
  verdict: ApplyGateResult['verdict'];
  blockedTripIds: string[];
  warningTripIds: string[];
  /** Number of trip-deltas the plan implied — sanity metric for the UI. */
  tripCount: number;
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Scores a single plan. Loads the vehicle pool once, walks the plan to
 * derive assignment deltas, runs them through PCE via evaluatePlanApply
 * (no writes), and returns {operatingCost, pcePenalty, totalCost, ...}.
 */
export async function scorePlan(
  prisma: PrismaClient,
  tenantId: string,
  plan: ScorablePlan,
  objective: Objective = {}
): Promise<PlanScore> {
  const vehicles = await loadVehiclePool(prisma, tenantId);
  const deltas = buildAssignmentDeltasFromPlan(plan, vehicles);

  const gate = deltas.length === 0
    ? emptyGate()
    : await evaluatePlanApply(prisma, { tenantId, deltas });

  const operatingCost = computeOperatingCost(plan.summary ?? {}, objective);
  const lambda = objective.penaltyLambda ?? 1;
  const totalCost = operatingCost + lambda * gate.totalPenalty;

  return {
    planId: plan.id,
    planName: plan.name,
    operatingCost,
    pcePenalty: gate.totalPenalty,
    totalCost,
    feasible: gate.verdict !== 'BLOCK',
    verdict: gate.verdict,
    blockedTripIds: gate.blockedTripIds,
    warningTripIds: gate.warningTripIds,
    tripCount: deltas.length,
  };
}

/**
 * Scores each plan and returns them sorted:
 *   1. feasible=true first (BLOCKed plans always at the bottom, since
 *      the operator can't actually apply them regardless of totalCost)
 *   2. ties broken by ascending totalCost — cheapest legal plan wins
 *   3. remaining ties broken by planName for stable output
 */
export async function rankPlans(
  prisma: PrismaClient,
  tenantId: string,
  plans: ScorablePlan[],
  objective: Objective = {}
): Promise<PlanScore[]> {
  // Sequential rather than Promise.all: PCE evaluation makes many
  // Prisma calls; hitting them concurrently for every candidate would
  // spike DB load with no wall-clock win for typical N<=10.
  const scored: PlanScore[] = [];
  for (const plan of plans) {
    scored.push(await scorePlan(prisma, tenantId, plan, objective));
  }
  return scored.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
    return a.planName.localeCompare(b.planName);
  });
}

// ─── Cost model ─────────────────────────────────────────────────────

/**
 * Prefer explicit per-hour rates when the caller supplied them; fall
 * back to the plan's own totalPayCost so a caller passing an empty
 * objective still gets sensible ranking based on runcut's estimate.
 */
function computeOperatingCost(summary: PlanSummary, objective: Objective): number {
  const usingOverrides =
    objective.costPerPayHour != null ||
    objective.costPerDeadheadHour != null ||
    objective.costPerVehicleDay != null ||
    objective.costPerDriverDay != null;

  if (!usingOverrides) return summary.totalPayCost ?? 0;

  return (
    (summary.totalPayHours ?? 0) * (objective.costPerPayHour ?? 0) +
    (summary.totalDeadheadHours ?? 0) * (objective.costPerDeadheadHour ?? 0) +
    (summary.blockCount ?? 0) * (objective.costPerVehicleDay ?? 0) +
    (summary.driverCount ?? 0) * (objective.costPerDriverDay ?? 0)
  );
}

function emptyGate(): ApplyGateResult {
  return { verdict: 'PASS', totalPenalty: 0, trips: [], blockedTripIds: [], warningTripIds: [] };
}
