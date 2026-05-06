'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface PreviewRow {
  routeId: string;
  routeName: string;
  stopCount: number;
  geoStopCount: number;
  originalDistanceKm: number;
  optimisedDistanceKm: number;
  distanceSavedKm: number;
  distanceSavedPct: number;
  skipped: boolean;
  skipReason?: string;
}

interface PreviewResponse {
  runAt: string;
  routesScanned: number;
  totalPotentialSavingsKm: number;
  routesWithMeaningfulSavings: number;
  rows: PreviewRow[];
}

export default function OptimisationPage() {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/bus-ops/routes/optimisation-preview');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Preview failed');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const apply = async (row: PreviewRow) => {
    if (row.distanceSavedPct < 5) {
      if (!confirm(`Only ${row.distanceSavedPct}% savings — apply anyway?`)) return;
    }
    setApplyingId(row.routeId); setError(null);
    try {
      const res = await fetch(`/api/bus-ops/routes/${row.routeId}/optimise`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Apply failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Route Optimisation</h1>
          <p className="text-sm text-slate-400 mt-1">
            Re-orders existing route stops to minimise total distance — Nearest-Neighbour + 2-opt TSP solver.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white text-sm hover:bg-slate-600 disabled:opacity-50">
          {loading ? 'Scanning…' : 'Refresh preview'}
        </button>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">{error}</div>}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Routes scanned" value={data.routesScanned} />
          <Stat label="With ≥5% savings" value={data.routesWithMeaningfulSavings} accent="emerald" />
          <Stat label="Total km savings" value={`${data.totalPotentialSavingsKm.toLocaleString()} km`} accent="emerald" />
          <Stat label="Last preview" value={new Date(data.runAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Loading preview…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No active staff routes found. Build one in <Link href="/bus-ops/route-planner" className="text-emerald-400 underline">Route Planner</Link> first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Stops</th>
                <th className="px-4 py-3 text-right">Current km</th>
                <th className="px-4 py-3 text-right">After km</th>
                <th className="px-4 py-3 text-right">Saving</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(row => {
                const tier = row.distanceSavedPct >= 10 ? 'high' : row.distanceSavedPct >= 5 ? 'mid' : 'low';
                return (
                  <tr key={row.routeId} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="text-white font-medium">{row.routeName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{row.routeId.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {row.geoStopCount}/{row.stopCount} geocoded
                    </td>
                    {row.skipped ? (
                      <td colSpan={4} className="px-4 py-3 text-xs italic text-slate-500">{row.skipReason}</td>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-right text-slate-300">{row.originalDistanceKm.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{row.optimisedDistanceKm.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className={
                            tier === 'high' ? 'text-emerald-300 font-semibold' :
                            tier === 'mid'  ? 'text-amber-300 font-semibold' :
                            'text-slate-500'
                          }>
                            {row.distanceSavedKm.toFixed(1)} km
                          </div>
                          <div className="text-[10px] text-slate-500">{row.distanceSavedPct.toFixed(1)}%</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => apply(row)}
                            disabled={applyingId === row.routeId || row.distanceSavedKm <= 0}
                            className={`text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40 ${
                              tier === 'high' ? 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500' :
                              tier === 'mid'  ? 'bg-amber-600/30 border-amber-500/40 text-amber-200 hover:bg-amber-600/50' :
                              'bg-slate-700/60 border-white/10 text-slate-400'
                            }`}
                          >
                            {applyingId === row.routeId ? 'Applying…' : 'Apply'}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-5 text-xs text-slate-400 space-y-2">
        <p className="text-white font-semibold mb-1">How it works</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Reuses the existing zero-dep TSP solver in <code>src/lib/agents/route-optimiser/tsp.ts</code> — same engine the school-bus agent runs nightly.</li>
          <li>Phase 1 nearest-neighbour gives a valid sequence in O(n²); phase 2 2-opt iteratively improves. Result is within ~5–10% of optimal.</li>
          <li>Distances are Haversine straight-line — adequate for stop sequencing. Real road distances need a Mapbox call (already wired in the route-planner page when building <em>new</em> routes).</li>
          <li>Apply is atomic: stops are re-numbered + the route's <code>totalDistanceKm</code> is updated in one transaction. Stops without coords stay at the end in their original order.</li>
          <li>Audit-logged. Safe to revert by manually re-sequencing in the routes page if a result looks wrong.</li>
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = 'slate' }: { label: string; value: string | number; accent?: string }) {
  const cls: Record<string, string> = { slate: 'text-white', emerald: 'text-emerald-300', amber: 'text-amber-300' };
  return (
    <div className="rounded-xl bg-slate-800/60 border border-white/10 p-4">
      <div className={`text-3xl font-bold ${cls[accent]}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}
