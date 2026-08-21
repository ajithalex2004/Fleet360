/**
 * Maintenance SLA Engine — Phase F
 *
 * Pure computation — no DB calls. Takes a MaintenanceRequest and returns a
 * fully-computed SLASnapshot covering 7 phases plus overall response / repair
 * deadlines.
 *
 * Tier mapping:
 *   BREAKDOWN type  OR  CRITICAL priority  →  CRITICAL (15 min / 4 hr)
 *   HIGH priority                          →  HIGH     (30 min / 8 hr)
 *   everything else                        →  NORMAL   (4 hr  / 48 hr)
 */

import {
    MaintenanceRequest,
    MaintenancePriority,
    MaintenanceType,
    MaintenanceStatus,
    SLATier,
    SLAStatus,
    SLAPhaseName,
    SLARuleSet,
    SLAPhaseSnapshot,
    SLASnapshot,
    DEFAULT_SLA_RULES,
} from '@/types/maintenance';

// ── helpers ──────────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<SLAPhaseName, string> = {
    RESPONSE:   'Response',
    DIAGNOSIS:  'Diagnosis',
    ESTIMATION: 'Estimation',
    APPROVAL:   'Approval',
    REPAIR:     'Repair',
    COMPLETION: 'Completion',
    VENDOR:     'Vendor',
};

const PHASE_ORDER: SLAPhaseName[] = [
    'RESPONSE', 'DIAGNOSIS', 'ESTIMATION', 'APPROVAL', 'REPAIR', 'COMPLETION', 'VENDOR',
];

function tierForMR(
    mr: Pick<MaintenanceRequest, 'priority' | 'maintenanceType'>,
): SLATier {
    if (mr.maintenanceType === MaintenanceType.BREAKDOWN) return 'CRITICAL';
    if (mr.priority === MaintenancePriority.CRITICAL)     return 'CRITICAL';
    if (mr.priority === MaintenancePriority.HIGH)         return 'HIGH';
    return 'NORMAL';
}

