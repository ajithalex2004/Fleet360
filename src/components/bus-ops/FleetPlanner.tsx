'use client';
/**
 * FleetPlanner — whole-fleet VRPTW solver as a reusable component.
 *
 * Extracted from the former /bus-ops/fleet-optimizer page so it can be
 * embedded as one mode of the Route Optimization page (mode toggle
 * switches between Single Route + Fleet Planner).
 *
 * The solve is async: POST /solve returns a runId, we poll GET /runs/:id
 * every 2s until status transitions to a terminal state.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, XCircle, CheckCircle2, AlertTriangle, Clock, Ban, Send, History } from 'lucide-react';
import FleetOptimizerMap, { type FleetMapRoute, type FleetMapUnassigned } from '@/components/bus-ops/FleetOptimizerMap';

// ── Types (mirror the API response shape) ──────────────────────────────────

type RunStatus =
  | 'PENDING' | 'VALIDATING' | 'SOLVING'
  | 'SUCCESS' | 'INFEASIBLE' | 'FAILED' | 'CANCELLED' | 'PUBLISHED';

interface RunStop {
  id: string;
  sequence: number;
  stopId: string | null;
  lat: number;
  lng: number;
  label: string;
  arrivalTime: string;
  departureTime: string;
  passengerCount: number;
  passengerIds: string[];
}

interface RunRoute {
  id: string;
  vehicleId: string;
  driverId: string | null;
  sequenceInRun: number;
  totalDistanceKm: number;
  totalDurationMin: number;
  totalPassengers: number;
  encodedPolyline: string;
  startTime: string;
  endTime: string;
  stops: RunStop[];
}

interface RunUnassigned {
  id: string;
  passengerId: string | null;
  stopLat: number;
  stopLng: number;
  stopLabel: string;
  reason: string;
  reasonDetail: string | null;
}

interface Run {
  id: string;
  status: RunStatus;
  statusReason: string | null;
  targetDate: string;
  createdAt: string;
  metrics: {
    totalDistanceKm?: number;
    totalDurationMin?: number;
    unassignedCount?: number;
    solveSec?: number;
  } | null;
  errorMessage: string | null;
  publishedAt: string | null;
  routes: RunRoute[];
  unassigned: RunUnassigned[];
}

interface Vehicle {
  id: string;
  licensePlate?: string | null;
  make?: string | null;
  model?: string | null;
  seatingCapacity?: number | null;
}

const TERMINAL_STATES = new Set<RunStatus>(['SUCCESS', 'INFEASIBLE', 'FAILED', 'CANCELLED', 'PUBLISHED']);
const POLL_INTERVAL_MS = 2_000;

export default function FleetPlanner() {
  // Inputs — solve anchors on effectiveFrom; publish loops over weekdays
  // in [effectiveFrom, effectiveTo]. Default effectiveTo = effectiveFrom
  // (single-day, matches the pre-range behaviour).
  const [effectiveFrom, setEffectiveFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [effectiveTo, setEffectiveTo] = useState<string>(effectiveFrom);
  // Keep effectiveTo in sync when the operator advances effectiveFrom past it.
  useEffect(() => {
    if (effectiveTo < effectiveFrom) setEffectiveTo(effectiveFrom);
  }, [effectiveFrom, effectiveTo]);
  // How many weekdays the publish will fan out to — hint for the operator.
  const weekdaysInRange = React.useMemo(() => {
    if (!effectiveFrom || !effectiveTo) return 0;
    const from = new Date(effectiveFrom);
    const to   = new Date(effectiveTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) return 0;
    let count = 0;
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count += 1;
    }
    return count;
  }, [effectiveFrom, effectiveTo]);
  const [timeout, setTimeoutSec] = useState<string>('30');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set());

  // Run state
  const [run, setRun] = useState<Run | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [history, setHistory] = useState<Array<{ id: string; status: RunStatus; targetDate: string; createdAt: string; publishedAt: string | null; metrics: Run['metrics'] }>>([]);

  // Load fleet on mount.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/vehicles');
        const data = await res.json();
        setVehicles(Array.isArray(data) ? data : (data?.vehicles ?? []));
      } catch { /* silent — inputs render with 0 vehicles */ }
    })();
  }, []);

  // Poll while run is non-terminal.
  useEffect(() => {
    if (!run || TERMINAL_STATES.has(run.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/bus-ops/fleet-optimizer/runs/${run.id}`);
        if (!res.ok) return;
        const next = await res.json() as Run;
        setRun(next);
      } catch { /* transient — next tick retries */ }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [run]);

  const solve = async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch('/api/bus-ops/fleet-optimizer/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: effectiveFrom,
          effectiveTo,
          vehicleIds: selectedVehicleIds.size > 0 ? [...selectedVehicleIds] : undefined,
          timeout: `${timeout}s`,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `HTTP ${res.status}`); return; }
      // Fetch the freshly-created run so the polling effect can take over.
      const runRes = await fetch(`/api/bus-ops/fleet-optimizer/runs/${data.runId}`);
      const fullRun = await runRes.json() as Run;
      setRun(fullRun);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Solve failed');
    } finally {
      setStarting(false);
    }
  };

  const cancel = useCallback(async () => {
    if (!run) return;
    try {
      const res = await fetch(`/api/bus-ops/fleet-optimizer/runs/${run.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Cancel failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    }
  }, [run]);

  // Load recent runs on mount + after any status transition on the active run.
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/bus-ops/fleet-optimizer/runs?limit=10');
      const data = await res.json();
      if (Array.isArray(data.items)) setHistory(data.items);
    } catch { /* silent */ }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => {
    if (run && TERMINAL_STATES.has(run.status)) void loadHistory();
  }, [run?.status, loadHistory, run]);

  const openRun = async (runId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/bus-ops/fleet-optimizer/runs/${runId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRun(await res.json() as Run);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open run');
    }
  };

  const publish = async () => {
    if (!run) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/bus-ops/fleet-optimizer/runs/${run.id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPublishConfirm(false);
      // Reload the run to see status=PUBLISHED
      const fresh = await fetch(`/api/bus-ops/fleet-optimizer/runs/${run.id}`);
      if (fresh.ok) setRun(await fresh.json() as Run);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const toggleVehicle = (id: string) => {
    setSelectedVehicleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const isRunning = run && !TERMINAL_STATES.has(run.status);
  const mapRoutes: FleetMapRoute[] = (run?.routes ?? []).map(r => ({
    vehicleId:       r.vehicleId,
    encodedPolyline: r.encodedPolyline,
    stops:           r.stops.map(s => ({
      sequence: s.sequence, lat: s.lat, lng: s.lng, label: s.label, passengerCount: s.passengerCount,
    })),
  }));
  const mapUnassigned: FleetMapUnassigned[] = (run?.unassigned ?? []).map(u => ({
    passengerId: u.passengerId, stopLat: u.stopLat, stopLng: u.stopLng, stopLabel: u.stopLabel, reason: u.reason,
  }));

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* Left — inputs */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1.5">Effective from</div>
                <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none" />
              </label>
              <label className="block">
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1.5">Effective to</div>
                <input type="date" value={effectiveTo} min={effectiveFrom} onChange={e => setEffectiveTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none" />
              </label>
            </div>
            <div className="text-[10px] text-[var(--text-faint)] -mt-2">
              Solver plans against <span className="font-mono">{effectiveFrom}</span>. Publish will fan the plan out to
              {' '}<span className="text-violet-300 font-semibold">{weekdaysInRange}</span> weekday{weekdaysInRange === 1 ? '' : 's'} (Sat/Sun skipped).
            </div>

            <label className="block">
              <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1.5">Solver timeout (seconds)</div>
              <input type="number" min={5} max={300} value={timeout} onChange={e => setTimeoutSec(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none" />
              <div className="text-[10px] text-[var(--text-faint)] mt-1">
                Wall-clock budget for the solver. Larger fleets need more.
              </div>
            </label>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1.5 flex items-center justify-between">
                <span>Vehicles ({selectedVehicleIds.size || 'all'})</span>
                <button type="button" onClick={() => setSelectedVehicleIds(new Set())}
                  className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-main)]">clear</button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] p-2">
                {vehicles.length === 0 && (
                  <div className="text-xs text-[var(--text-faint)] p-2">No vehicles found in the fleet.</div>
                )}
                {vehicles.map(v => {
                  const label = v.licensePlate ?? v.id.slice(0, 8);
                  const seat = v.seatingCapacity != null ? `${v.seatingCapacity} seats` : 'seats unknown';
                  return (
                    <label key={v.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-surface-hover)] cursor-pointer text-xs text-[var(--text-muted)]">
                      <input type="checkbox"
                        checked={selectedVehicleIds.has(v.id)}
                        onChange={() => toggleVehicle(v.id)}
                        className="accent-violet-500" />
                      <span className="flex-1 truncate">{label} · {seat}</span>
                    </label>
                  );
                })}
              </div>
              <div className="text-[10px] text-[var(--text-faint)] mt-1">
                Leave empty to include every vehicle in the fleet.
              </div>
            </div>

            <button
              type="button"
              onClick={solve}
              disabled={starting || !!isRunning || !effectiveFrom || !effectiveTo || weekdaysInRange === 0}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting || isRunning
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> {run?.status ?? 'Starting…'}</>
                : <><Play className="w-4 h-4" /> Solve</>}
            </button>

            {isRunning && (
              <button type="button" onClick={cancel}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/20">
                <Ban className="w-4 h-4" /> Cancel this run
              </button>
            )}
          </div>

          {/* Recent runs */}
          {history.length > 0 && (
            <div className="rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium">
                <History className="w-3.5 h-3.5" /> Recent runs ({history.length})
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {history.map(h => {
                  const cfg = statusStyle(h.status);
                  const active = run?.id === h.id;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => openRun(h.id)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${
                        active ? 'bg-violet-500/20 border border-violet-500/40' : 'hover:bg-[var(--bg-surface-hover)] border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <cfg.Icon className={`w-3 h-3 shrink-0`} />
                        <span className="flex-1 truncate text-[var(--text-main)]">{h.targetDate.slice(0, 10)}</span>
                        {h.publishedAt && <span className="text-[9px] text-violet-300 uppercase">Published</span>}
                      </div>
                      <div className="text-[10px] text-[var(--text-faint)] truncate ml-5">
                        {h.status}
                        {h.metrics?.totalDistanceKm != null ? ` · ${h.metrics.totalDistanceKm} km` : ''}
                        {h.metrics?.unassignedCount != null && h.metrics.unassignedCount > 0 ? ` · ${h.metrics.unassignedCount} unassigned` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right — results */}
        <div className="space-y-4">
          {!run && (
            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/30 p-10 text-center text-sm text-[var(--text-muted)]">
              Choose a target date and press <span className="font-mono">Solve</span> to run the optimizer.
            </div>
          )}

          {run && (
            <>
              <StatusHeader run={run} />
              <MetricsHeader run={run} />

              {run.status === 'SUCCESS' && !run.publishedAt && (
                <div className="flex items-center justify-between rounded-2xl border border-violet-500/40 bg-violet-500/10 px-4 py-3">
                  <div className="text-sm text-violet-100">
                    Ready to publish {run.routes.length} route{run.routes.length === 1 ? '' : 's'} as TripSchedules — fanned out to every weekday in the effective range.
                  </div>
                  <button
                    type="button"
                    onClick={() => setPublishConfirm(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    <Send className="w-4 h-4" /> Publish to Schedules
                  </button>
                </div>
              )}

              {run.publishedAt && (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  <CheckCircle2 className="inline w-4 h-4 mr-1" />
                  Published to Trip Schedules on {new Date(run.publishedAt).toLocaleString()}. View them on the Schedules page.
                </div>
              )}
              {run.routes.length > 0 && (
                <div className="rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] overflow-hidden">
                  <div className="px-4 py-2 border-b border-[var(--border-subtle)] text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium">
                    Routes ({run.routes.length})
                  </div>
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {run.routes.map((r, i) => <RouteCard key={r.id} route={r} index={i} vehicles={vehicles} />)}
                  </div>
                </div>
              )}
              {run.unassigned.length > 0 && (
                <UnassignedPanel unassigned={run.unassigned} />
              )}
              {run.routes.length > 0 && (
                <div className="h-96">
                  <FleetOptimizerMap routes={mapRoutes} unassigned={mapUnassigned} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Publish confirmation modal */}
      {publishConfirm && run && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget && !publishing) setPublishConfirm(false); }}
        >
          <div className="w-full max-w-md rounded-2xl border border-violet-500/40 bg-[var(--bg-surface)]/95 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-500/15 border border-violet-500/40 flex items-center justify-center shrink-0">
                <Send className="w-5 h-5 text-violet-300" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-[var(--text-main)]">Publish to Trip Schedules?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  Creates one TripSchedule per (solved-route × weekday) in the effective range from {new Date(run.targetDate).toLocaleDateString()}. Weekends skipped.
                </p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm text-[var(--text-muted)]">
              <p>
                Each solver-route becomes one scheduled trip. The parent route is picked by
                most-common-passenger — this is a heuristic, not an exact match.
              </p>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Existing schedules for the same date are <span className="font-semibold">not</span> cancelled automatically. Review the Schedules page after publish and cancel any duplicates manually.
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPublishConfirm(false)} disabled={publishing}
                className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] text-sm font-medium disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={publish} disabled={publishing}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
                {publishing ? <><RefreshCw className="w-4 h-4 animate-spin" /> Publishing…</> : <><Send className="w-4 h-4" /> Publish</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Presentational components ──────────────────────────────────────────────

function StatusHeader({ run }: { run: Run }) {
  const cfg = statusStyle(run.status);
  return (
    <div className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${cfg.wrap}`}>
      <cfg.Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{cfg.title}</div>
        {run.statusReason && <div className="text-xs opacity-80 mt-0.5">{run.statusReason}</div>}
        {run.errorMessage && (
          <details className="mt-2 text-[11px] font-mono">
            <summary className="cursor-pointer opacity-70 hover:opacity-100">Error detail</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words opacity-80">{run.errorMessage}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function MetricsHeader({ run }: { run: Run }) {
  const m = run.metrics ?? {};
  const chip = (label: string, value: React.ReactNode) => (
    <div className="rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-medium">{label}</div>
      <div className="text-lg font-semibold text-[var(--text-main)]">{value}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {chip('Routes',      run.routes.length)}
      {chip('Distance',    m.totalDistanceKm != null ? `${m.totalDistanceKm} km` : '—')}
      {chip('Duration',    m.totalDurationMin != null ? `${Math.floor(m.totalDurationMin / 60)}h ${m.totalDurationMin % 60}m` : '—')}
      {chip('Unassigned',  m.unassignedCount ?? run.unassigned.length)}
    </div>
  );
}

function RouteCard({ route, index, vehicles }: { route: RunRoute; index: number; vehicles: Vehicle[] }) {
  const colors = ['bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-pink-500'];
  const dot = colors[index % colors.length];
  const vehicleLabel = vehicles.find(v => v.id === route.vehicleId)?.licensePlate ?? route.vehicleId.slice(0, 8);
  return (
    <details className="group">
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--bg-surface-hover)]">
        <span className={`w-3 h-3 rounded-full ${dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-main)]">Vehicle {vehicleLabel}</div>
          <div className="text-[11px] text-[var(--text-faint)]">
            {route.stops.length} stops · {route.totalPassengers} pax · {route.totalDistanceKm} km · {route.totalDurationMin} min
          </div>
        </div>
      </summary>
      <div className="px-4 pb-3 space-y-1">
        {route.stops.map(s => (
          <div key={s.id} className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-1">
            <span className="w-5 h-5 rounded-full bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-[10px] flex items-center justify-center font-mono">{s.sequence}</span>
            <span className="flex-1 truncate">{s.label}</span>
            <span className="text-[var(--text-faint)]">{s.passengerCount} pax</span>
            <span className="text-[var(--text-faint)] tabular-nums">{new Date(s.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function UnassignedPanel({ unassigned }: { unassigned: RunUnassigned[] }) {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-amber-300" />
        <div className="text-sm font-semibold text-amber-200">{unassigned.length} unassigned</div>
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {unassigned.map(u => (
          <div key={u.id} className="text-xs text-amber-100/90 flex items-start gap-2">
            <span className="font-mono text-[10px] rounded bg-amber-500/20 border border-amber-500/40 px-1 py-0.5">{u.reason}</span>
            <span className="flex-1">{u.stopLabel}{u.reasonDetail ? ` — ${u.reasonDetail}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Status styling ─────────────────────────────────────────────────────────

function statusStyle(status: RunStatus) {
  switch (status) {
    case 'PENDING':
    case 'VALIDATING':
    case 'SOLVING':
      return { title: status.charAt(0) + status.slice(1).toLowerCase() + '…', Icon: RefreshCw, wrap: 'border-sky-500/40 bg-sky-500/10 text-sky-200' };
    case 'SUCCESS':
      return { title: 'Solved', Icon: CheckCircle2, wrap: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' };
    case 'INFEASIBLE':
      return { title: 'No feasible solution', Icon: AlertTriangle, wrap: 'border-amber-500/40 bg-amber-500/10 text-amber-200' };
    case 'FAILED':
      return { title: 'Failed', Icon: XCircle, wrap: 'border-rose-500/40 bg-rose-500/10 text-rose-200' };
    case 'CANCELLED':
      return { title: 'Cancelled', Icon: Ban, wrap: 'border-slate-500/40 bg-slate-500/10 text-[var(--text-main)]' };
    case 'PUBLISHED':
      return { title: 'Published to schedules', Icon: Clock, wrap: 'border-violet-500/40 bg-violet-500/10 text-violet-200' };
  }
}
