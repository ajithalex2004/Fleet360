/**
 * Maintenance Risk Score Engine — Phase G
 *
 * Pure computation — no DB calls. Accepts RiskScoreInputs and returns a
 * 0–100 MaintenanceRiskScore across 10 maintenance-domain factors.
 *
 * Bands:
 *   🔴 CRITICAL  75 – 100
 *   🟠 HIGH      50 – 74
 *   🟡 MEDIUM    25 – 49
 *   🟢 LOW        0 – 24
 */

import type {
    RiskScoreInputs,
    RiskFactor,
    MaintenanceRiskScore,
    RiskBand,
} from '@/types/maintenance';

// ── band helpers ──────────────────────────────────────────────────────────────

function bandFor(score: number): RiskBand {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 25) return 'MEDIUM';
    return 'LOW';
}

const BAND_EMOJI: Record<RiskBand, string> = {
    CRITICAL: '🔴',
    HIGH:     '🟠',
    MEDIUM:   '🟡',
    LOW:      '🟢',
};

/** Clamp a value to [min, max]. */
const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

// ── factor scorers ────────────────────────────────────────────────────────────

/** F1 — Overdue PM (max 20 pts) */
function f1_overduePM(inp: RiskScoreInputs): RiskFactor {
    const interval = inp.pmIntervalDays ?? 90;
    const days     = inp.daysSinceLastPM ?? 0;
    const overdue  = Math.max(0, days - interval);
    // Linear: 0 overdue → 0, 1+ interval overdue → 20
    const score    = clamp(Math.round((overdue / interval) * 20), 0, 20);
    return {
        key:      'overdue_pm',
        label:    'Overdue PM',
        score,
        maxScore: 20,
        pct:      score / 20,
        description: overdue > 0
            ? `${overdue}d overdue (interval ${interval}d)`
            : 'PM up to date',
    };
}

/** F2 — Recent failures (max 15 pts) */
function f2_recentFailures(inp: RiskScoreInputs): RiskFactor {
    const count = inp.failuresLast90d ?? 0;
    // 3 pts per failure, max 5 failures = 15 pts
    const score = clamp(count * 3, 0, 15);
    return {
        key:      'recent_failures',
        label:    'Recent failures',
        score,
        maxScore: 15,
        pct:      score / 15,
        description: `${count} breakdown/emergency MR${count !== 1 ? 's' : ''} in 90 d`,
    };
}

/** F3 — Mileage (max 10 pts) */
function f3_mileage(inp: RiskScoreInputs): RiskFactor {
    const odometer  = inp.odometerKm      ?? 0;
    const lifetime  = inp.expectedLifetimeKm ?? 300_000;
    const ratio     = odometer / lifetime;
    // Square-root curve: 0 km→0, half-life→7, full→10
    const score = clamp(Math.round(Math.sqrt(ratio) * 10), 0, 10);
    return {
        key:      'mileage',
        label:    'Mileage',
        score,
        maxScore: 10,
        pct:      score / 10,
        description: `${Math.round(odometer / 1000)}k km (${Math.round(ratio * 100)}% of ${Math.round(lifetime / 1000)}k limit)`,
    };
}

/** F4 — Vehicle age (max 10 pts) */
function f4_vehicleAge(inp: RiskScoreInputs): RiskFactor {
    const age   = inp.ageYears ?? 0;
    // Linear: 0 yr→0, 8+ yr→10
    const score = clamp(Math.round((age / 8) * 10), 0, 10);
    return {
        key:      'vehicle_age',
        label:    'Vehicle age',
        score,
        maxScore: 10,
        pct:      score / 10,
        description: `${age.toFixed(1)} years old`,
    };
}

/** F5 — Component condition (max 10 pts) */
function f5_componentCondition(inp: RiskScoreInputs): RiskFactor {
    const failed = inp.failedInspections ?? 0;
    // 5 pts per failed inspection, max 2 = 10 pts
    const score  = clamp(failed * 5, 0, 10);
    return {
        key:      'component_condition',
        label:    'Component condition',
        score,
        maxScore: 10,
        pct:      score / 10,
        description: failed > 0
            ? `${failed} quality inspection${failed !== 1 ? 's' : ''} failed`
            : 'All inspections passed',
    };
}

