'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, Plus, Flag, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

// Session → default departure time-of-day when spawning a trip from a
// forecast row. Ops can still edit the resulting trip in Schedules.
const SESSION_DEFAULT_TIME: Record<string, string> = {
  MORNING: '07:00',
  EVENING: '17:00',
  NIGHT:   '22:00',
  SPLIT:   '07:00',
};

// Given today and a target day-of-week (0=Sun..6=Sat), return next date
// (today if today matches, else next occurrence within 7 days).
function nextDateForDayOfWeek(dow: number): Date {
  const now = new Date();
  const delta = ((dow - now.getDay()) + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
  return d;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface ForecastRow {
  routeId: string;
  routeName: string;
  shiftType: string;
  dayOfWeek: number;
  baseline: number;
  trendDelta: number;
  trailingWeeks: number;
  capacity: number | null;
  capacityRiskPct: number | null;
  aiAnnotation: { confidence: 'LOW' | 'MEDIUM' | 'HIGH'; risk: 'OVER' | 'UNDER' | 'OK'; rationale: string } | null;
}

interface ForecastResponse {
  weeksOfHistory: number;
  runAt: string;
  rows: ForecastRow[];
  warning?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RISK_PILL: Record<string, string> = {
  OVER:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  UNDER: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  OK:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};

const CONF_PILL: Record<string, string> = {
  HIGH:   'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  MEDIUM: 'bg-amber-900/40 text-amber-300 border-amber-700',
  LOW:    'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] border-[var(--border-strong)]',
};

export default function DemandForecastPage() {
  const router = useRouter();
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [weeks, setWeeks] = useState(4);
  const [aiOn, setAiOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/bus-ops/analytics/demand-forecast?weeks=${weeks}&aiAnnotate=${aiOn ? 1 : 0}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Forecast failed');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Forecast failed');
    } finally {
      setLoading(false);
    }
  }, [weeks, aiOn]);

  useEffect(() => { load(); }, [load]);

  const overCount = data?.rows.filter(r => (r.capacityRiskPct ?? 0) >= 95).length ?? 0;
  const underCount = data?.rows.filter(r => r.capacityRiskPct != null && r.capacityRiskPct <= 55).length ?? 0;

  // Per-row action state: which row is currently spinning + last outcome
  // (keyed on the row's synthetic id so multiple concurrent actions can
  // show independent feedback).
  const [rowBusy, setRowBusy]     = useState<Record<string, 'trip' | 'flag' | null>>({});
  const [rowResult, setRowResult] = useState<Record<string, string>>({});

  const rowKey = (r: ForecastRow) => `${r.routeId}-${r.shiftType}-${r.dayOfWeek}`;

  const createTripFromRow = async (r: ForecastRow) => {
    const key = rowKey(r);
    setRowBusy(b => ({ ...b, [key]: 'trip' }));
    setRowResult(x => ({ ...x, [key]: '' }));
    try {
      const target = nextDateForDayOfWeek(r.dayOfWeek);
      const time = SESSION_DEFAULT_TIME[r.shiftType.toUpperCase()] ?? '07:00';
      const [hh, mm] = time.split(':').map(n => parseInt(n, 10));
      const departure = new Date(target.getFullYear(), target.getMonth(), target.getDate(), hh, mm, 0);
      const res = await fetch('/api/bus-ops/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId:       r.routeId,
          departureTime: departure.toISOString(),
          shiftType:     r.shiftType,
          status:        'SCHEDULED',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const trip = await res.json();
      setRowResult(x => ({ ...x, [key]: `Trip ${trip.tripNumber ?? ''} created for ${target.toLocaleDateString()}` }));
    } catch (e) {
      setRowResult(x => ({ ...x, [key]: e instanceof Error ? e.message : 'Trip create failed' }));
    } finally {
      setRowBusy(b => ({ ...b, [key]: null }));
    }
  };

  const flagRowForReview = async (r: ForecastRow) => {
    const key = rowKey(r);
    setRowBusy(b => ({ ...b, [key]: 'flag' }));
    setRowResult(x => ({ ...x, [key]: '' }));
    try {
      const pct = r.capacityRiskPct ?? 0;
      const sev = pct >= 95 ? 'HIGH' : pct <= 55 ? 'MEDIUM' : 'LOW';
      const res = await fetch('/api/alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        'FORECAST_REVIEW',
          title:       `Forecast review: ${r.routeName} · ${r.shiftType} · ${DAYS[r.dayOfWeek]}`,
          description: `Baseline ${r.baseline}, trend ${r.trendDelta >= 0 ? '+' : ''}${r.trendDelta}, capacity ${r.capacity ?? 'n/a'}, risk ${pct}%${r.aiAnnotation ? ` · AI: ${r.aiAnnotation.rationale}` : ''}`,
          severity:    sev,
          status:      'PENDING',
          relatedEntityId: r.routeId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setRowResult(x => ({ ...x, [key]: 'Flagged for review — see Alerts inbox' }));
    } catch (e) {
      setRowResult(x => ({ ...x, [key]: e instanceof Error ? e.message : 'Flag failed' }));
    } finally {
      setRowBusy(b => ({ ...b, [key]: null }));
    }
  };

  // Closes the "forecast flags risk → someone has to manually go plan for
  // it" gap: hands the flagged day straight to Planning Core with the date
  // pre-filled and a compute already triggered, so the operator lands on a
  // ready-to-review plan instead of a blank form. Planning Core computes
  // fleet-wide for a date range (not scoped to one route), so this seeds a
  // single-day window on the flagged date — the day that's actually at risk.
  const draftPlanFromRow = (r: ForecastRow) => {
    const target = toIsoDate(nextDateForDayOfWeek(r.dayOfWeek));
    const params = new URLSearchParams({
      tab: 'core',
      dateFrom: target,
      dateTo: target,
      autoCompute: '1',
    });
    router.push(`/bus-ops/planning-engine?${params.toString()}`);
  };

  if (loading && !data) return <div className="flex items-center justify-center h-full"><div className="text-[var(--text-muted)] animate-pulse">Loading forecast...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Demand Forecast"
        subtitle={data
          ? `${data.rows.length} forecast rows · ${overCount} over-capacity (≥95%) · ${underCount} under-utilised (≤55%) · ${data.weeksOfHistory} weeks of history`
          : 'Predicts next-week pax counts per (route × shift × day) from history. Top 10 risk rows annotated by gpt-4o-mini.'}
        icon={TrendingUp}
        accent="violet"
        actions={
          <>
            <label className="text-xs text-[var(--text-muted)] flex items-center gap-2">
              History:
              <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}
                className="px-3 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none">
                {[2, 4, 6, 8, 12].map(w => <option key={w} value={w}>{w} weeks</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)] flex items-center gap-2">
              <input type="checkbox" checked={aiOn} onChange={e => setAiOn(e.target.checked)} className="w-4 h-4 accent-violet-500" />
              AI rationale
            </label>
            <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {loading ? 'Forecasting…' : 'Refresh'}
            </button>
          </>
        }
      />

      {data?.warning && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">{data.warning}</div>
      )}
      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {!data || data.rows.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">
            No forecast yet. Need at least one trip with passengers in the history window.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Route</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Shift</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Day</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Forecast</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Trend</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Capacity</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Risk %</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">AI</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const pct = r.capacityRiskPct ?? 0;
                const pctClass = pct >= 95 ? 'text-rose-400 font-bold' : pct >= 80 ? 'text-amber-400' : pct <= 55 ? 'text-amber-400' : 'text-emerald-400';
                return (
                  <tr key={`${r.routeId}-${r.shiftType}-${r.dayOfWeek}-${i}`} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">{r.routeName}</td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)] uppercase">{r.shiftType}</td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">{DAYS[r.dayOfWeek]}</td>
                    <td className="px-4 py-3 text-sm text-right text-[var(--text-main)] font-mono">{r.baseline + r.trendDelta}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span className={r.trendDelta > 0 ? 'text-emerald-400' : r.trendDelta < 0 ? 'text-rose-400' : 'text-[var(--text-muted)]'}>
                        {r.trendDelta > 0 ? '+' : ''}{r.trendDelta}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-[var(--text-main)]">{r.capacity ?? '—'}</td>
                    <td className={`px-4 py-3 text-sm text-right ${pctClass}`}>{r.capacityRiskPct != null ? `${r.capacityRiskPct}%` : '—'}</td>
                    <td className="px-4 py-3">
                      {r.aiAnnotation ? (
                        <div className="flex items-start gap-1.5 max-w-md">
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border ${RISK_PILL[r.aiAnnotation.risk]}`}>{r.aiAnnotation.risk}</span>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border ${CONF_PILL[r.aiAnnotation.confidence]}`}>{r.aiAnnotation.confidence}</span>
                          <span className="text-xs text-[var(--text-muted)] truncate">{r.aiAnnotation.rationale}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const key = rowKey(r);
                        const busy = rowBusy[key];
                        const msg  = rowResult[key];
                        return (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex gap-1">
                              <button
                                onClick={() => createTripFromRow(r)}
                                disabled={!!busy}
                                title={`Create trip for next ${DAYS[r.dayOfWeek]}`}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
                                <Plus className="w-3 h-3" />
                                {busy === 'trip' ? '…' : 'Create trip'}
                              </button>
                              <button
                                onClick={() => flagRowForReview(r)}
                                disabled={!!busy}
                                title="Raise ops alert for review"
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
                                <Flag className="w-3 h-3" />
                                {busy === 'flag' ? '…' : 'Flag'}
                              </button>
                              <button
                                onClick={() => draftPlanFromRow(r)}
                                disabled={!!busy}
                                title={`Open Planning Core with a plan already computed for next ${DAYS[r.dayOfWeek]}`}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
                                <Sparkles className="w-3 h-3" />
                                Draft plan
                              </button>
                            </div>
                            {msg && <div className="text-[10px] text-[var(--text-muted)] max-w-[16rem] text-right truncate" title={msg}>{msg}</div>}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}

