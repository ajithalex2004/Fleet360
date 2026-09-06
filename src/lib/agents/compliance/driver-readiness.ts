/**
 * Driver Compliance & Readiness Gatekeeper
 * -----------------------------------------
 * Deterministic pre-assignment verification engine connecting Workforce,
 * Driver Mobile App, Dispatch, and Regulatory domains.
 *
 * Enforces:
 *  1. Credential Validity (UAE License, Emirates ID, RTA Driver Card, Medical Fitness)
 *  2. Vehicle Category Authorization Match (Light, Heavy Bus, Articulated, etc.)
 *  3. UAE MoHRE Daily Hours of Service (10h max duty)
 *  4. UAE RTA Continuous Driving Limit (4.5h max continuous with 45m mandatory rest)
 *  5. Black Points Risk (Safe < 18, Warning >= 18, Suspension = 24)
 *  6. Roster Status (ON_DUTY vs ON_LEAVE / SICK_LEAVE / OFF_DUTY)
 */

import { DriverReadinessRequest, DriverReadinessResult } from '../types';

export const MAX_DAILY_DUTY_MINUTES = 600; // 10 Hours (UAE MoHRE)
export const MAX_CONTINUOUS_DRIVING_MINUTES = 270; // 4.5 Hours (UAE RTA)
export const MANDATORY_REST_BREAK_MINUTES = 45;
export const BLACK_POINTS_WARNING_THRESHOLD = 18;
export const BLACK_POINTS_SUSPENSION_THRESHOLD = 24;

