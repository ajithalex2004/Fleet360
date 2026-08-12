'use client';

import { useState } from 'react';
import { PMItemStatus, PMTriggerType } from '@/types/maintenance';

// ── Mock data representing PM due calculations ────────────────────────────────

interface MockDueItem {
    id: string;
    vehicleId: string;
    vehiclePlate: string;
    vehicleModel: string;
    planId: string;
    planName: string;
    status: PMItemStatus;
    triggeringFactor: 'ODOMETER' | 'CALENDAR' | 'BOTH' | 'NONE';
    daysUntilDue?: number;
    kmUntilDue?: number;
    urgencyScore: number;
    lastServiceDate?: string;
    lastOdometerKm?: number;
}

const MOCK_ITEMS: MockDueItem[] = [
    { id: 'i1', vehicleId: 'v1', vehiclePlate: 'DXB-A-12345', vehicleModel: 'Toyota Hilux 2022',
      planId: 'plan-1', planName: 'Engine Oil Service',
      status: PMItemStatus.OVERDUE, triggeringFactor: 'BOTH',
      daysUntilDue: -12, kmUntilDue: -850, urgencyScore: 95,
      lastServiceDate: '2026-01-15', lastOdometerKm: 42000 },
    { id: 'i2', vehicleId: 'v2', vehiclePlate: 'DXB-B-67890', vehicleModel: 'Ford Transit 2023',
      planId: 'plan-3', planName: 'Major Service',
      status: PMItemStatus.OVERDUE, triggeringFactor: 'ODOMETER',
      daysUntilDue: 30, kmUntilDue: -250, urgencyScore: 82,
      lastServiceDate: '2025-08-01', lastOdometerKm: 98000 },
    { id: 'i3', vehicleId: 'v3', vehiclePlate: 'SHJ-C-11111', vehicleModel: 'Nissan Patrol 2021',
      planId: 'plan-2', planName: 'Brake Inspection',
      status: PMItemStatus.DUE, triggeringFactor: 'ODOMETER',
      daysUntilDue: 14, kmUntilDue: 280, urgencyScore: 55,
      lastServiceDate: '2025-11-20', lastOdometerKm: 61000 },
    { id: 'i4', vehicleId: 'v4', vehiclePlate: 'AUH-D-22222', vehicleModel: 'Mercedes Sprinter 2022',
      planId: 'plan-1', planName: 'Engine Oil Service',
      status: PMItemStatus.DUE, triggeringFactor: 'CALENDAR',
      daysUntilDue: 6, kmUntilDue: 1200, urgencyScore: 48,
      lastServiceDate: '2025-12-10', lastOdometerKm: 33000 },
    { id: 'i5', vehicleId: 'v5', vehiclePlate: 'DXB-E-33333', vehicleModel: 'Isuzu D-Max 2023',
      planId: 'plan-2', planName: 'Brake Inspection',
      status: PMItemStatus.UPCOMING, triggeringFactor: 'ODOMETER',
      daysUntilDue: 45, kmUntilDue: 3200, urgencyScore: 18,
      lastServiceDate: '2026-03-01', lastOdometerKm: 22000 },
    { id: 'i6', vehicleId: 'v6', vehiclePlate: 'SHJ-F-44444', vehicleModel: 'Toyota Land Cruiser 2024',
      planId: 'plan-3', planName: 'Major Service',
      status: PMItemStatus.UPCOMING, triggeringFactor: 'NONE',
      daysUntilDue: 120, kmUntilDue: 18000, urgencyScore: 5,
      lastServiceDate: '2025-06-15', lastOdometerKm: 15000 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
    [PMItemStatus.OVERDUE]:  { label: 'Overdue',  dot: 'bg-red-500',     badge: 'bg-red-500/15 text-red-400 border-red-500/30',     tab: 'border-red-500 text-red-400' },
    [PMItemStatus.DUE]:      { label: 'Due',       dot: 'bg-amber-400',   badge: 'bg-amber-400/15 text-amber-300 border-amber-400/30', tab: 'border-amber-400 text-amber-300' },
    [PMItemStatus.UPCOMING]: { label: 'Upcoming',  dot: 'bg-slate-500',   badge: 'bg-slate-700/60 text-slate-400 border-slate-600/40', tab: 'border-slate-500 text-slate-400' },
    [PMItemStatus.COMPLETED]:{ label: 'Completed', dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', tab: 'border-emerald-500 text-emerald-400' },
    [PMItemStatus.SNOOZED]:  { label: 'Snoozed',  dot: 'bg-purple-400',  badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30', tab: 'border-purple-500 text-purple-400' },
};

function dueLabel(item: MockDueItem): string {
    const { status, daysUntilDue, kmUntilDue, triggeringFactor } = item;
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

const TABS = [PMItemStatus.OVERDUE, PMItemStatus.DUE, PMItemStatus.UPCOMING] as const;
type TabStatus = typeof TABS[number];

// ── Component ─────────────────────────────────────────────────────────────────

export default function PMSchedulePage() {
    const [items, setItems]       = useState<MockDueItem[]>(MOCK_ITEMS);
    const [activeTab, setActiveTab] = useState<TabStatus>(PMItemStatus.OVERDUE);
    const [generating, setGenerating] = useState(false);
    const [generated, setGenerated]   = useState(0);

    const counts = {
        [PMItemStatus.OVERDUE]:  items.filter(i => i.status === PMItemStatus.OVERDUE).length,
        [PMItemStatus.DUE]:      items.filter(i => i.status === PMItemStatus.DUE).length,
        [PMItemStatus.UPCOMING]: items.filter(i => i.status === PMItemStatus.UPCOMING).length,
    };

    const visibleItems = items
        .filter(i => i.status === activeTab)
        .sort((a, b) => b.urgencyScore - a.urgencyScore);

    function handleGenerateRequests() {
        setGenerating(true);
        setTimeout(() => {
            const actionable = items.filter(i => i.status === PMItemStatus.OVERDUE || i.status === PMItemStatus.DUE);
            setGenerated(actionable.length);
            setGenerating(false);
        }, 1200);
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">PM Schedule</h1>
                    <p className="mt-1 text-slate-500">Due items across all active maintenance plans — whichever trigger comes first</p>
                </div>
                <button
                    onClick={handleGenerateRequests}
                    disabled={generating || counts[PMItemStatus.OVERDUE] + counts[PMItemStatus.DUE] === 0}
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
                        <strong>{generated}</strong> maintenance request{generated !== 1 ? 's' : ''} created for DUE and OVERDUE items.
                    </p>
                    <button onClick={() => setGenerated(0)} className="text-emerald-400/60 hover:text-emerald-400 text-xs">Dismiss</button>
                </div>
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Overdue',        value: counts[PMItemStatus.OVERDUE],  color: 'text-red-400' },
                    { label: 'Due soon',        value: counts[PMItemStatus.DUE],      color: 'text-amber-300' },
                    { label: 'Upcoming',        value: counts[PMItemStatus.UPCOMING], color: 'text-slate-400' },
                    { label: 'Total tracked',   value: items.length,                  color: 'text-white' },
                ].map(kpi => (
                    <div key={kpi.label} className="rounded-xl border border-white/10 bg-slate-900 p-5">
                        <p className="text-xs text-slate-500 uppercase tracking-wide">{kpi.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-white/10">
                {TABS.map(tab => {
                    const cfg = STATUS_CONFIG[tab];
                    const active = activeTab === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${active ? cfg.tab : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                        >
                            {cfg.label}
                            {counts[tab] > 0 && (
                                <span className={`ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs ${active ? cfg.badge : 'bg-slate-800 text-slate-500 border border-white/10'}`}>
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
                        <div key={item.id} className="rounded-xl border border-white/10 bg-slate-900 p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className={`inline-block h-2 w-2 rounded-full ${cfg.dot} shrink-0`} />
                                        <span className="text-base font-bold text-white">{item.vehiclePlate}</span>
                                        <span className="text-slate-500 text-sm">{item.vehicleModel}</span>
                                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium border ${cfg.badge}`}>
                                            {cfg.label}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                        <span className="text-slate-500">Plan: <strong className="text-slate-300">{item.planName}</strong></span>
                                        <span className={`font-medium ${item.status === PMItemStatus.OVERDUE ? 'text-red-400' : item.status === PMItemStatus.DUE ? 'text-amber-300' : 'text-slate-400'}`}>
                                            {dueLabel(item)}
                                        </span>
                                        {item.triggeringFactor !== 'NONE' && (
                                            <span className="text-slate-600 text-xs self-center">
                                                triggered by {item.triggeringFactor.toLowerCase()}
                                            </span>
                                        )}
                                    </div>
                                    {(item.lastServiceDate || item.lastOdometerKm) && (
                                        <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-slate-600">
                                            {item.lastServiceDate && <span>Last service: {new Date(item.lastServiceDate).toLocaleDateString('en-GB')}</span>}
                                            {item.lastOdometerKm && <span>At: {item.lastOdometerKm.toLocaleString()} km</span>}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    {/* Urgency score */}
                                    <div className="text-right">
                                        <p className="text-xs text-slate-600 mb-0.5">Urgency</p>
                                        <p className={`text-lg font-bold ${item.urgencyScore >= 70 ? 'text-red-400' : item.urgencyScore >= 40 ? 'text-amber-300' : 'text-slate-500'}`}>
                                            {item.urgencyScore}
                                        </p>
                                    </div>
                                    <button className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 border border-white/10 transition-colors">
                                        Create request
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {visibleItems.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-slate-900 p-12 text-center">
                        <p className="text-slate-500 text-sm">No {STATUS_CONFIG[activeTab].label.toLowerCase()} items.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
