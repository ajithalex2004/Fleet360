/**
 * Route Consolidation — Stage 4 component scoring.
 *
 * Turns a candidate's PCE result + real matrix distances (Stage 2/3) into
 * the component breakdown an operator can actually judge a merge by,
 * plus a bounded internal ranking cost and a 0-100 display score.
 *
 * Deliberately kept separate from route-consolidation.ts (which owns
 * eligibility filtering + orchestration) so neither file turns into a
 * monolith — this one is pure arithmetic over already-resolved facts, no
 * DB/API access, easy to unit test in isolation.
 */

import { estimateFuelCost } from '@/lib/mapbox';
import type { ScoringPolicy } from './route-consolidation-scoring-policy';
import type { MatrixPairingResult } from './route-consolidation-matrix';

export type RedeploymentStatus = 'CONFIRMED' | 'POTENTIAL' | 'NOT_AVAILABLE' | 'UNVERIFIED';
export type SurvivingResourceSlackStatus = 'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT' | 'UNVERIFIED';

export interface ResourceRelease {
  /** Hard operational fact for a simultaneous (Case 1) merge — the second route no longer runs separately. */
  routeEliminated: boolean;
  /** Same as routeEliminated today; kept distinct because a future turnaround (Case 2) merge could release a
   *  resource without eliminating a whole route. */
  serviceResourceReleased: boolean;
  /**
   * Whether the released vehicle+driver pairing can be usefully redeployed
   * elsewhere. Genuinely uncertain without persisted duty/operating-window
   * data (doesn't exist yet for bus-ops) — always UNVERIFIED today, not a
   * guess. Does NOT reduce the score; routeEliminated is what's credited.
   */
  redeploymentStatus: RedeploymentStatus;
  /** Whether the surviving (merged) vehicle still has slack after its now-longer duty. Same UNVERIFIED reasoning. */
  survivingResourceSlackStatus: SurvivingResourceSlackStatus;
}

export interface ScoreComponents {
  /** Sum of pickupToPickup + dropoffToDropoff added drive time (min) — Phase-1 detour proxy; see computeScoreComponents doc. */
  detourMinutes: number;
  detourKm: number;
  /** detourMinutes x combined rider count — equal-distribution approximation; a full stop-sequence recompute is a future refinement. */
  passengerImpactMinutes: number;
  netDistanceSavedKm: number;
  netTimeSavedMinutes: number;
  resourceRelease: ResourceRelease;
  pcePenalty: number;
}

export interface EstimatedSavings {
  /** AED/week — labelled "Estimated Direct Operating Saving", not "total benefit": only fuel + vehicle-day costs are dollarized today. */
  weeklyAmount: number;
  fuelCostPerKm: number;
  fuelPriceSource: 'fleet-log' | 'default';
  distanceSavedKmPerDay: number;
  durationSavedMinutesPerDay: number;
  vehicleDaysSavedPerWeek: number;
  operatingDaysPerWeek: number;
  calculationVersion: string;
}

export interface RankResult {
  /** impactScore - benefitScore, bounded [-1, +1] given both weight groups sum to 1. Lower = better — matches the PCE-stack convention. */
  rankingCost: number;
  /** 50 x (1 - rankingCost), clamped [0, 100]. Higher = better — UI presentation only, not used for sorting. */
  operatorScore: number;
}

// ── Components ───────────────────────────────────────────────────────────────

/**
 * Detour is approximated as the added driving needed to also touch the
 * other route's pickup and dropoff points — sum of the two matrix
 * pairings' distance/duration. When both pairings resolve to the same
 * point (the common case: candidates surviving zone-compatibility
 * usually share near-identical stops), detour is correctly 0. A full
 * merged-stop-sequence recompute (matching the actual nearest-neighbor
 * order used at Apply time) would be more precise but is materially more
 * work — out of scope for this stage; the pairwise-endpoint proxy is the
 * "deliberately simple, Phase 1" choice consistent with the rest of this
 * engine.
 */
