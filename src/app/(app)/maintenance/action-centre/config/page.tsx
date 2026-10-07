'use client';

import { useCallback, useEffect, useState } from 'react';
import { ALERT_FREQUENCIES, ALERT_TYPES, type AlertFor, type AlertFrequency } from '@/lib/alerts/alert-config';

interface AlertConfig {
    id: string;
    alertFor: AlertFor;
    alertType: string;
    frequency: AlertFrequency;
    frequencyValue: number;
    dueAlertThreshold: string;
    thresholdValue: number;
    notificationEnabled: boolean;
}

const blankConfig = (): AlertConfig => ({
    id: '',
    alertFor: 'Vehicle',
    alertType: ALERT_TYPES.Vehicle[0],
    frequency: 'By Odometer',
    frequencyValue: 5000,
    dueAlertThreshold: ALERT_FREQUENCIES['By Odometer'].thresholds[0],
    thresholdValue: 500,
    notificationEnabled: true,
});

/** A rule as the API returns it (numbers arrive as strings from BIGINT). */
function toConfig(r: Record<string, unknown>): AlertConfig {
    const alertFor = (r.alertFor === 'Driver' ? 'Driver' : 'Vehicle') as AlertFor;
    const frequency = (typeof r.frequency === 'string' && r.frequency in ALERT_FREQUENCIES ? r.frequency : 'By Odometer') as AlertFrequency;
    return {
        id: String(r.id),
        alertFor,
        alertType: typeof r.alertType === 'string' ? r.alertType : ALERT_TYPES[alertFor][0],
        frequency,
        frequencyValue: Number(r.frequencyValue ?? 0) || 0,
        dueAlertThreshold: typeof r.dueAlertThreshold === 'string' ? r.dueAlertThreshold : ALERT_FREQUENCIES[frequency].thresholds[0],
        thresholdValue: Number(r.thresholdValue ?? 0) || 0,
        notificationEnabled: Boolean(r.notificationEnabled),
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

export default function AlertConfigPage() {
    const [configs, setConfigs] = useState<AlertConfig[]>([]);
    const [currentConfig, setCurrentConfig] = useState<AlertConfig>(blankConfig());
    const [isAddingNew, setIsAddingNew] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const alertTypes = ALERT_TYPES;
    const frequencyOptions = Object.keys(ALERT_FREQUENCIES) as AlertFrequency[];
    const unit = ALERT_FREQUENCIES[currentConfig.frequency].unit;

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/alert-configs', { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error ?? `Could not load alert rules (${res.status})`);
            const list = (Array.isArray(json) ? json : []).map(toConfig);
            setConfigs(list);
            if (list.length > 0) { setCurrentConfig(list[0]); setIsAddingNew(false); }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load alert rules');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const { id, ...body } = currentConfig;
            const saved = toConfig(isAddingNew
                ? await send('/api/alert-configs', 'POST', body)
                : await send(`/api/alert-configs/${id}`, 'PATCH', body));
            setConfigs(prev => (isAddingNew ? [saved, ...prev] : prev.map(c => (c.id === saved.id ? saved : c))));
            setCurrentConfig(saved);
            setIsAddingNew(false);
            setNotice('Alert saved.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the alert');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (isAddingNew || !currentConfig.id) return;
        if (!window.confirm(`Delete the "${currentConfig.alertType}" alert?`)) return;
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            await send(`/api/alert-configs/${currentConfig.id}`, 'DELETE');
            const rest = configs.filter(c => c.id !== currentConfig.id);
            setConfigs(rest);
            if (rest.length > 0) { setCurrentConfig(rest[0]); setIsAddingNew(false); }
            else { setCurrentConfig(blankConfig()); setIsAddingNew(true); }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not delete the alert');
        } finally {
            setSaving(false);
        }
    };

    /** Discards unsaved edits: back to the saved rule, or a fresh form. */
    const handleReset = () => {
        setNotice(null);
        setCurrentConfig(isAddingNew ? blankConfig() : configs.find(c => c.id === currentConfig.id) ?? blankConfig());
    };

    const handleAddNew = () => {
        setNotice(null);
        setIsAddingNew(true);
        setCurrentConfig(blankConfig());
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">Alert Configuration</h1>
                    <p className="text-xs mt-1 text-[var(--text-faint)]">Configure automated alerts and notifications.</p>
                </div>
                <button
                    onClick={handleAddNew}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 hover:shadow-blue-500/50"
                >
                    + Add Alert
                </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Saved Alerts List */}
                <div className="lg:col-span-1">
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm">
                        <div className="border-b border-[var(--border-subtle)] p-4">
                            <h3 className="font-semibold text-[var(--text-main)]">Configured Alerts</h3>
                        </div>
                        <div className="divide-y divide-white/10">
                            {loading && <p className="p-4 text-sm text-[var(--text-faint)]">Loading…</p>}
                            {!loading && configs.length === 0 && (
                                <p className="p-4 text-sm text-[var(--text-faint)]">No alerts configured yet.</p>
                            )}
                            {configs.map((config) => (
                                <button
                                    key={config.id}
                                    onClick={() => {
                                        setCurrentConfig(config);
                                        setIsAddingNew(false);
                                        setNotice(null);
                                    }}
                                    className={`w-full p-4 text-left transition-colors hover:bg-[var(--bg-surface-hover)] ${currentConfig.id === config.id && !isAddingNew ? 'bg-blue-500/10' : ''
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-[var(--text-main)]">{config.alertType}</p>
                                            <p className="text-xs text-[var(--text-faint)]">{config.alertFor}</p>
                                        </div>
                                        <div className={`h-2 w-2 rounded-full ${config.notificationEnabled ? 'bg-green-500' : 'bg-slate-300'}`} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Configuration Form */}
                <div className="lg:col-span-2">
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                        <h2 className="mb-6 text-lg font-bold text-[var(--text-main)]">{isAddingNew ? 'New Alert' : 'Configure Alert'}</h2>
                        {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
                        {notice && <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{notice}</p>}

                        <div className="space-y-6">
                            {/* Alert For & Alert Type */}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Alert For</label>
                                    <select
                                        className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--text-main)]"
                                        value={currentConfig.alertFor}
                                        onChange={(e) => setCurrentConfig({
                                            ...currentConfig,
                                            alertFor: e.target.value as AlertFor,
                                            alertType: alertTypes[e.target.value as AlertFor][0]
                                        })}
                                    >
                                        <option value="Vehicle" className="text-[var(--text-main)] bg-[var(--bg-surface)]">Vehicle</option>
                                        <option value="Driver" className="text-[var(--text-main)] bg-[var(--bg-surface)]">Driver</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Alert / Notification Type</label>
                                    <select
                                        className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--text-main)]"
                                        value={currentConfig.alertType}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, alertType: e.target.value })}
                                    >
                                        {alertTypes[currentConfig.alertFor].map((type) => (
                                            <option key={type} value={type} className="text-[var(--text-main)] bg-[var(--bg-surface)]">{type}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Frequency */}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Frequency</label>
                                    <select
                                        className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--text-main)]"
                                        value={currentConfig.frequency}
                                        onChange={(e) => setCurrentConfig({
                                            ...currentConfig,
                                            frequency: e.target.value as AlertConfig['frequency'],
                                            dueAlertThreshold: ALERT_FREQUENCIES[e.target.value as AlertFrequency].thresholds[0]
                                        })}
                                    >
                                        {frequencyOptions.map((option) => (
                                            <option key={option} value={option} className="text-[var(--text-main)] bg-[var(--bg-surface)]">{option}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Frequency Value ({unit})</label>
                                    <input
                                        type="number"
                                        className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--text-main)]"
                                        value={currentConfig.frequencyValue}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, frequencyValue: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            {/* Due Alert Threshold */}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Due Alert Threshold</label>
                                    <select
                                        className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--text-main)]"
                                        value={currentConfig.dueAlertThreshold}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, dueAlertThreshold: e.target.value })}
                                    >
                                        {ALERT_FREQUENCIES[currentConfig.frequency].thresholds.map((option) => (
                                            <option key={option} value={option} className="text-[var(--text-main)] bg-[var(--bg-surface)]">{option}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Threshold Value ({unit})</label>
                                    <input
                                        type="number"
                                        className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--text-main)]"
                                        value={currentConfig.thresholdValue}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, thresholdValue: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            {/* Notification Enabled Toggle */}
                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    onClick={() => setCurrentConfig({ ...currentConfig, notificationEnabled: !currentConfig.notificationEnabled })}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${currentConfig.notificationEnabled ? 'bg-blue-600' : 'bg-slate-200'
                                        }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--bg-surface)] shadow ring-0 transition duration-200 ease-in-out ${currentConfig.notificationEnabled ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                    />
                                </button>
                                <span className="text-sm font-medium text-[var(--text-muted)]">Notification Enabled</span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end gap-3 pt-6 border-t border-[var(--border-subtle)]">
                                <button
                                    onClick={handleReset}
                                    className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                    </svg>
                                    {isAddingNew ? 'Clear' : 'Discard Changes'}
                                </button>
                                {!isAddingNew && (
                                    <button
                                        onClick={() => void handleDelete()}
                                        disabled={saving}
                                        className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                                    >
                                        Delete
                                    </button>
                                )}
                                <button
                                    onClick={() => void handleSave()}
                                    disabled={saving}
                                    className="disabled:opacity-50 flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-6 py-2 text-sm font-medium text-[var(--text-main)] hover:bg-[var(--bg-surface)]"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                    </svg>
                                    {saving ? 'Saving…' : 'Save Alert'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
