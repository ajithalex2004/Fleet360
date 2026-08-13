'use client';

/**
 * VRP batch planner — assign N shipments across M vehicles optimally.
 *
 * Distinct from the single-route calculator at /logistics/planner (which
 * plans waypoints for one trip). This page:
 *   1. Operator selects available vehicles + pending shipments
 *   2. Clicks Optimize → POST /api/logistics/planner/optimize
 *   3. Reviews the resulting routes, per-route violation badges, summary
 *   4. Commits (writes assignments) or discards
 *
 * Implements the three-pane layout from ROUTE_OPTIMIZER_V1_SPEC.md §7.
 * Manual drag-to-reorder (the /edit endpoint) is wired as a follow-up;
 * v1 ships the optimize → review → commit core.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Route as RouteIcon, Truck, Package, Play, Check, AlertTriangle, RefreshCw, GripVertical, X } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui/page-theme';

// ── Types mirror the API response (RouteOptimizerResult) ───────────────────

interface RouteStop {
  sequence: number;
  stopId: string;
  shipmentId: string;
  type: 'PICKUP' | 'DELIVERY';
  arriveMin: number;
  departMin: number;
  onTime: boolean;
  lateMinutes: number;
  loadAfterKg: number;
}
interface SolvedRoute {
  vehicleId: string;
  driverId: string | null;
  stops: RouteStop[];
  totalDistanceKm: number;
  totalDurationMin: number;
  capacityUtilization: { weightPct: number; volumePct: number };
  estimatedCost: number;
  violations: Array<{ stopId: string; kind: string; detail: string }>;
}
interface OptimizeResult {
  routes: SolvedRoute[];
  unassigned: Array<{ shipmentId: string; reason: string; detail?: string }>;
  summary: {
    totalDistanceKm: number;
    totalDurationMin: number;
    vehiclesUsed: number;
    shipmentsAssigned: number;
    shipmentsUnassigned: number;
    estimatedCost: number;
    timeWindowViolations: number;
  };
}
interface OptimizeResponse {
  planId: string;
  status: 'COMPLETED' | 'PARTIAL';
  result: OptimizeResult;
  geocodeFailures: Array<{ stopId: string; address: string | null; reason: string }>;
}

interface SelectableVehicle { id: string; label: string; capacityKg: number | null; }
interface SelectableShipment { id: string; label: string; weightKg: number | null; }

function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function VrpPlannerPage() {
  const [vehicles, setVehicles] = useState<SelectableVehicle[]>([]);
  const [shipments, setShipments] = useState<SelectableShipment[]>([]);
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());
  const [selectedShipments, setSelectedShipments] = useState<Set<string>>(new Set());
  const [loadingInputs, setLoadingInputs] = useState(true);

  const [optimizing, setOptimizing] = useState(false);
  const [plan, setPlan] = useState<OptimizeResponse | null>(null);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Which stop is currently being dragged, and from which vehicle's route.
  const [drag, setDrag] = useState<{ stopId: string; vehicleId: string } | null>(null);

  // ── Load selectable vehicles + shipments ─────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [vRes, sRes] = await Promise.all([
          fetch('/api/logistics/planner/inputs?type=vehicles', { cache: 'no-store' }),
          fetch('/api/logistics/planner/inputs?type=shipments', { cache: 'no-store' }),
        ]);
        if (vRes.ok) { const d = await vRes.json(); setVehicles(d.vehicles ?? []); }
        if (sRes.ok) { const d = await sRes.json(); setShipments(d.shipments ?? []); }
      } catch { /* non-fatal — empty selectors */ }
      finally { setLoadingInputs(false); }
    })();
  }, []);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  const runOptimize = useCallback(async () => {
    setOptimizing(true);
    setError(null);
    setPlan(null);
    setCommitted(false);
    try {
      const res = await fetch('/api/logistics/planner/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleIds: [...selectedVehicles],
          shipmentIds: [...selectedShipments],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Optimize failed (${res.status})`);
      }
      setPlan(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  }, [selectedVehicles, selectedShipments]);

  const commit = useCallback(async () => {
    if (!plan) return;
    setError(null);
    try {
      const res = await fetch(`/api/logistics/planner/plans/${plan.planId}/commit`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Commit failed (${res.status})`);
      }
      setCommitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed');
    }
  }, [plan]);

  const discard = useCallback(async () => {
    if (!plan) return;
    await fetch(`/api/logistics/planner/plans/${plan.planId}/discard`, { method: 'POST' }).catch(() => {});
    setPlan(null);
    setCommitted(false);
  }, [plan]);

  // ── Manual edit: POST the new per-route stop order + unassign list to
  //    /edit, which re-validates (without re-optimising) and returns fresh
  //    violation badges. We merge the result back into the plan, preserving
  //    planId + geocodeFailures (the /edit response only carries result).
  const applyEdit = useCallback(async (
    routes: Array<{ vehicleId: string; stopOrder: string[] }>,
    unassign?: string[],
  ) => {
    if (!plan) return;
    setEditing(true);
    setError(null);
    try {
      const res = await fetch(`/api/logistics/planner/plans/${plan.planId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routes, unassign }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Edit failed (${res.status})`);
      }
      const edited = await res.json() as { result: OptimizeResult };
      setPlan(p => p ? { ...p, result: edited.result } : p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Edit failed');
    } finally {
      setEditing(false);
    }
  }, [plan]);

  // Current per-route stop order, used as the baseline for any edit.
  const currentRouteOrders = useCallback((): Array<{ vehicleId: string; stopOrder: string[] }> => {
    if (!plan) return [];
    return plan.result.routes.map(r => ({ vehicleId: r.vehicleId, stopOrder: r.stops.map(s => s.stopId) }));
  }, [plan]);

  // Drop target: reorder `draggedStopId` to sit before `targetStopId` within
  // the same route. Cross-route moves aren't supported in v1 (the solver's
  // capacity feasibility would need re-checking); within-route reorder covers
  // the common "operator knows this stop should come first" case.
  const handleDropBefore = useCallback((vehicleId: string, targetStopId: string) => {
    if (!drag || drag.vehicleId !== vehicleId || drag.stopId === targetStopId) { setDrag(null); return; }
    const orders = currentRouteOrders();
    const route = orders.find(o => o.vehicleId === vehicleId);
    if (!route) { setDrag(null); return; }
    const without = route.stopOrder.filter(id => id !== drag.stopId);
    const targetIdx = without.indexOf(targetStopId);
    without.splice(targetIdx, 0, drag.stopId);
    route.stopOrder = without;
    setDrag(null);
    applyEdit(orders);
  }, [drag, currentRouteOrders, applyEdit]);

  // Remove a shipment from its route → unassigned.
  const unassignShipment = useCallback((shipmentId: string, vehicleId: string) => {
    const orders = currentRouteOrders();
    const route = orders.find(o => o.vehicleId === vehicleId);
    if (!route || !plan) return;
    // Drop both stops of this shipment from the route order.
    const stopIdsToRemove = new Set(
      plan.result.routes.find(r => r.vehicleId === vehicleId)?.stops
        .filter(s => s.shipmentId === shipmentId).map(s => s.stopId) ?? [],
    );
    route.stopOrder = route.stopOrder.filter(id => !stopIdsToRemove.has(id));
    applyEdit(orders, [shipmentId]);
  }, [currentRouteOrders, plan, applyEdit]);

  const canOptimize = selectedVehicles.size > 0 && selectedShipments.size > 0 && !optimizing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Optimizer"
        subtitle="Assign shipments across vehicles — minimise distance subject to capacity & time windows"
        icon={RouteIcon}
        accent="violet"
        actions={
          <Link href="/logistics/planner" className="text-sm text-slate-400 hover:text-white">
            Single-route calculator →
          </Link>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── Selection + optimize bar ─────────────────────────────────────── */}
      {!committed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Vehicles" icon={Truck} accent="amber"
            subtitle={`${selectedVehicles.size} of ${vehicles.length} selected`}>
            {loadingInputs ? (
              <div className="text-sm text-slate-500">Loading vehicles…</div>
            ) : vehicles.length === 0 ? (
              <div className="text-sm text-slate-500">
                No logistics vehicles with payload capacity configured. Set
                payload_capacity_kg + depot coordinates on vehicles first.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {vehicles.map(v => (
                  <label key={v.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                      selectedVehicles.has(v.id) ? 'bg-amber-500/15 border border-amber-500/30' : 'border border-white/5 hover:bg-white/5'
                    }`}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedVehicles.has(v.id)}
                        onChange={() => setSelectedVehicles(s => toggle(s, v.id))} className="sr-only" />
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                        selectedVehicles.has(v.id) ? 'bg-amber-500 border-amber-400 text-white' : 'border-slate-600'
                      }`}>{selectedVehicles.has(v.id) ? '✓' : ''}</span>
                      {v.label}
                    </span>
                    <span className="text-xs text-slate-500">{v.capacityKg ? `${v.capacityKg.toLocaleString()}kg` : '—'}</span>
                  </label>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Shipments" icon={Package} accent="cyan"
            subtitle={`${selectedShipments.size} of ${shipments.length} selected`}>
            {loadingInputs ? (
              <div className="text-sm text-slate-500">Loading shipments…</div>
            ) : shipments.length === 0 ? (
              <div className="text-sm text-slate-500">No pending shipments to plan.</div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {shipments.map(s => (
                  <label key={s.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                      selectedShipments.has(s.id) ? 'bg-cyan-500/15 border border-cyan-500/30' : 'border border-white/5 hover:bg-white/5'
                    }`}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedShipments.has(s.id)}
                        onChange={() => setSelectedShipments(st => toggle(st, s.id))} className="sr-only" />
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                        selectedShipments.has(s.id) ? 'bg-cyan-500 border-cyan-400 text-white' : 'border-slate-600'
                      }`}>{selectedShipments.has(s.id) ? '✓' : ''}</span>
                      {s.label}
                    </span>
                    <span className="text-xs text-slate-500">{s.weightKg ? `${s.weightKg.toLocaleString()}kg` : '—'}</span>
                  </label>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {!committed && (
        <div className="flex justify-end">
          <button onClick={runOptimize} disabled={!canOptimize}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-all">
            {optimizing ? <><RefreshCw className="w-4 h-4 animate-spin" /> Optimizing…</> : <><Play className="w-4 h-4" /> Optimize</>}
          </button>
        </div>
      )}

      {/* ── Committed banner ─────────────────────────────────────────────── */}
      {committed && plan && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Check className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="text-emerald-300 font-semibold text-sm">Plan committed</div>
              <div className="text-emerald-400/70 text-xs">
                {plan.result.summary.shipmentsAssigned} shipments assigned across {plan.result.summary.vehiclesUsed} vehicle(s)
              </div>
            </div>
          </div>
          <Link href="/logistics/dispatch" className="text-sm font-medium text-emerald-300 hover:text-emerald-200">
            View dispatch →
          </Link>
        </div>
      )}

      {/* ── Results: routes + summary ────────────────────────────────────── */}
      {plan && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Routes */}
          <div className="lg:col-span-2 space-y-3">
            {plan.result.routes.length === 0 && (
              <Panel title="Routes" icon={RouteIcon} accent="violet">
                <div className="text-sm text-slate-500">No routes produced — see unassigned shipments.</div>
              </Panel>
            )}
            {plan.result.routes.map((route, idx) => {
              const hasViolations = route.violations.length > 0;
              return (
                <div key={route.vehicleId}
                  className={`rounded-2xl bg-slate-900/60 border p-4 ${hasViolations ? 'border-amber-500/30' : 'border-white/10'}`}
                  style={{ borderLeftWidth: 3, borderLeftColor: hasViolations ? '#BA7517' : '#1D9E75' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-sm text-white">
                      Vehicle {idx + 1} <span className="font-mono text-xs text-slate-500">{route.vehicleId.slice(0, 8)}</span>
                    </div>
                    {hasViolations ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" /> {route.violations.length} issue(s)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3" /> on time
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mb-3 flex items-center justify-between">
                    <span>
                      {route.totalDistanceKm}km · {fmtDuration(route.totalDurationMin)} · {route.capacityUtilization.weightPct}% capacity · AED {route.estimatedCost.toLocaleString()}
                    </span>
                    {!committed && <span className="text-slate-600 text-[10px]">drag to reorder</span>}
                  </div>
                  <ol className={`space-y-1 text-xs ${editing ? 'opacity-50 pointer-events-none' : ''}`}>
                    {route.stops.map(stop => (
                      <li key={stop.stopId}
                        draggable={!committed}
                        onDragStart={() => setDrag({ stopId: stop.stopId, vehicleId: route.vehicleId })}
                        onDragOver={e => { if (drag?.vehicleId === route.vehicleId) e.preventDefault(); }}
                        onDrop={e => { e.preventDefault(); handleDropBefore(route.vehicleId, stop.stopId); }}
                        className={`group flex items-center gap-2 rounded px-1 py-0.5 ${stop.onTime ? '' : 'text-amber-300'} ${
                          drag?.stopId === stop.stopId ? 'opacity-40' : ''
                        } ${!committed ? 'hover:bg-white/5 cursor-grab' : ''}`}>
                        {!committed && <GripVertical className="w-3 h-3 text-slate-600 flex-shrink-0" />}
                        <span className="font-mono text-slate-500 w-4">{stop.sequence}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${stop.type === 'PICKUP' ? 'bg-cyan-400' : 'bg-emerald-400'}`} />
                        <span className="text-slate-300">{stop.type === 'PICKUP' ? 'Pickup' : 'Drop'}</span>
                        <span className="font-mono text-slate-500">{stop.shipmentId.slice(0, 8)}</span>
                        <span className="text-slate-500">{fmtTime(stop.arriveMin)}</span>
                        {!stop.onTime && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                        {!committed && stop.type === 'PICKUP' && (
                          <button
                            onClick={() => unassignShipment(stop.shipmentId, route.vehicleId)}
                            title="Remove shipment from route"
                            className="ml-auto opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition-opacity">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                  {hasViolations && (
                    <ul className="mt-2 pt-2 border-t border-white/5 space-y-0.5">
                      {route.violations.map((v, i) => (
                        <li key={i} className="text-xs text-amber-300/80">⚠ {v.detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {plan.result.unassigned.length > 0 && (
              <Panel title={`Unassigned · ${plan.result.unassigned.length}`} icon={Package} accent="rose">
                <ul className="space-y-1 text-xs">
                  {plan.result.unassigned.map(u => (
                    <li key={u.shipmentId} className="flex items-center justify-between">
                      <span className="font-mono text-slate-400">{u.shipmentId.slice(0, 8)}</span>
                      <span className="text-rose-300">{u.reason}{u.detail ? ` — ${u.detail}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          {/* Summary */}
          <Panel title="Plan summary" icon={RouteIcon} accent={plan.status === 'COMPLETED' ? 'emerald' : 'amber'}>
            <dl className="space-y-3 text-sm">
              <SummaryRow label="Total distance" value={`${plan.result.summary.totalDistanceKm} km`} />
              <SummaryRow label="Total time" value={fmtDuration(plan.result.summary.totalDurationMin)} />
              <SummaryRow label="Vehicles used" value={`${plan.result.summary.vehiclesUsed}`} />
              <SummaryRow label="Assigned" value={`${plan.result.summary.shipmentsAssigned}`} />
              <SummaryRow label="Unassigned" value={`${plan.result.summary.shipmentsUnassigned}`}
                accent={plan.result.summary.shipmentsUnassigned > 0 ? 'rose' : undefined} />
              <SummaryRow label="Window violations" value={`${plan.result.summary.timeWindowViolations}`}
                accent={plan.result.summary.timeWindowViolations > 0 ? 'amber' : undefined} />
              <SummaryRow label="Cost estimate" value={`AED ${plan.result.summary.estimatedCost.toLocaleString()}`} />
            </dl>

            {!committed && (
              <div className="mt-5 flex flex-col gap-2">
                <button onClick={commit}
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm transition-colors">
                  Commit plan
                </button>
                <button onClick={discard}
                  className="w-full py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-slate-800 transition-colors">
                  Discard
                </button>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: 'rose' | 'amber' }) {
  const valueColor = accent === 'rose' ? 'text-rose-300' : accent === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-400 text-xs">{label}</dt>
      <dd className={`font-semibold ${valueColor}`}>{value}</dd>
    </div>
  );
}
