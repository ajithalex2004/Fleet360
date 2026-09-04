'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  UserCheck,
  Moon,
  Timer,
  Calendar,
  Zap,
} from 'lucide-react';
import type { FatigueEvaluationResult } from '@/lib/bus-ops/driver-fatigue-guard';

interface FatigueSummaryData {
  totalDrivers: number;
  compliantCount: number;
  warningCount: number;
  blockedCount: number;
  evaluations: FatigueEvaluationResult[];
}

export default function DriverFatigueDashboard() {
  const [data, setData] = useState<FatigueSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PASS' | 'WARN' | 'BLOCK'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Simulator state
  const [simDriverId, setSimDriverId] = useState('');
  const [simDeparture, setSimDeparture] = useState('');
  const [simDuration, setSimDuration] = useState(60);
  const [simResult, setSimResult] = useState<FatigueEvaluationResult | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  const fetchFatigueStatus = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch('/api/bus-ops/drivers/fatigue-check');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.evaluations?.length > 0 && !simDriverId) {
          setSimDriverId(json.evaluations[0].driverId);
        }
      }
    } catch (err) {
      console.error('Failed to load fatigue status', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [simDriverId]);

  useEffect(() => {
    fetchFatigueStatus();
    // Default simulator time to 2 hours from now
    const nextTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    setSimDeparture(nextTime.toISOString().slice(0, 16));
  }, [fetchFatigueStatus]);

  const handleRunSimulator = async () => {
    if (!simDriverId || !simDeparture) return;
    setSimRunning(true);
    setSimResult(null);

    try {
      const res = await fetch('/api/bus-ops/drivers/fatigue-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId: simDriverId,
          targetDepartureTime: new Date(simDeparture).toISOString(),
          targetDurationMinutes: Number(simDuration),
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setSimResult(json);
      }
    } catch (err) {
      console.error('Simulation failed', err);
    } finally {
      setSimRunning(false);
    }
  };

  const filteredEvaluations = useMemo(() => {
    if (!data?.evaluations) return [];
    return data.evaluations.filter((item) => {
      const matchStatus = statusFilter === 'ALL' || item.severity === statusFilter;
      const matchSearch =
        !searchQuery ||
        (item.driverName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.driverId.toLowerCase().includes(searchQuery.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [data, statusFilter, searchQuery]);

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
              🛡️ HOS Safety Guard
            </span>
            <span className="text-xs text-[var(--text-muted)]">Mandatory 8h Rest & Fatigue Prevention</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mt-1">Driver Fatigue & Rest Monitor</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Real-time split-shift rest tracking, 4.5h continuous driving limits, and automated assignment lockout.
          </p>
        </div>

        <button
          onClick={() => fetchFatigueStatus(true)}
          disabled={refreshing || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-rose-400' : ''}`} />
          Refresh Rest Matrix
        </button>
      </div>

      {/* Critical Hazard Banner if any driver is in lockout */}
      {data && data.blockedCount > 0 && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-rose-300">
              Fatigue Lockout Triggered ({data.blockedCount} Drivers Hard-Blocked)
            </div>
            <div className="text-rose-200/80 text-xs mt-0.5">
              These drivers have not completed their mandatory 8-hour continuous rest period or have exceeded daily limits. Dispatching them to active passenger trips is strictly blocked.
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-1">
          <div className="text-xs text-[var(--text-muted)] font-medium">Total Monitored Drivers</div>
          <div className="text-2xl font-bold text-[var(--text-main)]">{data?.totalDrivers ?? '—'}</div>
          <div className="text-[11px] text-[var(--text-faint)]">Active roster drivers</div>
        </div>

        <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-1">
          <div className="text-xs text-emerald-400 font-medium">Fully Rested (Pass)</div>
          <div className="text-2xl font-bold text-emerald-300">{data?.compliantCount ?? '—'}</div>
          <div className="text-[11px] text-emerald-400/70">≥ 8 hours continuous rest</div>
        </div>

        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/20 space-y-1">
          <div className="text-xs text-amber-400 font-medium">Tight Rest Buffer (Warn)</div>
          <div className="text-2xl font-bold text-amber-300">{data?.warningCount ?? '—'}</div>
          <div className="text-[11px] text-amber-400/70">8h–10h buffer or night-shift</div>
        </div>

        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/20 space-y-1">
          <div className="text-xs text-rose-400 font-medium">Hard-Lockout (Blocked)</div>
          <div className="text-2xl font-bold text-rose-300">{data?.blockedCount ?? '—'}</div>
          <div className="text-[11px] text-rose-400/70">&lt; 8h rest or &gt;10h daily drive</div>
        </div>
      </div>

      {/* Simulator & Rest Matrix Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Driver Rest Matrix Table */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search driver name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg pl-9 pr-3 py-2 text-xs text-[var(--text-main)] focus:outline-none focus:border-rose-500/50"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              {(['ALL', 'PASS', 'WARN', 'BLOCK'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === st
                      ? 'bg-rose-600 text-[var(--text-main)]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)]'
                  }`}
                >
                  {st === 'ALL' ? 'All Drivers' : st === 'PASS' ? 'Rested' : st === 'WARN' ? 'At-Risk' : 'Blocked'}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-[var(--text-muted)] text-xs animate-pulse">
                Evaluating driver rest cycles and HOS telemetry...
              </div>
            ) : filteredEvaluations.length === 0 ? (
              <div className="p-12 text-center text-[var(--text-faint)] text-xs">
                No drivers match the selected status filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--bg-surface)]/90 text-[var(--text-muted)] border-b border-[var(--border-subtle)] uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3">Driver</th>
                      <th className="p-3">Last Shift End</th>
                      <th className="p-3">Continuous Rest</th>
                      <th className="p-3">24h Drive Time</th>
                      <th className="p-3">Safety Status</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredEvaluations.map((item) => {
                      const restHours = item.metrics.restTimeSinceLastShiftHours;
                      const isBlock = item.severity === 'BLOCK';
                      const isWarn = item.severity === 'WARN';

                      return (
                        <tr key={item.driverId} className="hover:bg-[var(--bg-surface)]/30 transition-colors">
                          <td className="p-3">
                            <div className="font-semibold text-[var(--text-main)]">{item.driverName}</div>
                            <div className="text-[10px] text-[var(--text-faint)]">ID: {item.driverId.slice(0, 8)}</div>
                          </td>
                          <td className="p-3 text-[var(--text-muted)]">
                            {item.metrics.lastTripEndAt
                              ? new Date(item.metrics.lastTripEndAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : 'No prior trip today'}
                          </td>
                          <td className="p-3">
                            {restHours !== null ? (
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                                <span
                                  className={`font-semibold ${
                                    restHours >= 8
                                      ? 'text-emerald-400'
                                      : restHours >= 6.5
                                      ? 'text-amber-400'
                                      : 'text-rose-400'
                                  }`}
                                >
                                  {restHours.toFixed(1)} hrs
                                </span>
                              </div>
                            ) : (
                              <span className="text-[var(--text-faint)]">Fully rested</span>
                            )}
                          </td>
                          <td className="p-3 text-[var(--text-muted)]">
                            <span className={item.metrics.rolling24hDriveHours > 8.5 ? 'text-amber-400 font-semibold' : ''}>
                              {item.metrics.rolling24hDriveHours} hrs / 10h
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                isBlock
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                  : isWarn
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              }`}
                            >
                              {isBlock ? (
                                <>
                                  <XCircle className="w-3 h-3 text-rose-400" /> Hard Lockout
                                </>
                              ) : isWarn ? (
                                <>
                                  <AlertTriangle className="w-3 h-3 text-amber-400" /> At-Risk
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Rested & Ready
                                </>
                              )}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => {
                                setSimDriverId(item.driverId);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="text-xs text-rose-400 hover:text-rose-300 font-medium"
                            >
                              Simulate Run →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Interactive Pre-Assignment Fatigue Simulator */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
            <Zap className="w-4 h-4 text-amber-400" />
            <h3 className="font-semibold text-sm text-[var(--text-main)]">Pre-Assignment Simulator</h3>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Test a proposed trip departure time before dispatching to verify whether the driver meets the mandatory 8-hour rest requirement.
          </p>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[var(--text-muted)] mb-1">Select Driver</label>
              <select
                value={simDriverId}
                onChange={(e) => setSimDriverId(e.target.value)}
                className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-2.5 text-[var(--text-main)] focus:outline-none focus:border-rose-500"
              >
                {data?.evaluations.map((d) => (
                  <option key={d.driverId} value={d.driverId}>
                    {d.driverName} ({d.severity})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[var(--text-muted)] mb-1">Proposed Departure Timestamp</label>
              <input
                type="datetime-local"
                value={simDeparture}
                onChange={(e) => setSimDeparture(e.target.value)}
                className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-2.5 text-[var(--text-main)] focus:outline-none focus:border-rose-500"
              >
              </input>
            </div>

            <div>
              <label className="block text-[var(--text-muted)] mb-1">Estimated Trip Duration (Minutes)</label>
              <input
                type="number"
                min={15}
                max={480}
                value={simDuration}
                onChange={(e) => setSimDuration(Number(e.target.value))}
                className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-2.5 text-[var(--text-main)] focus:outline-none focus:border-rose-500"
              />
            </div>

            <button
              onClick={handleRunSimulator}
              disabled={simRunning || !simDriverId || !simDeparture}
              className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-[var(--text-main)] font-semibold transition-colors disabled:opacity-50 mt-2"
            >
              {simRunning ? 'Evaluating Rest Telemetry...' : 'Evaluate Driver Assignment'}
            </button>
          </div>

          {/* Simulation Result */}
          {simResult && (
            <div
              className={`p-4 rounded-xl border text-xs space-y-2 mt-4 ${
                simResult.severity === 'BLOCK'
                  ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                  : simResult.severity === 'WARN'
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              }`}
            >
              <div className="flex items-center justify-between font-bold text-sm">
                <span>{simResult.severity === 'BLOCK' ? '❌ DISPATCH BLOCKED' : simResult.severity === 'WARN' ? '⚠️ DISPATCH AT-RISK' : '✅ COMPLIANT DISPATCH'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-black/30">{simResult.severity}</span>
              </div>
              <div className="text-[11px] leading-relaxed">{simResult.recommendation}</div>

              {simResult.violations.length > 0 && (
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1 text-[11px]">
                  <div className="font-semibold">Safety Violations Detected:</div>
                  {simResult.violations.map((v, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[var(--text-muted)]">
                      <span>•</span>
                      <span>{v.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
