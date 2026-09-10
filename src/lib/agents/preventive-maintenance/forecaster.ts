/**
 * Continuous Preventive Maintenance Burn-Down Forecaster
 * --------------------------------------------------------
 * Consumes:
 *  - Mileage & Daily Km trend
 *  - Engine Operating Hours & Run Rate
 *  - Vehicle Age & Environmental Aging
 *  - Active Maintenance Plan (PMTrigger: Odometer, Engine Hours, Calendar)
 *  - Last Maintenance Date & Odometer
 *  - Telematics utilization & sensor health
 *  - Manufacturer OEM schedule
 *
 * Produces:
 *  - Days until threshold breach
 *  - Projected service milestone date
 *  - Human-centric forward narrative:
 *    "Vehicle V-103 will reach its 20,000 km service threshold in approximately 6 operating days."
 */

import { getNextOEMMilestone, OEMServiceMilestone } from './oem-schedules';
import { PMUrgencyLevel } from '../types';

export interface VehiclePMInput {
  vehicleId: string;
  vehicleCode: string;
  licensePlate: string;
  make: string;
  model: string;
  year?: number;
  currentOdometerKm: number;
  currentEngineHours?: number;
  historicalDailyKm?: number; // e.g. from 7d or 14d moving average
  historicalDailyHours?: number;
  lastServiceDate?: string;
  lastServiceOdometerKm?: number;
  activePlan?: {
    planId: string;
    planName: string;
    triggers: Array<{
      triggerType: 'ODOMETER' | 'CALENDAR' | 'ENGINE_HOURS';
      intervalValue: number;
      intervalUnit: string;
    }>;
  };
}

export interface BurnDownCalculationResult {
  vehicleId: string;
  vehicleCode: string;
  licensePlate: string;
  make: string;
  model: string;
  currentOdometerKm: number;
  currentEngineHours: number;
  dailyAvgKm: number;
  dailyAvgEngineHours: number;
  targetServiceThreshold: string;
  targetTriggerType: 'ODOMETER' | 'ENGINE_HOURS' | 'CALENDAR';
  targetValue: number;
  remainingKm: number;
  remainingEngineHours: number;
  estimatedDaysToDue: number;
  projectedDueDate: string; // YYYY-MM-DD
  urgencyLevel: PMUrgencyLevel;
  forecastNarrative: string;
  operationsNeeded: string[];
  estimatedDurationHours: number;
  estimatedCostAed: number;
}

const DEFAULT_DAILY_KM = 120; // Default daily utilization for commercial fleets
const DEFAULT_DAILY_HOURS = 4.5;

/**
 * Calculates the dynamic burn-down forecast for a single vehicle.
 */
