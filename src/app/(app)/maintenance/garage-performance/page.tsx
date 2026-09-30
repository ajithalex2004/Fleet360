'use client';

import { useEffect, useState } from 'react';
import type { GarageScorecard } from '@/lib/maintenance/garage-performance';

const scoreColor = (s: number | null) =>
    s == null ? 'text-[var(--text-faint)]' : s >= 90 ? 'text-green-600' : s >= 75 ? 'text-yellow-600' : s >= 60 ? 'text-orange-600' : 'text-red-600';
const scoreBg = (s: number | null) =>
    s == null ? 'bg-[var(--bg-surface-hover)] border-[var(--border-subtle)]'
    : s >= 90 ? 'bg-emerald-500/20 border-green-300' : s >= 75 ? 'bg-amber-500/20 border-yellow-300'
    : s >= 60 ? 'bg-orange-500/20 border-orange-300' : 'bg-red-500/20 border-red-300';

const fmt = (v: number | null, suffix = '') => (v == null ? '—' : `${v.toLocaleString('en-AE')}${suffix}`);
const aed = (v: number | null) => (v == null ? '—' : `AED ${v.toLocaleString('en-AE')}`);

function Rate({ label, value, note }: { label: string; value: number | null; note: string }) {
    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--text-muted)]">{label}</span>
                <span className={`text-sm font-bold ${scoreColor(value)}`}>{fmt(value, '%')}</span>
            </div>
            <div className="w-full bg-[var(--bg-surface-hover)] rounded-full h-3">
                <div
                    className={`h-3 rounded-full ${value == null ? '' : value >= 90 ? 'bg-green-600' : value >= 75 ? 'bg-yellow-600' : 'bg-orange-600'}`}
                    style={{ width: `${value ?? 0}%` }}
                />
            </div>
            <p className="text-xs text-[var(--text-faint)] mt-1">{note}</p>
        </div>
    );
}

