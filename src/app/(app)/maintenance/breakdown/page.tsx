'use client';

import { useState } from 'react';
import {
    AlertTriangle, Plus, Truck, CheckCircle2, Clock,
    MapPin, Wrench, X, ChevronRight, Radio,
} from 'lucide-react';
import type { BreakdownReport, BreakdownType, BreakdownStatus, BreakdownSeverity } from '@/types/maintenance';

// ─── seed data ────────────────────────────────────────────────────────────────

const SEED: BreakdownReport[] = [
    {
        id: 'br-1',
        reportNo: 'BRK-202608-00001',
        tenantId: '',
        vehicleId: 'v-001',
        driverId: 'd-101',
        reportedAt: '2026-08-11T08:15:00Z',
        breakdownType: 'ENGINE_FAILURE',
        location: 'Sheikh Zayed Road, Dubai — near Exit 43',
        latitude: 25.1972,
        longitude: 55.2796,
        driverNotes: 'Engine warning light came on and vehicle lost power suddenly.',
        photoUrls: [],
        severity: 'HIGH',
        status: 'RECOVERY_DISPATCHED',
        recoveryVehicleId: 'rv-02',
        recoveryDriverId: 'rd-05',
        recoveryNotes: 'Recovery truck en route',
        recoveryDispatchedAt: '2026-08-11T08:25:00Z',
        recoveryCompletedAt: null,
        estimatedArrivalAt: '2026-08-11T09:00:00Z',
        maintenanceRequestId: 'mr-001',
        MaintenanceRequest: { id: 'mr-001', status: 'Open', workOrderNo: 'BRK-MR-001' },
        createdAt: '2026-08-11T08:15:00Z',
        updatedAt: '2026-08-11T08:25:00Z',
    },
    {
        id: 'br-2',
        reportNo: 'BRK-202608-00002',
        tenantId: '',
        vehicleId: 'v-005',
        driverId: 'd-108',
        reportedAt: '2026-08-10T14:30:00Z',
        breakdownType: 'FLAT_TYRE',
        location: 'Al Khail Road, Dubai',
        latitude: null,
        longitude: null,
        driverNotes: 'Front left tyre blew out.',
        photoUrls: [],
        severity: 'MEDIUM',
        status: 'AT_WORKSHOP',
        recoveryVehicleId: 'rv-01',
        recoveryDriverId: 'rd-03',
        recoveryNotes: null,
        recoveryDispatchedAt: '2026-08-10T14:45:00Z',
        recoveryCompletedAt: '2026-08-10T16:10:00Z',
        estimatedArrivalAt: null,
        maintenanceRequestId: 'mr-002',
        MaintenanceRequest: { id: 'mr-002', status: 'IN_PROGRESS', workOrderNo: 'BRK-MR-002' },
        createdAt: '2026-08-10T14:30:00Z',
        updatedAt: '2026-08-10T16:10:00Z',
    },
    {
        id: 'br-3',
        reportNo: 'BRK-202608-00003',
        tenantId: '',
        vehicleId: 'v-012',
        driverId: 'd-115',
        reportedAt: '2026-08-09T11:00:00Z',
        breakdownType: 'BATTERY_DEAD',
        location: 'Business Bay, Dubai',
        latitude: null,
        longitude: null,
        driverNotes: 'Vehicle would not start in the parking lot.',
        photoUrls: [],
        severity: 'LOW',
        status: 'RESOLVED',
        recoveryVehicleId: null,
        recoveryDriverId: null,
        recoveryNotes: null,
        recoveryDispatchedAt: null,
        recoveryCompletedAt: null,
        estimatedArrivalAt: null,
        maintenanceRequestId: 'mr-003',
        MaintenanceRequest: { id: 'mr-003', status: 'CLOSED', workOrderNo: 'BRK-MR-003' },
        createdAt: '2026-08-09T11:00:00Z',
        updatedAt: '2026-08-09T15:30:00Z',
    },
];

// ─── constants ────────────────────────────────────────────────────────────────

const BREAKDOWN_TYPE_LABELS: Record<BreakdownType, string> = {
    FLAT_TYRE:     'Flat Tyre',
    ENGINE_FAILURE:'Engine Failure',
    BATTERY_DEAD:  'Battery Dead',
    ACCIDENT:      'Accident',
    FUEL_EMPTY:    'Fuel Empty',
    OVERHEATING:   'Overheating',
    ELECTRICAL:    'Electrical',
    TRANSMISSION:  'Transmission',
    OTHER:         'Other',
};