/** Add `minutes` to an ISO string and return the resulting ISO string. */
function addMinutes(iso: string, minutes: number): string {
    return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Elapsed minutes between two ISO strings (positive = forward in time). */
function minutesBetween(from: string, to: string): number {
    return (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
}

/**
 * Return the first non-null value from `statusTimeline` matching any key in
 * `keys`, in the order given.
 */
function getTs(
    tl: Partial<Record<MaintenanceStatus, string>>,
    ...keys: MaintenanceStatus[]
): string | null {
    for (const k of keys) {
        if (tl[k]) return tl[k]!;
    }
    return null;
}

/**
 * Classify a single phase.
 *
 * Rules:
 * - No start            → PENDING
 * - Completed ≤ deadline → MET
 * - Completed > deadline → BREACHED
 * - Not completed, past deadline → BREACHED
 * - Not completed, ≤ 20 % of target remaining → AT_RISK
 * - Otherwise → MET (still within comfortable window)
 */
function classifyPhase(
    startedAt: string | null,
    completedAt: string | null,
    deadlineAt: string | null,
    now: Date,
    targetMinutes: number,
): SLAStatus | 'PENDING' {
    if (!startedAt) return 'PENDING';
    if (completedAt) {
        return new Date(completedAt) <= new Date(deadlineAt!) ? 'MET' : 'BREACHED';
    }
    if (!deadlineAt) return 'PENDING';
    const msUntil = new Date(deadlineAt).getTime() - now.getTime();
    if (msUntil <= 0) return 'BREACHED';
    const atRiskMs = targetMinutes * 60_000 * 0.20;
    return msUntil <= atRiskMs ? 'AT_RISK' : 'MET';
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Compute a full SLASnapshot for a MaintenanceRequest.
 *
 * @param mr           The maintenance request (statusTimeline drives phase detection).
 * @param rulesOverride Optional per-tenant rule overrides; defaults to DEFAULT_SLA_RULES.
 * @param now          Injected "now" for testability; defaults to new Date().
 */
export function computeSLASnapshot(
    mr: MaintenanceRequest,
    rulesOverride?: Record<SLATier, SLARuleSet>,
    now: Date = new Date(),
): SLASnapshot {
    const rules = rulesOverride ?? DEFAULT_SLA_RULES;
    const tier  = tierForMR(mr);
    const rule  = rules[tier];
    const tl    = mr.statusTimeline ?? {};

    // Anchor the clock on the request date (creation timestamp).
    const createdAt: string =
        mr.requestDate ??
        tl[MaintenanceStatus.REQUESTED] ??
        now.toISOString();

    // ── phase boundary timestamps from statusTimeline ─────────────────────
    const bounds: Record<SLAPhaseName, { start: string | null; end: string | null }> = {
        RESPONSE: {
            start: createdAt,
            end:   getTs(tl, MaintenanceStatus.SUBMITTED, MaintenanceStatus.ACCEPTED),
        },
        DIAGNOSIS: {
            start: getTs(tl, MaintenanceStatus.ACCEPTED),
            end:   getTs(tl, MaintenanceStatus.UNDER_ESTIMATION, MaintenanceStatus.UNDER_MAINTENANCE),
        },
        ESTIMATION: {
            start: getTs(tl, MaintenanceStatus.UNDER_ESTIMATION),
            end:   getTs(tl, MaintenanceStatus.PENDING_ESTIMATION_APPROVAL),
        },
        APPROVAL: {
            start: getTs(tl, MaintenanceStatus.PENDING_ESTIMATION_APPROVAL),
            end:   getTs(tl, MaintenanceStatus.ESTIMATION_APPROVED),
        },
        REPAIR: {
            start: getTs(tl, MaintenanceStatus.UNDER_MAINTENANCE),
            end:   getTs(tl, MaintenanceStatus.JOB_COMPLETED),
        },
        COMPLETION: {
            start: getTs(tl, MaintenanceStatus.JOB_COMPLETED),
            end:   getTs(tl,
                MaintenanceStatus.MAINTENANCE_COMPLETED,
                MaintenanceStatus.COMPLETED,
            ),
        },
        VENDOR: {
            // Vendor SLA: from when the garage was engaged (ACCEPTED) to repair done.
            start: getTs(tl, MaintenanceStatus.ACCEPTED),
            end:   getTs(tl, MaintenanceStatus.JOB_COMPLETED),
        },
    };

    // ── build phase snapshots ─────────────────────────────────────────────
    const phases: SLAPhaseSnapshot[] = PHASE_ORDER.map(phase => {
        const { start, end } = bounds[phase];
        const targetMinutes  = rule.phaseMinutes[phase];
        const deadlineAt     = start ? addMinutes(start, targetMinutes) : null;

        const elapsedMinutes = start
            ? minutesBetween(start, end ?? now.toISOString())
            : null;

        const remainingMinutes = (start && !end && deadlineAt)
            ? Math.max(0, minutesBetween(now.toISOString(), deadlineAt))
            : null;

        const status = classifyPhase(start, end, deadlineAt, now, targetMinutes);

        return {
            phase,
            label:    PHASE_LABELS[phase],
            startedAt:      start,
            completedAt:    end,
            deadlineAt,
            targetMinutes,
            elapsedMinutes,
            remainingMinutes,
            status,
        };
    });

    // ── top-level response / repair deadlines ─────────────────────────────
    const responseDeadlineAt = addMinutes(createdAt, rule.responseMinutes);
    const responseEndTs      = getTs(tl, MaintenanceStatus.SUBMITTED, MaintenanceStatus.ACCEPTED);
    const responseStatus     = classifyPhase(
        createdAt, responseEndTs, responseDeadlineAt, now, rule.responseMinutes,
    );

    const repairDeadlineAt = addMinutes(createdAt, rule.repairMinutes);
    const repairEndTs      = getTs(
        tl,
        MaintenanceStatus.MAINTENANCE_COMPLETED,
        MaintenanceStatus.COMPLETED,
        MaintenanceStatus.CLOSED,
    );
    const repairStatus = classifyPhase(
        createdAt, repairEndTs, repairDeadlineAt, now, rule.repairMinutes,
    );

    // ── overall status: worst across response + repair + active phases ────
    const allStatuses: Array<SLAStatus | 'PENDING'> = [
        responseStatus,
        repairStatus,
        ...phases.map(p => p.status),
    ];
    const overallStatus: SLAStatus = allStatuses.includes('BREACHED')
        ? 'BREACHED'
        : allStatuses.includes('AT_RISK')
        ? 'AT_RISK'
        : 'MET';

    return {
        mrId:      mr.id,
        priority:  mr.priority ?? 'NORMAL',
        tier,
        createdAt,
        overallStatus,
        responseDeadlineAt,
        repairDeadlineAt,
        responseStatus,
        repairStatus,
        phases,
        rules: rule,
    };
}
