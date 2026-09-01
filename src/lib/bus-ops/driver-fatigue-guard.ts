/**
 * Driver Fatigue & Continuous Driving Rest Enforcement Engine (HOS Guard)
 *
 * Implements regulatory and safety standards for bus drivers:
 *   1. Mandatory Inter-Shift Rest (default: 8.0 hours minimum continuous rest between shifts)
 *   2. Max Continuous Drive Time (default: 4.5 hours max before requiring a 45-min break)
 *   3. Max Daily Drive Time (default: 10.0 hours max in any rolling 24h window)
 *   4. Circadian Night-Shift Hazard (trips operating between 00:00 and 06:00)
 */

export interface DriverTripHistoryItem {
  id: string;
  tripNumber?: string;
  routeId?: string;
  routeName?: string;
  departureTime: Date | string;
  arrivalTime?: Date | string | null;
  status: string;
  durationMinutes?: number;
}

export interface FatigueCheckParams {
  driverId: string;
  driverName?: string;
  targetDepartureTime: Date | string;
  targetDurationMinutes?: number; // expected duration in minutes, default 60
  recentTrips: DriverTripHistoryItem[];
  rules?: {
    minInterShiftRestHours?: number; // default 8.0
    maxContinuousDriveHours?: number; // default 4.5
    maxDailyDriveHours?: number; // default 10.0
    minBreakMinutesForReset?: number; // default 45
  };
}

export interface FatigueEvaluationResult {
  driverId: string;
  driverName?: string;
  isCompliant: boolean;
  severity: 'PASS' | 'WARN' | 'BLOCK';
  violations: Array<{
    rule: 'INTER_SHIFT_REST' | 'MAX_CONTINUOUS_DRIVE' | 'MAX_DAILY_DRIVE' | 'NIGHT_SHIFT_CIRCADIAN';
    level: 'WARN' | 'BLOCK';
    message: string;
    actualValue: number;
    thresholdValue: number;
    unit: 'hours' | 'minutes';
  }>;
  metrics: {
    restTimeSinceLastShiftHours: number | null;
    lastTripEndAt: string | null;
    continuousDriveHours: number;
    rolling24hDriveHours: number;
    isNightShift: boolean;
    hoursUntilCompliant: number;
  };
  recommendation: string;
}

/**
 * Pure fatigue evaluation algorithm against driver's trip history
 */
