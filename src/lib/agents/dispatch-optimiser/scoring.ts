/**
 * Dispatch Optimiser — 15-Factor Scoring Model
 * -----------------------------------------------
 * Scores each (driver, vehicle, job) triplet 0–1 across 15 factors.
 * Fully statistical — no LLM required for scoring.
 *
 * Factors and weights:
 *  1. proximity          0.20  — haversine distance driver → pickup
 *  2. eta_estimate       0.15  — estimated travel time vs SLA window
 *  3. skill_match        0.12  — driver license class matches vehicle/job type
 *  4. vehicle_capacity   0.08  — vehicle capacity covers job load
 *  5. vehicle_type_match 0.08  — vehicle type suitable for service type
 *  6. hos_compliance     0.10  — hours-of-service hours remaining vs trip duration
 *  7. fatigue_score      0.08  — inverse of current fatigue level (from RAG)
 *  8. rag_score          0.06  — driver performance rating
 *  9. sla_urgency        0.05  — time remaining before SLA breach
 * 10. load_balance       0.04  — prefer less-loaded drivers
 * 11. language_match     0.02  — driver language vs customer preference
 * 12. vehicle_condition  0.01  — vehicle risk score (lower risk = better)
 * 13. cost_efficiency    0.00  — reserved, not yet scored (always 0.5)
 * 14. route_familiarity  0.01  — driver previously drove this zone
 *     Total = 1.00
 */

export interface DriverCandidate {
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleCode: string;
  vehicleType: string;
  capacity: number;
  currentLat: number | null;
  currentLng: number | null;
  avgSpeedKmh: number;          // historical average
  hoursRemainingToday: number;  // HOS hours before mandatory rest
  ragScore: number | null;      // 0–100
  fatigueScore: number | null;  // 0–1 (0=fresh, 1=exhausted)
  currentJobCount: number;      // jobs currently in progress
  languages: string[];          // e.g. ['ar', 'en']
  licenseClasses: string[];     // e.g. ['B', 'D']
  vehicleRiskScore: number;     // 0–1 from predictive maintenance
  zonesServed: string[];        // zone_ids this driver frequently services
}

export interface JobRequirements {
  jobId: string;
  serviceType: string;
  priority: string;
  pickupLat: number;
  pickupLng: number;
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
  fatigueScore: number;
  ragScore: number;
  slaUrgency: number;
  loadBalance: number;
  languageMatch: number;
  vehicleCondition: number;
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
}

