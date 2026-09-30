'use client';

import { useCallback, useEffect, useState } from 'react';
import { PMTriggerType } from '@/types/maintenance';

interface PMTriggerForm {
    triggerType: PMTriggerType;
    intervalValue: number;
    intervalUnit: 'KM' | 'DAYS' | 'HOURS';
}

interface PMPlanData {
    id: string;
    name: string;
    description?: string;
    maintenanceType: string;
    triggers: PMTriggerForm[];
    gracePeriodDays: number;
    earlyWindowDays: number;
    earlyWindowKm: number;
    notifyDaysBefore: number;
    isActive: boolean;
}

const TRIGGER_LABELS: Record<PMTriggerType, string> = {
    [PMTriggerType.ODOMETER]:        'Odometer (km)',
    [PMTriggerType.CALENDAR]:        'Calendar (days)',
    [PMTriggerType.ENGINE_HOURS]:    'Engine hours',
    [PMTriggerType.OPERATING_HOURS]: 'Operating hours',
    [PMTriggerType.COMPONENT_LIFE]:  'Component life',
};

const TRIGGER_UNITS: Record<PMTriggerType, 'KM' | 'DAYS' | 'HOURS'> = {
    [PMTriggerType.ODOMETER]:        'KM',
    [PMTriggerType.CALENDAR]:        'DAYS',
    [PMTriggerType.ENGINE_HOURS]:    'HOURS',
    [PMTriggerType.OPERATING_HOURS]: 'HOURS',
    [PMTriggerType.COMPONENT_LIFE]:  'DAYS',
};

/** A plan as the API returns it, with nulls filled for the form. */
function toPlan(r: Record<string, unknown>): PMPlanData {
    const n = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
    return {
        id: String(r.id),
        name: String(r.name ?? ''),
        description: typeof r.description === 'string' ? r.description : '',
        maintenanceType: typeof r.maintenanceType === 'string' ? r.maintenanceType : 'PREVENTIVE',
        triggers: (Array.isArray(r.triggers) ? r.triggers : []).map((t: Record<string, unknown>) => ({
            triggerType: t.triggerType as PMTriggerType,
            intervalValue: n(t.intervalValue, 0),
            intervalUnit: (t.intervalUnit as PMTriggerForm['intervalUnit']) ?? 'KM',
        })),
        gracePeriodDays: n(r.gracePeriodDays, 0),
        earlyWindowDays: n(r.earlyWindowDays, 0),
        earlyWindowKm: n(r.earlyWindowKm, 0),
        notifyDaysBefore: n(r.notifyDaysBefore, 0),
        isActive: Boolean(r.isActive),
    };
}

async function send(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json as Record<string, unknown>;
}

const blankPlan = (): Omit<PMPlanData, 'id'> => ({
    name: '', description: '', maintenanceType: 'PREVENTIVE',
    triggers: [], gracePeriodDays: 7, earlyWindowDays: 7,
    earlyWindowKm: 500, notifyDaysBefore: 7, isActive: true,
});

function XIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
    );
}

