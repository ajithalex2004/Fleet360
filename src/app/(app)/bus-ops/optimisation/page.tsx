'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Recycle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

interface PreviewRow {
  routeId: string;
  routeName: string;
  routeCode: string | null;
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
  const router = useRouter();
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
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

  const apply = (row: PreviewRow) => {
    router.push(`/bus-ops/route-planner?edit=${row.routeId}&optimize=1`);
  };

  if (loading && !data) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading optimisation preview...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Route Optimisation Status"
        subtitle={data
          ? `${data.routesScanned} routes scanned · ${data.routesWithMeaningfulSavings} with ≥5% savings · ${data.totalPotentialSavingsKm.toLocaleString()} km potential`
          : 'Re-orders existing route stops to minimise total distance — Nearest-Neighbour + 2-opt TSP solver.'}
        icon={Recycle}
        accent="violet"
        actions={
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Scanning…' : 'Refresh preview'}
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {!data || data.rows.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            No active staff routes found. Build one in <Link href="/bus-ops/route-planner" className="text-violet-400 underline">Route Optimization</Link> first.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Route</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Stops</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400">Current km</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400">After km</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400">Saving</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(row => {
                const tier = row.distanceSavedPct >= 10 ? 'high' : row.distanceSavedPct >= 5 ? 'mid' : 'low';
                return (
                  <tr key={row.routeId} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-white">{row.routeName}</div>
                      {row.routeCode
                        ? (
                          <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30">
                            {row.routeCode}
                          </span>
                        )
                        : <div className="text-xs font-mono text-slate-500">no code</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      {row.geoStopCount}/{row.stopCount}
                      <div className="text-xs text-slate-300">geocoded</div>
                    </td>
                    {row.skipped ? (
                      <td colSpan={4} className="px-4 py-3 text-xs italic text-slate-400">{row.skipReason}</td>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-sm text-right text-white">{row.originalDistanceKm.toFixed(1)}</td>
                        <td className="px-4 py-3 text-sm text-right text-white">{row.optimisedDistanceKm.toFixed(1)}</td>
                        <td className="px-4 py-3 text-sm text-right">
                          <div className={`font-semibold ${
                            tier === 'high' ? 'text-emerald-400' :
                            tier === 'mid'  ? 'text-amber-400' :
                            'text-slate-400'
                          }`}>
                            {row.distanceSavedKm.toFixed(1)} km
                          </div>
                          <div className="text-xs text-slate-300">{row.distanceSavedPct.toFixed(1)}%</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.distanceSavedKm <= 0 ? (
                            // The solver couldn't find a shorter arrangement — the
                            // route is already at its optimum stop order. Show a
                            // status badge instead of a disabled button so the
                            // operator sees "done" state at a glance.
                            <span
                              title="Solver found no shorter arrangement — stop order is already optimum."
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Optimised
                            </span>
                          ) : (
                            <button
                              onClick={() => apply(row)}
                              className={`text-xs px-2 py-1 rounded border ${
                                tier === 'high' ? 'bg-violet-500/20 text-violet-400 border-violet-500/30 hover:bg-violet-500/30' :
                                tier === 'mid'  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30' :
                                'bg-slate-700 text-slate-200 border-white/10 hover:bg-slate-600'
                              }`}
                            >
                              Review &amp; Optimise →
                            </button>
                          )}
                        </td>
                      </>
                    )}
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

