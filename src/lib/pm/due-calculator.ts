/**
 * PM Due Calculation Engine
 *
 * Evaluates whether a PMScheduleItem is UPCOMING / DUE / OVERDUE given the
 * current vehicle odometer and today's date.
 *
 * "Whichever comes first" semantics: the item is DUE as soon as ANY single
 * trigger enters its early-service window; OVERDUE as soon as ANY trigger
 * has passed its due point plus grace period.
 */

import {
    PMTriggerType,
    PMItemStatus,
    type PMDueCalculation,
    type PMScheduleItem,
    type MaintenancePlan,
} from '@/types/maintenance';

export interface VehicleSnapshot {
    id: string;
    currentOdometerKm: number;
    currentEngineHours?: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Calculate the due status for a single PM schedule item.
 *
 * @param item    - the per-vehicle tracking row
 * @param plan    - the plan definition including triggers + window config
 * @param vehicle - current vehicle telemetry snapshot
 * @param now     - override for "today" (useful in tests)
 */
export function calculateDue(
    item: PMScheduleItem,
    plan: MaintenancePlan,
    vehicle: VehicleSnapshot,
    now: Date = new Date(),
): PMDueCalculation {
    const graceDays = plan.gracePeriodDays  ?? 0;
    const earlyDays = plan.earlyWindowDays  ?? 7;
    const earlyKm   = plan.earlyWindowKm    ?? 500;

    // Track the "worst" reading across all triggers
    let minDaysUntilDue: number | undefined;
    let minKmUntilDue:   number | undefined;

    for (const trigger of plan.triggers) {
        switch (trigger.triggerType) {
            case PMTriggerType.CALENDAR: {
                // Compute next due date from last service + interval days
                let nextDue: Date | null = null;
                if (item.lastServiceDate) {
                    const base = new Date(item.lastServiceDate);
                    nextDue = new Date(base.getTime() + trigger.intervalValue * MS_PER_DAY);
                } else if (item.nextDueDateCalc) {
                    nextDue = new Date(item.nextDueDateCalc);
                }
                if (!nextDue) break;

                const days = (nextDue.getTime() - now.getTime()) / MS_PER_DAY;
                // Floating-point ceiling toward "more urgent"
                const daysInt = Math.ceil(days);
                if (minDaysUntilDue === undefined || daysInt < minDaysUntilDue) {
                    minDaysUntilDue = daysInt;
                }
                break;
            }

            case PMTriggerType.ODOMETER: {
                const baseKm   = item.lastOdometerKm ?? 0;
                const nextKm   = baseKm + trigger.intervalValue;
                const kmRemain = nextKm - vehicle.currentOdometerKm;
                if (minKmUntilDue === undefined || kmRemain < minKmUntilDue) {
                    minKmUntilDue = kmRemain;
                }
                break;
            }

            case PMTriggerType.ENGINE_HOURS:
            case PMTriggerType.OPERATING_HOURS:
                // Fall back to calendar semantics until hour-meter telemetry is wired
                break;

            case PMTriggerType.COMPONENT_LIFE:
                // Component life uses intervalValue as days from install
                if (item.lastServiceDate) {
                    const base    = new Date(item.lastServiceDate);
                    const nextDue = new Date(base.getTime() + trigger.intervalValue * MS_PER_DAY);
                    const days    = Math.ceil((nextDue.getTime() - now.getTime()) / MS_PER_DAY);
                    if (minDaysUntilDue === undefined || days < minDaysUntilDue) {
                        minDaysUntilDue = days;
                    }
                }
                break;
        }
    }

    // ── Classify per trigger dimension ────────────────────────────────────────
    // OVERDUE  = past due + grace period
    // DUE      = within early-service window (but not yet overdue)
    // UPCOMING = outside all windows

    const calendarOverdue = minDaysUntilDue !== undefined && minDaysUntilDue < -graceDays;
    const calendarDue     = minDaysUntilDue !== undefined && minDaysUntilDue <= earlyDays && !calendarOverdue;

    const odometerOverdue = minKmUntilDue !== undefined && minKmUntilDue < 0;
    const odometerDue     = minKmUntilDue !== undefined && minKmUntilDue <= earlyKm && !odometerOverdue;

    let rawStatus: PMItemStatus = PMItemStatus.UPCOMING;
    let triggeringFactor: PMDueCalculation['triggeringFactor'] = 'NONE';

    if (calendarOverdue || odometerOverdue) {
        rawStatus = PMItemStatus.OVERDUE;
        if (calendarOverdue && odometerOverdue) triggeringFactor = 'BOTH';
        else if (calendarOverdue)               triggeringFactor = 'CALENDAR';
        else                                    triggeringFactor = 'ODOMETER';
    } else if (calendarDue || odometerDue) {
        rawStatus = PMItemStatus.DUE;
        if (calendarDue && odometerDue) triggeringFactor = 'BOTH';
        else if (calendarDue)           triggeringFactor = 'CALENDAR';
        else                            triggeringFactor = 'ODOMETER';
    }

    // Respect terminal states stored on the item itself
    const effectiveStatus =
        item.status === PMItemStatus.COMPLETED ? PMItemStatus.COMPLETED :
        item.status === PMItemStatus.SNOOZED   ? PMItemStatus.SNOOZED   :
        rawStatus;

    // ── Urgency score (0–100) ─────────────────────────────────────────────────
    let urgencyScore = 0;
    if (effectiveStatus === PMItemStatus.OVERDUE) {
        const overdueDays = minDaysUntilDue !== undefined ? -minDaysUntilDue : 0;
        const overdueKm   = minKmUntilDue   !== undefined ? -minKmUntilDue   : 0;
        urgencyScore = Math.min(100, 70 + Math.max(overdueDays * 2, overdueKm / 100));
    } else if (effectiveStatus === PMItemStatus.DUE) {
        const dayRatio = (minDaysUntilDue !== undefined && earlyDays > 0)
            ? 1 - (minDaysUntilDue / earlyDays) : 0;
        const kmRatio  = (minKmUntilDue !== undefined && earlyKm > 0)
            ? 1 - (minKmUntilDue / earlyKm) : 0;
        urgencyScore = Math.min(69, Math.round(Math.max(dayRatio, kmRatio) * 69));
    }

    return {
        item,
        effectiveStatus,
        daysUntilDue:    minDaysUntilDue,
        kmUntilDue:      minKmUntilDue,
        triggeringFactor,
        urgencyScore,
    };
}

/**
 * Sort due calculations most-urgent first.
 * OVERDUE > DUE > UPCOMING > COMPLETED / SNOOZED.
 */
export function sortByUrgency(calcs: PMDueCalculation[]): PMDueCalculation[] {
    const priority = (s: PMItemStatus) => {
        if (s === PMItemStatus.OVERDUE)   return 0;
        if (s === PMItemStatus.DUE)       return 1;
        if (s === PMItemStatus.UPCOMING)  return 2;
        return 3;
    };
    return [...calcs].sort((a, b) => {
        const diff = priority(a.effectiveStatus) - priority(b.effectiveStatus);
        if (diff !== 0) return diff;
        return b.urgencyScore - a.urgencyScore;
    });
}
