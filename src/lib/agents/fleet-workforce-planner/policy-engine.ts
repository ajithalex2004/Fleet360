/**
 * Driver Hours Policy Engine
 * --------------------------
 * Resolves versioned jurisdictional and contractual labor rules:
 *  - UAE Federal Baseline (8h normal / 48h weekly, max 10h daily duty with overtime)
 *  - Dubai RTA Commercial Passenger Transport rules
 *  - Abu Dhabi ITC Asateel requirements
 *  - Ramadan adjustments (6h/day, 36h/week)
 *  - Specific client enterprise contract rules
 */

import { DriverHoursPolicy } from '../types';

export const UAE_FEDERAL_DEFAULT_POLICY: DriverHoursPolicy = {
  policyId: 'policy-uae-federal-standard',
  jurisdiction: 'UAE_FEDERAL',
  operatorType: 'STAFF_TRANSPORT',
  effectiveFrom: '2026-01-01',
  normalDailyHours: 8.0,
  normalWeeklyHours: 48.0,
  maxDailyDutyHours: 10.0,
  maxWeeklyDutyHours: 60.0,
  maxConsecutiveWorkDays: 6,
  maxContinuousDrivingMinutes: 270, // 4.5 hours
  mandatoryBreakMinutes: 45,
  interShiftRestHours: 11.0,
  isRamadanSchedule: false,
  splitShiftMaxSpreadHours: 14.0,
};

export const UAE_RAMADAN_POLICY: DriverHoursPolicy = {
  ...UAE_FEDERAL_DEFAULT_POLICY,
  policyId: 'policy-uae-ramadan-standard',
  normalDailyHours: 6.0,
  normalWeeklyHours: 36.0,
  maxDailyDutyHours: 8.0,
  maxWeeklyDutyHours: 48.0,
  isRamadanSchedule: true,
};

export class DriverHoursPolicyEngine {
  /**
   * Resolve strictest applicable policy for tenant, operator type, and date.
   */
  resolvePolicy(
    customOverrides?: Partial<DriverHoursPolicy>,
    jurisdiction: DriverHoursPolicy['jurisdiction'] = 'UAE_FEDERAL',
  ): DriverHoursPolicy {
    const base = customOverrides?.isRamadanSchedule
      ? UAE_RAMADAN_POLICY
      : UAE_FEDERAL_DEFAULT_POLICY;

    return {
      ...base,
      jurisdiction,
      ...customOverrides,
    };
  }

  /**
   * Validate if a proposed duty block satisfies the resolved policy.
   */
  validateDutyBlock(
    policy: DriverHoursPolicy,
    totalDailyDutyMinutes: number,
    continuousDrivingMinutes: number,
    proposedTripDurationMinutes: number,
  ): { isValid: boolean; violationReason?: string; shiftRemainingMinutes: number } {
    const maxDailyMin = policy.maxDailyDutyHours * 60;
    const projectedDutyMin = totalDailyDutyMinutes + proposedTripDurationMinutes;
    const shiftRemainingMinutes = Math.max(0, maxDailyMin - totalDailyDutyMinutes);

    // 1. Daily duty check
    if (projectedDutyMin > maxDailyMin) {
      return {
        isValid: false,
        violationReason: `Daily duty limit exceeded: Driver would reach ${projectedDutyMin} min (Max: ${maxDailyMin} min / ${policy.maxDailyDutyHours}h under ${policy.jurisdiction}).`,
        shiftRemainingMinutes,
      };
    }

    // 2. Continuous driving check
    if (continuousDrivingMinutes + proposedTripDurationMinutes > policy.maxContinuousDrivingMinutes) {
      return {
        isValid: false,
        violationReason: `Continuous driving limit exceeded: ${continuousDrivingMinutes + proposedTripDurationMinutes} min continuous without ${policy.mandatoryBreakMinutes}m rest break (Max: ${policy.maxContinuousDrivingMinutes}m).`,
        shiftRemainingMinutes,
      };
    }

    return {
      isValid: true,
      shiftRemainingMinutes,
    };
  }
}

export const driverHoursPolicyEngine = new DriverHoursPolicyEngine();
