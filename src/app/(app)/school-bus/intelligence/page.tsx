'use client';
/**
 * Route Optimisation & Network Consolidation Dashboard
 * -----------------------------------------------------
 * Runs the Route Optimiser agent and renders both:
 *   1. Multi-Route Network Consolidation & Fleet Sizing (5 routes -> 3 vehicles, AED/mo savings)
 *   2. Single-Route Stop Sequencing (TSP Nearest Neighbour + 2-opt)
 */
import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ConsolidationItem {
  id: string;
  sourceRouteIds: string[];
  sourceRouteNames: string[];
  sourceRouteNumbers: string[];
  candidateType: string;
  direction: string;
  shift: string;
  combinedPassengers: number;
  requiredCapacity: number;
  operatorScore: number;
  detourMinutes: number;
  detourKm: number;
  dailyDistanceSavedKm: number;
  weeklySavingsAed: number;
  monthlySavingsAed: number;
  vehiclesReleased: number;
  status: 'SUGGESTED' | 'APPLIED' | 'REJECTED';
}

interface NetworkDesign {
  currentRoutesCount: number;
  currentVehiclesCount: number;
  recommendedRoutesCount: number;
  recommendedVehiclesCount: number;
  vehiclesSaved: number;
  dailyKmSaved: number;
  monthlyCostSavedAed: number;
  annualCostSavedAed: number;
}

interface RouteResult {
  id: string;
  route_id: string;
  route_name: string;
  route_number: string;
  original_stop_count: number;
  matched_stop_count: number;
  original_distance_km: number;
  optimised_distance_km: number;
  distance_saved_km: number;
  distance_saved_pct: number;
  iterations_2opt: number;
  solver_duration_ms: number;
  estimated_duration_min: number | null;
  original_sequence: StopItem[];
  optimised_sequence: StopItem[];
  status: 'SUGGESTED' | 'AUTO_APPLIED' | 'APPLIED' | 'REJECTED';
  applied_at: string | null;
  rejected_at: string | null;
  created_at: string;
}

interface StopItem {
  stopName: string;
  sequence: number;
  pickupTime?: string;
  studentCount?: number;
}