/** F6 — Repeat failures (max 10 pts) */
function f6_repeatFailures(inp: RiskScoreInputs): RiskFactor {
    const count = inp.repeatJobsLast180d ?? 0;
    // 5 pts per repeat, max 2 = 10 pts
    const score = clamp(count * 5, 0, 10);
    return {
        key:      'repeat_failures',
        label:    'Repeat failures',
        score,
        maxScore: 10,
        pct:      score / 10,
        description: `${count} recurring job type${count !== 1 ? 's' : ''} in 180 d`,
    };
}

/** F7 — Open defects (max 10 pts) */
function f7_openDefects(inp: RiskScoreInputs): RiskFactor {
    const count = inp.openDefects ?? 0;
    // 3 pts per open defect, max 3 = ~9 (capped at 10)
    const score = clamp(count * 3, 0, 10);
    return {
        key:      'open_defects',
        label:    'Open defects',
        score,
        maxScore: 10,
        pct:      score / 10,
        description: `${count} open MR${count !== 1 ? 's' : ''} awaiting action`,
    };
}

/** F8 — Downtime (max 5 pts) */
function f8_downtime(inp: RiskScoreInputs): RiskFactor {
    const days  = inp.downtimeDaysLast90d ?? 0;
    // Linear: 0 d→0, 7+ d→5
    const score = clamp(Math.round((days / 7) * 5), 0, 5);
    return {
        key:      'downtime',
        label:    'Downtime',
        score,
        maxScore: 5,
        pct:      score / 5,
        description: `${days}d under maintenance in 90 d`,
    };
}

/** F9 — Warranty status (max 5 pts) */
function f9_warrantyStatus(inp: RiskScoreInputs): RiskFactor {
    const covered = inp.warrantyActive ?? false;
    const score   = covered ? 0 : 5;
    return {
        key:      'warranty_status',
        label:    'Warranty status',
        score,
        maxScore: 5,
        pct:      score / 5,
        description: covered ? 'Warranty active' : 'No warranty coverage',
    };
}

/** F10 — Predictive risk (max 5 pts) — bridges to AI Platform */
function f10_predictiveRisk(inp: RiskScoreInputs): RiskFactor {
    const ai01 = inp.aiRiskScore01 ?? 0;
    const score = clamp(Math.round(ai01 * 5), 0, 5);
    return {
        key:      'predictive_risk',
        label:    'Predictive risk (AI)',
        score,
        maxScore: 5,
        pct:      score / 5,
        description: ai01 > 0
            ? `AI confidence ${Math.round(ai01 * 100)}% failure within window`
            : 'No AI prediction available',
    };
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Compute a 0–100 maintenance risk score for a single vehicle.
 *
 * All inputs are optional — missing signals score 0 (optimistic default).
 * Callers should supply as many signals as possible for accuracy.
 */
export function computeRiskScore(inp: RiskScoreInputs): MaintenanceRiskScore {
    const factors: RiskFactor[] = [
        f1_overduePM(inp),
        f2_recentFailures(inp),
        f3_mileage(inp),
        f4_vehicleAge(inp),
        f5_componentCondition(inp),
        f6_repeatFailures(inp),
        f7_openDefects(inp),
        f8_downtime(inp),
        f9_warrantyStatus(inp),
        f10_predictiveRisk(inp),
    ];

    const raw   = factors.reduce((sum, f) => sum + f.score, 0);
    const score = clamp(Math.round(raw), 0, 100);
    const band  = bandFor(score);

    return {
        vehicleId:    inp.vehicleId,
        vehicleCode:  inp.vehicleCode   ?? inp.vehicleId.slice(0, 8),
        licensePlate: inp.licensePlate  ?? '—',
        make:         inp.make          ?? 'Unknown',
        model:        inp.model         ?? '',
        score,
        band,
        emoji:        BAND_EMOJI[band],
        factors,
        computedAt:   new Date().toISOString(),
    };
}
