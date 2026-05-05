/**
 * TRIPEXL Scoring Engine
 * Weighted multi-factor scoring with SLA urgency boost.
 * All scores are normalized to [0, 1].
 */

import type { Candidate, DispatchJob, DispatchWeights } from './types';

/* ─────────────────────────────────────────────────────────────
   Normalizers
───────────────────────────────────────────────────────────── */

/** Smaller value is better (distance, ETA, cost, utilization) */
function normMin(value: number, max: number): number {
  if (max <= 0) return 1;
  return Math.max(0, 1 - value / max);
}

/** Larger value is better (rating, capacity match) */
function normMax(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, value / max);
}

/* ─────────────────────────────────────────────────────────────
   SLA urgency factor
   Returns 0 (no urgency) → 1 (SLA already breached)
───────────────────────────────────────────────────────────── */
export function urgencyFactor(slaDeadline?: Date): number {
  if (!slaDeadline) return 0;
  const minutesUntil = (slaDeadline.getTime() - Date.now()) / 60_000;
  if (minutesUntil <= 0)   return 1;   // already breached
  if (minutesUntil >= 120) return 0;   // > 2 hours: no urgency
  return 1 - minutesUntil / 120;
}

/**
 * Apply urgency boost to ETA weight.
 * As urgency increases, ETA weight grows by up to +0.20,
 * proportionally reducing all other weights.
 */
function applyUrgencyBoost(w: DispatchWeights, urgency: number): DispatchWeights {
  const etaBoost = urgency * 0.20;
  const scale    = 1 - etaBoost;
  return {
    ...w,
    distance:     (w.distance     ?? 0) * scale,
    eta:          (w.eta          ?? 0) + etaBoost,
    rating:       (w.rating       ?? 0) * scale,
    cost:         (w.cost         ?? 0) * scale,
    load:         (w.load         ?? 0) * scale,
    skill:        (w.skill        ?? 0) * scale,
    equipment:    (w.equipment    ?? 0),  // never scale equipment for safety reasons
    crewReadiness:(w.crewReadiness ?? 0),
    reliability:  (w.reliability  ?? 0) * scale,
  };
}

/* ─────────────────────────────────────────────────────────────
   Per-candidate scoring
───────────────────────────────────────────────────────────── */

export function scoreCandidate(
  candidate:     Candidate,
  job:           DispatchJob,
  weights:       DispatchWeights,
  allCandidates: Candidate[],
): { score: number; breakdown: Record<string, number> } {

  const urgency = urgencyFactor(job.slaDeadline ? new Date(job.slaDeadline) : undefined);
  const w = applyUrgencyBoost(weights, urgency);

  // Reference maxima across the pool (for normalization)
  const maxDist = Math.max(...allCandidates.map(c => c.distanceKm), 1);
  const maxETA  = Math.max(...allCandidates.map(c => c.etaMinutes),  1);
  const maxCost = Math.max(...allCandidates.map(c => c.costPerKm),   1);
  const maxCap  = Math.max(...allCandidates.map(c => c.vehicleCapacity), 1);

  // Base score components
  const distScore  = normMin(candidate.distanceKm,  maxDist);
  const etaScore   = normMin(candidate.etaMinutes,  maxETA);
  const rateScore  = normMax(candidate.driverRating, 5);
  const costScore  = normMin(candidate.costPerKm,   maxCost);
  const loadScore  = normMax(candidate.vehicleCapacity, maxCap);
  const utilScore  = normMin(candidate.utilizationScore ?? 0, 1); // prefer less-utilized

  // Skill match (technician)
  const requiredSkills = ((job.metadata as Record<string, unknown>)?.requiredSkills as string[] | undefined) ?? [];
  const candidateSkills = candidate.skillTags ?? [];
  const skillScore = requiredSkills.length > 0
    ? requiredSkills.filter(sk => candidateSkills.includes(sk)).length / requiredSkills.length
    : 1;

  // Equipment match (ambulance)
  const requiredEquip  = ((job.metadata as Record<string, unknown>)?.requiredEquipment as string[] | undefined) ?? [];
  const onBoard        = candidate.equipmentTags ?? [];
  const equipScore     = requiredEquip.length > 0
    ? requiredEquip.filter(eq => onBoard.includes(eq)).length / requiredEquip.length
    : 1;

  // Crew readiness — proxy via driver rating for now; extend with fatigue model
  const crewScore = rateScore;

  // Reliability — proxy via driver rating (extend with historical completion rate)
  const reliabilityScore = rateScore;

  // Zone bonus: 5% boost for same-zone dispatch
  const zoneBonus = (!job.zoneId || candidate.zoneId === job.zoneId) ? 0.05 : 0;

  const breakdown: Record<string, number> = {
    distance:     distScore,
    eta:          etaScore,
    rating:       rateScore,
    cost:         costScore,
    load:         loadScore,
    utilization:  utilScore,
    skill:        skillScore,
    equipment:    equipScore,
    crewReadiness: crewScore,
    reliability:  reliabilityScore,
    urgency,
    zoneBonus,
  };

  const raw =
    (w.distance      ?? 0) * distScore  +
    (w.eta           ?? 0) * etaScore   +
    (w.rating        ?? 0) * rateScore  +
    (w.cost          ?? 0) * costScore  +
    (w.load          ?? 0) * loadScore  +
    (w.skill         ?? 0) * skillScore +
    (w.equipment     ?? 0) * equipScore +
    (w.crewReadiness ?? 0) * crewScore  +
    (w.reliability   ?? 0) * reliabilityScore +
    zoneBonus;

  return { score: Math.min(1, Math.max(0, raw)), breakdown };
}

/* ─────────────────────────────────────────────────────────────
   Rank entire pool
───────────────────────────────────────────────────────────── */

export function rankCandidates(
  candidates: Candidate[],
  job:        DispatchJob,
  weights:    DispatchWeights,
): Candidate[] {
  return candidates
    .map(c => {
      const { score, breakdown } = scoreCandidate(c, job, weights, candidates);
      return { ...c, score, scoreBreakdown: breakdown };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
