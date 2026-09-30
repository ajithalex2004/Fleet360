'use client';

import { useEffect, useState } from 'react';
import type { MaintenanceAnalytics } from '@/lib/maintenance/analytics';

const PERIODS = [
    { months: 3, label: 'Last 3 months' },
    { months: 6, label: 'Last 6 months' },
    { months: 12, label: 'Last 12 months' },
] as const;

const TYPE_LABEL: Record<string, string> = {
    PREVENTIVE: 'Preventive',
    CORRECTIVE: 'Corrective',
    EMERGENCY: 'Emergency',
    INSPECTION: 'Inspection',
    BREAKDOWN: 'Breakdown',
    PREDICTIVE: 'Predictive',
    UNSPECIFIED: 'Not specified',
};
const TYPE_COLOR = ['bg-blue-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500', 'bg-violet-500', 'bg-slate-400'];

const aed = (n: number) => `AED ${Math.round(n).toLocaleString('en-AE')}`;

export default function AnalyticsPage() {
    const [months, setMonths] = useState<number>(6);
    const [data, setData] = useState<MaintenanceAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetch(`/api/maintenance/analytics?months=${months}`, { cache: 'no-store' })
            .then(async res => {
                const json = await res.json().catch(() => null);
                if (!res.ok) throw new Error(json?.error ?? `Could not load analytics (${res.status})`);
                if (!cancelled) setData(json as MaintenanceAnalytics);
            })
            .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load analytics'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [months]);

    const maxCost = Math.max(0, ...(data?.costByMonth ?? []).map(m => m.cost));
    const hasCost = (data?.totalCost ?? 0) > 0;

    const cards = [
        { label: 'Maintenance Requests', value: data ? data.requests.toLocaleString('en-AE') : '—', sub: data ? `${data.completed} completed · ${data.openRequests} open now` : '' },
        { label: 'Vehicles Serviced', value: data ? data.vehiclesServiced.toLocaleString('en-AE') : '—', sub: 'With a request in the period' },
        {
            label: 'Actual Cost',
            value: data && hasCost ? aed(data.totalCost) : '—',
            sub: data?.avgCostPerVehicle != null ? `${aed(data.avgCostPerVehicle)} per vehicle` : 'No invoiced costs recorded',
        },
        {
            label: 'Downtime',
            value: data?.downtimeDays != null ? `${data.downtimeDays}` : '—',
            sub: data?.downtimeDays != null ? 'days in total, request to completion' : 'No completed requests',
        },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">Maintenance Analytics</h1>
                    <p className="text-xs mt-1 text-[var(--text-faint)]">From your maintenance requests and their invoiced costs</p>
                </div>
                <select
                    value={months}
                    onChange={(e) => setMonths(Number(e.target.value))}
                    className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                >
                    {PERIODS.map(p => <option key={p.months} value={p.months}>{p.label}</option>)}
                </select>
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
            )}

            <div className={`grid grid-cols-1 md:grid-cols-4 gap-4 ${loading ? 'opacity-60' : ''}`}>
                {cards.map(c => (
                    <div key={c.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                        <p className="text-sm text-[var(--text-faint)]">{c.label}</p>
                        <p className={`text-3xl font-bold ${c.value === '—' ? 'text-[var(--text-faint)]' : 'text-[var(--text-main)]'}`}>{c.value}</p>
                        {c.sub && <p className="text-xs text-[var(--text-faint)] mt-1">{c.sub}</p>}
                    </div>
                ))}
            </div>

            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${loading ? 'opacity-60' : ''}`}>
                {/* Cost by month */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-[var(--text-main)] mb-4">Actual Cost by Month</h3>
                    {!hasCost ? (
                        <p className="text-sm text-[var(--text-faint)]">No invoiced maintenance costs in this period yet.</p>
                    ) : (
                        <div className="space-y-3">
                            {data!.costByMonth.map(m => (
                                <div key={m.month} className="flex items-center gap-3">
                                    <span className="text-sm font-medium text-[var(--text-muted)] w-14">{m.label}</span>
                                    <div className="flex-1 bg-[var(--bg-surface-hover)] rounded-full h-7 relative overflow-hidden">
                                        <div className="bg-blue-600 h-7 rounded-full" style={{ width: `${maxCost ? (m.cost / maxCost) * 100 : 0}%` }} />
                                    </div>
                                    <span className="text-xs font-medium text-[var(--text-muted)] w-24 text-right">{m.cost ? aed(m.cost) : '—'}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Type mix */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-[var(--text-main)] mb-4">Maintenance Type Mix</h3>
                    {!data || data.byType.length === 0 ? (
                        <p className="text-sm text-[var(--text-faint)]">No maintenance requests in this period yet.</p>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex h-4 w-full overflow-hidden rounded-full bg-[var(--bg-surface-hover)]">
                                {data.byType.map((t, i) => (
                                    <div key={t.type} className={TYPE_COLOR[i % TYPE_COLOR.length]} style={{ width: `${t.pct}%` }} title={`${TYPE_LABEL[t.type] ?? t.type}: ${t.pct}%`} />
                                ))}
                            </div>
                            <ul className="space-y-2">
                                {data.byType.map((t, i) => (
                                    <li key={t.type} className="flex items-center justify-between text-sm">
                                        <span className="flex items-center gap-2 text-[var(--text-muted)]">
                                            <span className={`h-3 w-3 rounded-full ${TYPE_COLOR[i % TYPE_COLOR.length]}`} />
                                            {TYPE_LABEL[t.type] ?? t.type}
                                        </span>
                                        <span className="font-medium text-[var(--text-main)]">{t.count} · {t.pct}%</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                {/* Top jobs */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm lg:col-span-2">
                    <h3 className="text-lg font-bold text-[var(--text-main)] mb-4">Most Frequent Jobs</h3>
                    {!data || data.topJobs.length === 0 ? (
                        <p className="text-sm text-[var(--text-faint)]">No jobs recorded on maintenance requests in this period yet.</p>
                    ) : (
                        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
                            <table className="min-w-full divide-y divide-white/10">
                                <thead className="bg-[var(--bg-surface)]/50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase">Job</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase">Requests</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase">Avg request cost</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/10 bg-[var(--bg-surface)]">
                                    {data.topJobs.map(j => (
                                        <tr key={j.job}>
                                            <td className="px-6 py-4 text-sm font-medium text-[var(--text-main)]">{j.job}</td>
                                            <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{j.occurrences}</td>
                                            <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{j.avgCost != null ? aed(j.avgCost) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