export function evaluateDriverReadiness(
  request: DriverReadinessRequest,
  referenceDate: Date = new Date(),
): DriverReadinessResult {
  const refMs = referenceDate.getTime();
  const disqualificationReasons: string[] = [];
  const warnings: string[] = [];

  const driverId = request.driverId;
  const driverName = request.driverName || `Driver ${driverId}`;

  // ── 1. Credential Validity Checks ──────────────────────────────────────────
  let credentialsValid = true;

  if (request.licenseExpiry) {
    const licExpiryMs = new Date(request.licenseExpiry).getTime();
    if (licExpiryMs <= refMs) {
      credentialsValid = false;
      disqualificationReasons.push(`UAE Driving License expired on ${new Date(request.licenseExpiry).toLocaleDateString()}.`);
    } else if (licExpiryMs - refMs <= 15 * 86400000) {
      warnings.push(`UAE Driving License expires in ${Math.ceil((licExpiryMs - refMs) / 86400000)} days.`);
    }
  }

  if (request.emiratesIdExpiry) {
    const eidExpiryMs = new Date(request.emiratesIdExpiry).getTime();
    if (eidExpiryMs <= refMs) {
      credentialsValid = false;
      disqualificationReasons.push(`Emirates ID expired on ${new Date(request.emiratesIdExpiry).toLocaleDateString()}.`);
    }
  }

  if (request.rtaCardExpiry) {
    const rtaExpiryMs = new Date(request.rtaCardExpiry).getTime();
    if (rtaExpiryMs <= refMs) {
      credentialsValid = false;
      disqualificationReasons.push(`RTA Commercial Driver Card expired on ${new Date(request.rtaCardExpiry).toLocaleDateString()}.`);
    }
  }

  if (request.medicalFitnessExpiry) {
    const medExpiryMs = new Date(request.medicalFitnessExpiry).getTime();
    if (medExpiryMs <= refMs) {
      credentialsValid = false;
      disqualificationReasons.push(`Medical Fitness Certificate expired on ${new Date(request.medicalFitnessExpiry).toLocaleDateString()}.`);
    }
  }

  // ── 2. Roster & Leave Status ───────────────────────────────────────────────
  let rosterStatusValid = true;
  const rosterStatus = request.rosterStatus || 'ON_DUTY';
  if (rosterStatus === 'ON_LEAVE' || rosterStatus === 'SICK_LEAVE' || rosterStatus === 'OFF_DUTY') {
    rosterStatusValid = false;
    disqualificationReasons.push(`Driver is currently marked as ${rosterStatus} on workforce roster.`);
  }

  // ── 3. Vehicle Category Authorization ──────────────────────────────────────
  let vehicleCategoryAuthorized = true;
  if (request.vehicleCategoryRequired) {
    const required = request.vehicleCategoryRequired.toUpperCase();
    const authorized = new Set([
      ...(request.authorizedCategories || []).map((c) => c.toUpperCase()),
      ...(request.licenseClasses || []).map((c) => c.toUpperCase()),
    ]);

    // General authorization logic
    const isHeavyBusReq = required.includes('BUS') || required.includes('COACH') || required.includes('COASTER');
    const hasHeavyBusAuth = authorized.has('HEAVY_BUS') || authorized.has('BUS') || authorized.has('CATEGORY_6') || authorized.has('HEAVY');

    if (isHeavyBusReq && !hasHeavyBusAuth) {
      vehicleCategoryAuthorized = false;
      disqualificationReasons.push(`License class does not authorize ${required} operation (Heavy Bus license required).`);
    }
  }

  // ── 4. Hours of Service (HOS) & Duty Remaining ────────────────────────────
  const dutyUsedMin = request.dailyDutyMinutesUsed || 0;
  const estimatedDurationMin = request.estimatedDurationMin || 60;
  const projectedDutyMin = dutyUsedMin + estimatedDurationMin;
  const shiftRemainingMin = Math.max(0, MAX_DAILY_DUTY_MINUTES - dutyUsedMin);

  const hoursRemaining = Math.floor(shiftRemainingMin / 60);
  const minsRemaining = shiftRemainingMin % 60;
  const shiftRemainingFormatted = `${hoursRemaining}h ${minsRemaining}m`;

  if (projectedDutyMin > MAX_DAILY_DUTY_MINUTES) {
    disqualificationReasons.push(
      `Daily Duty Limit Exceeded: Driver would reach ${projectedDutyMin} min (Max: ${MAX_DAILY_DUTY_MINUTES} min / 10h MoHRE limit). Only ${shiftRemainingFormatted} remaining.`,
    );
  }

  // ── 5. Continuous Driving Time & Mandatory Rest Breaks ──────────────────────
  const continuousMin = request.continuousDrivingMinutesUsed || 0;
  let restCompliance: DriverReadinessResult['restCompliance'] = 'PASS';

  if (continuousMin >= MAX_CONTINUOUS_DRIVING_MINUTES) {
    restCompliance = 'VIOLATION';
    disqualificationReasons.push(
      `RTA Continuous Driving Violation: Driver has driven ${continuousMin} min continuously without mandatory 45m rest break (Max allowed: 270m / 4.5h).`,
    );
  } else if (continuousMin + estimatedDurationMin > MAX_CONTINUOUS_DRIVING_MINUTES) {
    restCompliance = 'REST_REQUIRED_SOON';
    disqualificationReasons.push(
      `Trip of ${estimatedDurationMin}m would breach 4.5h continuous driving limit (${continuousMin}m already driven). Mandatory 45m rest required first.`,
    );
  }

  // ── 6. Black Points Risk ───────────────────────────────────────────────────
  const blackPoints = request.blackPoints || 0;
  let blackPointsRisk: DriverReadinessResult['blackPointsRisk'] = 'SAFE';

  if (blackPoints >= BLACK_POINTS_SUSPENSION_THRESHOLD) {
    blackPointsRisk = 'CRITICAL_SUSPENSION';
    disqualificationReasons.push(`License Suspended: Driver has accumulated ${blackPoints}/24 black points. Mandatory police suspension active.`);
  } else if (blackPoints >= BLACK_POINTS_WARNING_THRESHOLD) {
    blackPointsRisk = 'WARNING_THRESHOLD';
    warnings.push(`High Black Points Warning: Driver has ${blackPoints}/24 black points. High risk of roadside impoundment.`);
  }

  // ── 7. Eligibility Determination & Readiness Score ─────────────────────────
  const isEligible =
    credentialsValid &&
    rosterStatusValid &&
    vehicleCategoryAuthorized &&
    disqualificationReasons.length === 0;

  let readinessScore = 100;
  if (!isEligible) {
    readinessScore = Math.max(0, 100 - disqualificationReasons.length * 30);
  } else if (warnings.length > 0) {
    readinessScore = Math.max(70, 100 - warnings.length * 15);
  }

  const status: DriverReadinessResult['status'] = isEligible
    ? warnings.length > 0
      ? 'WARNING'
      : 'ELIGIBLE'
    : 'BLOCKED';

  // Summary Generation
  let summary = '';
  if (isEligible) {
    summary = `Driver ${driverName} is fully compliant and eligible for assignment. Shift remaining: ${shiftRemainingFormatted}. Rest compliance: ${restCompliance}. Black points: ${blackPoints}/24.`;
  } else {
    summary = `Driver ${driverName} is BLOCKED from assignment: ${disqualificationReasons.join('; ')}`;
  }

  return {
    isEligible,
    status,
    readinessScore,
    driverId,
    driverName,
    shiftRemainingMin,
    shiftRemainingFormatted,
    continuousDrivingMin: continuousMin,
    restCompliance,
    blackPoints,
    blackPointsRisk,
    credentialsValid,
    vehicleCategoryAuthorized,
    rosterStatusValid,
    disqualificationReasons,
    warnings,
    summary,
    evaluatedAt: referenceDate.toISOString(),
  };
}