export default function GaragePerformancePage() {
    const [garages, setGarages] = useState<GarageScorecard[] | null>(null);
    const [months, setMonths] = useState(12);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/maintenance/garage-performance', { cache: 'no-store' })
            .then(async res => {
                const json = await res.json().catch(() => null);
                if (!res.ok) throw new Error(json?.error ?? `Could not load garage performance (${res.status})`);
                if (!cancelled) { setGarages(Array.isArray(json?.garages) ? json.garages : []); setMonths(json?.months ?? 12); }
            })
            .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load garage performance'); setGarages([]); } });
        return () => { cancelled = true; };
    }, []);

    const rows: Array<[string, (g: GarageScorecard) => string, (g: GarageScorecard) => string]> = [
        ['Overall score', g => fmt(g.overallScore), g => scoreColor(g.overallScore)],
        ['On-time completion', g => fmt(g.onTimeRate, '%'), g => scoreColor(g.onTimeRate)],
        ['QC first-time pass', g => fmt(g.qcFirstPassRate, '%'), g => scoreColor(g.qcFirstPassRate)],
        ['Jobs (completed)', g => `${g.totalJobs} (${g.completedJobs})`, () => 'text-[var(--text-main)]'],
        ['Avg completion', g => fmt(g.avgCompletionDays, ' days'), () => 'text-[var(--text-main)]'],
        ['Avg actual cost', g => aed(g.avgActualCost), () => 'text-[var(--text-main)]'],
        ['Cost vs estimate', g => (g.costVariancePct == null ? '—' : `${g.costVariancePct > 0 ? '+' : ''}${g.costVariancePct}%`), g => (g.costVariancePct == null ? 'text-[var(--text-faint)]' : g.costVariancePct <= 0 ? 'text-green-600' : 'text-red-600')],
        ['Response time', g => fmt(g.responseHours, ' h'), () => 'text-[var(--text-main)]'],
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-[var(--text-main)]">Garage Performance Metrics</h1>
                <p className="text-xs mt-1 text-[var(--text-faint)]">
                    From maintenance requests assigned to each garage in the last {months} months. The overall score is the average of on-time completion and first-time QC pass rate.
                </p>
            </div>

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

            {garages === null ? (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-sm text-[var(--text-faint)]">Loading garage performance…</div>
            ) : garages.length === 0 && !error ? (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-sm text-[var(--text-faint)]">
                    No maintenance requests have been assigned to a garage in the last {months} months.
                </div>
            ) : (
                <>
                    {/* Rankings */}
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-[var(--text-main)] mb-4">Overall Rankings</h3>
                        <div className="space-y-3">
                            {garages.map((g, i) => (
                                <div key={g.garageId} className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50">
                                    <div className="w-8 text-center text-lg font-bold text-[var(--text-faint)]">{g.overallScore == null ? '–' : i + 1}</div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-base font-bold text-[var(--text-main)] truncate">{g.garageName}</h4>
                                        <p className="text-sm text-[var(--text-faint)]">{g.completedJobs} of {g.totalJobs} jobs completed</p>
                                    </div>
                                    <div className={`rounded-full px-4 py-2 border ${scoreBg(g.overallScore)}`}>
                                        <p className={`text-2xl font-bold ${scoreColor(g.overallScore)}`}>{fmt(g.overallScore)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Detail cards */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {garages.map(g => (
                            <div key={g.garageId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm p-6 space-y-5">
                                <div className="flex items-start justify-between">
                                    <h3 className="text-lg font-bold text-[var(--text-main)]">{g.garageName}</h3>
                                    <div className={`rounded-full px-4 py-2 border ${scoreBg(g.overallScore)}`}>
                                        <p className={`text-2xl font-bold ${scoreColor(g.overallScore)}`}>{fmt(g.overallScore)}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                    <div><p className="text-xs text-[var(--text-faint)]">Jobs</p><p className="text-2xl font-bold text-[var(--text-main)]">{g.totalJobs}</p><p className="text-xs text-green-600">{g.completedJobs} completed</p></div>
                                    <div><p className="text-xs text-[var(--text-faint)]">Avg completion</p><p className="text-2xl font-bold text-[var(--text-main)]">{fmt(g.avgCompletionDays, 'd')}</p></div>
                                    <div>
                                        <p className="text-xs text-[var(--text-faint)]">Avg cost</p>
                                        <p className="text-lg font-bold text-[var(--text-main)]">{aed(g.avgActualCost)}</p>
                                        {g.costVariancePct != null && (
                                            <p className={`text-xs ${g.costVariancePct <= 0 ? 'text-green-600' : 'text-red-600'}`}>{g.costVariancePct > 0 ? '+' : ''}{g.costVariancePct}% vs estimate</p>
                                        )}
                                    </div>
                                    <div><p className="text-xs text-[var(--text-faint)]">Response</p><p className="text-2xl font-bold text-[var(--text-main)]">{fmt(g.responseHours, 'h')}</p></div>
                                </div>
                                <Rate label="On-time completion" value={g.onTimeRate} note="Completed jobs with a promised date that finished by it" />
                                <Rate label="QC first-time pass" value={g.qcFirstPassRate} note="Inspected jobs whose first quality inspection passed" />
                            </div>
                        ))}
                    </div>

                    {/* Comparison */}
                    {garages.length > 1 && (
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm overflow-x-auto">
                            <div className="p-6 border-b border-[var(--border-subtle)]"><h3 className="text-lg font-bold text-[var(--text-main)]">Side-by-Side Comparison</h3></div>
                            <table className="min-w-full divide-y divide-white/10">
                                <thead className="bg-[var(--bg-surface)]/50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase">Metric</th>
                                        {garages.map(g => <th key={g.garageId} className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase">{g.garageName}</th>)}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/10">
                                    {rows.map(([label, value, cls]) => (
                                        <tr key={label}>
                                            <td className="px-6 py-4 text-sm font-medium text-[var(--text-main)]">{label}</td>
                                            {garages.map(g => <td key={g.garageId} className={`px-6 py-4 text-sm font-bold ${cls(g)}`}>{value(g)}</td>)}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
