'use client';

import { useState, useMemo } from 'react';
import {
    Clock, AlertTriangle, CheckCircle2, XCircle, TrendingUp,
    ChevronRight, Activity, Timer, Wrench, ShieldCheck,
} from 'lucide-react';
import {
    MaintenanceStatus, MaintenancePriority, MaintenanceType,
    SLAStatus, SLAPhaseName, SLAPhaseSnapshot, SLASnapshot,
    DEFAULT_SLA_RULES,
} from '@/types/maintenance';
import { computeSLASnapshot } from '@/lib/maintenance/sla-engine';
import type { MaintenanceRequest } from '@/types/maintenance';

// ── seed data ─────────────────────────────────────────────────────────────────

function ago(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

const SEED_MRS: MaintenanceRequest[] = [
    {
        id: 'mr-001', vehicleId: 'V-001', driverId: 'D-001',
        requestDate: ago(20), description: 'Engine oil leak — urgent',
        status: MaintenanceStatus.UNDER_MAINTENANCE,
        priority: MaintenancePriority.CRITICAL,
        maintenanceType: MaintenanceType.CORRECTIVE,
        workOrderNo: 'WO-2608-001', comments: [],
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]:  ago(20),
            [MaintenanceStatus.SUBMITTED]:  ago(18),
            [MaintenanceStatus.ACCEPTED]:   ago(15),
            [MaintenanceStatus.UNDER_MAINTENANCE]: ago(10),
        },
    },
    {
        id: 'mr-002', vehicleId: 'V-002', driverId: 'D-002',
        requestDate: ago(600), description: 'Brake pad replacement',
        status: MaintenanceStatus.MAINTENANCE_COMPLETED,
        priority: MaintenancePriority.HIGH,
        maintenanceType: MaintenanceType.PREVENTIVE,
        workOrderNo: 'WO-2608-002', comments: [],
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]:  ago(600),
            [MaintenanceStatus.SUBMITTED]:  ago(595),
            [MaintenanceStatus.ACCEPTED]:   ago(590),
            [MaintenanceStatus.UNDER_ESTIMATION]: ago(580),
            [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL]: ago(560),
            [MaintenanceStatus.ESTIMATION_APPROVED]: ago(540),
            [MaintenanceStatus.UNDER_MAINTENANCE]: ago(480),
            [MaintenanceStatus.REPAIR_COMPLETED]: ago(60),
            [MaintenanceStatus.MAINTENANCE_COMPLETED]: ago(30),
        },
    },
    {
        id: 'mr-003', vehicleId: 'V-003', driverId: 'D-003',
        requestDate: ago(40), description: 'Tyre blowout on highway',
        status: MaintenanceStatus.UNDER_MAINTENANCE,
        priority: MaintenancePriority.CRITICAL,
        maintenanceType: MaintenanceType.BREAKDOWN,
        workOrderNo: 'WO-2608-003', comments: [],
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]: ago(40),
            [MaintenanceStatus.ACCEPTED]:  ago(35),
            [MaintenanceStatus.UNDER_MAINTENANCE]: ago(20),
        },
    },
    {
        id: 'mr-004', vehicleId: 'V-004', driverId: 'D-004',
        requestDate: ago(300), description: 'AC unit not cooling',
        status: MaintenanceStatus.PENDING_ESTIMATION_APPROVAL,
        priority: MaintenancePriority.MEDIUM,
        maintenanceType: MaintenanceType.CORRECTIVE,
        workOrderNo: 'WO-2608-004', comments: [],
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]: ago(300),
            [MaintenanceStatus.SUBMITTED]: ago(290),
            [MaintenanceStatus.ACCEPTED]:  ago(270),
            [MaintenanceStatus.UNDER_ESTIMATION]: ago(240),
            [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL]: ago(60),
        },
    },
    {
        id: 'mr-005', vehicleId: 'V-005', driverId: 'D-005',
        requestDate: ago(3200), description: '60,000 km scheduled service',
        status: MaintenanceStatus.CLOSED,
        priority: MaintenancePriority.LOW,
        maintenanceType: MaintenanceType.PREVENTIVE,
        workOrderNo: 'WO-2608-005', comments: [],
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]:  ago(3200),
            [MaintenanceStatus.SUBMITTED]:  ago(3190),
            [MaintenanceStatus.ACCEPTED]:   ago(3180),
            [MaintenanceStatus.UNDER_ESTIMATION]: ago(3120),
            [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL]: ago(3000),
            [MaintenanceStatus.ESTIMATION_APPROVED]: ago(2880),
            [MaintenanceStatus.UNDER_MAINTENANCE]: ago(2700),
            [MaintenanceStatus.REPAIR_COMPLETED]: ago(480),
            [MaintenanceStatus.MAINTENANCE_COMPLETED]: ago(300),
            [MaintenanceStatus.CLOSED]: ago(60),
        },
    },
    {
        id: 'mr-006', vehicleId: 'V-006', driverId: 'D-006',
        requestDate: ago(50), description: 'Battery dead — vehicle won\'t start',
        status: MaintenanceStatus.ACCEPTED,
        priority: MaintenancePriority.HIGH,
        maintenanceType: MaintenanceType.EMERGENCY,
        workOrderNo: 'WO-2608-006', comments: [],
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]: ago(50),
            [MaintenanceStatus.SUBMITTED]: ago(45),
            [MaintenanceStatus.ACCEPTED]:  ago(40),
        },
    },
];

