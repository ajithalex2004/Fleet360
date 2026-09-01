/**
 * src/lib/telematics/pm-odometer-sync.ts
 *
 * Preventive Maintenance (PM) Odometer Synchronizer.
 *
 * Evaluates live odometer against vehicle service intervals and PM plans:
 *   - Approaching Service (<= 500 km remaining): Raises PM_SERVICE_DUE_SOON alert
 *   - Service Overdue (odometer >= nextDueKm): Raises PM_SERVICE_OVERDUE alert
 */

import type { Prisma } from '@prisma/client';
import { raiseAlert } from '@/lib/alerts/raise';

export interface PmCheckResult {
  vehicleId: string;
  currentOdometerKm: number;
  serviceIntervalKm: number;
  nextDueKm: number;
  kmRemaining: number;
  status: 'OK' | 'DUE_SOON' | 'OVERDUE';
  alertRaised: boolean;
}

/**
 * Pure evaluation function for PM odometer thresholds.
 */
export function evaluatePmOdometerThresholdSync(
  currentOdometerKm: number,
  serviceIntervalKm: number = 10000,
  lastServiceOdometerKm?: number,
): {
  nextDueKm: number;
  kmRemaining: number;
  status: 'OK' | 'DUE_SOON' | 'OVERDUE';
} {
  let targetDueKm: number;
  let kmRemaining: number;

  if (lastServiceOdometerKm !== undefined) {
    targetDueKm = lastServiceOdometerKm + serviceIntervalKm;
    kmRemaining = targetDueKm - currentOdometerKm;
  } else {
    // Determine closest periodic interval boundary
    const prevInterval = Math.floor(currentOdometerKm / serviceIntervalKm) * serviceIntervalKm;
    const nextInterval = prevInterval + serviceIntervalKm;
    const distPastPrev = currentOdometerKm - prevInterval;

    if (distPastPrev > 0 && distPastPrev <= 1000 && prevInterval > 0) {
      // Just passed the interval by <= 1000km -> OVERDUE for prevInterval
      targetDueKm = prevInterval;
      kmRemaining = -distPastPrev;
    } else {
      targetDueKm = nextInterval;
      kmRemaining = nextInterval - currentOdometerKm;
    }
  }

  let status: 'OK' | 'DUE_SOON' | 'OVERDUE' = 'OK';
  if (kmRemaining <= 0) {
    status = 'OVERDUE';
  } else if (kmRemaining <= 500) {
    status = 'DUE_SOON';
  }

  return {
    nextDueKm: targetDueKm,
    kmRemaining,
    status,
  };
}

/**
 * Checks vehicle PM status during telematics ingestion and triggers alerts when threshold is breached.
 */
export async function checkAndTriggerPmOdometerAlerts(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicle: { id: string; vehicleCode?: string | null; licensePlate?: string | null },
  currentOdometerKm: number,
): Promise<PmCheckResult> {
  const serviceIntervalKm = 10000; // Standard 10k km commercial interval

  const evalResult = evaluatePmOdometerThresholdSync(currentOdometerKm, serviceIntervalKm);
  let alertRaised = false;

  if (evalResult.status === 'DUE_SOON' || evalResult.status === 'OVERDUE') {
    alertRaised = true;
    const severity = evalResult.status === 'OVERDUE' ? 'HIGH' : 'MEDIUM';
    const code = evalResult.status === 'OVERDUE' ? 'PM_SERVICE_OVERDUE' : 'PM_SERVICE_DUE_SOON';
    const vehicleLabel = vehicle.vehicleCode || vehicle.licensePlate || 'Vehicle';

    await raiseAlert({
      tenantId,
      code,
      sourceModule: 'fleet',
      subjectType: 'Vehicle',
      subjectId: vehicle.id,
      severity,
      title: `PM Service ${evalResult.status === 'OVERDUE' ? 'OVERDUE' : 'Due Soon'}: ${vehicleLabel}`,
      description: `Current Odometer: ${currentOdometerKm.toLocaleString()} km. Scheduled ${serviceIntervalKm.toLocaleString()} km service target is ${evalResult.nextDueKm.toLocaleString()} km (${evalResult.kmRemaining <= 0 ? `${Math.abs(evalResult.kmRemaining)} km overdue` : `${evalResult.kmRemaining} km remaining`}).`,
      dedupeKey: `${code}:${vehicle.id}:${evalResult.nextDueKm}`,
    }).catch((err) => console.warn('[pm-odometer-sync] Alert failed:', err));
  }

  return {
    vehicleId: vehicle.id,
    currentOdometerKm,
    serviceIntervalKm,
    nextDueKm: evalResult.nextDueKm,
    kmRemaining: evalResult.kmRemaining,
    status: evalResult.status,
    alertRaised,
  };
}
