/**
 * Predictive Maintenance — 9-Signal Advanced Failure Estimation Engine
 * ---------------------------------------------------------------------
 * Multi-dimensional hybrid statistical & physical degradation model.
 *
 * Evaluates:
 *   1. Service Overdue (Days & Km vs OEM Intervals)
 *   2. Fuel Consumption Anomaly (30d vs 90d Baseline Ratio)
 *   3. Work Order History (Open & Recent Maintenance Volume)
 *   4. Vehicle Age & Environmental Aging
 *   5. Odometer Cumulative Wear & Mileage Curve
 *   6. CAN-bus DTC Faults (SAE J2012 / J1939 Active Code Penalties)
 *   7. Telematics Live Sensor Anomalies (Coolant, Oil Pressure, Battery Voltage)
 *   8. Engine Operating Hours & Duty Cycle Stress (Idling / PTO Factor)
 *   9. Repeat Subsystem Failures & Component RUL (Remaining Useful Life)
 */

import {
  MaintenanceAction,
  MaintenanceRiskFactors,
  RiskLevel,
  VehicleRiskScore,
} from '../types';
import { EXTENDED_DTC_DICTIONARY } from '@/lib/telematics/canbus-diagnostics-engine';

// ── Base Weights Configuration ────────────────────────────────────────────────
const WEIGHTS = {
  serviceOverdue:       0.18,
  dtcFaults:            0.22,
  sensorAnomalies:      0.18,
  fuelAnomaly:          0.12,
  repeatFailures:       0.10,
  workOrderFrequency:   0.08,
  operatingHoursStress: 0.05,
  odometer:             0.04,
  vehicleAge:           0.03,
};

const SERVICE_INTERVAL_DAYS = 90;    // Standard service every 90 days
const SERVICE_INTERVAL_KM   = 10_000; // Or every 10,000 km

// ── Dimension 1: Service Overdue ──────────────────────────────────────────────
export function calcServiceOverdueScore(
  daysSinceLastService: number,
  kmSinceLastService: number,
): { score: number; daysSince: number; kmSince: number } {
  const daysFraction = Math.min(daysSinceLastService / SERVICE_INTERVAL_DAYS, 2.5) / 2.5;
  const kmFraction   = Math.min(kmSinceLastService   / SERVICE_INTERVAL_KM,   2.5) / 2.5;
  const score = Math.min(Math.max(daysFraction, kmFraction), 1);
  return { score, daysSince: daysSinceLastService, kmSince: kmSinceLastService };
}

// ── Dimension 2: Fuel Consumption Anomaly ─────────────────────────────────────
export function calcFuelAnomalyScore(
  baselineLitersPer100km: number | null,
  recentLitersPer100km:   number | null,
): { score: number; baseline: number; recent: number } {
  const baseline = baselineLitersPer100km ?? 0;
  const recent   = recentLitersPer100km   ?? 0;

  if (baseline === 0 || recent === 0) {
    return { score: 0, baseline, recent };
  }

  const ratio = recent / baseline;
  let score = 0;
  if (ratio >= 1.45) score = 1.0;
  else if (ratio >= 1.30) score = 0.75;
  else if (ratio >= 1.20) score = 0.50;
  else if (ratio >= 1.10) score = 0.30;
  else if (ratio >= 1.05) score = 0.15;

  return { score: Math.min(score, 1), baseline, recent };
}

// ── Dimension 3: Work Order Frequency ─────────────────────────────────────────
export function calcWorkOrderFrequencyScore(
  openWorkOrders: number,
  workOrdersLast90Days: number,
  avgWorkOrdersPer90Days: number,
): { score: number; open: number } {
  const openScore = Math.min(openWorkOrders * 0.20, 0.6);
  const avgComparison = avgWorkOrdersPer90Days > 0
    ? Math.min((workOrdersLast90Days / avgWorkOrdersPer90Days - 1) * 0.4, 0.4)
    : 0;
  const score = Math.min(openScore + Math.max(avgComparison, 0), 1);
  return { score, open: openWorkOrders };
}