export function calculateVehicleBurnDown(
  input: VehiclePMInput,
  now: Date = new Date()
): BurnDownCalculationResult {
  const currentKm = input.currentOdometerKm || 0;
  const currentHours = input.currentEngineHours || 0;

  // 1. Determine daily run-rates
  const dailyAvgKm = input.historicalDailyKm && input.historicalDailyKm > 5
    ? input.historicalDailyKm
    : DEFAULT_DAILY_KM;

  const dailyAvgHours = input.historicalDailyHours && input.historicalDailyHours > 0.5
    ? input.historicalDailyHours
    : DEFAULT_DAILY_HOURS;

  // 2. Check Active PM Plan vs OEM Milestone
  let targetServiceThreshold = '';
  let targetTriggerType: 'ODOMETER' | 'ENGINE_HOURS' | 'CALENDAR' = 'ODOMETER';
  let targetKm: number | null = null;
  let targetHours: number | null = null;
  let targetDate: Date | null = null;
  let operations: string[] = [];
  let durationHours = 2.5;
  let estimatedCost = 800;

  // A. Check PM Plan Triggers (if active)
  if (input.activePlan && input.activePlan.triggers.length > 0) {
    const odoTrigger = input.activePlan.triggers.find((t) => t.triggerType === 'ODOMETER');
    const calTrigger = input.activePlan.triggers.find((t) => t.triggerType === 'CALENDAR');
    const hrsTrigger = input.activePlan.triggers.find((t) => t.triggerType === 'ENGINE_HOURS');

    if (odoTrigger) {
      const baseKm = input.lastServiceOdometerKm || 0;
      targetKm = baseKm + odoTrigger.intervalValue;
      targetServiceThreshold = `${input.activePlan.planName} (${targetKm.toLocaleString()} km)`;
    }

    if (hrsTrigger) {
      targetHours = (currentHours || 0) + hrsTrigger.intervalValue;
    }

    if (calTrigger && input.lastServiceDate) {
      const baseTime = new Date(input.lastServiceDate).getTime();
      targetDate = new Date(baseTime + calTrigger.intervalValue * 86_400_000);
    }
  }

  // B. Fallback to OEM Milestone if no explicit plan target or OEM is sooner
  const oem = getNextOEMMilestone(currentKm);
  if (!targetKm || oem.targetOdometerKm < targetKm) {
    targetKm = oem.targetOdometerKm;
    targetServiceThreshold = oem.nextMilestone.label;
    operations = oem.nextMilestone.operations;
    durationHours = oem.nextMilestone.estimatedDurationHours;
    estimatedCost = oem.nextMilestone.estimatedCostAed;
  }

  // 3. Compute Days to Threshold Breach across all applicable dimensions
  let daysByKm = 999;
  let remainingKm = 0;
  if (targetKm !== null) {
    remainingKm = Math.max(0, targetKm - currentKm);
    daysByKm = remainingKm <= 0 ? 0 : Math.ceil(remainingKm / dailyAvgKm);
  }

  let daysByHours = 999;
  let remainingHours = 0;
  if (targetHours !== null) {
    remainingHours = Math.max(0, targetHours - currentHours);
    daysByHours = remainingHours <= 0 ? 0 : Math.ceil(remainingHours / dailyAvgHours);
  }

  let daysByCalendar = 999;
  if (targetDate !== null) {
    const diffMs = targetDate.getTime() - now.getTime();
    daysByCalendar = Math.ceil(diffMs / 86_400_000);
  }

  // Whichever threshold is reached first drives the forecast
  const estimatedDaysToDue = Math.min(daysByKm, daysByHours, daysByCalendar);

  if (estimatedDaysToDue === daysByHours) {
    targetTriggerType = 'ENGINE_HOURS';
  } else if (estimatedDaysToDue === daysByCalendar) {
    targetTriggerType = 'CALENDAR';
  } else {
    targetTriggerType = 'ODOMETER';
  }

  // 4. Calculate projected due date
  const projectedDueTime = new Date(now.getTime() + Math.max(0, estimatedDaysToDue) * 86_400_000);
  const projectedDueDate = projectedDueTime.toISOString().slice(0, 10);

  // 5. Determine Urgency Level
  let urgencyLevel: PMUrgencyLevel = 'NORMAL';
  if (estimatedDaysToDue <= 0) {
    urgencyLevel = 'OVERDUE';
  } else if (estimatedDaysToDue <= 7) {
    urgencyLevel = 'DUE_SOON';
  } else if (estimatedDaysToDue <= 21) {
    urgencyLevel = 'UPCOMING';
  } else {
    urgencyLevel = 'NORMAL';
  }

  // 6. Formulate forward-looking narrative statement
  const vehicleLabel = input.vehicleCode || input.licensePlate || 'Vehicle';
  let forecastNarrative = '';

  if (estimatedDaysToDue <= 0) {
    forecastNarrative = `${vehicleLabel} has reached its ${targetServiceThreshold} threshold (${remainingKm === 0 ? 'overdue by mileage' : 'overdue by schedule'}). Service immediate slot recommended.`;
  } else {
    forecastNarrative = `${vehicleLabel} will reach its ${targetServiceThreshold} threshold in approximately ${estimatedDaysToDue} operating days (projected: ${projectedDueDate}).`;
  }

  return {
    vehicleId: input.vehicleId,
    vehicleCode: input.vehicleCode,
    licensePlate: input.licensePlate,
    make: input.make,
    model: input.model,
    currentOdometerKm: currentKm,
    currentEngineHours: currentHours,
    dailyAvgKm: Math.round(dailyAvgKm),
    dailyAvgEngineHours: parseFloat(dailyAvgHours.toFixed(1)),
    targetServiceThreshold,
    targetTriggerType,
    targetValue: targetKm || 0,
    remainingKm,
    remainingEngineHours: Math.round(remainingHours),
    estimatedDaysToDue,
    projectedDueDate,
    urgencyLevel,
    forecastNarrative,
    operationsNeeded: operations,
    estimatedDurationHours: durationHours,
    estimatedCostAed: estimatedCost,
  };
}
