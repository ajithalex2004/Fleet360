/**
 * Predictive Maintenance — the AI Platform view of two engines:
 *  - maintenance risk scores (/api/maintenance/risk-scores): every active
 *    vehicle scored from its service, failure, defect, downtime, age,
 *    mileage, inspection and warranty record, with the factor breakdown;
 *  - service forecasts from the preventive-maintenance agent
 *    (/api/agents/preventive-maintenance/forecasts): projected service dates
 *    from each vehicle's daily usage against its service threshold.
 * Maintenance teams see the alert view at /maintenance/predictive-alerts.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Activity, CalendarClock, Gauge } from 'lucide-react';
import type { MaintenanceRiskScore, RiskBand } from '@/types/maintenance';

interface Forecast {
  id: string; vehicleId: string; licensePlate: string | null; make: string | null; model: string | null;
  estimatedDaysToDue: number | null; projectedDueDate: string | null; urgencyLevel: string;
  forecastNarrative: string | null; targetTriggerType: string | null;
}

const BAND: Record<RiskBand, { label: string; cls: string; bar: string }> = {
  CRITICAL: { label: 'Critical', cls: 'bg-red-500/20 text-red-300 border-red-500/30', bar: 'bg-red-500' },
  HIGH:     { label: 'High',     cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30', bar: 'bg-orange-500' },
  MEDIUM:   { label: 'Medium',   cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30', bar: 'bg-amber-500' },
  LOW:      { label: 'Low',      cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', bar: 'bg-emerald-500' },
};
const URGENCY_CLS: Record<string, string> = {
  OVERDUE: 'text-red-400', DUE_SOON: 'text-amber-400', UPCOMING: 'text-sky-400', NORMAL: 'text-[var(--text-muted)]',
};

async function getJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json;
}

const vehicleName = (v: { make?: string | null; model?: string | null; licensePlate?: string | null; vehicleId: string }) =>
  [[v.make, v.model].filter(Boolean).join(' '), v.licensePlate].filter(Boolean).join(' – ') || v.vehicleId;

export default function AIPlatformPredictivePage() {
  const [scores, setScores] = useState<MaintenanceRiskScore[] | null>(null);
  const [forecasts, setForecasts] = useState<Forecast[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fail = (e: unknown) => { if (!cancelled) setErrors((p) => [...p, e instanceof Error ? e.message : String(e)]); };
    getJson('/api/maintenance/risk-scores')
      .then((j) => { if (!cancelled) setScores(Array.isArray(j?.scores) ? j.scores : []); })
      .catch((e) => { fail(e); if (!cancelled) setScores([]); });
    getJson('/api/agents/preventive-maintenance/forecasts')
      .then((j) => { if (!cancelled) setForecasts(Array.isArray(j?.forecasts) ? j.forecasts : []); })
      .catch((e) => { fail(e); if (!cancelled) setForecasts([]); });
    return () => { cancelled = true; };
  }, []);

  const count = (b: RiskBand) => (scores ?? []).filter((s) => s.band === b).length;
  const dueIn30 = (forecasts ?? []).filter((f) => f.estimatedDaysToDue != null && f.estimatedDaysToDue <= 30).length;

  const kpis = [
    { label: 'Critical / high risk', value: scores ? `${count('CRITICAL')} / ${count('HIGH')}` : '—', icon: AlertTriangle, cls: 'text-red-400' },
    { label: 'Medium risk', value: scores ? String(count('MEDIUM')) : '—', icon: Activity, cls: 'text-amber-400' },
    { label: 'Vehicles scored', value: scores ? String(scores.length) : '—', icon: Gauge, cls: 'text-blue-400' },
    { label: 'Services due ≤ 30 days', value: forecasts ? String(dueIn30) : '—', icon: CalendarClock, cls: 'text-purple-400' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)]">Predictive Maintenance</h1>
        <p className="text-xs mt-1 text-[var(--text-faint)]">
          Risk scores from each vehicle&apos;s maintenance record, and service dates projected from its usage.
          Maintenance teams see alerts in{' '}
          <Link href="/maintenance/predictive-alerts" className="underline hover:text-[var(--text-muted)]">Predictive Alerts</Link>.
        </p>
      </div>

      {errors.map((e) => (
        <div key={e} className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{e}</div>
      ))}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <Icon className={`h-4 w-4 mb-2 ${cls}`} />
            <p className="text-xs text-[var(--text-faint)]">{label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${value === '—' ? 'text-[var(--text-faint)]' : 'text-[var(--text-main)]'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Risk ranking */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="p-5 border-b border-[var(--border-subtle)]">
          <h3 className="font-semibold text-[var(--text-main)]">Risk ranking</h3>
          <p className="text-sm text-[var(--text-faint)] mt-0.5">Highest risk first. Select a vehicle to see what drives its score.</p>
        </div>
        {scores === null ? (
          <p className="p-5 text-sm text-[var(--text-faint)]">Loading risk scores…</p>
        ) : scores.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-faint)]">No active vehicles to score yet.</p>
        ) : (
          <div className="divide-y divide-white/10">
            {scores.slice(0, 25).map((s) => {
              const b = BAND[s.band];
              const open = expanded === s.vehicleId;
              return (
                <div key={s.vehicleId}>
                  <button
                    onClick={() => setExpanded(open ? null : s.vehicleId)}
                    className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-[var(--bg-surface-hover)] transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-main)] truncate">{vehicleName(s)}</p>
                      <p className="text-xs text-[var(--text-faint)] mt-0.5 truncate">
                        {s.factors.filter((f) => f.score > 0).sort((x, y) => y.score - x.score).slice(0, 2).map((f) => f.label).join(' · ') || 'No risk factors recorded'}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <p className="text-sm font-bold text-[var(--text-main)]">{s.score}<span className="text-xs text-[var(--text-faint)]">/100</span></p>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
                    </div>
                  </button>
                  {open && (
                    <ul className="px-5 pb-5 space-y-2">
                      {s.factors.map((f) => (
                        <li key={f.key} className="text-xs">
                          <div className="flex justify-between text-[var(--text-muted)]">
                            <span>{f.label}</span>
                            <span>{f.score} / {f.maxScore}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--bg-surface-hover)] overflow-hidden mt-1">
                            <div className={`h-full ${b.bar}`} style={{ width: `${Math.round(f.pct * 100)}%` }} />
                          </div>
                          <p className="text-[var(--text-faint)] mt-0.5">{f.description}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Service forecasts */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="p-5 border-b border-[var(--border-subtle)]">
          <h3 className="font-semibold text-[var(--text-main)]">Projected service dates</h3>
          <p className="text-sm text-[var(--text-faint)] mt-0.5">From the preventive-maintenance agent: each vehicle&apos;s daily usage against its service threshold.</p>
        </div>
        {forecasts === null ? (
          <p className="p-5 text-sm text-[var(--text-faint)]">Loading forecasts…</p>
        ) : forecasts.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-faint)]">No forecasts yet. They appear once the preventive-maintenance agent has run for your vehicles.</p>
        ) : (
          <div className="divide-y divide-white/10">
            {forecasts.slice(0, 15).map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-main)] truncate">{vehicleName(f)}</p>
                  {f.forecastNarrative && <p className="text-xs text-[var(--text-faint)] mt-0.5 line-clamp-2">{f.forecastNarrative}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-semibold ${URGENCY_CLS[f.urgencyLevel] ?? 'text-[var(--text-muted)]'}`}>
                    {f.estimatedDaysToDue == null ? '—' : f.estimatedDaysToDue < 0 ? `${Math.abs(f.estimatedDaysToDue)}d overdue` : `in ${f.estimatedDaysToDue}d`}
                  </p>
                  {f.projectedDueDate && <p className="text-xs text-[var(--text-faint)]">{new Date(f.projectedDueDate).toLocaleDateString('en-GB')}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