// ── config maps ───────────────────────────────────────────────────────────────

const SLA_STATUS_CFG: Record<SLAStatus, { label: string; cls: string; dot: string }> = {
    MET:      { label: 'Met',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
    AT_RISK:  { label: 'At Risk',  cls: 'bg-amber-50  text-amber-700  border-amber-200',  dot: 'bg-amber-500'  },
    BREACHED: { label: 'Breached', cls: 'bg-red-50    text-red-700    border-red-200',    dot: 'bg-red-500'    },
};

const TIER_CFG: Record<string, { label: string; cls: string }> = {
    CRITICAL: { label: 'Critical', cls: 'bg-red-100    text-red-700'    },
    HIGH:     { label: 'High',     cls: 'bg-orange-100 text-orange-700' },
    NORMAL:   { label: 'Normal',   cls: 'bg-blue-100   text-blue-700'   },
};

const PHASE_ICONS: Record<SLAPhaseName, React.ReactNode> = {
    RESPONSE:   <Clock      className="w-3.5 h-3.5" />,
    DIAGNOSIS:  <Activity   className="w-3.5 h-3.5" />,
    ESTIMATION: <Calculator className="w-3.5 h-3.5" />,
    APPROVAL:   <ShieldCheck className="w-3.5 h-3.5" />,
    REPAIR:     <Wrench     className="w-3.5 h-3.5" />,
    COMPLETION: <CheckCircle2 className="w-3.5 h-3.5" />,
    VENDOR:     <Timer      className="w-3.5 h-3.5" />,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtMins(mins: number | null): string {
    if (mins === null) return '—';
    if (mins < 60) return `${Math.round(mins)}m`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
}

function phaseBar(phase: SLAPhaseSnapshot): number {
    // Returns 0-100 progress percentage
    if (!phase.startedAt) return 0;
    if (phase.completedAt && phase.elapsedMinutes !== null) {
        return Math.min(100, (phase.elapsedMinutes / phase.targetMinutes) * 100);
    }
    if (phase.elapsedMinutes !== null) {
        return Math.min(100, (phase.elapsedMinutes / phase.targetMinutes) * 100);
    }
    return 0;
}

function phaseBarColor(status: SLAPhaseSnapshot['status']): string {
    if (status === 'MET')      return 'bg-emerald-500';
    if (status === 'AT_RISK')  return 'bg-amber-500';
    if (status === 'BREACHED') return 'bg-red-500';
    return 'bg-slate-300';
}

// ── sub-components ────────────────────────────────────────────────────────────

function KpiCard({
    icon, label, value, sub, colorCls,
}: {
    icon: React.ReactNode;
    label: string;
    value: number | string;
    sub?: string;
    colorCls: string;
}) {
    return (
        <div className="bg-white rounded-xl border border-[var(--border-subtle)] p-4 flex items-start gap-3">
            <div className={`p-2 rounded-lg ${colorCls}`}>{icon}</div>
            <div>
                <p className="text-2xl font-bold text-[var(--text-main)]">{value}</p>
                <p className="text-sm text-[var(--text-faint)]">{label}</p>
                {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

function StatusPill({ status }: { status: SLAStatus | 'PENDING' }) {
    if (status === 'PENDING') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[var(--bg-surface-hover)] text-[var(--text-faint)] border-[var(--border-subtle)]">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                Pending
            </span>
        );
    }
    const cfg = SLA_STATUS_CFG[status];
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
        </span>
    );
}

function PhaseRow({ phase }: { phase: SLAPhaseSnapshot }) {
    const pct = phaseBar(phase);
    const barColor = phaseBarColor(phase.status);
    return (
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 w-28 shrink-0 text-[var(--text-faint)] text-xs">
                {PHASE_ICONS[phase.phase]}
                <span>{phase.label}</span>
            </div>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <div className="w-24 text-right shrink-0">
                <StatusPill status={phase.status} />
            </div>
            <div className="w-20 text-right text-xs text-[var(--text-faint)] shrink-0">
                {phase.status === 'PENDING' ? '—' :
                    phase.completedAt ? fmtMins(phase.elapsedMinutes) + ' / ' + fmtMins(phase.targetMinutes) :
                    fmtMins(phase.remainingMinutes) + ' left'}
            </div>
        </div>
    );
}

// ── Calculator icon (not in lucide set imported above) ────────────────────────
function Calculator({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="10" x2="8" y2="10" strokeWidth={3} />
            <line x1="12" y1="10" x2="12" y2="10" strokeWidth={3} />
            <line x1="16" y1="10" x2="16" y2="10" strokeWidth={3} />
            <line x1="8" y1="14" x2="8" y2="14" strokeWidth={3} />
            <line x1="12" y1="14" x2="12" y2="14" strokeWidth={3} />
            <line x1="16" y1="14" x2="16" y2="18" strokeWidth={3} />
            <line x1="8" y1="18" x2="8" y2="18" strokeWidth={3} />
            <line x1="12" y1="18" x2="12" y2="18" strokeWidth={3} />
        </svg>
    );
}

// ── main page ─────────────────────────────────────────────────────────────────

type StatusFilter = 'ALL' | SLAStatus;

export default function SLADashboardPage() {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [tierFilter, setTierFilter]     = useState<'ALL' | string>('ALL');
    const [selectedId, setSelectedId]     = useState<string | null>(null);

    // Compute snapshots once (seed data is static; in production this would
    // come from the API endpoint GET /api/maintenance/[id]/sla).
    const snapshots = useMemo<SLASnapshot[]>(() => {
        return SEED_MRS.map(mr => computeSLASnapshot(mr));
    }, []);

    // KPI counts
    const breached = snapshots.filter(s => s.overallStatus === 'BREACHED').length;
    const atRisk   = snapshots.filter(s => s.overallStatus === 'AT_RISK').length;
    const met      = snapshots.filter(s => s.overallStatus === 'MET').length;

    // Filtered list
    const filtered = useMemo(() => {
        return snapshots.filter(s => {
            if (statusFilter !== 'ALL' && s.overallStatus !== statusFilter) return false;
            if (tierFilter   !== 'ALL' && s.tier           !== tierFilter)   return false;
            return true;
        });
    }, [snapshots, statusFilter, tierFilter]);

    const selected = selectedId ? snapshots.find(s => s.mrId === selectedId) ?? null : null;
    const selectedMR = selected ? SEED_MRS.find(m => m.id === selected.mrId) ?? null : null;

    const STATUS_TABS: { key: StatusFilter; label: string; count: number }[] = [
        { key: 'ALL',      label: 'All',      count: snapshots.length },
        { key: 'BREACHED', label: 'Breached', count: breached },
        { key: 'AT_RISK',  label: 'At Risk',  count: atRisk },
        { key: 'MET',      label: 'Met',      count: met },
    ];

    return (
        <div className="min-h-screen bg-[var(--bg-surface-hover)] p-6 space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                    Maintenance SLA
                </h1>
                <p className="text-sm text-[var(--text-faint)] mt-0.5">
                    Response &amp; repair SLA tracking across all active maintenance requests
                </p>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard
                    icon={<Activity className="w-4 h-4 text-blue-600" />}
                    label="Total monitored" value={snapshots.length}
                    colorCls="bg-blue-50"
                />
                <KpiCard
                    icon={<XCircle className="w-4 h-4 text-red-600" />}
                    label="SLA breached" value={breached}
                    sub={`${Math.round((breached / snapshots.length) * 100)}% of total`}
                    colorCls="bg-red-50"
                />
                <KpiCard
                    icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
                    label="At risk" value={atRisk}
                    sub="≤ 20% time remaining"
                    colorCls="bg-amber-50"
                />
                <KpiCard
                    icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    label="SLA met" value={met}
                    colorCls="bg-emerald-50"
                />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Status tabs */}
                <div className="flex bg-white border border-[var(--border-subtle)] rounded-lg p-0.5 gap-0.5">
                    {STATUS_TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setStatusFilter(t.key)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                statusFilter === t.key
                                    ? 'bg-blue-600 text-white'
                                    : 'text-[var(--text-faint)] hover:bg-[var(--bg-surface-hover)]'
                            }`}
                        >
                            {t.label}
                            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                                statusFilter === t.key ? 'bg-blue-500 text-white' : 'bg-slate-100 text-[var(--text-faint)]'
                            }`}>{t.count}</span>
                        </button>
                    ))}
                </div>

                {/* Tier filter */}
                <select
                    value={tierFilter}
                    onChange={e => setTierFilter(e.target.value)}
                    className="text-xs border border-[var(--border-subtle)] rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="ALL">All tiers</option>
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="NORMAL">Normal</option>
                </select>
            </div>

            {/* Two-pane layout */}
            <div className="flex gap-4 items-start">
                {/* League table */}
                <div className="flex-1 min-w-0 bg-white rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] text-xs text-[var(--text-faint)] uppercase tracking-wide">
                                    <th className="text-left px-4 py-3 font-medium">Work Order</th>
                                    <th className="text-left px-4 py-3 font-medium">Description</th>
                                    <th className="text-left px-4 py-3 font-medium">Tier</th>
                                    <th className="text-left px-4 py-3 font-medium">Response</th>
                                    <th className="text-left px-4 py-3 font-medium">Repair</th>
                                    <th className="text-left px-4 py-3 font-medium">Overall</th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)]">
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="text-center py-10 text-[var(--text-muted)] text-sm">
                                            No maintenance requests match the selected filters.
                                        </td>
                                    </tr>
                                )}
                                {filtered.map(snap => {
                                    const mr = SEED_MRS.find(m => m.id === snap.mrId)!;
                                    const tierCfg = TIER_CFG[snap.tier];
                                    const isSelected = selectedId === snap.mrId;
                                    return (
                                        <tr
                                            key={snap.mrId}
                                            onClick={() => setSelectedId(isSelected ? null : snap.mrId)}
                                            className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                                                isSelected ? 'bg-blue-50' : ''
                                            }`}
                                        >
                                            <td className="px-4 py-3 font-mono text-xs text-blue-700">
                                                {mr.workOrderNo ?? snap.mrId.slice(0, 8)}
                                            </td>
                                            <td className="px-4 py-3 text-slate-800 max-w-[180px] truncate">
                                                {mr.description}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${tierCfg.cls}`}>
                                                    {tierCfg.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusPill status={snap.responseStatus} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusPill status={snap.repairStatus} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusPill status={snap.overallStatus} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <ChevronRight className={`w-4 h-4 transition-transform ${isSelected ? 'rotate-90 text-blue-600' : 'text-[var(--text-muted)]'}`} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Detail panel */}
                {selected && selectedMR && (
                    <div className="w-96 shrink-0 bg-white rounded-xl border border-[var(--border-subtle)] p-5 space-y-5 sticky top-6">
                        <div>
                            <div className="flex items-center justify-between">
                                <h2 className="font-semibold text-[var(--text-main)] text-sm">SLA Detail</h2>
                                <button
                                    onClick={() => setSelectedId(null)}
                                    className="text-[var(--text-muted)] hover:text-[var(--text-faint)] text-xs"
                                >
                                    ✕
                                </button>
                            </div>
                            <p className="text-xs text-[var(--text-faint)] mt-1">{selectedMR.description}</p>
                        </div>

                        {/* Summary badges */}
                        <div className="flex flex-wrap gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${TIER_CFG[selected.tier].cls}`}>
                                {TIER_CFG[selected.tier].label} tier
                            </span>
                            <StatusPill status={selected.overallStatus} />
                        </div>

                        {/* Response / Repair deadlines */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-[var(--bg-surface-hover)] rounded-lg p-3">
                                <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide font-medium">Response deadline</p>
                                <p className="text-xs font-semibold text-slate-800 mt-0.5">
                                    {fmtMins(selected.rules.responseMinutes)} target
                                </p>
                                <StatusPill status={selected.responseStatus} />
                            </div>
                            <div className="bg-[var(--bg-surface-hover)] rounded-lg p-3">
                                <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide font-medium">Repair deadline</p>
                                <p className="text-xs font-semibold text-slate-800 mt-0.5">
                                    {fmtMins(selected.rules.repairMinutes)} target
                                </p>
                                <StatusPill status={selected.repairStatus} />
                            </div>
                        </div>

                        {/* Phase breakdown */}
                        <div>
                            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
                                Phase breakdown
                            </h3>
                            <div className="space-y-3">
                                {selected.phases.map(phase => (
                                    <PhaseRow key={phase.phase} phase={phase} />
                                ))}
                            </div>
                        </div>

                        {/* Breach heatmap row */}
                        <div>
                            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                                Phase heat
                            </h3>
                            <div className="flex gap-1">
                                {selected.phases.map(phase => {
                                    const color =
                                        phase.status === 'BREACHED' ? 'bg-red-400' :
                                        phase.status === 'AT_RISK'  ? 'bg-amber-400' :
                                        phase.status === 'MET'      ? 'bg-emerald-400' :
                                        'bg-slate-200';
                                    return (
                                        <div
                                            key={phase.phase}
                                            title={`${phase.label}: ${phase.status}`}
                                            className={`flex-1 h-4 rounded ${color}`}
                                        />
                                    );
                                })}
                            </div>
                            <div className="flex gap-1 mt-0.5">
                                {selected.phases.map(phase => (
                                    <div key={phase.phase} className="flex-1 text-[9px] text-[var(--text-muted)] text-center truncate">
                                        {phase.label.slice(0, 3)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
