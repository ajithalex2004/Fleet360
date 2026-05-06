'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

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
  LOW:    'bg-slate-700/40 text-slate-400 border-slate-600',
};

export default function DemandForecastPage() {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demand Forecast"
        subtitle="Predicts next-week pax counts per (route × shift × day) from history. Top 10 risk rows annotated by gpt-4o-mini."
        icon={TrendingUp}
        accent="violet"
        actions={
          <>
            <label className="text-xs text-slate-400 flex items-center gap-2">
              History:
              <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}
                className="px-2 py-1 rounded-lg bg-slate-800 border border-white/10 text-white text-xs">
                {[2, 4, 6, 8, 12].map(w => <option key={w} value={w}>{w} weeks</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 flex items-center gap-2">
              <input type="checkbox" checked={aiOn} onChange={e => setAiOn(e.target.checked)} className="w-4 h-4" />
              AI rationale
            </label>
            <button onClick={load} disabled={loading} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {loading ? 'Forecasting…' : 'Refresh'}
            </button>
          </>
        }
      />

      {data?.warning && (
        <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-sm">{data.warning}</div>
      )}
      {error && <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">{error}</div>}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Forecast rows" value={data.rows.length} />
          <Stat label="Over-capacity (≥95%)" value={overCount} accent="rose" />
          <Stat label="Under-utilised (≤55%)" value={underCount} accent="amber" />
          <Stat label="History" value={`${data.weeksOfHistory} wk`} />
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Computing baseline + AI rationales…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No forecast yet. Need at least one trip with passengers in the history window.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3 text-right">Forecast</th>
                <th className="px-4 py-3 text-right">Trend</th>
                <th className="px-4 py-3 text-right">Capacity</th>
                <th className="px-4 py-3 text-right">Risk %</th>
                <th className="px-4 py-3">AI</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const pct = r.capacityRiskPct ?? 0;
                const pctClass = pct >= 95 ? 'text-rose-300 font-bold' : pct >= 80 ? 'text-amber-300' : pct <= 55 ? 'text-amber-400' : 'text-emerald-300';
                return (
                  <tr key={`${r.routeId}-${r.shiftType}-${r.dayOfWeek}-${i}`} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="text-white font-medium">{r.routeName}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300 uppercase">{r.shiftType}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">{DAYS[r.dayOfWeek]}</td>
                    <td className="px-4 py-3 text-right text-white font-mono">{r.baseline + r.trendDelta}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className={r.trendDelta > 0 ? 'text-emerald-300' : r.trendDelta < 0 ? 'text-rose-300' : 'text-slate-500'}>
                        {r.trendDelta > 0 ? '+' : ''}{r.trendDelta}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">{r.capacity ?? '—'}</td>
                    <td className={`px-4 py-3 text-right ${pctClass}`}>{r.capacityRiskPct != null ? `${r.capacityRiskPct}%` : '—'}</td>
                    <td className="px-4 py-3">
                      {r.aiAnnotation ? (
                        <div className="flex items-start gap-1.5 max-w-md">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] border ${RISK_PILL[r.aiAnnotation.risk]}`}>{r.aiAnnotation.risk}</span>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] border ${CONF_PILL[r.aiAnnotation.confidence]}`}>{r.aiAnnotation.confidence}</span>
                          <span className="text-[11px] text-slate-300 truncate">{r.aiAnnotation.rationale}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-5 text-xs text-slate-400 space-y-2">
        <p className="text-white font-semibold mb-1">How the forecast works</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Baseline</strong>: average pax for each (route × shift × day-of-week) bucket over the history window. Uses TripSchedule.confirmedCount.</li>
          <li><strong>Trend delta</strong>: recent-half-window average minus older-half-window average. Positive → demand rising.</li>
          <li><strong>Risk %</strong>: (forecast pax) / capacity. ≥95% triggers OVER risk, ≤55% triggers UNDER.</li>
          <li><strong>AI rationale</strong>: gpt-4o-mini annotates the top 10 risk rows with confidence (HIGH only with ≥3 samples + low variance) and a one-line dispatcher hint.</li>
          <li>Forecast is read-only — operators decide what to do (split a trip, merge low-utilisation pairs, reassign capacity).</li>
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = 'slate' }: { label: string; value: string | number; accent?: string }) {
  const cls: Record<string, string> = { slate: 'text-white', rose: 'text-rose-300', amber: 'text-amber-300' };
  return (
    <div className="rounded-xl bg-slate-800/60 border border-white/10 p-4">
      <div className={`text-3xl font-bold ${cls[accent]}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}