// ── Dimension 4: Cumulative Mileage Curve ────────────────────────────────────
export function calcOdometerScore(odometer: number): { score: number; odometer: number } {
  let score: number;
  if      (odometer < 40_000)  score = 0.05;
  else if (odometer < 80_000)  score = 0.20;
  else if (odometer < 130_000) score = 0.45;
  else if (odometer < 180_000) score = 0.70;
  else if (odometer < 240_000) score = 0.88;
  else                         score = 1.0;
  return { score, odometer };
}

// ── Dimension 5: Vehicle Age ─────────────────────────────────────────────────
export function calcVehicleAgeScore(ageYears: number): { score: number; ageYears: number } {
  let score: number;
  if      (ageYears < 2)  score = 0.05;
  else if (ageYears < 4)  score = 0.20;
  else if (ageYears < 6)  score = 0.40;
  else if (ageYears < 8)  score = 0.65;
  else if (ageYears < 10) score = 0.85;
  else                    score = 1.0;
  return { score, ageYears };
}

// ── Dimension 6: CAN-bus DTC Fault Analysis ──────────────────────────────────
export function calcDtcFaultScore(dtcCodes: string[]): {
  score: number;
  criticalCount: number;
  majorCount: number;
  summary: string;
  penalties: number;
} {
  if (!dtcCodes || dtcCodes.length === 0) {
    return { score: 0, criticalCount: 0, majorCount: 0, summary: 'No active DTC faults', penalties: 0 };
  }

  let totalPenalty = 0;
  let criticalCount = 0;
  let majorCount = 0;

  for (const code of dtcCodes) {
    const def = EXTENDED_DTC_DICTIONARY[code];
    if (def) {
      totalPenalty += def.breakdownRiskPenalty;
      if (def.severity === 'CRITICAL') criticalCount++;
      if (def.severity === 'MAJOR') majorCount++;
    } else {
      totalPenalty += 15; // Unlisted DTC baseline penalty
      majorCount++;
    }
  }

  // If there is any critical DTC (e.g., P0217 Overheat, P0524 Low Oil Pressure), score is at least 0.85
  const normalizedScore = criticalCount > 0
    ? Math.min(0.85 + (totalPenalty / 200), 1.0)
    : Math.min(totalPenalty / 100, 0.80);

  const summary = `${dtcCodes.length} fault(s) [${criticalCount} Critical, ${majorCount} Major]`;
  return { score: parseFloat(normalizedScore.toFixed(3)), criticalCount, majorCount, summary, penalties: totalPenalty };
}

// ── Dimension 7: Live Telemetry Sensor Evaluation & Thermal Stress ───────────
export interface SensorInputs {
  coolantTempC?: number;
  oilPressureKpa?: number;
  batteryVoltage?: number;
  transmissionTempC?: number;
}

export function calcSensorAnomalyScore(sensors: SensorInputs): {
  score: number;
  warnings: string[];
  hasImmediateStopRisk: boolean;
} {
  const warnings: string[] = [];
  let score = 0;
  let hasImmediateStopRisk = false;

  // Coolant Temperature (Normal: 82°C - 98°C)
  if (sensors.coolantTempC !== undefined && sensors.coolantTempC !== null) {
    if (sensors.coolantTempC >= 110) {
      warnings.push(`CRITICAL: Coolant Overheat (${sensors.coolantTempC}°C > 110°C)`);
      score += 0.60;
      hasImmediateStopRisk = true;
    } else if (sensors.coolantTempC >= 102) {
      warnings.push(`WARNING: High Coolant Temperature (${sensors.coolantTempC}°C)`);
      score += 0.35;
    }
  }

  // Oil Pressure (Normal at load: 200 - 450 kPa, idle > 150 kPa)
  if (sensors.oilPressureKpa !== undefined && sensors.oilPressureKpa !== null) {
    if (sensors.oilPressureKpa < 120) {
      warnings.push(`CRITICAL: Loss of Engine Oil Pressure (${sensors.oilPressureKpa} kPa < 120 kPa)`);
      score += 0.70;
      hasImmediateStopRisk = true;
    } else if (sensors.oilPressureKpa < 170) {
      warnings.push(`WARNING: Low Oil Pressure (${sensors.oilPressureKpa} kPa)`);
      score += 0.30;
    }
  }

  // Battery / Alternator Voltage (Normal: 13.6V - 14.5V running, >12.4V resting)
  if (sensors.batteryVoltage !== undefined && sensors.batteryVoltage !== null) {
    if (sensors.batteryVoltage < 11.8) {
      warnings.push(`CRITICAL: Severe Electrical Under-voltage (${sensors.batteryVoltage}V < 11.8V)`);
      score += 0.40;
    } else if (sensors.batteryVoltage < 12.3) {
      warnings.push(`WARNING: Low Battery Voltage (${sensors.batteryVoltage}V)`);
      score += 0.20;
    } else if (sensors.batteryVoltage > 15.2) {
      warnings.push(`WARNING: Alternator Overvoltage Spike (${sensors.batteryVoltage}V)`);
      score += 0.25;
    }
  }

  // Transmission Temperature (Normal: 70°C - 95°C)
  if (sensors.transmissionTempC !== undefined && sensors.transmissionTempC !== null) {
    if (sensors.transmissionTempC >= 115) {
      warnings.push(`CRITICAL: Transmission Fluid Overheat (${sensors.transmissionTempC}°C)`);
      score += 0.45;
    } else if (sensors.transmissionTempC >= 102) {
      warnings.push(`WARNING: Elevated Transmission Temp (${sensors.transmissionTempC}°C)`);
      score += 0.25;
    }
  }

  return {
    score: Math.min(score, 1.0),
    warnings,
    hasImmediateStopRisk,
  };
}

