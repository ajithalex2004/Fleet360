/**
 * Smart Dispatch Optimiser — 15-Factor Semi-Autonomous Scoring Model v2.1.0
 * --------------------------------------------------------------------------
 * Scores each (driver, vehicle, job) triplet across 15 operational factors.
 * Includes hard compliance disqualification gates, deadhead distance minimization,
 * live HOS shift verification, maintenance health index integration,
 * adaptive spatial candidate pre-filtering, and Top-K road matrix refinement.
 *
 * Factors and weights:
 *  1. proximity          0.20  — Haversine/road distance driver/vehicle → pickup
 *  2. eta_estimate       0.15  — Estimated travel time vs SLA window
 *  3. skill_match        0.12  — Driver license class matches vehicle/job type
 *  4. vehicle_capacity   0.08  — Vehicle seating & load coverage
 *  5. vehicle_type_match 0.08  — Vehicle category suitable for service type
 *  6. hos_compliance     0.10  — Live shift hours remaining vs trip duration + return
 *  7. deadhead_cost      0.08  — Repositioning distance from dropoff to base/zone
 *  8. vehicle_condition  0.06  — Predictive maintenance risk score (low risk = high score)
 *  9. compliance_status  0.05  — Valid vehicle Mulkiya, insurance, driver certification
 * 10. fatigue_score      0.04  — Inverse of driver fatigue telemetry
 * 11. rag_score          0.04  — Driver performance and safety rating
 * 12. sla_urgency        0.04  — Time remaining before customer SLA breach
 * 13. load_balance       0.02  — Workload distribution across drivers
 * 14. language_match     0.01  — Driver language vs customer preference
 * 15. route_familiarity  0.01  — Driver operating zone familiarity
 *     Total = 1.00
 */

import { routingIntelligence } from '@/lib/routing/intelligence-service';

export interface DriverCandidate {
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleCode: string;
  vehicleType: string;
  capacity: number;
  currentLat: number | null;
  currentLng: number | null;
  avgSpeedKmh: number;
  hoursRemainingToday: number;   // Live HOS hours remaining
  ragScore: number | null;       // 0–100 performance score
  fatigueScore: number | null;   // 0–1 (0=fresh, 1=exhausted)
  currentJobCount: number;
  languages: string[];
  licenseClasses: string[];      // ['LIGHT', 'BUS', 'HEAVY', 'MOTORCYCLE']
  vehicleRiskScore: number;      // 0–1 from predictive maintenance
  zonesServed: string[];
  // Compliance & Registration
  isVehicleRegistered: boolean;
  isVehicleInsured: boolean;
  isDriverLicensed: boolean;
  baseDepotLat?: number | null;
  baseDepotLng?: number | null;
}

export interface JobRequirements {
  jobId: string;
  serviceType: string;
  priority: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  requiredCapacity: number;
  requiredVehicleTypes: string[];  // [] = any
  requiredLicenseClass: string | null;
  slaDeadline: Date | null;
  estimatedDurationMin: number;
  customerLanguage: string | null;
  zoneId: string | null;
}

export interface FactorScores {
  proximity: number;
  etaEstimate: number;
  skillMatch: number;
  vehicleCapacity: number;
  vehicleTypeMatch: number;
  hosCompliance: number;
  deadheadCost: number;
  vehicleCondition: number;
  complianceStatus: number;
  fatigueScore: number;
  ragScore: number;
  slaUrgency: number;
  loadBalance: number;
  languageMatch: number;
  routeFamiliarity: number;
}

export interface ScoredCandidate {
  driverId: string;
  vehicleId: string;
  driverName: string;
  vehicleCode: string;
  compositeScore: number;
  factors: FactorScores;
  rank: number;
  reason: string;
  isBlocked: boolean;
  blockReason?: string;
  distanceKm: number;
  etaMinutes: number;
  hoursRemaining: number;
  autoDispatchEligible: boolean;
  isMatrixRefined?: boolean;
}