export function computeScoreComponents(input: {
  sourceA: { totalDistanceKm: number | null; estimatedDurationMins: number | null; enrolledCount: number };
  sourceB: { totalDistanceKm: number | null; estimatedDurationMins: number | null; enrolledCount: number };
  matrixRefinement: {
    pickupToPickup: MatrixPairingResult | null;
    dropoffToDropoff: MatrixPairingResult | null;
  } | null;
  pcePenalty: number;
}): ScoreComponents {
  const pickup = input.matrixRefinement?.pickupToPickup ?? null;
  const dropoff = input.matrixRefinement?.dropoffToDropoff ?? null;
  const detourKm = (pickup?.distanceKm ?? 0) + (dropoff?.distanceKm ?? 0);
  const detourMinutes = (pickup?.durationMin ?? 0) + (dropoff?.durationMin ?? 0);

  const distA = input.sourceA.totalDistanceKm ?? 0;
  const distB = input.sourceB.totalDistanceKm ?? 0;
  const durA = input.sourceA.estimatedDurationMins ?? 0;
  const durB = input.sourceB.estimatedDurationMins ?? 0;

  // Eliminating the shorter route saves its full distance/duration; the
  // detour is the cost of accommodating the other route's endpoints on
  // the surviving vehicle. Floored at 0 — a candidate this bad should
  // already have been rejected by Stage 1/PCE, but the arithmetic
  // shouldn't produce a negative "saving".
  const netDistanceSavedKm = Math.max(0, Math.min(distA, distB) - detourKm);
  const netTimeSavedMinutes = Math.max(0, Math.min(durA, durB) - detourMinutes);

  const combinedRiders = input.sourceA.enrolledCount + input.sourceB.enrolledCount;
  const passengerImpactMinutes = detourMinutes * combinedRiders;

  return {
    detourMinutes,
    detourKm,
    passengerImpactMinutes,
    netDistanceSavedKm,
    netTimeSavedMinutes,
    resourceRelease: {
      // Case 1 (today): two simultaneous routes become one — the second
      // route's vehicle+driver pairing is a hard fact no longer needed
      // for this service, independent of any operating-window data.
      routeEliminated: true,
      serviceResourceReleased: true,
      // Genuinely uncertain without persisted duty data — not a guess.
      redeploymentStatus: 'UNVERIFIED',
      survivingResourceSlackStatus: 'UNVERIFIED',
    },
    pcePenalty: input.pcePenalty,
  };
}

// ── Ranking ──────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * benefitScore and impactScore are each convex combinations (weights sum
 * to 1, each normalized term in [0,1]) so each lands in [0,1];
 * rankingCost = impactScore - benefitScore is therefore bounded [-1,+1]
 * by construction — no separate clamp needed on rankingCost itself, only
 * on the derived operatorScore as a defensive final step.
 */
export function rankCandidate(components: ScoreComponents, policy: ScoringPolicy): RankResult {
  const r = policy.references;
  const normalizedDistanceSaving = clamp01(components.netDistanceSavedKm / r.distanceReferenceKm);
  const normalizedTimeSaving = clamp01(components.netTimeSavedMinutes / r.timeReferenceMinutes);
  const normalizedResourceBenefit = components.resourceRelease.serviceResourceReleased ? 1 : 0;
  const normalizedPassengerImpact = clamp01(components.passengerImpactMinutes / r.passengerImpactReferenceMinutes);
  const normalizedDetour = clamp01(components.detourMinutes / r.detourReferenceMinutes);
  const normalizedPcePenalty = clamp01(components.pcePenalty / r.pcePenaltyReference);

  const bw = policy.benefitWeights;
  const iw = policy.impactWeights;
  const benefitScore =
    bw.distance * normalizedDistanceSaving +
    bw.time * normalizedTimeSaving +
    bw.resourceRelease * normalizedResourceBenefit;
  const impactScore =
    iw.passengerImpact * normalizedPassengerImpact +
    iw.detour * normalizedDetour +
    iw.pcePenalty * normalizedPcePenalty;

  const rankingCost = impactScore - benefitScore;
  const operatorScoreRaw = 50 * (1 - rankingCost);
  const operatorScore = Math.min(100, Math.max(0, Math.round(operatorScoreRaw * 10) / 10));

  return { rankingCost: Math.round(rankingCost * 1000) / 1000, operatorScore };
}

// ── Estimated savings ─────────────────────────────────────────────────────────

/**
 * Only fuel + vehicle-day costs are dollarized — maintenance, tyres,
 * depreciation, driver hours, tolls aren't modeled yet, hence "Estimated
 * Direct Operating Saving" rather than "total benefit". fuelCostPerKm
 * reuses estimateFuelCost() (mapbox.ts) with the fleet's real per-litre
 * price — same source as the Single Route/Fleet Planner fuel estimate,
 * not a second independently-set constant.
 */
export function computeEstimatedSavings(
  components: ScoreComponents,
  args: {
    fuelPricePerLitreAED: number;
    fuelPriceSource: 'fleet-log' | 'default';
    vehicleCostPerDay: number;
    operatingDaysPerWeek: number;
    calculationVersion: string;
  },
): EstimatedSavings {
  const fuel = estimateFuelCost(components.netDistanceSavedKm, 'bus', args.fuelPricePerLitreAED);
  const fuelCostPerKm = components.netDistanceSavedKm > 0 ? fuel.costAED / components.netDistanceSavedKm : 0;
  const vehicleDaysSavedPerWeek = components.resourceRelease.serviceResourceReleased ? args.operatingDaysPerWeek : 0;
  const weeklyAmount = Math.round(fuel.costAED * args.operatingDaysPerWeek + vehicleDaysSavedPerWeek * args.vehicleCostPerDay);

  return {
    weeklyAmount,
    fuelCostPerKm: Math.round(fuelCostPerKm * 100) / 100,
    fuelPriceSource: args.fuelPriceSource,
    distanceSavedKmPerDay: components.netDistanceSavedKm,
    durationSavedMinutesPerDay: components.netTimeSavedMinutes,
    vehicleDaysSavedPerWeek,
    operatingDaysPerWeek: args.operatingDaysPerWeek,
    calculationVersion: args.calculationVersion,
  };
}
