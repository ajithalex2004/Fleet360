'use client';

import { useCallback, useEffect, useState } from 'react';
import { PMItemStatus } from '@/types/maintenance';
import { NO_HISTORY, pmRequestBody, type ScheduleEntry, type ScheduleStatus } from '@/lib/pm/schedule';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
    [PMItemStatus.OVERDUE]:  { label: 'Overdue',  dot: 'bg-red-500',     badge: 'bg-red-500/15 text-red-400 border-red-500/30',     tab: 'border-red-500 text-red-400' },
    [PMItemStatus.DUE]:      { label: 'Due',       dot: 'bg-amber-400',   badge: 'bg-amber-400/15 text-amber-300 border-amber-400/30', tab: 'border-amber-400 text-amber-300' },
    [PMItemStatus.UPCOMING]: { label: 'Upcoming',  dot: 'bg-slate-500',   badge: 'bg-[var(--bg-surface-hover)]/60 text-[var(--text-muted)] border-[var(--border-strong)]/40', tab: 'border-slate-500 text-[var(--text-muted)]' },
    [NO_HISTORY]:            { label: 'No service on record', dot: 'bg-sky-400', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30', tab: 'border-sky-400 text-sky-300' },
};

function dueLabel(item: ScheduleEntry): string {
    const { status, daysUntilDue, kmUntilDue, triggeringFactor } = item;
    if (status === NO_HISTORY) return 'No completed service for this plan yet';
    if (status === PMItemStatus.OVERDUE) {
        const parts: string[] = [];
        if (daysUntilDue !== undefined && daysUntilDue < 0) parts.push(`${Math.abs(daysUntilDue)}d overdue`);
        if (kmUntilDue !== undefined && kmUntilDue < 0) parts.push(`${Math.abs(kmUntilDue).toLocaleString()} km overdue`);
        return parts.join(' / ') || 'Overdue';
    }
    const parts: string[] = [];
    if ((triggeringFactor === 'CALENDAR' || triggeringFactor === 'BOTH') && daysUntilDue !== undefined)
        parts.push(`${daysUntilDue}d`);
    if ((triggeringFactor === 'ODOMETER' || triggeringFactor === 'BOTH') && kmUntilDue !== undefined)
        parts.push(`${kmUntilDue.toLocaleString()} km`);
    return parts.length ? parts.join(' / ') + ' remaining' : `${daysUntilDue ?? '?'}d remaining`;
}

const TABS: ScheduleStatus[] = [PMItemStatus.OVERDUE, PMItemStatus.DUE, PMItemStatus.UPCOMING, NO_HISTORY];
type TabStatus = ScheduleStatus;

// ── Component ─────────────────────────────────────────────────────────────────