const WEIGHTS: Record<keyof FactorScores, number> = {
  proximity:        0.20,
  etaEstimate:      0.15,
  skillMatch:       0.12,
  vehicleCapacity:  0.08,
  vehicleTypeMatch: 0.08,
  hosCompliance:    0.10,
  fatigueScore:     0.08,
  ragScore:         0.06,
  slaUrgency:       0.05,
  loadBalance:      0.04,
  languageMatch:    0.02,
  vehicleCondition: 0.01,
  routeFamiliarity: 0.01,
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(v: number): number { return Math.max(0, Math.min(1, v)); }

export function scoreCandidate(candidate: DriverCandidate, job: JobRequirements): FactorScores {
  // 1. Proximity (0 km = 1.0, 50 km+ = 0.0)
  let proximity = 0.5;
  if (candidate.currentLat !== null && candidate.currentLng !== null) {
    const dist = haversineKm(candidate.currentLat, candidate.currentLng, job.pickupLat, job.pickupLng);
    proximity = clamp(1 - dist / 50);
  }

  // 2. ETA estimate vs SLA window
  let etaEstimate = 0.5;
  if (candidate.currentLat !== null && candidate.currentLng !== null && job.slaDeadline) {
    const dist = haversineKm(candidate.currentLat, candidate.currentLng, job.pickupLat, job.pickupLng);
    const etaMin = (dist / (candidate.avgSpeedKmh || 40)) * 60;
    const windowMin = (job.slaDeadline.getTime() - Date.now()) / 60000;
    const slackRatio = windowMin > 0 ? clamp((windowMin - etaMin) / windowMin) : 0;
    etaEstimate = slackRatio;
  }

  // 3. Skill match — license class
  const skillMatch = job.requiredLicenseClass
    ? (candidate.licenseClasses.includes(job.requiredLicenseClass) ? 1.0 : 0.0)
    : 1.0;

  // 4. Vehicle capacity
  const vehicleCapacity = job.requiredCapacity > 0
    ? clamp(candidate.capacity / job.requiredCapacity > 1
        ? 1.0
        : candidate.capacity / job.requiredCapacity)
    : 1.0;

  // 5. Vehicle type match
  let vehicleTypeMatch = 0.5;
  if (job.requiredVehicleTypes.length === 0) {
    vehicleTypeMatch = 1.0;
  } else {
    const typeNorm = candidate.vehicleType.toLowerCase();
    vehicleTypeMatch = job.requiredVehicleTypes.some(t => typeNorm.includes(t.toLowerCase())) ? 1.0 : 0.1;
  }

  // 6. HOS compliance (hours remaining vs estimated trip duration)
  const tripHours = job.estimatedDurationMin / 60;
  const hosCompliance = candidate.hoursRemainingToday <= 0
    ? 0  // no hours left
    : clamp(candidate.hoursRemainingToday / Math.max(tripHours * 1.5, 2));

  // 7. Fatigue (0 = fresh → 1.0 score, 1 = exhausted → 0.0)
  const fatigueScore = clamp(1 - (candidate.fatigueScore ?? 0.3));

  // 8. RAG score (0–100 → 0–1)
  const ragScore = candidate.ragScore !== null ? clamp(candidate.ragScore / 100) : 0.6;

  // 9. SLA urgency — inverse (less time = higher urgency = must pick best candidate)
  //    For scoring, higher score = more reliable in urgent conditions
  const slaUrgency = job.slaDeadline
    ? clamp(1 - (Date.now() / job.slaDeadline.getTime()))
    : 0.5;

  // 10. Load balance (0 jobs = 1.0, 3+ = 0.0)
  const loadBalance = clamp(1 - candidate.currentJobCount / 3);

  // 11. Language match
  const languageMatch = job.customerLanguage
    ? (candidate.languages.includes(job.customerLanguage) ? 1.0 : 0.3)
    : 1.0;

  // 12. Vehicle condition (risk score: low risk = good condition)
  const vehicleCondition = clamp(1 - candidate.vehicleRiskScore);

  // 13. Route familiarity
  const routeFamiliarity = job.zoneId && candidate.zonesServed.includes(job.zoneId) ? 1.0 : 0.5;

  return {
    proximity, etaEstimate, skillMatch, vehicleCapacity, vehicleTypeMatch,
    hosCompliance, fatigueScore, ragScore, slaUrgency, loadBalance,
    languageMatch, vehicleCondition, routeFamiliarity,
  };
}

export function computeComposite(factors: FactorScores): number {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (factors[key as keyof FactorScores] ?? 0) * weight;
  }
  return parseFloat(total.toFixed(4));
}

export function rankCandidates(candidates: DriverCandidate[], job: JobRequirements): ScoredCandidate[] {
  const scored = candidates.map(c => {
    const factors = scoreCandidate(c, job);
    const compositeScore = computeComposite(factors);
    return { driverId: c.driverId, vehicleId: c.vehicleId, driverName: c.driverName, vehicleCode: c.vehicleCode, compositeScore, factors, rank: 0, reason: '' };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    reason: buildReason(s.factors, i === 0),
  }));
}

function buildReason(f: FactorScores, isTop: boolean): string {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (f.proximity > 0.7) strengths.push('close proximity');
  if (f.hosCompliance > 0.8) strengths.push('full HOS availability');
  if (f.ragScore > 0.8) strengths.push('high performance rating');
  if (f.fatigueScore > 0.8) strengths.push('well-rested driver');
  if (f.vehicleCondition > 0.8) strengths.push('excellent vehicle condition');
  if (f.skillMatch === 1.0) strengths.push('license class match');
  if (f.vehicleTypeMatch === 1.0) strengths.push('vehicle type match');

  if (f.hosCompliance < 0.3) weaknesses.push('low HOS hours');
  if (f.fatigueScore < 0.3) weaknesses.push('driver fatigue concern');
  if (f.proximity < 0.3) weaknesses.push('distant location');

  const parts: string[] = [];
  if (isTop && strengths.length) parts.push(`Best match: ${strengths.slice(0, 2).join(', ')}`);
  else if (strengths.length) parts.push(strengths.slice(0, 2).join(', '));
  if (weaknesses.length) parts.push(`⚠ ${weaknesses[0]}`);

  return parts.join(' · ') || 'Adequate match';
}
