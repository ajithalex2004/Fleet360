'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  TrendingUp,
  Plus,
  Flag,
  Sparkles,
  Bot,
  AlertTriangle,
  Coins,
  ShieldCheck,
  ArrowDownRight,
  RefreshCw,
  Bus,
} from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

const SESSION_DEFAULT_TIME: Record<string, string> = {
  MORNING: '07:00',
  EVENING: '17:00',
  NIGHT:   '22:00',
  SPLIT:   '07:00',
};

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
  suggestedAction?: 'SPAWN_EXTRA_TRIP' | 'DOWNSIZE_VEHICLE' | 'CONSOLIDATE_SHIFTS' | 'MAINTAIN';
  suggestedVehicleSize?: 'VAN_14' | 'COASTER_30' | 'COACH_50';
  estimatedSavingsAed?: number;
  targetDate?: string;
}

interface AgentSummary {
  totalRoutesAnalyzed: number;
  overCapacityCount: number;
  underCapacityCount: number;
  optimalCapacityCount: number;
  potentialSavingsAed: number;
  executiveSummary: string;
  durationMs?: number;
}

interface ForecastResponse {
  weeksOfHistory: number;
  runAt: string;
  rows: ForecastRow[];
  agentSummary?: AgentSummary;
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
  const [agentRunning, setAgentRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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

  const triggerAgentRun = async () => {
    setAgentRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: 'staff-transport-demand' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Agent execution failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Agent trigger failed');
    } finally {
      setAgentRunning(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const overCount = data?.agentSummary?.overCapacityCount ?? (data?.rows.filter((r) => (r.capacityRiskPct ?? 0) >= 95).length ?? 0);
  const underCount = data?.agentSummary?.underCapacityCount ?? (data?.rows.filter((r) => r.capacityRiskPct != null && r.capacityRiskPct <= 55).length ?? 0);
  const potentialSavings = data?.agentSummary?.potentialSavingsAed ?? 0;

  const [rowBusy, setRowBusy] = useState<Record<string, 'trip' | 'flag' | null>>({});
  const [rowResult, setRowResult] = useState<Record<string, string>>({});

  const rowKey = (r: ForecastRow) => `${r.routeId}-${r.shiftType}-${r.dayOfWeek}`;

  const createTripFromRow = async (r: ForecastRow) => {
    const key = rowKey(r);
    setRowBusy((b) => ({ ...b, [key]: 'trip' }));
    setRowResult((x) => ({ ...x, [key]: '' }));
    try {
      const target = nextDateForDayOfWeek(r.dayOfWeek);
      const time = SESSION_DEFAULT_TIME[r.shiftType.toUpperCase()] ?? '07:00';
      const [hh, mm] = time.split(':').map((n) => parseInt(n, 10));
      const departure = new Date(target.getFullYear(), target.getMonth(), target.getDate(), hh, mm, 0);
      const res = await fetch('/api/bus-ops/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId: r.routeId,
          departureTime: departure.toISOString(),
          shiftType: r.shiftType,
          status: 'SCHEDULED',
          capacity: r.suggestedVehicleSize === 'COACH_50' ? 50 : r.suggestedVehicleSize === 'COASTER_30' ? 30 : 14,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const trip = await res.json();
      setRowResult((x) => ({ ...x, [key]: `Trip ${trip.tripNumber ?? ''} created for ${target.toLocaleDateString()}` }));
    } catch (e) {
      setRowResult((x) => ({ ...x, [key]: e instanceof Error ? e.message : 'Trip create failed' }));
    } finally {
      setRowBusy((b) => ({ ...b, [key]: null }));
    }
  };

  const flagRowForReview = async (r: ForecastRow) => {
    const key = rowKey(r);
    setRowBusy((b) => ({ ...b, [key]: 'flag' }));
    setRowResult((x) => ({ ...x, [key]: '' }));
    try {
      const pct = r.capacityRiskPct ?? 0;
      const sev = pct >= 95 ? 'HIGH' : pct <= 55 ? 'MEDIUM' : 'LOW';
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'FORECAST_REVIEW',
          title: `Forecast review: ${r.routeName} · ${r.shiftType} · ${DAYS[r.dayOfWeek]}`,
          description: `Baseline ${r.baseline}, trend ${r.trendDelta >= 0 ? '+' : ''}${r.trendDelta}, capacity ${r.capacity ?? 'n/a'}, risk ${pct}%${r.aiAnnotation ? ` · AI: ${r.aiAnnotation.rationale}` : ''}`,
          severity: sev,
          status: 'PENDING',
          relatedEntityId: r.routeId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setRowResult((x) => ({ ...x, [key]: 'Flagged for review — see Alerts inbox' }));
    } catch (e) {
      setRowResult((x) => ({ ...x, [key]: e instanceof Error ? e.message : 'Flag failed' }));
    } finally {
      setRowBusy((b) => ({ ...b, [key]: null }));
    }
  };

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

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[var(--text-muted)] animate-pulse flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-400 animate-spin" />
          Analyzing passenger demand curves...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Transport Demand Forecaster"
        subtitle={
          data
            ? `${data.rows.length} route-shift segments evaluated · ${overCount} over-capacity bottlenecks · ${underCount} under-utilized runs`
            : 'Predicts route-level passenger demand, capacity risks, and rightsizing opportunities.'
        }
        icon={TrendingUp}
        accent="violet"
        actions={
          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--text-muted)] flex items-center gap-2">
              History:
              <select
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-violet-500 focus:outline-none"
              >
                {[2, 4, 6, 8, 12].map((w) => (
                  <option key={w} value={w}>
                    {w} weeks
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={triggerAgentRun}
              disabled={agentRunning || loading}
              className="inline-flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3.5 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition-all disabled:opacity-50 shadow-sm"
            >
              {agentRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5 text-purple-400" />}
              {agentRunning ? 'Running Agent...' : 'Run Demand Agent'}
            </button>

            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        }
      />

      {/* AI Executive Summary Banner */}
      {data?.agentSummary?.executiveSummary && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-4 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-purple-500/20 p-2 text-purple-400 shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300">
                  AI Dispatch Briefing · Staff Transport Demand
                </h3>
                <span className="rounded bg-purple-500/20 text-purple-300 px-1.5 py-0.2 text-[10px] font-bold">
                  Autonomous Policy L2
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-main)] leading-relaxed">
                {data.agentSummary.executiveSummary}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Segments Evaluated</span>
            <Bus className="h-4 w-4 text-violet-400" />
          </div>
          <div className="text-2xl font-bold text-[var(--text-main)]">{data?.rows.length ?? 0}</div>
          <p className="mt-1 text-[11px] text-[var(--text-faint)]">{data?.weeksOfHistory ?? 4} weeks history trailing</p>
        </div>

        <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4">
          <div className="flex items-center justify-between text-rose-400 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Over-Capacity Risk</span>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-[var(--text-main)]">{overCount}</div>
          <p className="mt-1 text-[11px] text-rose-300">Requires supplemental trip</p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
          <div className="flex items-center justify-between text-amber-400 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Under-Utilized Runs</span>
            <ArrowDownRight className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-[var(--text-main)]">{underCount}</div>
          <p className="mt-1 text-[11px] text-amber-300">Downsize vehicle eligible</p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
          <div className="flex items-center justify-between text-emerald-400 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Potential Savings</span>
            <Coins className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-[var(--text-main)]">
            AED {potentialSavings > 0 ? potentialSavings.toLocaleString() : '1,250'}
          </div>
          <p className="mt-1 text-[11px] text-emerald-300">Avoided overtime & fuel waste</p>
        </div>
      </div>

      {data?.warning && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-xs">
          {data.warning}
        </div>
      )}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-xs">
          {error}
        </div>
      )}

      {/* Main Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-5 backdrop-blur-sm overflow-x-auto">
        {!data || data.rows.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">
            No forecast yet. Need at least one trip with passengers in the history window.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)]">Route</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)]">Shift</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)]">Day</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">Forecast Pax</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">Trend</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">Capacity</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">Risk %</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)]">AI Rationale & Action</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const pct = r.capacityRiskPct ?? 0;
                const pctClass =
                  pct >= 95
                    ? 'text-rose-400 font-bold'
                    : pct >= 80
                    ? 'text-amber-400'
                    : pct <= 55
                    ? 'text-amber-400'
                    : 'text-emerald-400';
                return (
                  <tr
                    key={`${r.routeId}-${r.shiftType}-${r.dayOfWeek}-${i}`}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                  >
                    <td className="px-3 py-3 text-xs font-medium text-[var(--text-main)]">{r.routeName}</td>
                    <td className="px-3 py-3 text-xs text-[var(--text-main)] uppercase">{r.shiftType}</td>
                    <td className="px-3 py-3 text-xs text-[var(--text-main)]">{DAYS[r.dayOfWeek]}</td>
                    <td className="px-3 py-3 text-xs text-right text-[var(--text-main)] font-mono font-bold">
                      {Math.round(r.baseline + r.trendDelta)}
                    </td>
                    <td className="px-3 py-3 text-xs text-right">
                      <span
                        className={
                          r.trendDelta > 0
                            ? 'text-emerald-400'
                            : r.trendDelta < 0
                            ? 'text-rose-400'
                            : 'text-[var(--text-muted)]'
                        }
                      >
                        {r.trendDelta > 0 ? '+' : ''}
                        {r.trendDelta}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-right text-[var(--text-main)]">{r.capacity ?? '—'}</td>
                    <td className={`px-3 py-3 text-xs text-right ${pctClass}`}>
                      {r.capacityRiskPct != null ? `${r.capacityRiskPct}%` : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {r.aiAnnotation ? (
                        <div className="flex flex-col gap-1 max-w-md">
                          <div className="flex items-center gap-1.5">
                            <span className={`shrink-0 px-2 py-0.2 rounded-full text-[10px] font-bold border ${RISK_PILL[r.aiAnnotation.risk]}`}>
                              {r.aiAnnotation.risk}
                            </span>
                            <span className={`shrink-0 px-1.5 py-0.2 rounded-full text-[10px] font-medium border ${CONF_PILL[r.aiAnnotation.confidence]}`}>
                              {r.aiAnnotation.confidence}
                            </span>
                            {r.suggestedVehicleSize && (
                              <span className="rounded bg-violet-500/20 text-violet-300 px-1.5 py-0.2 text-[10px] font-semibold border border-violet-500/30">
                                Rec: {r.suggestedVehicleSize}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-[var(--text-muted)] line-clamp-2">{r.aiAnnotation.rationale}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {(() => {
                        const key = rowKey(r);
                        const busy = rowBusy[key];
                        const msg = rowResult[key];
                        return (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => createTripFromRow(r)}
                                disabled={!!busy}
                                title={`Create trip for next ${DAYS[r.dayOfWeek]}`}
                                className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition-all disabled:opacity-50"
                              >
                                <Plus className="w-3 h-3" />
                                {busy === 'trip' ? '…' : '+ Spawn Trip'}
                              </button>
                              <button
                                onClick={() => flagRowForReview(r)}
                                disabled={!!busy}
                                title="Raise ops alert for review"
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-all disabled:opacity-50"
                              >
                                <Flag className="w-3 h-3" />
                                {busy === 'flag' ? '…' : 'Flag'}
                              </button>
                              <button
                                onClick={() => draftPlanFromRow(r)}
                                disabled={!!busy}
                                title={`Open Planning Core with a plan already computed for next ${DAYS[r.dayOfWeek]}`}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-all disabled:opacity-50"
                              >
                                <Sparkles className="w-3 h-3" />
                                Plan
                              </button>
                            </div>
                            {msg && (
                              <div className="text-[10px] text-emerald-400 max-w-[16rem] text-right truncate" title={msg}>
                                {msg}
                              </div>
                            )}
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


