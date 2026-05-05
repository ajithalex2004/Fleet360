/**
 * Predictive Maintenance — Statistical Scoring Model
 * ---------------------------------------------------
 * Five-factor weighted model. No LLM required.
 * Each factor returns a score 0.000–1.000.
 * Composite score = weighted sum of factors.
 *
 * Factor weights:
 *   Service Overdue       35%  (most predictive of near-term failure)
 *   Fuel Anomaly          25%  (consumption spike = engine/fuel system issue)
 *   Work Order Frequency  20%  (high WO rate = chronic underlying problem)
 *   Vehicle Age           10%  (older vehicles need more attention)
 *   Odometer Reading      10%  (high mileage = cumulative wear)
 */

import {
  MaintenanceAction,
  MaintenanceRiskFactors,
  RiskLevel,
  VehicleRiskScore,
} from '../types';

// ── Configuration ──────────────────────────────────────────────────────────────
const WEIGHTS = {
  serviceOverdue:      0.35,
  fuelAnomaly:         0.25,
  workOrderFrequency:  0.20,
  vehicleAge:          0.10,
  odometer:            0.10,
};

const SERVICE_INTERVAL_DAYS = 90;   // standard service every 90 days
const SERVICE_INTERVAL_KM   = 10_000; // or every 10,000 km

// ── Factor: Service Overdue ────────────────────────────────────────────────────
export function calcServiceOverdueScore(
  daysSinceLastService: number,
  kmSinceLastService: number,
): { score: number; daysSince: number; kmSince: number } {
  // Normalise each dimension: 0 = on schedule, 1 = 2x overdue
  const daysFraction = Math.min(daysSinceLastService / SERVICE_INTERVAL_DAYS, 2) / 2;
  const kmFraction   = Math.min(kmSinceLastService   / SERVICE_INTERVAL_KM,   2) / 2;
  // Take the worse of the two
  const score = Math.min(Math.max(daysFraction, kmFraction), 1);
  return { score, daysSince: daysSinceLastService, kmSince: kmSinceLastService };
}

// ── Factor: Fuel Consumption Anomaly ──────────────────────────────────────────
// Uses a simple ratio comparison: recent 30-day avg vs 90-day baseline
export function calcFuelAnomalyScore(
  baselineLitersPer100km: number | null,  // 90-day historical average
  recentLitersPer100km:   number | null,  // last 30-day average
): { score: number; baseline: number; recent: number } {
  const baseline = baselineLitersPer100km ?? 0;
  const recent   = recentLitersPer100km   ?? 0;

  if (baseline === 0 || recent === 0) {
    return { score: 0, baseline, recent };
  }

  const ratio = recent / baseline;
  // 1.0 = normal, 1.2 = 20% spike → 0.4 score, 1.5 = 50% spike → 1.0 score
  let score = 0;
  if (ratio >= 1.5) score = 1.0;
  else if (ratio >= 1.3) score = 0.7;
  else if (ratio >= 1.2) score = 0.5;
  else if (ratio >= 1.1) score = 0.3;
  else if (ratio >= 1.05) score = 0.1;

  return { score: Math.min(score, 1), baseline, recent };
}

// ── Factor: Work Order Frequency ──────────────────────────────────────────────
export function calcWorkOrderFrequencyScore(
  openWorkOrders:      number,
  workOrdersLast90Days: number,
  avgWorkOrdersPer90Days: number, // fleet-wide average
): { score: number; open: number } {
  // Open WOs alone: each open WO adds 0.15, capped at 0.6
  const openScore = Math.min(openWorkOrders * 0.15, 0.6);
  // Recent WOs vs fleet average: 2x average = 0.4 additional score
  const avgComparison = avgWorkOrdersPer90Days > 0
    ? Math.min((workOrdersLast90Days / avgWorkOrdersPer90Days - 1) * 0.4, 0.4)
    : 0;
  const score = Math.min(openScore + Math.max(avgComparison, 0), 1);
  return { score, open: openWorkOrders };
}

// ── Factor: Vehicle Age ────────────────────────────────────────────────────────
export function calcVehicleAgeScore(ageYears: number): { score: number; ageYears: number } {
  let score: number;
  if      (ageYears < 2)  score = 0.05;
  else if (ageYears < 4)  score = 0.2;
  else if (ageYears < 6)  score = 0.4;
  else if (ageYears < 8)  score = 0.65;
  else if (ageYears < 10) score = 0.8;
  else                    score = 1.0;
  return { score, ageYears };
}

// ── Factor: Odometer Reading ──────────────────────────────────────────────────
export function calcOdometerScore(odometer: number): { score: number; odometer: number } {
  let score: number;
  if      (odometer < 50_000)  score = 0.05;
  else if (odometer < 100_000) score = 0.25;
  else if (odometer < 150_000) score = 0.5;
  else if (odometer < 200_000) score = 0.75;
  else                          score = 1.0;
  return { score, odometer };
}