export const WEIGHTS: Record<keyof FactorScores, number> = {
  proximity:        0.20,
  etaEstimate:      0.15,
  skillMatch:       0.12,
  vehicleCapacity:  0.08,
  vehicleTypeMatch: 0.08,
  hosCompliance:    0.10,
  deadheadCost:     0.08,
  vehicleCondition: 0.06,
  complianceStatus: 0.05,
  fatigueScore:     0.04,
  ragScore:         0.04,
  slaUrgency:       0.04,
  loadBalance:      0.02,
  languageMatch:    0.01,
  routeFamiliarity: 0.01,
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

function clamp(v: number): number { return Math.max(0, Math.min(1, v)); }

function createBlockedCandidate(candidate: DriverCandidate, reason: string): ScoredCandidate {
  return {
    driverId: candidate.driverId,
    vehicleId: candidate.vehicleId,
    driverName: candidate.driverName,
    vehicleCode: candidate.vehicleCode,
    compositeScore: 0,
    factors: {
      proximity: 0, etaEstimate: 0, skillMatch: 0, vehicleCapacity: 0,
      vehicleTypeMatch: 0, hosCompliance: 0, deadheadCost: 0, vehicleCondition: 0,
      complianceStatus: 0, fatigueScore: 0, ragScore: 0, slaUrgency: 0,
      loadBalance: 0, languageMatch: 0, routeFamiliarity: 0,
    },
    rank: 0,
    reason: `DISQUALIFIED: ${reason}`,
    isBlocked: true,
    blockReason: reason,
    distanceKm: 0,
    etaMinutes: 0,
    hoursRemaining: candidate.hoursRemainingToday,
    autoDispatchEligible: false,
  };
}

export function computeComposite(factors: FactorScores): number {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (factors[key as keyof FactorScores] ?? 0) * weight;
  }
  return parseFloat(total.toFixed(4));
}

/**
 * Filters a pool of candidate drivers/vehicles using spatial shortlisting with adaptive radius expansion.
 */
export function spatialShortlistCandidates(
  candidates: DriverCandidate[],
  job: JobRequirements,
  options: { maxCandidates?: number; initialRadiusKm?: number; minCandidates?: number } = {},
): DriverCandidate[] {
  const origin = { lat: job.pickupLat, lng: job.pickupLng };
  const candidateItems = candidates.map(c => ({
    item: c,
    lat: c.currentLat ?? 25.2048,
    lng: c.currentLng ?? 55.2708,
  }));

  const shortlisted = routingIntelligence.spatialShortlist(origin, candidateItems, {
    maxCandidates: options.maxCandidates ?? 20,
    initialRadiusKm: options.initialRadiusKm ?? 10,
    minCandidates: options.minCandidates ?? 3,
    adaptiveExpansion: true,
  });

  return shortlisted.selected.map(s => s.item);
}

