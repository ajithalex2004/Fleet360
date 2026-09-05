'use client';

/**
 * /maintenance/risk — Maintenance Risk Score dashboard (Phase G)
 *
 * Fetches all vehicle risk scores from /api/maintenance/risk-scores and
 * renders a sortable league table. Each row expands to show the 10-factor
 * drill-down with per-factor progress bars.
 */

import React, { useState } from 'react';
import { Gauge, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/ui/page-theme';
import { useFetchedData } from '@/hooks/useFetchedData';
import type { MaintenanceRiskScore, RiskBand, RiskFactor } from '@/types/maintenance';

// ── band config ───────────────────────────────────────────────────────────────

const BAND_CFG: Record<RiskBand, { label: string; emoji: string; bar: string; badge: string }> = {
    CRITICAL: { label: 'Critical', emoji: '🔴', bar: 'bg-red-500',    badge: 'bg-red-500/20 text-red-400 border-red-500/40' },
    HIGH:     { label: 'High',     emoji: '🟠', bar: 'bg-orange-500', badge: 'bg-orange-500/20 text-orange-400 border-orange-500/40' },
    MEDIUM:   { label: 'Medium',   emoji: '🟡', bar: 'bg-amber-400',  badge: 'bg-amber-400/20 text-amber-300 border-amber-400/40' },
    LOW:      { label: 'Low',      emoji: '🟢', bar: 'bg-emerald-500',badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' },
};

type BandFilter = 'ALL' | RiskBand;

const BAND_TABS: { key: BandFilter; label: string; emoji: string }[] = [
    { key: 'ALL',      label: 'All',      emoji: '🚗' },
    { key: 'CRITICAL', label: 'Critical', emoji: '🔴' },
    { key: 'HIGH',     label: 'High',     emoji: '🟠' },
    { key: 'MEDIUM',   label: 'Medium',   emoji: '🟡' },
    { key: 'LOW',      label: 'Low',      emoji: '🟢' },
];

// ── factor bar ────────────────────────────────────────────────────────────────

function FactorBar({ f }: { f: RiskFactor }) {
    const pct = f.maxScore > 0 ? (f.score / f.maxScore) * 100 : 0;
    const color =
        pct >= 80 ? 'bg-red-500' :
        pct >= 50 ? 'bg-orange-500' :
        pct >= 25 ? 'bg-amber-400' :
        'bg-emerald-500';

    return (
        <div className="grid grid-cols-[9rem_1fr_4rem] gap-3 items-center text-xs">
            <span className="text-[var(--text-muted)] truncate">{f.label}</span>
            <div className="bg-[var(--bg-surface-hover)] rounded-full h-1.5">
                <div
                    className={`${color} h-1.5 rounded-full transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-right text-[var(--text-muted)]">
                {f.score}<span className="text-[var(--text-faint)]">/{f.maxScore}</span>
            </span>
        </div>
    );
}

// ── score pill ────────────────────────────────────────────────────────────────

function ScorePill({ score, band }: { score: number; band: RiskBand }) {
    const cfg = BAND_CFG[band];
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm font-bold border ${cfg.badge}`}>
            {cfg.emoji} {score}
        </span>
    );
}

// ── row ───────────────────────────────────────────────────────────────────────

function RiskRow({ rs, rank }: { rs: MaintenanceRiskScore; rank: number }) {
    const [open, setOpen] = useState(false);
    const cfg = BAND_CFG[rs.band];

    return (
        <>
            {/* Main row */}
            <tr
                className="border-b border-[var(--border-subtle)] hover:bg-white/[.03] transition-colors cursor-pointer"
                onClick={() => setOpen(o => !o)}
            >
                <td className="px-4 py-3 text-[var(--text-faint)] text-sm w-10 text-center">{rank}</td>
                <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        {open
                            ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
                        }
                        <span className="text-[var(--text-main)] font-medium">{rs.vehicleCode}</span>
                        {rs.licensePlate !== '—' && (
                            <span className="text-[var(--text-faint)] text-xs">{rs.licensePlate}</span>
                        )}
                    </div>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] text-sm hidden sm:table-cell">
                    {[rs.make, rs.model].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-4 py-3">
                    <ScorePill score={rs.score} band={rs.band} />
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${cfg.badge}`}>
                        {cfg.label}
                    </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                    {/* Mini heat bar */}
                    <div className="flex gap-0.5">
                        {rs.factors.map(f => {
                            const pct = f.maxScore > 0 ? f.score / f.maxScore : 0;
                            return (
                                <div
                                    key={f.key}
                                    title={`${f.label}: ${f.score}/${f.maxScore}`}
                                    className={`h-3 flex-1 rounded-sm ${
                                        pct >= 0.8 ? 'bg-red-500' :
                                        pct >= 0.5 ? 'bg-orange-500' :
                                        pct >= 0.25 ? 'bg-amber-400' :
                                        'bg-[var(--bg-surface-hover)]'
                                    }`}
                                />
                            );
                        })}
                    </div>
                </td>
            </tr>

            {/* Expanded factor panel */}
            {open && (
                <tr className="bg-[var(--bg-surface)]/60 border-b border-[var(--border-subtle)]">
                    <td colSpan={6} className="px-6 py-4">
                        <div className="space-y-2.5 max-w-2xl">
                            <p className="text-xs text-[var(--text-faint)] mb-3">
                                Computed {new Date(rs.computedAt).toLocaleString()}
                            </p>
                            {rs.factors.map(f => (
                                <div key={f.key}>
                                    <FactorBar f={f} />
                                    <p className="text-xs text-[var(--text-faint)] ml-[9.5rem] mt-0.5">
                                        {f.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// ── page ──────────────────────────────────────────────────────────────────────

interface ApiResponse { scores: MaintenanceRiskScore[] }

export default function RiskScorePage() {
    const { data, loading, error: rawError, refresh } =
        useFetchedData<ApiResponse>('/api/maintenance/risk-scores');

    const errorMsg: string = rawError
        ? rawError instanceof Error ? rawError.message : String(rawError)
        : '';

    const all: MaintenanceRiskScore[] = data?.scores ?? [];

    const [bandFilter, setBandFilter] = useState<BandFilter>('ALL');

    const filtered = bandFilter === 'ALL'
        ? all
        : all.filter(r => r.band === bandFilter);

    // KPI counts
    const criticalCount = all.filter(r => r.band === 'CRITICAL').length;
    const highCount     = all.filter(r => r.band === 'HIGH').length;
    const mediumCount   = all.filter(r => r.band === 'MEDIUM').length;
    const lowCount      = all.filter(r => r.band === 'LOW').length;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full min-h-[200px]">
                <div className="animate-spin">
                    <div className="w-12 h-12 border-4 border-[var(--border-subtle)] border-t-orange-500 rounded-full" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Maintenance Risk Scores"
                subtitle="0–100 per-vehicle risk index across 10 maintenance signals"
                icon={Gauge}
                accent="amber"
            />

            {errorMsg && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">
                    {errorMsg}
                </div>
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="🔴 Critical"  value={criticalCount} icon={Gauge} accent="rose"    />
                <KpiCard label="🟠 High"      value={highCount}     icon={Gauge} accent="amber"   />
                <KpiCard label="🟡 Medium"    value={mediumCount}   icon={Gauge} accent="default" />
                <KpiCard label="🟢 Low"       value={lowCount}      icon={Gauge} accent="emerald" />
            </div>

            {/* Table card */}
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
                {/* Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
                    {/* Band tabs */}
                    <div className="flex gap-1 flex-wrap">
                        {BAND_TABS.map(t => (
                            <button
                                key={t.key}
                                onClick={() => setBandFilter(t.key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                    bandFilter === t.key
                                        ? 'bg-orange-500 text-white'
                                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]'
                                }`}
                            >
                                {t.emoji} {t.label}
                                {t.key !== 'ALL' && (
                                    <span className="ml-1 text-[var(--text-faint)]">
                                        ({all.filter(r => r.band === t.key).length})
                                    </span>
                                )}
                                {t.key === 'ALL' && (
                                    <span className="ml-1 text-[var(--text-faint)]">({all.length})</span>
                                )}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => refresh()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                    </button>
                </div>

                {filtered.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="text-4xl mb-3">🚗</div>
                        <p className="text-[var(--text-muted)]">
                            {all.length === 0 ? 'No vehicle data available.' : 'No vehicles in this band.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)]">
                                    <th className="px-4 py-3 text-center w-10">#</th>
                                    <th className="px-4 py-3 text-left">Vehicle</th>
                                    <th className="px-4 py-3 text-left hidden sm:table-cell">Make / Model</th>
                                    <th className="px-4 py-3 text-left">Score</th>
                                    <th className="px-4 py-3 text-left hidden md:table-cell">Band</th>
                                    <th className="px-4 py-3 text-left hidden lg:table-cell">Factor heat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((rs, i) => (
                                    <RiskRow key={rs.vehicleId} rs={rs} rank={i + 1} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-[var(--text-faint)] px-1">
                {(Object.keys(BAND_CFG) as RiskBand[]).map(band => {
                    const cfg = BAND_CFG[band];
                    const range =
                        band === 'CRITICAL' ? '75–100' :
                        band === 'HIGH'     ? '50–74'  :
                        band === 'MEDIUM'   ? '25–49'  : '0–24';
                    return (
                        <span key={band}>{cfg.emoji} {cfg.label}: {range}</span>
                    );
                })}
                <span className="ml-2">· Click any row to expand the 10-factor breakdown</span>
            </div>
        </div>
    );
}