const STATUS_CONFIG: Record<BreakdownStatus, { label: string; cls: string; dot: string }> = {
    REPORTED:             { label: 'Reported',            cls: 'bg-red-500/20 text-red-400 border-red-500/30',         dot: 'bg-red-400' },
    RECOVERY_DISPATCHED:  { label: 'Recovery Dispatched', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30',   dot: 'bg-amber-400' },
    RECOVERY_COMPLETED:   { label: 'Recovery Completed',  cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30',      dot: 'bg-blue-400' },
    AT_WORKSHOP:          { label: 'At Workshop',         cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30',dot: 'bg-purple-400' },
    RESOLVED:             { label: 'Resolved',            cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400' },
};

const SEVERITY_CONFIG: Record<BreakdownSeverity, { label: string; cls: string }> = {
    LOW:      { label: 'Low',      cls: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30' },
    MEDIUM:   { label: 'Medium',   cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    HIGH:     { label: 'High',     cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
    CRITICAL: { label: 'Critical', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const BREAKDOWN_TYPES: BreakdownType[] = [
    'FLAT_TYRE','ENGINE_FAILURE','BATTERY_DEAD','ACCIDENT',
    'FUEL_EMPTY','OVERHEATING','ELECTRICAL','TRANSMISSION','OTHER',
];

// ─── component ────────────────────────────────────────────────────────────────

export default function BreakdownPage() {
    const [reports, setReports]         = useState<BreakdownReport[]>(SEED);
    const [selected, setSelected]       = useState<BreakdownReport | null>(null);
    const [showCreate, setShowCreate]   = useState(false);
    const [filterStatus, setFilterStatus] = useState<BreakdownStatus | 'ALL'>('ALL');

    // ── create form ──
    const [form, setForm] = useState({
        vehicleId:     '',
        driverId:      '',
        breakdownType: 'OTHER' as BreakdownType,
        location:      '',
        driverNotes:   '',
        severity:      'HIGH' as BreakdownSeverity,
    });

    // ─── derived ───────────────────────────────────────────────────────────────

    const filtered = filterStatus === 'ALL'
        ? reports
        : reports.filter(r => r.status === filterStatus);

    const active   = reports.filter(r => r.status !== 'RESOLVED').length;
    const dispatched = reports.filter(r => r.status === 'RECOVERY_DISPATCHED').length;
    const atWorkshop = reports.filter(r => r.status === 'AT_WORKSHOP').length;
    const resolved   = reports.filter(r => r.status === 'RESOLVED').length;

    // ─── handlers ──────────────────────────────────────────────────────────────

    const handleCreate = () => {
        if (!form.vehicleId) return;
        const now = new Date().toISOString();
        const next: BreakdownReport = {
            id:                   `br-${Date.now()}`,
            reportNo:             `BRK-${now.slice(0,7).replace('-','')}-${String(reports.length + 1).padStart(5,'0')}`,
            tenantId:             '',
            vehicleId:            form.vehicleId,
            driverId:             form.driverId || null,
            reportedAt:           now,
            breakdownType:        form.breakdownType,
            location:             form.location || null,
            latitude:             null,
            longitude:            null,
            driverNotes:          form.driverNotes || null,
            photoUrls:            [],
            severity:             form.severity,
            status:               'REPORTED',
            recoveryVehicleId:    null,
            recoveryDriverId:     null,
            recoveryNotes:        null,
            recoveryDispatchedAt: null,
            recoveryCompletedAt:  null,
            estimatedArrivalAt:   null,
            maintenanceRequestId: null,
            createdAt:            now,
            updatedAt:            null,
        };
        setReports(prev => [next, ...prev]);
        setShowCreate(false);
        setForm({ vehicleId: '', driverId: '', breakdownType: 'OTHER', location: '', driverNotes: '', severity: 'HIGH' });
    };

    const handleStatusAdvance = (id: string) => {
        const NEXT: Record<BreakdownStatus, BreakdownStatus | null> = {
            REPORTED:            'RECOVERY_DISPATCHED',
            RECOVERY_DISPATCHED: 'RECOVERY_COMPLETED',
            RECOVERY_COMPLETED:  'AT_WORKSHOP',
            AT_WORKSHOP:         'RESOLVED',
            RESOLVED:            null,
        };
        setReports(prev => prev.map(r => {
            if (r.id !== id) return r;
            const next = NEXT[r.status];
            return next ? { ...r, status: next, updatedAt: new Date().toISOString() } : r;
        }));
        if (selected?.id === id) {
            setSelected(prev => {
                if (!prev) return null;
                const next = NEXT[prev.status];
                return next ? { ...prev, status: next } : prev;
            });
        }
    };

    // ─── render ────────────────────────────────────────────────────────────────

    return (
        <div className="mx-auto max-w-7xl pb-12 space-y-8">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
                        <AlertTriangle className="h-6 w-6 text-orange-400" />
                        Breakdown Management
                    </h1>
                    <p className="text-[var(--text-faint)] text-sm mt-1">
                        Driver-reported breakdowns — from roadside incident to workshop resolution
                    </p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
                >
                    <Plus className="h-4 w-4" />
                    Report Breakdown
                </button>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                    { label: 'Active Incidents', value: active,     icon: AlertTriangle, cls: 'text-red-400' },
                    { label: 'Recovery En Route', value: dispatched, icon: Truck,         cls: 'text-amber-400' },
                    { label: 'At Workshop',        value: atWorkshop, icon: Wrench,        cls: 'text-purple-400' },
                    { label: 'Resolved',           value: resolved,   icon: CheckCircle2,  cls: 'text-emerald-400' },
                ].map(({ label, value, icon: Icon, cls }) => (
                    <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-4 flex items-center gap-4">
                        <Icon className={`h-8 w-8 ${cls}`} />
                        <div>
                            <p className="text-2xl font-bold text-[var(--text-main)]">{value}</p>
                            <p className="text-xs text-[var(--text-muted)]">{label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
                {(['ALL', 'REPORTED', 'RECOVERY_DISPATCHED', 'RECOVERY_COMPLETED', 'AT_WORKSHOP', 'RESOLVED'] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setFilterStatus(s)}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                            filterStatus === s
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-slate-500 hover:text-[var(--text-muted)]'
                        }`}
                    >
                        {s === 'ALL' ? 'All' : STATUS_CONFIG[s].label}
                    </button>
                ))}
            </div>

            {/* Two-pane layout */}
            <div className="flex gap-4">

                {/* List */}
                <div className="flex-1 min-w-0 space-y-3">
                    {filtered.length === 0 && (
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-10 text-center text-[var(--text-faint)]">
                            No breakdown reports found.
                        </div>
                    )}
                    {filtered.map(r => {
                        const sc = STATUS_CONFIG[r.status];
                        const sv = SEVERITY_CONFIG[r.severity as BreakdownSeverity] ?? SEVERITY_CONFIG.HIGH;
                        return (
                            <button
                                key={r.id}
                                onClick={() => setSelected(r)}
                                className={`w-full text-left rounded-xl border p-4 transition-colors ${
                                    selected?.id === r.id
                                        ? 'border-blue-500 bg-[var(--bg-surface)]'
                                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 hover:border-slate-500'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-mono text-[var(--text-faint)]">{r.reportNo}</span>
                                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${sc.cls}`}>
                                                <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
                                                {sc.label}
                                            </span>
                                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sv.cls}`}>
                                                {sv.label}
                                            </span>
                                        </div>
                                        <p className="text-sm font-medium text-[var(--text-main)]">
                                            {BREAKDOWN_TYPE_LABELS[r.breakdownType as BreakdownType] ?? r.breakdownType}
                                            {' '}— Vehicle {r.vehicleId}
                                        </p>
                                        {r.location && (
                                            <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1 truncate">
                                                <MapPin className="h-3 w-3 shrink-0" />
                                                {r.location}
                                            </p>
                                        )}
                                    </div>
                                    <div className="shrink-0 flex items-center gap-2">
                                        <span className="text-xs text-[var(--text-faint)]">
                                            {new Date(r.reportedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                                        </span>
                                        <ChevronRight className="h-4 w-4 text-[var(--text-faint)]" />
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Detail pane */}
                {selected && (
                    <div className="w-80 shrink-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-5 space-y-5 self-start sticky top-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-xs font-mono text-[var(--text-faint)] mb-1">{selected.reportNo}</p>
                                <h2 className="text-base font-semibold text-[var(--text-main)]">
                                    {BREAKDOWN_TYPE_LABELS[selected.breakdownType as BreakdownType] ?? selected.breakdownType}
                                </h2>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">Vehicle {selected.vehicleId}</p>
                            </div>
                            <button onClick={() => setSelected(null)} className="text-[var(--text-faint)] hover:text-[var(--text-main)]">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Status badge */}
                        <div>
                            {(() => {
                                const sc = STATUS_CONFIG[selected.status];
                                return (
                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${sc.cls}`}>
                                        <span className={`h-2 w-2 rounded-full ${sc.dot}`} />
                                        {sc.label}
                                    </span>
                                );
                            })()}
                        </div>

                        {/* Details */}
                        <dl className="space-y-2 text-sm">
                            {selected.location && (
                                <div>
                                    <dt className="text-[var(--text-faint)] text-xs">Location</dt>
                                    <dd className="text-[var(--text-main)] flex items-start gap-1">
                                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--text-muted)]" />
                                        {selected.location}
                                    </dd>
                                </div>
                            )}
                            {selected.driverNotes && (
                                <div>
                                    <dt className="text-[var(--text-faint)] text-xs">Driver notes</dt>
                                    <dd className="text-[var(--text-muted)]">{selected.driverNotes}</dd>
                                </div>
                            )}
                            <div>
                                <dt className="text-[var(--text-faint)] text-xs">Reported at</dt>
                                <dd className="text-[var(--text-muted)]">{new Date(selected.reportedAt).toLocaleString()}</dd>
                            </div>
                            {selected.recoveryDispatchedAt && (
                                <div>
                                    <dt className="text-[var(--text-faint)] text-xs">Recovery dispatched</dt>
                                    <dd className="text-[var(--text-muted)]">{new Date(selected.recoveryDispatchedAt).toLocaleString()}</dd>
                                </div>
                            )}
                            {selected.estimatedArrivalAt && (
                                <div>
                                    <dt className="text-[var(--text-faint)] text-xs">ETA</dt>
                                    <dd className="text-[var(--text-muted)] flex items-center gap-1">
                                        <Clock className="h-3.5 w-3.5" />
                                        {new Date(selected.estimatedArrivalAt).toLocaleString()}
                                    </dd>
                                </div>
                            )}
                            {selected.MaintenanceRequest && (
                                <div>
                                    <dt className="text-[var(--text-faint)] text-xs">Maintenance request</dt>
                                    <dd className="text-[var(--text-muted)] flex items-center gap-1">
                                        <Wrench className="h-3.5 w-3.5" />
                                        {selected.MaintenanceRequest.workOrderNo ?? selected.MaintenanceRequest.id}
                                        <span className="text-[var(--text-faint)]">({selected.MaintenanceRequest.status})</span>
                                    </dd>
                                </div>
                            )}
                        </dl>

                        {/* Action button */}
                        {selected.status !== 'RESOLVED' && (() => {
                            const LABELS: Record<BreakdownStatus, string> = {
                                REPORTED:            'Dispatch Recovery',
                                RECOVERY_DISPATCHED: 'Mark Recovery Completed',
                                RECOVERY_COMPLETED:  'Mark At Workshop',
                                AT_WORKSHOP:         'Mark Resolved',
                                RESOLVED:            '',
                            };
                            const ICONS: Record<BreakdownStatus, React.ElementType> = {
                                REPORTED:            Radio,
                                RECOVERY_DISPATCHED: Truck,
                                RECOVERY_COMPLETED:  Wrench,
                                AT_WORKSHOP:         CheckCircle2,
                                RESOLVED:            CheckCircle2,
                            };
                            const Icon = ICONS[selected.status];
                            return (
                                <button
                                    onClick={() => handleStatusAdvance(selected.id)}
                                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                    <Icon className="h-4 w-4" />
                                    {LABELS[selected.status]}
                                </button>
                            );
                        })()}
                    </div>
                )}
            </div>

            {/* Create modal */}
            {showCreate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-orange-400" />
                                Report Breakdown
                            </h2>
                            <button onClick={() => setShowCreate(false)} className="text-[var(--text-faint)] hover:text-[var(--text-main)]">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Vehicle ID *</label>
                                <input
                                    value={form.vehicleId}
                                    onChange={e => setForm(p => ({ ...p, vehicleId: e.target.value }))}
                                    placeholder="e.g. v-001"
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Driver ID</label>
                                <input
                                    value={form.driverId}
                                    onChange={e => setForm(p => ({ ...p, driverId: e.target.value }))}
                                    placeholder="e.g. d-101"
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Breakdown Type</label>
                                <select
                                    value={form.breakdownType}
                                    onChange={e => setForm(p => ({ ...p, breakdownType: e.target.value as BreakdownType }))}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    {BREAKDOWN_TYPES.map(t => (
                                        <option key={t} value={t}>{BREAKDOWN_TYPE_LABELS[t]}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Severity</label>
                                <select
                                    value={form.severity}
                                    onChange={e => setForm(p => ({ ...p, severity: e.target.value as BreakdownSeverity }))}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    {(['LOW','MEDIUM','HIGH','CRITICAL'] as BreakdownSeverity[]).map(s => (
                                        <option key={s} value={s}>{SEVERITY_CONFIG[s].label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Location</label>
                                <input
                                    value={form.location}
                                    onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
                                    placeholder="e.g. Sheikh Zayed Road, Exit 43"
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Driver notes</label>
                                <textarea
                                    value={form.driverNotes}
                                    onChange={e => setForm(p => ({ ...p, driverNotes: e.target.value }))}
                                    rows={3}
                                    placeholder="Describe what happened..."
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                                />
                            </div>
                        </div>

                        <p className="text-xs text-[var(--text-faint)]">
                            A HIGH-priority maintenance request will be automatically created and linked to this report.
                        </p>

                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={() => setShowCreate(false)}
                                className="flex-1 rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-muted)] hover:border-slate-500"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!form.vehicleId}
                                className="flex-1 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Report Breakdown
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