// ── Composite Score ────────────────────────────────────────────────────────────
export function computeCompositeScore(factors: {
  serviceOverdueScore:     number;
  fuelAnomalyScore:        number;
  workOrderFrequency:      number;
  vehicleAgeFactor:        number;
  odometerFactor:          number;
}): number {
  return (
    factors.serviceOverdueScore  * WEIGHTS.serviceOverdue     +
    factors.fuelAnomalyScore     * WEIGHTS.fuelAnomaly        +
    factors.workOrderFrequency   * WEIGHTS.workOrderFrequency +
    factors.vehicleAgeFactor     * WEIGHTS.vehicleAge         +
    factors.odometerFactor       * WEIGHTS.odometer
  );
}

// ── Risk Level Thresholds ─────────────────────────────────────────────────────
export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 0.75) return 'CRITICAL';
  if (score >= 0.50) return 'HIGH';
  if (score >= 0.25) return 'MEDIUM';
  return 'LOW';
}

export function riskLevelToAction(level: RiskLevel): MaintenanceAction {
  switch (level) {
    case 'CRITICAL': return 'GROUND_VEHICLE';
    case 'HIGH':     return 'URGENT_SERVICE';
    case 'MEDIUM':   return 'SCHEDULE_SERVICE';
    default:         return 'MONITOR';
  }
}

export function scoreToFailureWindow(score: number): string {
  if (score >= 0.80) return '0–7 days';
  if (score >= 0.65) return '7–14 days';
  if (score >= 0.50) return '14–30 days';
  if (score >= 0.35) return '30–60 days';
  if (score >= 0.25) return '60–90 days';
  return 'No immediate risk';
}

// ── Master Scorer ─────────────────────────────────────────────────────────────
export interface VehicleInput {
  id: string;
  vehicleCode: string;
  make: string;
  model: string;
  licensePlate: string;
  purchaseDate: string | null;
  odometerReading: number | null;
  // Computed from joins:
  daysSinceLastService: number;
  kmSinceLastService: number;
  baselineFuelLper100: number | null;
  recentFuelLper100: number | null;
  openWorkOrders: number;
  workOrdersLast90Days: number;
}

export function scoreVehicle(
  v: VehicleInput,
  fleetAvgWorkOrdersPer90Days: number,
): VehicleRiskScore {
  const purchaseDate = v.purchaseDate ? new Date(v.purchaseDate) : null;
  const ageMs   = purchaseDate ? Date.now() - purchaseDate.getTime() : 0;
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);

  const serviceResult  = calcServiceOverdueScore(v.daysSinceLastService, v.kmSinceLastService);
  const fuelResult     = calcFuelAnomalyScore(v.baselineFuelLper100, v.recentFuelLper100);
  const woResult       = calcWorkOrderFrequencyScore(v.openWorkOrders, v.workOrdersLast90Days, fleetAvgWorkOrdersPer90Days);
  const ageResult      = calcVehicleAgeScore(ageYears);
  const odomResult     = calcOdometerScore(v.odometerReading ?? 0);

  const raw = computeCompositeScore({
    serviceOverdueScore:  serviceResult.score,
    fuelAnomalyScore:     fuelResult.score,
    workOrderFrequency:   woResult.score,
    vehicleAgeFactor:     ageResult.score,
    odometerFactor:       odomResult.score,
  });

  const riskScore = parseFloat(raw.toFixed(3));
  const riskLevel = scoreToRiskLevel(riskScore);

  const factors: MaintenanceRiskFactors = {
    serviceOverdue:          serviceResult.score,
    fuelAnomalyScore:        fuelResult.score,
    workOrderFrequency:      woResult.score,
    vehicleAgeFactor:        ageResult.score,
    odometerFactor:          odomResult.score,
    serviceOverdueDays:      serviceResult.daysSince,
    serviceOverdueKm:        serviceResult.kmSince,
    fuelConsumptionBaseline: fuelResult.baseline,
    fuelConsumptionRecent:   fuelResult.recent,
    openWorkOrders:          woResult.open,
    vehicleAgeYears:         ageResult.ageYears,
    odometerKm:              odomResult.odometer,
  };

  return {
    vehicleId:             v.id,
    vehicleCode:           v.vehicleCode,
    make:                  v.make,
    model:                 v.model,
    licensePlate:          v.licensePlate,
    riskScore,
    riskLevel,
    factors,
    recommendedAction:     riskLevelToAction(riskLevel),
    predictedFailureWindow: scoreToFailureWindow(riskScore),
    scoredAt:              new Date().toISOString(),
  };
}