export function evaluateDriverFatigue(params: FatigueCheckParams): FatigueEvaluationResult {
  const {
    driverId,
    driverName = 'Driver',
    targetDepartureTime,
    targetDurationMinutes = 60,
    recentTrips = [],
    rules = {},
  } = params;

  const minInterShiftRestHours = rules.minInterShiftRestHours ?? 8.0;
  const maxContinuousDriveHours = rules.maxContinuousDriveHours ?? 4.5;
  const maxDailyDriveHours = rules.maxDailyDriveHours ?? 10.0;
  const minBreakMinutesForReset = rules.minBreakMinutesForReset ?? 45;

  const targetStart = new Date(targetDepartureTime);

  // Filter completed or active trips before the target start, sorted by departureTime desc
  const pastTrips = recentTrips
    .filter((t) => {
      const dep = new Date(t.departureTime);
      return (
        dep.getTime() < targetStart.getTime() &&
        !['CANCELLED', 'ABORTED'].includes(t.status)
      );
    })
    .sort(
      (a, b) =>
        new Date(b.departureTime).getTime() - new Date(a.departureTime).getTime()
    );

  const violations: FatigueEvaluationResult['violations'] = [];

  // 1. Inter-Shift Rest Evaluation
  let restTimeSinceLastShiftHours: number | null = null;
  let lastTripEndAt: string | null = null;
  let hoursUntilCompliant = 0;

  if (pastTrips.length > 0) {
    const lastTrip = pastTrips[0];
    const lastTripStart = new Date(lastTrip.departureTime);
    const lastTripDuration = lastTrip.durationMinutes ?? 60;
    const computedEnd = lastTrip.arrivalTime
      ? new Date(lastTrip.arrivalTime)
      : new Date(lastTripStart.getTime() + lastTripDuration * 60 * 1000);

    lastTripEndAt = computedEnd.toISOString();
    const restMillis = targetStart.getTime() - computedEnd.getTime();
    restTimeSinceLastShiftHours = Math.max(0, restMillis / (1000 * 60 * 60));

    if (restTimeSinceLastShiftHours < minInterShiftRestHours) {
      hoursUntilCompliant = Number(
        (minInterShiftRestHours - restTimeSinceLastShiftHours).toFixed(2)
      );
      violations.push({
        rule: 'INTER_SHIFT_REST',
        level: 'BLOCK',
        message: `Insufficient rest between shifts: ${restTimeSinceLastShiftHours.toFixed(
          1
        )}h recorded (minimum required: ${minInterShiftRestHours}h). Driver requires ${hoursUntilCompliant}h more rest.`,
        actualValue: Number(restTimeSinceLastShiftHours.toFixed(2)),
        thresholdValue: minInterShiftRestHours,
        unit: 'hours',
      });
    } else if (restTimeSinceLastShiftHours < minInterShiftRestHours + 1.5) {
      violations.push({
        rule: 'INTER_SHIFT_REST',
        level: 'WARN',
        message: `Tight rest buffer between shifts: ${restTimeSinceLastShiftHours.toFixed(
          1
        )}h (recommended ${minInterShiftRestHours + 2}h).`,
        actualValue: Number(restTimeSinceLastShiftHours.toFixed(2)),
        thresholdValue: minInterShiftRestHours + 2,
        unit: 'hours',
      });
    }
  }

  // 2. Continuous Driving Evaluation (chained trips without 45m break)
  let continuousMinutes = targetDurationMinutes;
  let prevTripEnd = targetStart;

  for (const t of pastTrips) {
    const tStart = new Date(t.departureTime);
    const tDuration = t.durationMinutes ?? 60;
    const tEnd = t.arrivalTime
      ? new Date(t.arrivalTime)
      : new Date(tStart.getTime() + tDuration * 60 * 1000);

    const gapMinutes = (prevTripEnd.getTime() - tEnd.getTime()) / (1000 * 60);

    if (gapMinutes < minBreakMinutesForReset) {
      continuousMinutes += tDuration;
      prevTripEnd = tStart;
    } else {
      break;
    }
  }

  const continuousDriveHours = Number((continuousMinutes / 60).toFixed(2));
  if (continuousDriveHours > maxContinuousDriveHours) {
    violations.push({
      rule: 'MAX_CONTINUOUS_DRIVE',
      level: 'BLOCK',
      message: `Continuous driving limit exceeded: ${continuousDriveHours}h consecutive driving without a qualifying ${minBreakMinutesForReset}-minute break (limit: ${maxContinuousDriveHours}h).`,
      actualValue: continuousDriveHours,
      thresholdValue: maxContinuousDriveHours,
      unit: 'hours',
    });
  }

  // 3. Rolling 24-Hour Cumulative Drive Time
  const rolling24hStart = new Date(targetStart.getTime() - 24 * 60 * 60 * 1000);
  let total24hMinutes = targetDurationMinutes;

  for (const t of pastTrips) {
    const tStart = new Date(t.departureTime);
    if (tStart.getTime() >= rolling24hStart.getTime()) {
      total24hMinutes += t.durationMinutes ?? 60;
    }
  }

  const rolling24hDriveHours = Number((total24hMinutes / 60).toFixed(2));
  if (rolling24hDriveHours > maxDailyDriveHours) {
    violations.push({
      rule: 'MAX_DAILY_DRIVE',
      level: 'BLOCK',
      message: `Daily cumulative drive limit exceeded: ${rolling24hDriveHours}h in rolling 24-hour window (maximum allowed: ${maxDailyDriveHours}h).`,
      actualValue: rolling24hDriveHours,
      thresholdValue: maxDailyDriveHours,
      unit: 'hours',
    });
  } else if (rolling24hDriveHours > maxDailyDriveHours - 1.5) {
    violations.push({
      rule: 'MAX_DAILY_DRIVE',
      level: 'WARN',
      message: `Driver approaching daily drive ceiling: ${rolling24hDriveHours}h / ${maxDailyDriveHours}h permitted.`,
      actualValue: rolling24hDriveHours,
      thresholdValue: maxDailyDriveHours,
      unit: 'hours',
    });
  }

  // 4. Circadian Night-Shift Hazard Check (00:00 - 06:00 UTC)
  const targetHour = targetStart.getUTCHours();
  const isNightShift = targetHour >= 0 && targetHour < 6;
  if (isNightShift) {
    violations.push({
      rule: 'NIGHT_SHIFT_CIRCADIAN',
      level: 'WARN',
      message: `Circadian fatigue risk: Trip departs during high-fatigue nocturnal window (${targetHour}:00). Ensure driver had day-sleep rest.`,
      actualValue: targetHour,
      thresholdValue: 6,
      unit: 'hours',
    });
  }

  // Determine overall severity
  const hasBlock = violations.some((v) => v.level === 'BLOCK');
  const hasWarn = violations.some((v) => v.level === 'WARN');
  const severity: FatigueEvaluationResult['severity'] = hasBlock
    ? 'BLOCK'
    : hasWarn
    ? 'WARN'
    : 'PASS';

  let recommendation = 'Driver is fully rested and compliant for dispatch.';
  if (hasBlock) {
    recommendation = `HARD LOCKOUT: Do not dispatch ${driverName}. ${violations
      .filter((v) => v.level === 'BLOCK')
      .map((v) => v.message)
      .join(' ')}`;
  } else if (hasWarn) {
    recommendation = `ADVISORY: Driver compliant but approaching rest thresholds. Monitor alertness on nocturnal/chained runs.`;
  }

  return {
    driverId,
    driverName,
    isCompliant: !hasBlock,
    severity,
    violations,
    metrics: {
      restTimeSinceLastShiftHours,
      lastTripEndAt,
      continuousDriveHours,
      rolling24hDriveHours,
      isNightShift,
      hoursUntilCompliant,
    },
    recommendation,
  };
}