export function scoreCandidate(
  candidate: DriverCandidate,
  job: JobRequirements,
  routingOverrides?: { distanceKm?: number; etaMinutes?: number; isMatrixRefined?: boolean },
): ScoredCandidate {
  // ── Hard Disqualification Gates (Blockers) ───────────────────────────────────
  if (!candidate.isVehicleRegistered) {
    return createBlockedCandidate(candidate, 'Vehicle registration / Mulkiya is expired or invalid');
  }
  if (!candidate.isVehicleInsured) {
    return createBlockedCandidate(candidate, 'Vehicle insurance is expired or unverified');
  }
  if (!candidate.isDriverLicensed) {
    return createBlockedCandidate(candidate, 'Driver commercial license is expired or invalid');
  }
  if (candidate.vehicleRiskScore >= 0.75) {
    return createBlockedCandidate(candidate, `Critical vehicle failure risk (${Math.round(candidate.vehicleRiskScore * 100)}%)`);
  }
  if (candidate.fatigueScore !== null && candidate.fatigueScore >= 0.80) {
    return createBlockedCandidate(candidate, 'Driver fatigue exceeds safety threshold (>= 80%)');
  }

  // 1. Proximity (0 km = 1.0, 40 km+ = 0.0)
  let proximity = 0.5;
  let distanceKm = routingOverrides?.distanceKm ?? 10.0;
  let etaMinutes = routingOverrides?.etaMinutes ?? 15;

  if (routingOverrides?.distanceKm !== undefined && routingOverrides?.etaMinutes !== undefined) {
    distanceKm = routingOverrides.distanceKm;
    etaMinutes = routingOverrides.etaMinutes;
    proximity = clamp(1 - distanceKm / 40);
  } else if (candidate.currentLat !== null && candidate.currentLng !== null) {
    distanceKm = parseFloat(haversineKm(candidate.currentLat, candidate.currentLng, job.pickupLat, job.pickupLng).toFixed(1));
    proximity = clamp(1 - distanceKm / 40);
    etaMinutes = Math.round((distanceKm / (candidate.avgSpeedKmh || 40)) * 60);
  }

  // 2. ETA estimate vs SLA window
  let etaEstimate = 0.5;
  if (job.slaDeadline) {
    const windowMin = (job.slaDeadline.getTime() - Date.now()) / 60000;
    if (windowMin <= 0) {
      etaEstimate = 0.1; // SLA already breached or imminent
    } else {
      etaEstimate = clamp((windowMin - etaMinutes) / windowMin);
    }
  } else {
    etaEstimate = clamp(1 - (etaMinutes / 60));
  }

  // 3. Skill match — license class
  const skillMatch = job.requiredLicenseClass
    ? (candidate.licenseClasses.includes(job.requiredLicenseClass) ? 1.0 : 0.0)
    : 1.0;

  // 4. Vehicle capacity
  const vehicleCapacity = job.requiredCapacity > 0
    ? (candidate.capacity >= job.requiredCapacity ? 1.0 : candidate.capacity / job.requiredCapacity)
    : 1.0;

  // 5. Vehicle type match
  let vehicleTypeMatch = 0.5;
  if (job.requiredVehicleTypes.length === 0) {
    vehicleTypeMatch = 1.0;
  } else {
    const typeNorm = candidate.vehicleType.toLowerCase();
    vehicleTypeMatch = job.requiredVehicleTypes.some(t => typeNorm.includes(t.toLowerCase())) ? 1.0 : 0.1;
  }

  // 6. Live HOS compliance (Shift hours remaining vs trip duration)
  const tripHours = job.estimatedDurationMin / 60;
  const hosCompliance = candidate.hoursRemainingToday < tripHours
    ? 0.0
    : clamp(candidate.hoursRemainingToday / (tripHours * 1.5));

  // 7. Deadhead & Repositioning Distance
  let deadheadCost = 0.8;
  if (job.dropoffLat && job.dropoffLng && candidate.baseDepotLat && candidate.baseDepotLng) {
    const returnKm = haversineKm(job.dropoffLat, job.dropoffLng, candidate.baseDepotLat, candidate.baseDepotLng);
    deadheadCost = clamp(1 - (returnKm / 50));
  }

  // 8. Vehicle Condition (Maintenance Health)
  const vehicleCondition = clamp(1 - candidate.vehicleRiskScore);

  // 9. Compliance Status
  const complianceStatus = (candidate.isVehicleRegistered && candidate.isVehicleInsured && candidate.isDriverLicensed) ? 1.0 : 0.0;

  // 10. Fatigue Score
  const fatigueScore = clamp(1 - (candidate.fatigueScore ?? 0.2));

  // 11. RAG Performance Rating
  const ragScore = candidate.ragScore !== null ? clamp(candidate.ragScore / 100) : 0.75;

  // 12. SLA Urgency
  const slaUrgency = job.slaDeadline
    ? clamp(1 - ((job.slaDeadline.getTime() - Date.now()) / (3 * 3600 * 1000)))
    : 0.5;

  // 13. Load Balance
  const loadBalance = clamp(1 - (candidate.currentJobCount / 3));

  // 14. Language Match
  const languageMatch = job.customerLanguage
    ? (candidate.languages.includes(job.customerLanguage) ? 1.0 : 0.3)
    : 1.0;

  // 15. Route / Zone Familiarity
  const routeFamiliarity = job.zoneId && candidate.zonesServed.includes(job.zoneId) ? 1.0 : 0.5;

  const factors: FactorScores = {
    proximity,
    etaEstimate,
    skillMatch,
    vehicleCapacity,
    vehicleTypeMatch,
    hosCompliance,
    deadheadCost,
    vehicleCondition,
    complianceStatus,
    fatigueScore,
    ragScore,
    slaUrgency,
    loadBalance,
    languageMatch,
    routeFamiliarity,
  };

  const compositeScore = computeComposite(factors);
  const autoDispatchEligible = compositeScore >= 0.85;

  const candidateResult: ScoredCandidate = {
    driverId: candidate.driverId,
    vehicleId: candidate.vehicleId,
    driverName: candidate.driverName,
    vehicleCode: candidate.vehicleCode,
    compositeScore,
    factors,
    rank: 0,
    reason: '',
    isBlocked: false,
    distanceKm,
    etaMinutes,
    hoursRemaining: candidate.hoursRemainingToday,
    autoDispatchEligible,
    isMatrixRefined: routingOverrides?.isMatrixRefined ?? false,
  };

  candidateResult.reason = buildReason(candidateResult, job);
  return candidateResult;
}

export function rankCandidates(candidates: DriverCandidate[], job: JobRequirements): ScoredCandidate[] {
  const scored = candidates.map(c => scoreCandidate(c, job));

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    reason: s.isBlocked
      ? `DISQUALIFIED: ${s.blockReason}`
      : buildReason(s, job),
  }));
}

