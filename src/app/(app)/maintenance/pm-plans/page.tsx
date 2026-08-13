'use client';

import { useState } from 'react';
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

const SEED_PLANS: PMPlanData[] = [
    {
        id: 'plan-1',
        name: 'Engine Oil Service',
        description: 'Oil + filter replacement',
        maintenanceType: 'PREVENTIVE',
        triggers: [
            { triggerType: PMTriggerType.ODOMETER, intervalValue: 10000, intervalUnit: 'KM' },
            { triggerType: PMTriggerType.CALENDAR, intervalValue: 180,   intervalUnit: 'DAYS' },
        ],
        gracePeriodDays: 7, earlyWindowDays: 14, earlyWindowKm: 500, notifyDaysBefore: 7, isActive: true,
    },
    {
        id: 'plan-2',
        name: 'Brake Inspection',
        description: 'Full brake system inspection',
        maintenanceType: 'INSPECTION',
        triggers: [
            { triggerType: PMTriggerType.ODOMETER, intervalValue: 15000, intervalUnit: 'KM' },
        ],
        gracePeriodDays: 3, earlyWindowDays: 7, earlyWindowKm: 300, notifyDaysBefore: 5, isActive: true,
    },
    {
        id: 'plan-3',
        name: 'Major Service',
        description: 'Full 50k service package',
        maintenanceType: 'PREVENTIVE',
        triggers: [
            { triggerType: PMTriggerType.ODOMETER, intervalValue: 50000, intervalUnit: 'KM' },
            { triggerType: PMTriggerType.CALENDAR, intervalValue: 365,   intervalUnit: 'DAYS' },
        ],
        gracePeriodDays: 14, earlyWindowDays: 30, earlyWindowKm: 1000, notifyDaysBefore: 14, isActive: true,
    },
];

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
    const [plans, setPlans]                 = useState<PMPlanData[]>(SEED_PLANS);
    const [showModal, setShowModal]         = useState(false);
    const [editingId, setEditingId]         = useState<string | null>(null);
    const [form, setForm]                   = useState<Omit<PMPlanData, 'id'>>(blankPlan());
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    function openCreate() {
        setEditingId(null);
        setForm(blankPlan());
        setShowModal(true);
    }

    function openEdit(plan: PMPlanData) {
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

    function save() {
        if (!form.name.trim()) return;
        if (editingId) {
            setPlans(p => p.map(pl => pl.id === editingId ? { ...form, id: editingId } : pl));
        } else {
            setPlans(p => [...p, { ...form, id: `plan-${Date.now()}` }]);
        }
        setShowModal(false);
    }

    function deletePlan(id: string) {
        setPlans(p => p.filter(pl => pl.id !== id));
        setDeleteConfirm(null);
    }

    function toggleActive(id: string) {
        setPlans(p => p.map(pl => pl.id === id ? { ...pl, isActive: !pl.isActive } : pl));
    }

    const totalTriggers = plans.reduce((s, p) => s + p.triggers.length, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">PM Plans</h1>
                    <p className="mt-1 text-slate-500">Define preventive maintenance rules with odometer, calendar, and hours triggers</p>
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
                    { label: 'Total plans',    value: plans.length,                              color: 'text-white' },
                    { label: 'Active',         value: plans.filter(p => p.isActive).length,      color: 'text-emerald-400' },
                    { label: 'Inactive',       value: plans.filter(p => !p.isActive).length,     color: 'text-slate-500' },
                    { label: 'Triggers total', value: totalTriggers,                              color: 'text-blue-400' },
                ].map(kpi => (
                    <div key={kpi.label} className="rounded-xl border border-white/10 bg-slate-900 p-5">
                        <p className="text-xs text-slate-500 uppercase tracking-wide">{kpi.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* Plan list */}
            <div className="space-y-3">
                {plans.map(plan => (
                    <div
                        key={plan.id}
                        className={`rounded-xl border p-5 transition-opacity ${plan.isActive ? 'border-white/10 bg-slate-900' : 'border-white/5 bg-slate-900/50 opacity-60'}`}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <h3 className="text-base font-bold text-white">{plan.name}</h3>
                                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium border ${plan.isActive ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-slate-700/40 text-slate-500 border-slate-600/40'}`}>
                                        {plan.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                    <span className="inline-flex rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400 border border-blue-500/30">
                                        {plan.maintenanceType}
                                    </span>
                                </div>
                                {plan.description && (
                                    <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
                                )}
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {plan.triggers.map((t, i) => (
                                        <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 border border-white/10 px-3 py-1 text-xs text-slate-300">
                                            {TRIGGER_LABELS[t.triggerType]} — every {t.intervalValue.toLocaleString()} {t.intervalUnit}
                                        </span>
                                    ))}
                                    {plan.triggers.length === 0 && (
                                        <span className="text-xs text-slate-600 italic">No triggers defined</span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-500">
                                    <span>Grace: <strong className="text-slate-400">{plan.gracePeriodDays}d</strong></span>
                                    <span>Early window: <strong className="text-slate-400">{plan.earlyWindowDays}d / {plan.earlyWindowKm.toLocaleString()} km</strong></span>
                                    <span>Notify: <strong className="text-slate-400">{plan.notifyDaysBefore}d before</strong></span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={() => toggleActive(plan.id)}
                                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/5 border border-white/10 transition-colors"
                                >
                                    {plan.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                                <button
                                    onClick={() => openEdit(plan)}
                                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 border border-white/10 transition-colors"
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
                {plans.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-slate-900 p-12 text-center">
                        <p className="text-slate-500 text-sm">No PM plans yet. Create one to start tracking preventive maintenance.</p>
                        <button onClick={openCreate} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                            + New plan
                        </button>
                    </div>
                )}
            </div>

            {/* Create / Edit modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl border border-white/10 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0">
                            <h3 className="text-lg font-bold text-white">{editingId ? 'Edit plan' : 'New PM plan'}</h3>
                            <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-300 transition-colors">
                                <XIcon />
                            </button>
                        </div>
                        <div className="p-6 space-y-5 overflow-y-auto flex-1">
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1.5">Plan name *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Engine Oil Service"
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-800 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1.5">Description</label>
                                <input
                                    type="text"
                                    value={form.description ?? ''}
                                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Brief description of the service"
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-800 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1.5">Type</label>
                                <select
                                    value={form.maintenanceType}
                                    onChange={e => setForm(f => ({ ...f, maintenanceType: e.target.value }))}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-800 text-white text-sm focus:outline-none"
                                >
                                    <option value="PREVENTIVE">Preventive</option>
                                    <option value="INSPECTION">Inspection</option>
                                </select>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-medium text-slate-400">
                                        Triggers <span className="text-slate-600 font-normal">(whichever comes first)</span>
                                    </label>
                                    <button onClick={addTrigger} className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors">
                                        + Add trigger
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {form.triggers.map((t, i) => (
                                        <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-800 border border-white/10 p-3">
                                            <select
                                                value={t.triggerType}
                                                onChange={e => updateTrigger(i, { triggerType: e.target.value as PMTriggerType })}
                                                className="flex-1 rounded-md border border-white/10 px-2 py-1.5 bg-slate-700 text-white text-xs focus:outline-none"
                                            >
                                                {Object.values(PMTriggerType).map(type => (
                                                    <option key={type} value={type}>{TRIGGER_LABELS[type]}</option>
                                                ))}
                                            </select>
                                            <span className="text-slate-500 text-xs shrink-0">every</span>
                                            <input
                                                type="number"
                                                min={1}
                                                value={t.intervalValue}
                                                onChange={e => updateTrigger(i, { intervalValue: Number(e.target.value) })}
                                                className="w-24 rounded-md border border-white/10 px-2 py-1.5 bg-slate-700 text-white text-xs focus:outline-none"
                                            />
                                            <span className="text-slate-400 text-xs w-10 shrink-0">{t.intervalUnit}</span>
                                            <button onClick={() => removeTrigger(i)} className="text-red-400 hover:text-red-300 shrink-0 transition-colors">
                                                <XIcon />
                                            </button>
                                        </div>
                                    ))}
                                    {form.triggers.length === 0 && (
                                        <p className="text-xs text-slate-600 italic py-1">No triggers — add at least one to enable due calculation</p>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2">Service windows</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {([
                                        { key: 'gracePeriodDays', label: 'Grace period (days)' },
                                        { key: 'earlyWindowDays', label: 'Early window (days)' },
                                        { key: 'earlyWindowKm',   label: 'Early window (km)'   },
                                    ] as { key: string; label: string }[]).map(({ key, label }) => (
                                        <div key={key}>
                                            <label className="block text-xs text-slate-500 mb-1">{label}</label>
                                            <input
                                                type="number"
                                                min={0}
                                                value={(form as Record<string, unknown>)[key] as number}
                                                onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                                                className="w-full rounded-md border border-white/10 px-2 py-1.5 bg-slate-800 text-white text-sm focus:outline-none"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-end gap-6">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Notify days before</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={form.notifyDaysBefore}
                                        onChange={e => setForm(f => ({ ...f, notifyDaysBefore: Number(e.target.value) }))}
                                        className="w-32 rounded-md border border-white/10 px-2 py-1.5 bg-slate-800 text-white text-sm focus:outline-none"
                                    />
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer pb-1.5">
                                    <input
                                        type="checkbox"
                                        checked={form.isActive}
                                        onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                                        className="h-4 w-4 rounded accent-blue-600"
                                    />
                                    <span className="text-sm text-slate-300">Active</span>
                                </label>
                            </div>
                        </div>
                        <div className="p-6 border-t border-white/10 flex justify-end gap-3 shrink-0">
                            <button
                                onClick={() => setShowModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={save}
                                disabled={!form.name.trim()}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {editingId ? 'Save changes' : 'Create plan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-sm shadow-2xl border border-white/10 p-6">
                        <h3 className="text-base font-bold text-white mb-2">Delete this plan?</h3>
                        <p className="text-sm text-slate-500 mb-5">
                            All associated schedule items will stop being tracked. This cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => deletePlan(deleteConfirm)}
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