interface Summary {
  SUGGESTED?: number;
  AUTO_APPLIED?: number;
  APPLIED?: number;
  REJECTED?: number;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    SUGGESTED:    'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    AUTO_APPLIED: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    APPLIED:      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    REJECTED:     'bg-red-500/20 text-red-300 border border-red-500/30',
  };
  const labels: Record<string, string> = {
    SUGGESTED: '⏳ Awaiting Approval',
    AUTO_APPLIED: '⚡ Auto-Applied',
    APPLIED: '✅ Applied',
    REJECTED: '❌ Rejected',
  };
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${map[status] ?? 'bg-slate-700 text-slate-300'}`}>
      {labels[status] ?? status}
    </span>
  );
}

export default function SchoolBusIntelligencePage() {
  const [results, setResults]                 = useState<RouteResult[]>([]);
  const [consolidations, setConsolidations]   = useState<ConsolidationItem[]>([]);
  const [networkDesign, setNetworkDesign]     = useState<NetworkDesign | null>(null);
  const [summary, setSummary]                 = useState<Summary>({});
  const [filter, setFilter]                   = useState<string>('ALL');
  const [loading, setLoading]                 = useState(false);
  const [running, setRunning]                 = useState(false);
  const [lastRun, setLastRun]                 = useState<string | null>(null);
  const [toast, setToast]                     = useState<string | null>(null);
  const [totalSavedKm, setTotalSavedKm]       = useState(0);

  useEffect(() => { fetch('/api/fleet/init').catch(() => {}); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const fetchResults = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const qs = status && status !== 'ALL' ? `?status=${status}` : '';
      const res = await fetch(`/api/agents/route-results${qs}`);
      const data = await res.json();
      const rows: RouteResult[] = Array.isArray(data.data) ? data.data : [];
      setResults(rows);
      setSummary(data.summary ?? {});
      const saved = rows.reduce((acc, r) => acc + (r.distance_saved_km ?? 0), 0);
      setTotalSavedKm(saved);
    } catch {
      showToast('Failed to load route results');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const runAgent = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: 'route-optimiser', tenant_id: 'default' }),
      });
      const data = await res.json();
      setLastRun(new Date().toLocaleString());

      const out = data?.output;
      if (out?.networkDesign) {
        setNetworkDesign(out.networkDesign);
      }
      if (Array.isArray(out?.consolidations)) {
        setConsolidations(out.consolidations);
      }

      const summaryText = out?.summary ?? 'Route network analysis completed';
      showToast(summaryText);
      await fetchResults(filter !== 'ALL' ? filter : undefined);
    } catch {
      showToast('Agent execution failed');
    } finally {
      setRunning(false);
    }
  };

  const handleApply = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/route-results/${id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPLY' }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('✅ Optimised route sequence applied');
        await fetchResults(filter !== 'ALL' ? filter : undefined);
      } else {
        showToast(data.error ?? 'Apply failed');
      }
    } catch {
      showToast('Failed to apply route');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/route-results/${id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REJECT' }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('Route optimization rejected');
        await fetchResults(filter !== 'ALL' ? filter : undefined);
      } else {
        showToast('Failed to reject');
      }
    } catch {
      showToast('Failed to reject');
    }
  };

  const totalRoutes = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-white/20 rounded-xl px-5 py-3 text-sm text-white shadow-2xl backdrop-blur-md">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🗺️ Route Optimisation &amp; Network Consolidation
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Enterprise network design, capacity planning, stop re-sequencing &amp; dollarized fleet cost reductions
          </p>
        </div>
        <button
          onClick={runAgent}
          disabled={running}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-bold text-sm transition-all disabled:opacity-50 shadow-lg"
        >
          {running ? (
            <>
              <span className="animate-spin">⚙️</span>
              Analysing Network…
            </>
          ) : (
            <>
              🚀 Run Network Analysis
            </>
          )}
        </button>
      </div>

      {lastRun && (
        <p className="text-xs text-slate-500">Last run: {lastRun}</p>
      )}

      {/* ── Network Consolidation Banner & Sizing Metric ──────────────────────── */}
      {networkDesign ? (
        <div className="bg-gradient-to-br from-indigo-950/70 via-slate-900 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 pb-4">
            <div>
              <span className="text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full px-3 py-1 uppercase tracking-wider">
                AI Network Design Recommendation
              </span>
              <h3 className="text-lg font-bold text-white mt-2">
                Consolidate {networkDesign.currentRoutesCount} Routes into {networkDesign.recommendedRoutesCount} Optimized Vehicles
              </h3>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Direct Monthly Savings</div>
              <div className="text-2xl font-black text-emerald-400">AED {networkDesign.monthlyCostSavedAed.toLocaleString()}<span className="text-xs font-normal text-slate-400"> / mo</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/80 border border-white/5 rounded-xl p-3.5">
              <div className="text-xs text-slate-400">Current Network</div>
              <div className="text-xl font-bold text-white mt-1">{networkDesign.currentRoutesCount} Routes <span className="text-xs font-normal text-slate-400">({networkDesign.currentVehiclesCount} Buses)</span></div>
            </div>
            <div className="bg-slate-900/80 border border-indigo-500/20 rounded-xl p-3.5">
              <div className="text-xs text-indigo-300">Recommended Plan</div>
              <div className="text-xl font-bold text-indigo-400 mt-1">{networkDesign.recommendedRoutesCount} Routes <span className="text-xs font-normal text-indigo-200">({networkDesign.recommendedVehiclesCount} Buses)</span></div>
            </div>
            <div className="bg-slate-900/80 border border-emerald-500/20 rounded-xl p-3.5">
              <div className="text-xs text-emerald-400">Fleet Released</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">-{networkDesign.vehiclesSaved} Vehicles <span className="text-xs font-normal text-emerald-200">(-{Math.round((networkDesign.vehiclesSaved/Math.max(networkDesign.currentVehiclesCount,1))*100)}%)</span></div>
            </div>
            <div className="bg-slate-900/80 border border-amber-500/20 rounded-xl p-3.5">
              <div className="text-xs text-amber-400">Daily KM Saved</div>
              <div className="text-xl font-bold text-amber-400 mt-1">{networkDesign.dailyKmSaved} km <span className="text-xs font-normal text-amber-200">/ day</span></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🚌</div>
            <div>
              <h3 className="text-sm font-bold text-white">Multi-Route Consolidation Ready</h3>
              <p className="text-xs text-slate-400 mt-0.5">Evaluate multi-route merges (e.g. 5 routes into 3 buses) against capacity, detour, and shift time constraints.</p>
            </div>
          </div>
          <button
            onClick={runAgent}
            disabled={running}
            className="px-4 py-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition-all"
          >
            Analyse Fleet Consolidation →
          </button>
        </div>
      )}

      {/* ── Consolidation Recommendations List ──────────────────────────────── */}
      {consolidations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>⚡</span> High-Impact Route Merges ({consolidations.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {consolidations.map((c) => (
              <div key={c.id} className="bg-slate-800/70 border border-indigo-500/30 rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      <span>{c.sourceRouteNames.join(' + ')}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Shift: {c.shift} · Direction: {c.direction} · {c.combinedPassengers} Riders
                    </div>
                  </div>
                  <span className="text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg px-2.5 py-1">
                    Score {c.operatorScore}/100
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-900/60 rounded-xl p-3 text-center">
                  <div>
                    <div className="text-[10px] text-slate-500">Vehicles Saved</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">1 Vehicle</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Distance Saved</div>
                    <div className="text-sm font-bold text-amber-400 mt-0.5">{c.dailyDistanceSavedKm} km/d</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Est. Saving</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">AED {c.monthlySavingsAed}/mo</div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>Detour: +{c.detourMinutes} min ({c.detourKm} km)</span>
                  <span className="text-indigo-400 font-semibold cursor-pointer hover:underline">View in Route Planner →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Routes',       value: totalRoutes,                        icon: '🗺️', color: 'text-white' },
          { label: 'Awaiting Approval',  value: summary.SUGGESTED ?? 0,             icon: '⏳', color: 'text-amber-400' },
          { label: 'Auto-Applied',       value: summary.AUTO_APPLIED ?? 0,          icon: '⚡', color: 'text-blue-400' },
          { label: 'Approved & Applied', value: (summary.APPLIED ?? 0),             icon: '✅', color: 'text-emerald-400' },
          { label: 'Total KM Saved',     value: `${totalSavedKm.toFixed(1)} km`,    icon: '📉', color: 'text-yellow-400' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-slate-800/60 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{kpi.icon}</span>
              <p className="text-xs text-slate-500">{kpi.label}</p>
            </div>
            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {['ALL', 'SUGGESTED', 'AUTO_APPLIED', 'APPLIED', 'REJECTED'].map(f => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              fetchResults(f !== 'ALL' ? f : undefined);
            }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {f === 'ALL' ? `All (${totalRoutes})` : f === 'SUGGESTED' ? `Awaiting (${summary.SUGGESTED ?? 0})` : f === 'AUTO_APPLIED' ? `Auto-Applied (${summary.AUTO_APPLIED ?? 0})` : f === 'APPLIED' ? `Applied (${summary.APPLIED ?? 0})` : `Rejected (${summary.REJECTED ?? 0})`}
          </button>
        ))}
      </div>

      {/* Single Route Sequencing Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <span className="animate-spin mr-3">⚙️</span> Loading route sequence results…
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-5xl mb-4">🗺️</p>
          <p className="text-lg font-semibold text-white">No route results yet</p>
          <p className="text-slate-400 text-sm mt-2 max-w-md">
            Click <strong>Run Network Analysis</strong> to analyse stop sequences and evaluate multi-route consolidations.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map(r => (
            <div key={r.id} className="bg-slate-800/60 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-bold text-white">{r.route_name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">Route {r.route_number} · {r.matched_stop_count} stops</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-bold text-amber-400">-{r.distance_saved_km.toFixed(1)} km ({r.distance_saved_pct.toFixed(0)}%)</div>
                    <div className="text-xs text-slate-500">~{r.estimated_duration_min ?? '—'} mins</div>
                  </div>
                  {statusBadge(r.status)}
                </div>
              </div>

              {r.status === 'SUGGESTED' && (
                <div className="flex gap-2 pt-1 border-t border-white/5">
                  <button
                    onClick={() => handleApply(r.id)}
                    className="flex-1 py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-all"
                  >
                    ✓ Apply Sequence
                  </button>
                  <button
                    onClick={() => handleReject(r.id)}
                    className="px-4 py-2 rounded-xl bg-slate-700/50 hover:bg-slate-700 border border-white/10 text-slate-400 text-xs font-medium transition-all"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
