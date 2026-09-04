'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Recycle, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

interface PreviewRow {
  routeId: string;
  routeName: string;
  /** BusRoute.code (RT-0001 …). Nullable — see the fallback at the render site. */
  routeCode: string | null;
  /** ISO timestamp of when these distances were computed; null when skipped. */
  computedAt: string | null;
  /** Served from the stored result (free) rather than freshly computed (paid). */
  cached: boolean;
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

  if (loading && !data) return <div className="flex items-center justify-center h-full"><div className="text-[var(--text-muted)] animate-pulse">Loading optimisation preview...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Route Optimisation"
        subtitle={data
          ? `${data.routesScanned} routes scanned · ${data.routesWithMeaningfulSavings} with ≥5% savings · ${data.totalPotentialSavingsKm.toLocaleString()} km potential (driving distance)`
          : 'Re-orders existing route stops to minimise driving distance, measured on real roads via the Routes API.'}
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

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {!data || data.rows.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">
            No active staff routes found. Build one in <Link href="/bus-ops/route-planner" className="text-violet-400 underline">Route Planner</Link> first.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Route</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Stops</th>
                {/* "driving" is load-bearing, not decoration: these used to be
                    straight-line kilometres while the Route Planner one click
                    away showed road kilometres for the same route — a ~54%
                    disagreement with nothing on screen to explain it. */}
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Current km<span className="block font-normal text-[var(--text-faint)]">driving</span></th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">After km<span className="block font-normal text-[var(--text-faint)]">driving</span></th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Saving</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(row => {
                const tier = row.distanceSavedPct >= 10 ? 'high' : row.distanceSavedPct >= 5 ? 'mid' : 'low';
                return (
                  <tr key={row.routeId} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-[var(--text-main)]">{row.routeName}</div>
                      {/* Route code, not the id. The id prefix meant nothing to
                          an operator — it can't be searched for, quoted, or
                          matched against the Routes grid. Falls back to the
                          truncated id only when a route genuinely has no code,
                          so the row stays identifiable either way. */}
                      <div className="text-xs font-mono text-[var(--text-muted)]">
                        {row.routeCode ?? row.routeId.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                      {row.geoStopCount}/{row.stopCount}
                      <div className="text-xs text-[var(--text-muted)]">geocoded</div>
                    </td>
                    {row.skipped ? (
                      <td colSpan={4} className="px-4 py-3 text-xs italic text-[var(--text-muted)]">{row.skipReason}</td>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-sm text-right text-[var(--text-main)]">{row.originalDistanceKm.toFixed(1)}</td>
                        <td className="px-4 py-3 text-sm text-right text-[var(--text-main)]">{row.optimisedDistanceKm.toFixed(1)}</td>
                        <td className="px-4 py-3 text-sm text-right">
                          <div className={`font-semibold ${
                            tier === 'high' ? 'text-emerald-400' :
                            tier === 'mid'  ? 'text-amber-400' :
                            'text-[var(--text-muted)]'
                          }`}>
                            {row.distanceSavedKm.toFixed(1)} km
                          </div>
                          <div className="text-xs text-[var(--text-muted)]">{row.distanceSavedPct.toFixed(1)}%</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => apply(row)}
                            disabled={row.distanceSavedKm <= 0}
                            className={`text-xs px-2 py-1 rounded border disabled:opacity-40 ${
                              tier === 'high' ? 'bg-violet-500/20 text-violet-400 border-violet-500/30 hover:bg-violet-500/30' :
                              tier === 'mid'  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30' :
                              'bg-[var(--bg-surface-hover)] text-[var(--text-main)] border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'
                            }`}
                          >
                            Review &amp; Optimise →
                          </button>
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