export default function PMSchedulePage() {
    const [items, setItems]         = useState<ScheduleEntry[]>([]);
    const [planCount, setPlanCount] = useState<number | null>(null);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabStatus>(PMItemStatus.OVERDUE);
    const [generating, setGenerating] = useState(false);
    const [creatingId, setCreatingId] = useState<string | null>(null);
    const [generated, setGenerated]   = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/maintenance/pm-schedule', { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error ?? `Could not load the schedule (${res.status})`);
            setItems(Array.isArray(json?.entries) ? json.entries : []);
            setPlanCount(typeof json?.plans === 'number' ? json.plans : null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the schedule');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const counts: Record<TabStatus, number> = {
        [PMItemStatus.OVERDUE]:  items.filter(i => i.status === PMItemStatus.OVERDUE).length,
        [PMItemStatus.DUE]:      items.filter(i => i.status === PMItemStatus.DUE).length,
        [PMItemStatus.UPCOMING]: items.filter(i => i.status === PMItemStatus.UPCOMING).length,
        [NO_HISTORY]:            items.filter(i => i.status === NO_HISTORY).length,
    };

    const visibleItems = items
        .filter(i => i.status === activeTab)
        .sort((a, b) => b.urgencyScore - a.urgencyScore);

    const actionable = items.filter(i => (i.status === PMItemStatus.OVERDUE || i.status === PMItemStatus.DUE) && !i.openRequestId);

    async function createRequest(item: ScheduleEntry): Promise<boolean> {
        const res = await fetch('/api/maintenance-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pmRequestBody(item)),
        });
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error ?? `Could not create the request (${res.status})`);
        }
        return true;
    }

    async function handleCreateOne(item: ScheduleEntry) {
        setCreatingId(item.id);
        setError(null);
        try {
            await createRequest(item);
            setGenerated(1);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the request');
        } finally {
            setCreatingId(null);
        }
    }

    async function handleGenerateRequests() {
        setGenerating(true);
        setError(null);
        let made = 0;
        try {
            for (const item of actionable) {
                await createRequest(item);
                made += 1;
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create every request');
        } finally {
            setGenerated(made);
            setGenerating(false);
            await load();
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">PM Schedule</h1>
                    <p className="text-xs mt-1 text-[var(--text-faint)]">Due items across all active maintenance plans — whichever trigger comes first</p>
                </div>
                <button
                    onClick={handleGenerateRequests}
                    disabled={generating || actionable.length === 0}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {generating ? (
                        <>
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                            Generating…
                        </>
                    ) : 'Generate requests'}
                </button>
            </div>

            {/* Generated banner */}
            {generated > 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 flex items-center justify-between">
                    <p className="text-sm text-emerald-400">
                        <strong>{generated}</strong> preventive maintenance request{generated !== 1 ? 's' : ''} created.
                    </p>
                    <button onClick={() => setGenerated(0)} className="text-emerald-400/60 hover:text-emerald-400 text-xs">Dismiss</button>
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
            )}
            {!loading && planCount === 0 && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-muted)]">
                    No active PM plans yet. Create one on the PM Plans screen and its vehicles will appear here.
                </div>
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Overdue',        value: counts[PMItemStatus.OVERDUE],  color: 'text-red-400' },
                    { label: 'Due soon',        value: counts[PMItemStatus.DUE],      color: 'text-amber-300' },
                    { label: 'Upcoming',        value: counts[PMItemStatus.UPCOMING], color: 'text-[var(--text-muted)]' },
                    { label: 'No service on record', value: counts[NO_HISTORY],       color: 'text-sky-300' },
                ].map(kpi => (
                    <div key={kpi.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                        <p className="text-xs text-[var(--text-faint)] uppercase tracking-wide">{kpi.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-[var(--border-subtle)]">
                {TABS.map(tab => {
                    const cfg = STATUS_CONFIG[tab];
                    const active = activeTab === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${active ? cfg.tab : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                        >
                            {cfg.label}
                            {counts[tab] > 0 && (
                                <span className={`ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs ${active ? cfg.badge : 'bg-[var(--bg-surface)] text-[var(--text-faint)] border border-[var(--border-subtle)]'}`}>
                                    {counts[tab]}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Items list */}
            <div className="space-y-3">
                {visibleItems.map(item => {
                    const cfg = STATUS_CONFIG[item.status];
                    return (
                        <div key={item.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className={`inline-block h-2 w-2 rounded-full ${cfg.dot} shrink-0`} />
                                        <span className="text-base font-bold text-[var(--text-main)]">{item.vehiclePlate}</span>
                                        <span className="text-[var(--text-faint)] text-sm">{item.vehicleModel}</span>
                                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium border ${cfg.badge}`}>
                                            {cfg.label}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                        <span className="text-[var(--text-faint)]">Plan: <strong className="text-[var(--text-muted)]">{item.planName}</strong></span>
                                        <span className={`font-medium ${item.status === PMItemStatus.OVERDUE ? 'text-red-400' : item.status === PMItemStatus.DUE ? 'text-amber-300' : 'text-[var(--text-muted)]'}`}>
                                            {dueLabel(item)}
                                        </span>
                                        {item.triggeringFactor !== 'NONE' && (
                                            <span className="text-[var(--text-faint)] text-xs self-center">
                                                triggered by {item.triggeringFactor.toLowerCase()}
                                            </span>
                                        )}
                                    </div>
                                    {(item.lastServiceDate || item.lastOdometerKm != null) && (
                                        <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-[var(--text-faint)]">
                                            {item.lastServiceDate && <span>Last service: {new Date(item.lastServiceDate).toLocaleDateString('en-GB')}</span>}
                                            {item.lastOdometerKm != null && <span>At: {item.lastOdometerKm.toLocaleString()} km</span>}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    {/* Urgency score */}
                                    <div className="text-right">
                                        <p className="text-xs text-[var(--text-faint)] mb-0.5">Urgency</p>
                                        <p className={`text-lg font-bold ${item.urgencyScore >= 70 ? 'text-red-400' : item.urgencyScore >= 40 ? 'text-amber-300' : 'text-[var(--text-faint)]'}`}>
                                            {item.urgencyScore}
                                        </p>
                                    </div>
                                    {item.openRequestId ? (
                                        <span className="rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-400 border border-emerald-500/30">
                                            Request open
                                        </span>
                                    ) : (
                                        <button
                                            onClick={() => void handleCreateOne(item)}
                                            disabled={creatingId !== null || generating}
                                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors disabled:opacity-40"
                                        >
                                            {creatingId === item.id ? 'Creating…' : 'Create request'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                {visibleItems.length === 0 && (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center">
                        <p className="text-[var(--text-faint)] text-sm">{loading ? 'Loading the schedule…' : `No ${STATUS_CONFIG[activeTab].label.toLowerCase()} items.`}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