/**
 * Full Phase 3 Optimized Ranking Pipeline:
 *  1. Spatial Pre-Filter (prunes hundreds of vehicles to Top-20)
 *  2. Initial Heuristic Scoring (identifies Top-5 policy candidates)
 *  3. Routing Intelligence Road Matrix Refinement (on Top-5)
 *  4. Final Ranking with Cost Avoidance Telemetry
 */
export async function rankCandidatesWithRouting(
  candidates: DriverCandidate[],
  job: JobRequirements,
  options: {
    maxCandidates?: number;
    topKRefineMatrix?: number;
    tenantId?: string;
  } = {},
): Promise<{
  ranked: ScoredCandidate[];
  rawCount: number;
  spatiallyFilteredCount: number;
  matrixElementsQueried: number;
  cacheHits: number;
  costAvoidedAed: number;
}> {
  const rawCount = candidates.length;
  if (rawCount === 0) {
    return {
      ranked: [],
      rawCount: 0,
      spatiallyFilteredCount: 0,
      matrixElementsQueried: 0,
      cacheHits: 0,
      costAvoidedAed: 0,
    };
  }

  // 1. Spatial Shortlist
  const maxSpatial = options.maxCandidates ?? 20;
  const spatiallyFiltered = spatialShortlistCandidates(candidates, job, {
    maxCandidates: maxSpatial,
    initialRadiusKm: 10,
    minCandidates: 3,
  });

  // 2. Initial Heuristic Scoring on Shortlisted Pool
  const initialRanked = rankCandidates(spatiallyFiltered, job);

  // 3. Select Top-K candidates for road matrix refinement
  const topKCount = options.topKRefineMatrix ?? 5;
  const topCandidates = initialRanked.slice(0, topKCount).filter(c => !c.isBlocked);

  let matrixElementsQueried = 0;
  let cacheHits = 0;
  let costAvoidedAed = 0;

  const candidateMap = new Map(spatiallyFiltered.map(c => [c.driverId, c]));
  const refinedResults = new Map<string, ScoredCandidate>();

  for (const tc of topCandidates) {
    const rawCandidate = candidateMap.get(tc.driverId);
    if (!rawCandidate || rawCandidate.currentLat === null || rawCandidate.currentLng === null) continue;

    try {
      matrixElementsQueried++;
      const travel = await routingIntelligence.getTravelTime(
        { lat: rawCandidate.currentLat, lng: rawCandidate.currentLng },
        { lat: job.pickupLat, lng: job.pickupLng },
        {
          tier: 'TRAFFIC_DYNAMIC',
          tenantId: options.tenantId,
        },
      );

      if (travel.isCacheHit) {
        cacheHits++;
        costAvoidedAed += 0.05; // 0.05 AED standard avoided matrix cost
      }

      const refined = scoreCandidate(rawCandidate, job, {
        distanceKm: travel.distanceKm,
        etaMinutes: travel.durationMin,
        isMatrixRefined: true,
      });

      refinedResults.set(tc.driverId, refined);
    } catch {
      // Fall back gracefully to initial heuristic score
      refinedResults.set(tc.driverId, tc);
    }
  }

  // Combine refined top-K candidates with remaining initial candidates
  const combined = initialRanked.map(c => refinedResults.get(c.driverId) ?? c);
  combined.sort((a, b) => b.compositeScore - a.compositeScore);

  const finalRanked = combined.map((s, i) => ({
    ...s,
    rank: i + 1,
    reason: s.isBlocked
      ? `DISQUALIFIED: ${s.blockReason}`
      : buildReason(s, job),
  }));

  return {
    ranked: finalRanked,
    rawCount,
    spatiallyFilteredCount: spatiallyFiltered.length,
    matrixElementsQueried,
    cacheHits,
    costAvoidedAed: parseFloat(costAvoidedAed.toFixed(4)),
  };
}

function buildReason(s: ScoredCandidate, job: JobRequirements): string {
  const parts: string[] = [];

  const matrixTag = s.isMatrixRefined ? ' (Road Matrix)' : '';
  parts.push(`${s.vehicleCode} is ${s.distanceKm} km away (ETA ${s.etaMinutes} mins${matrixTag})`);
  parts.push(`Driver ${s.driverName} has ${s.hoursRemaining.toFixed(1)}h shift remaining`);
  if (s.factors.vehicleCondition >= 0.85) parts.push('Vehicle Health 90%+');
  if (s.factors.skillMatch === 1.0 && job.requiredLicenseClass) parts.push(`Class ${job.requiredLicenseClass} License`);

  return parts.join(' · ');
}