export default function PMPlansPage() {
    const [plans, setPlans]                 = useState<PMPlanData[]>([]);
    const [loading, setLoading]             = useState(true);
    const [saving, setSaving]               = useState(false);
    const [error, setError]                 = useState<string | null>(null);
    const [formError, setFormError]         = useState<string | null>(null);
    const [showModal, setShowModal]         = useState(false);
    const [editingId, setEditingId]         = useState<string | null>(null);
    const [form, setForm]                   = useState<Omit<PMPlanData, 'id'>>(blankPlan());
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/maintenance/pm-plans?activeOnly=false', { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error ?? `Could not load PM plans (${res.status})`);
            setPlans((Array.isArray(json) ? json : []).map(toPlan));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load PM plans');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    function openCreate() {
        setFormError(null);
        setEditingId(null);
        setForm(blankPlan());
        setShowModal(true);
    }

    function openEdit(plan: PMPlanData) {
        setFormError(null);
        setEditingId(plan.id);
        setForm({ name: plan.name, description: plan.description, maintenanceType: plan.maintenanceType,
                  triggers: plan.triggers.map(t => ({ ...t })),
                  gracePeriodDays: plan.gracePeriodDays, earlyWindowDays: plan.earlyWindowDays,
                  earlyWindowKm: plan.earlyWindowKm, notifyDaysBefore: plan.notifyDaysBefore,
                  isActive: plan.isActive });
        setShowModal(true);
    }

    function addTrigger() {
        const type = PMTriggerType.ODOMETER;
        setForm(f => ({ ...f, triggers: [...f.triggers, { triggerType: type, intervalValue: 10000, intervalUnit: TRIGGER_UNITS[type] }] }));
    }

    function updateTrigger(idx: number, patch: Partial<PMTriggerForm>) {
        setForm(f => {
            const triggers = f.triggers.map((t, i) => {
                if (i !== idx) return t;
                const next = { ...t, ...patch };
                if (patch.triggerType) next.intervalUnit = TRIGGER_UNITS[patch.triggerType];
                return next;
            });
            return { ...f, triggers };
        });
    }

    function removeTrigger(idx: number) {
        setForm(f => ({ ...f, triggers: f.triggers.filter((_, i) => i !== idx) }));
    }

    async function save() {
        if (!form.name.trim()) return;
        if (form.triggers.length === 0) { setFormError('Add at least one trigger.'); return; }
        setSaving(true);
        setFormError(null);
        try {
            const body = { ...form, name: form.name.trim(), description: form.description?.trim() || null };
            const saved = toPlan(editingId
                ? await send(`/api/maintenance/pm-plans/${editingId}`, 'PUT', body)
                : await send('/api/maintenance/pm-plans', 'POST', body));
            setPlans(p => (editingId ? p.map(pl => (pl.id === editingId ? saved : pl)) : [saved, ...p]));
            setShowModal(false);
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Could not save the plan');
        } finally {
            setSaving(false);
        }
    }

    async function deletePlan(id: string) {
        setSaving(true);
        setError(null);
        try {
            await send(`/api/maintenance/pm-plans/${id}`, 'DELETE');
            setPlans(p => p.filter(pl => pl.id !== id));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not delete the plan');
        } finally {
            setSaving(false);
            setDeleteConfirm(null);
        }
    }

    async function toggleActive(plan: PMPlanData) {
        setSaving(true);
        setError(null);
        try {
            const saved = toPlan(await send(`/api/maintenance/pm-plans/${plan.id}`, 'PUT', { isActive: !plan.isActive }));
            setPlans(p => p.map(pl => (pl.id === plan.id ? saved : pl)));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update the plan');
        } finally {
            setSaving(false);
        }
    }

    const totalTriggers = plans.reduce((s, p) => s + p.triggers.length, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">PM Plans</h1>
                    <p className="text-xs mt-1 text-[var(--text-faint)]">Define preventive maintenance rules with odometer, calendar, and hours triggers</p>
                </div>
                <button
                    onClick={openCreate}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                    + New plan
                </button>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Total plans',    value: plans.length,                              color: 'text-[var(--text-main)]' },
                    { label: 'Active',         value: plans.filter(p => p.isActive).length,      color: 'text-emerald-400' },
                    { label: 'Inactive',       value: plans.filter(p => !p.isActive).length,     color: 'text-[var(--text-faint)]' },
                    { label: 'Triggers total', value: totalTriggers,                              color: 'text-blue-400' },
                ].map(kpi => (
                    <div key={kpi.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                        <p className="text-xs text-[var(--text-faint)] uppercase tracking-wide">{kpi.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
            )}

            {/* Plan list */}
            <div className="space-y-3">
                {loading && (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-sm text-[var(--text-faint)]">
                        Loading PM plans…
                    </div>
                )}
                {plans.map(plan => (
                    <div
                        key={plan.id}
                        className={`rounded-xl border p-5 transition-opacity ${plan.isActive ? 'border-[var(--border-subtle)] bg-[var(--bg-surface)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 opacity-60'}`}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <h3 className="text-base font-bold text-[var(--text-main)]">{plan.name}</h3>
                                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium border ${plan.isActive ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-faint)] border-[var(--border-strong)]/40'}`}>
                                        {plan.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                    <span className="inline-flex rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400 border border-blue-500/30">
                                        {plan.maintenanceType}
                                    </span>
                                </div>
                                {plan.description && (
                                    <p className="text-sm text-[var(--text-faint)] mt-1">{plan.description}</p>
                                )}
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {plan.triggers.map((t, i) => (
                                        <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-muted)]">
                                            {TRIGGER_LABELS[t.triggerType]} — every {t.intervalValue.toLocaleString()} {t.intervalUnit}
                                        </span>
                                    ))}
                                    {plan.triggers.length === 0 && (
                                        <span className="text-xs text-[var(--text-faint)] italic">No triggers defined</span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-4 mt-3 text-xs text-[var(--text-faint)]">
                                    <span>Grace: <strong className="text-[var(--text-muted)]">{plan.gracePeriodDays}d</strong></span>
                                    <span>Early window: <strong className="text-[var(--text-muted)]">{plan.earlyWindowDays}d / {plan.earlyWindowKm.toLocaleString()} km</strong></span>
                                    <span>Notify: <strong className="text-[var(--text-muted)]">{plan.notifyDaysBefore}d before</strong></span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={() => void toggleActive(plan)}
                                    disabled={saving}
                                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors"
                                >
                                    {plan.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                                <button
                                    onClick={() => openEdit(plan)}
                                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => setDeleteConfirm(plan.id)}
                                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                {!loading && plans.length === 0 && (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center">
                        <p className="text-[var(--text-faint)] text-sm">No PM plans yet. Create one to start tracking preventive maintenance.</p>
                        <button onClick={openCreate} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                            + New plan
                        </button>
                    </div>
                )}
            </div>

            {/* Create / Edit modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-[var(--bg-surface)] rounded-2xl w-full max-w-2xl shadow-2xl border border-[var(--border-subtle)] max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
                            <h3 className="text-lg font-bold text-[var(--text-main)]">{editingId ? 'Edit plan' : 'New PM plan'}</h3>
                            <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-muted)] transition-colors">
                                <XIcon />
                            </button>
                        </div>
                        <div className="p-6 space-y-5 overflow-y-auto flex-1">
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Plan name *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Engine Oil Service"
                                    className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)] text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Description</label>
                                <input
                                    type="text"
                                    value={form.description ?? ''}
                                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Brief description of the service"
                                    className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)] text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Type</label>
                                <select
                                    value={form.maintenanceType}
                                    onChange={e => setForm(f => ({ ...f, maintenanceType: e.target.value }))}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)] text-sm focus:outline-none"
                                >
                                    <option value="PREVENTIVE">Preventive</option>
                                    <option value="INSPECTION">Inspection</option>
                                    <option value="PREDICTIVE">Predictive</option>
                                    <option value="CORRECTIVE">Corrective</option>
                                </select>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-medium text-[var(--text-muted)]">
                                        Triggers <span className="text-[var(--text-faint)] font-normal">(whichever comes first)</span>
                                    </label>
                                    <button onClick={addTrigger} className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors">
                                        + Add trigger
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {form.triggers.map((t, i) => (
                                        <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-3">
                                            <select
                                                value={t.triggerType}
                                                onChange={e => updateTrigger(i, { triggerType: e.target.value as PMTriggerType })}
                                                className="flex-1 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs focus:outline-none"
                                            >
                                                {Object.values(PMTriggerType).map(type => (
                                                    <option key={type} value={type}>{TRIGGER_LABELS[type]}</option>
                                                ))}
                                            </select>
                                            <span className="text-[var(--text-faint)] text-xs shrink-0">every</span>
                                            <input
                                                type="number"
                                                min={1}
                                                value={t.intervalValue}
                                                onChange={e => updateTrigger(i, { intervalValue: Number(e.target.value) })}
                                                className="w-24 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs focus:outline-none"
                                            />
                                            <span className="text-[var(--text-muted)] text-xs w-10 shrink-0">{t.intervalUnit}</span>
                                            <button onClick={() => removeTrigger(i)} className="text-red-400 hover:text-red-300 shrink-0 transition-colors">
                                                <XIcon />
                                            </button>
                                        </div>
                                    ))}
                                    {form.triggers.length === 0 && (
                                        <p className="text-xs text-[var(--text-faint)] italic py-1">No triggers — add at least one to enable due calculation</p>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-2">Service windows</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {([
                                        { key: 'gracePeriodDays', label: 'Grace period (days)' },
                                        { key: 'earlyWindowDays', label: 'Early window (days)' },
                                        { key: 'earlyWindowKm',   label: 'Early window (km)'   },
                                    ] as { key: string; label: string }[]).map(({ key, label }) => (
                                        <div key={key}>
                                            <label className="block text-xs text-[var(--text-faint)] mb-1">{label}</label>
                                            <input
                                                type="number"
                                                min={0}
                                                value={(form as Record<string, unknown>)[key] as number}
                                                onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                                                className="w-full rounded-md border border-[var(--border-subtle)] px-2 py-1.5 bg-[var(--bg-surface)] text-[var(--text-main)] text-sm focus:outline-none"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-end gap-6">
                                <div>
                                    <label className="block text-xs text-[var(--text-faint)] mb-1">Notify days before</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={form.notifyDaysBefore}
                                        onChange={e => setForm(f => ({ ...f, notifyDaysBefore: Number(e.target.value) }))}
                                        className="w-32 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 bg-[var(--bg-surface)] text-[var(--text-main)] text-sm focus:outline-none"
                                    />
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer pb-1.5">
                                    <input
                                        type="checkbox"
                                        checked={form.isActive}
                                        onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                                        className="h-4 w-4 rounded accent-blue-600"
                                    />
                                    <span className="text-sm text-[var(--text-muted)]">Active</span>
                                </label>
                            </div>
                        </div>
                        <div className="p-6 border-t border-[var(--border-subtle)] flex items-center justify-end gap-3 shrink-0">
                            {formError && <p className="mr-auto text-sm text-red-400">{formError}</p>}
                            <button
                                onClick={() => setShowModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void save()}
                                disabled={!form.name.trim() || saving}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create plan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-[var(--bg-surface)] rounded-2xl w-full max-w-sm shadow-2xl border border-[var(--border-subtle)] p-6">
                        <h3 className="text-base font-bold text-[var(--text-main)] mb-2">Delete this plan?</h3>
                        <p className="text-sm text-[var(--text-faint)] mb-5">
                            All associated schedule items will stop being tracked. This cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void deletePlan(deleteConfirm)}
                                disabled={saving}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
