'use client';

import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
    AlertTriangle, Plus, Truck, CheckCircle2, Clock,
    MapPin, Wrench, X, ChevronRight, Radio,
} from 'lucide-react';
import type { BreakdownReport, BreakdownType, BreakdownStatus, BreakdownSeverity } from '@/types/maintenance';

// ─── api ──────────────────────────────────────────────────────────────────────

interface Option { id: string; label: string }

async function send(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json as BreakdownReport;
}

async function loadOptions(url: string, label: (row: Record<string, unknown>) => string): Promise<Option[]> {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        const rows = res.ok ? await res.json() : [];
        return (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({ id: String(r.id), label: label(r) || String(r.id) }));
    } catch {
        return [];
    }
}

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
    const [reports, setReports]         = useState<BreakdownReport[]>([]);
    const [vehicles, setVehicles]       = useState<Option[]>([]);
    const [drivers, setDrivers]         = useState<Option[]>([]);
    const [loading, setLoading]         = useState(true);
    const [saving, setSaving]           = useState(false);
    const [error, setError]             = useState<string | null>(null);
    const [formError, setFormError]     = useState<string | null>(null);
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

    // ─── load ──────────────────────────────────────────────────────────────────

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/maintenance/breakdown-reports', { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error ?? `Could not load breakdown reports (${res.status})`);
            setReports(Array.isArray(json) ? json : []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load breakdown reports');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        void loadOptions('/api/vehicles', v =>
            [v.licensePlate, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')).then(setVehicles);
        void loadOptions('/api/drivers', d =>
            String(d.name || [d.firstName, d.lastName].filter(Boolean).join(' ') || '')).then(setDrivers);
    }, []);

    const vehicleLabel = (id: string | null) => (id ? vehicles.find(v => v.id === id)?.label ?? id : '—');
    const driverLabel  = (id: string | null) => (id ? drivers.find(d => d.id === id)?.label ?? id : null);

    // ─── handlers ──────────────────────────────────────────────────────────────

    const replace = (updated: BreakdownReport) => {
        setReports(prev => prev.map(r => (r.id === updated.id ? updated : r)));
        setSelected(prev => (prev?.id === updated.id ? updated : prev));
    };

    const handleCreate = async () => {
        if (!form.vehicleId) return;
        setSaving(true);
        setFormError(null);
        try {
            const created = await send('/api/maintenance/breakdown-reports', 'POST', {
                vehicleId:     form.vehicleId,
                driverId:      form.driverId || null,
                breakdownType: form.breakdownType,
                severity:      form.severity,
                location:      form.location.trim() || null,
                driverNotes:   form.driverNotes.trim() || null,
            });
            setReports(prev => [created, ...prev]);
            setShowCreate(false);
            setForm({ vehicleId: '', driverId: '', breakdownType: 'OTHER', location: '', driverNotes: '', severity: 'HIGH' });
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Could not save the report');
        } finally {
            setSaving(false);
        }
    };

    const handleStatusAdvance = async (report: BreakdownReport) => {
        const NEXT: Record<BreakdownStatus, BreakdownStatus | null> = {
            REPORTED:            'RECOVERY_DISPATCHED',
            RECOVERY_DISPATCHED: 'RECOVERY_COMPLETED',
            RECOVERY_COMPLETED:  'AT_WORKSHOP',
            AT_WORKSHOP:         'RESOLVED',
            RESOLVED:            null,
        };
        const next = NEXT[report.status];
        if (!next) return;
        setSaving(true);
        setError(null);
        try {
            const updated = report.status === 'REPORTED'
                ? await send(`/api/maintenance/breakdown-reports/${report.id}/dispatch-recovery`, 'POST', {})
                : await send(`/api/maintenance/breakdown-reports/${report.id}`, 'PATCH', { status: next });
            replace(updated);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update the report');
        } finally {
            setSaving(false);
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
                    {error && (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
                    )}
                    {loading && (
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-10 text-center text-[var(--text-faint)]">
                            Loading breakdown reports…
                        </div>
                    )}
                    {!loading && filtered.length === 0 && (
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-10 text-center text-[var(--text-faint)]">
                            {reports.length === 0 ? 'No breakdowns reported yet.' : 'No breakdown reports with this status.'}
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
                                            {' '}— {vehicleLabel(r.vehicleId)}
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
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">{vehicleLabel(selected.vehicleId)}</p>
                                {driverLabel(selected.driverId) && (
                                    <p className="text-xs text-[var(--text-faint)]">Driver: {driverLabel(selected.driverId)}</p>
                                )}
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
                                    onClick={() => void handleStatusAdvance(selected)}
                                    disabled={saving}
                                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Vehicle *</label>
                                <SearchableSelect
                                    value={form.vehicleId}
                                    onChange={(val) => setForm((p) => ({ ...p, vehicleId: val }))}
                                    options={vehicles.map((v) => ({ value: v.id, label: v.label }))}
                                    placeholder={vehicles.length ? 'Search & select a vehicle...' : 'No vehicles found'}
                                    searchPlaceholder="Type plate number, model..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Driver</label>
                                <SearchableSelect
                                    value={form.driverId}
                                    onChange={(val) => setForm((p) => ({ ...p, driverId: val }))}
                                    options={drivers.map((d) => ({ value: d.id, label: d.label }))}
                                    placeholder="Search driver..."
                                    searchPlaceholder="Type driver name..."
                                    isClearable
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

                        {formError && <p className="text-sm text-red-400">{formError}</p>}

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
                                onClick={() => void handleCreate()}
                                disabled={!form.vehicleId || saving}
                                className="flex-1 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving…' : 'Report Breakdown'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