// ── Dimension 8: Operating Hours & High-Idle Stress ───────────────────────────
export function calcOperatingHoursScore(
  engineHours: number | null,
  odometerKm: number,
): { score: number; engineHours: number; stressRatio: number } {
  const hours = engineHours ?? 0;
  if (hours <= 0 || odometerKm <= 0) {
    return { score: 0, engineHours: hours, stressRatio: 1.0 };
  }

  // In typical driving: 1 hour ≈ 35–45 km (Stress ratio = (Hours * 35) / Km)
  // Higher ratio > 1.4 indicates heavy GCC urban idling with air conditioning running
  const equivalentKm = hours * 35;
  const stressRatio = parseFloat((equivalentKm / odometerKm).toFixed(2));

  let score = 0;
  if (stressRatio >= 2.0) score = 0.80;      // Extreme idle/PTO duty
  else if (stressRatio >= 1.5) score = 0.50; // Heavy urban traffic
  else if (stressRatio >= 1.2) score = 0.25;
  else score = 0.05;

  return { score: Math.min(score, 1.0), engineHours: hours, stressRatio };
}

// ── Dimension 9: Repeat Subsystem Failures & Component RUL ────────────────────
export interface HistoricalRepairRecord {
  subsystem: 'POWERTRAIN' | 'BRAKES' | 'ELECTRICAL' | 'HVAC' | 'SUSPENSION' | 'GENERAL';
  completedAt: string;
}

export function calcRepeatFailuresAndRUL(
  repairs: HistoricalRepairRecord[],
  odometerKm: number,
  daysSinceLastService: number,
  sensorScore: number,
  dtcScore: number,
): {
  repeatScore: number;
  repeatCount: number;
  repeatSubsystems: string[];
  subsystemRUL: {
    powertrainPct: number;
    brakeSystemPct: number;
    electricalPct: number;
    hvacPct: number;
  };
} {
  const cutoff90 = Date.now() - (90 * 24 * 60 * 60 * 1000);
  const recentSubsystems = new Map<string, number>();

  for (const r of repairs) {
    const t = new Date(r.completedAt).getTime();
    if (t >= cutoff90) {
      recentSubsystems.set(r.subsystem, (recentSubsystems.get(r.subsystem) ?? 0) + 1);
    }
  }

  const repeatSubsystems: string[] = [];
  let repeatCount = 0;
  for (const [subsystem, count] of recentSubsystems.entries()) {
    if (count >= 2) {
      repeatSubsystems.push(subsystem);
      repeatCount += count;
    }
  }

  let repeatScore = 0;
  if (repeatCount >= 3) repeatScore = 1.0;
  else if (repeatCount >= 2) repeatScore = 0.70;
  else if (repeatCount === 1) repeatScore = 0.35;

  // Estimate Remaining Useful Life (RUL) across key subsystems
  const kmBaseFactor = Math.min(odometerKm / 200_000, 1.0);
  const svcDegrade   = Math.min(daysSinceLastService / 180, 0.4);

  const powertrainRUL = Math.max(
    100 - Math.round((kmBaseFactor * 40 + svcDegrade * 30 + dtcScore * 35 + sensorScore * 25)),
    5,
  );
  const brakeRUL = Math.max(
    100 - Math.round((kmBaseFactor * 50 + svcDegrade * 30 + (recentSubsystems.get('BRAKES') ? 30 : 0))),
    8,
  );
  const electricalRUL = Math.max(
    100 - Math.round((kmBaseFactor * 35 + sensorScore * 40 + (recentSubsystems.get('ELECTRICAL') ? 35 : 0))),
    10,
  );
  const hvacRUL = Math.max(
    100 - Math.round((kmBaseFactor * 40 + svcDegrade * 20 + (recentSubsystems.get('HVAC') ? 40 : 0))),
    12,
  );

  return {
    repeatScore: Math.min(repeatScore, 1.0),
    repeatCount,
    repeatSubsystems,
    subsystemRUL: {
      powertrainPct: powertrainRUL,
      brakeSystemPct: brakeRUL,
      electricalPct: electricalRUL,
      hvacPct: hvacRUL,
    },
  };
}

// ── Master Failure Scorer ─────────────────────────────────────────────────────
export interface ComprehensiveVehicleInput {
  id: string;
  vehicleCode: string;
  make: string;
  model: string;
  licensePlate: string;
  purchaseDate: string | null;
  odometerReading: number | null;
  // Service & Fuel
  daysSinceLastService: number;
  kmSinceLastService: number;
  baselineFuelLper100: number | null;
  recentFuelLper100: number | null;
  // Work Orders & History
  openWorkOrders: number;
  workOrdersLast90Days: number;
  historicalRepairs: HistoricalRepairRecord[];
  // Telematics & Diagnostics
  activeDtcCodes: string[];
  sensors: SensorInputs;
  engineOperatingHours: number | null;
}

export function scoreVehicleComprehensive(
  v: ComprehensiveVehicleInput,
  fleetAvgWorkOrdersPer90Days: number,
): VehicleRiskScore {
  const purchaseDate = v.purchaseDate ? new Date(v.purchaseDate) : null;
  const ageMs = purchaseDate ? Date.now() - purchaseDate.getTime() : 0;
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
  const odometer = Number(v.odometerReading ?? 0);

  // 1. Service Overdue
  const serviceRes = calcServiceOverdueScore(v.daysSinceLastService, v.kmSinceLastService);
  // 2. Fuel Anomaly
  const fuelRes = calcFuelAnomalyScore(v.baselineFuelLper100, v.recentFuelLper100);
  // 3. Work Order Frequency
  const woRes = calcWorkOrderFrequencyScore(v.openWorkOrders, v.workOrdersLast90Days, fleetAvgWorkOrdersPer90Days);
  // 4. Cumulative Mileage
  const odomRes = calcOdometerScore(odometer);
  // 5. Vehicle Age
  const ageRes = calcVehicleAgeScore(ageYears);
  // 6. CAN-bus DTC Faults
  const dtcRes = calcDtcFaultScore(v.activeDtcCodes);
  // 7. Telemetry Sensor Values
  const sensorRes = calcSensorAnomalyScore(v.sensors);
  // 8. Operating Hours & Idle Stress
  const hoursRes = calcOperatingHoursScore(v.engineOperatingHours, odometer);
  // 9. Repeat Failures & Component RUL
  const repeatRes = calcRepeatFailuresAndRUL(
    v.historicalRepairs,
    odometer,
    v.daysSinceLastService,
    sensorRes.score,
    dtcRes.score,
  );

  // Calculate Weighted Sum
  let compositeScore =
    serviceRes.score  * WEIGHTS.serviceOverdue       +
    dtcRes.score      * WEIGHTS.dtcFaults            +
    sensorRes.score   * WEIGHTS.sensorAnomalies      +
    fuelRes.score     * WEIGHTS.fuelAnomaly          +
    repeatRes.repeatScore * WEIGHTS.repeatFailures   +
    woRes.score       * WEIGHTS.workOrderFrequency   +
    hoursRes.score    * WEIGHTS.operatingHoursStress +
    odomRes.score     * WEIGHTS.odometer             +
    ageRes.score      * WEIGHTS.vehicleAge;

  // Immediate override for emergency breakdown safety
  if (sensorRes.hasImmediateStopRisk || dtcRes.criticalCount > 0) {
    compositeScore = Math.max(compositeScore, 0.88);
  }

  const riskScore = parseFloat(Math.min(compositeScore, 1.0).toFixed(3));
  const riskLevel: RiskLevel =
    riskScore >= 0.75 ? 'CRITICAL' :
    riskScore >= 0.50 ? 'HIGH' :
    riskScore >= 0.25 ? 'MEDIUM' : 'LOW';

  const recommendedAction: MaintenanceAction =
    riskLevel === 'CRITICAL' ? 'GROUND_VEHICLE' :
    riskLevel === 'HIGH'     ? 'URGENT_SERVICE' :
    riskLevel === 'MEDIUM'   ? 'SCHEDULE_SERVICE' : 'MONITOR';

  const predictedFailureWindow =
    riskScore >= 0.85 ? '0–48 hours (Imminent Failure)' :
    riskScore >= 0.75 ? '2–7 days' :
    riskScore >= 0.60 ? '7–14 days' :
    riskScore >= 0.45 ? '14–30 days' :
    riskScore >= 0.25 ? '30–60 days' : 'No immediate failure risk';

  // Determine primary failure reason
  let primaryFailureReason = 'Normal fleet wear within operating limits';
  if (dtcRes.criticalCount > 0) {
    primaryFailureReason = `Critical DTC Fault: ${v.activeDtcCodes.join(', ')} (${dtcRes.summary})`;
  } else if (sensorRes.warnings.length > 0) {
    primaryFailureReason = sensorRes.warnings[0];
  } else if (repeatRes.repeatSubsystems.length > 0) {
    primaryFailureReason = `Chronic repeat failures detected in: ${repeatRes.repeatSubsystems.join(', ')}`;
  } else if (serviceRes.score >= 0.8) {
    primaryFailureReason = `Severe maintenance overdue: ${serviceRes.daysSince} days / ${serviceRes.kmSince} km`;
  } else if (fuelRes.score >= 0.7) {
    primaryFailureReason = `High fuel consumption spike: ${fuelRes.recent} L/100km (+${Math.round((fuelRes.recent/fuelRes.baseline - 1)*100)}%)`;
  }

  const factors: MaintenanceRiskFactors = {
    serviceOverdue:          serviceRes.score,
    serviceOverdueDays:      serviceRes.daysSince,
    serviceOverdueKm:        serviceRes.kmSince,
    fuelAnomalyScore:        fuelRes.score,
    fuelConsumptionBaseline: fuelRes.baseline,
    fuelConsumptionRecent:   fuelRes.recent,
    workOrderFrequency:      woRes.score,
    openWorkOrders:          woRes.open,
    workOrdersLast90Days:    v.workOrdersLast90Days,
    odometerFactor:          odomRes.score,
    odometerKm:              odomRes.odometer,
    vehicleAgeFactor:        ageRes.score,
    vehicleAgeYears:         ageRes.ageYears,
    dtcFaultScore:           dtcRes.score,
    activeDtcCodes:          v.activeDtcCodes,
    dtcSeveritySummary:      dtcRes.summary,
    sensorAnomalyScore:      sensorRes.score,
    coolantTempC:            v.sensors.coolantTempC,
    oilPressureKpa:          v.sensors.oilPressureKpa,
    batteryVoltage:          v.sensors.batteryVoltage,
    transmissionTempC:       v.sensors.transmissionTempC,
    sensorWarningList:       sensorRes.warnings,
    operatingHoursFactor:    hoursRes.score,
    engineOperatingHours:    hoursRes.engineHours,
    dutyCycleStressRatio:    hoursRes.stressRatio,
    repeatFailureScore:      repeatRes.repeatScore,
    repeatFailureCount:      repeatRes.repeatCount,
    repeatSubsystems:        repeatRes.repeatSubsystems,
    subsystemRUL:            repeatRes.subsystemRUL,
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
    recommendedAction,
    predictedFailureWindow,
    primaryFailureReason,
    scoredAt:              new Date().toISOString(),
  };
}

// Backward compatibility export
export const scoreVehicle = scoreVehicleComprehensive;
