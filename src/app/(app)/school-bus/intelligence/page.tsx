'use client';
/**
 * School Bus Intelligence — Route Optimisation Dashboard
 * -------------------------------------------------------
 * Runs the Route Optimiser agent and shows per-route savings.
 * Operators can review SUGGESTED routes and choose Apply or Reject.
 */
import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[status] ?? 'bg-slate-700 text-slate-300'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function savingsBadge(pct: number) {
  if (pct >= 15) return <span className="text-emerald-400 font-bold">{pct.toFixed(1)}% saved</span>;
  if (pct >= 8)  return <span className="text-yellow-400 font-bold">{pct.toFixed(1)}% saved</span>;
  return <span className="text-slate-400">{pct.toFixed(1)}% saved</span>;
}

// ── Route Card ────────────────────────────────────────────────────────────────
function RouteCard({
  result,
  onApply,
  onReject,
}: {
  result: RouteResult;
  onApply: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const orig = Array.isArray(result.original_sequence) ? result.original_sequence : [];
  const opt  = Array.isArray(result.optimised_sequence) ? result.optimised_sequence : [];

  return (
    <div className="bg-slate-800/60 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center text-lg">🗺️</div>
          <div>
            <p className="font-semibold text-white text-sm">{result.route_name}</p>
            <p className="text-xs text-slate-400">Route {result.route_number} · {result.matched_stop_count} stops</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Savings pill */}
          <div className="text-right">
            <p className="text-sm">{savingsBadge(result.distance_saved_pct)}</p>
            <p className="text-xs text-slate-500">{result.distance_saved_km.toFixed(1)} km · ~{result.estimated_duration_min ?? '—'} min</p>
          </div>

          {/* Status */}
          {statusBadge(result.status)}

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded view */}
      {expanded && (
        <div className="border-t border-white/10 px-5 py-4 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-slate-900/60 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500">Original Distance</p>
              <p className="text-base font-bold text-white">{result.original_distance_km.toFixed(1)} km</p>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500">Optimised Distance</p>
              <p className="text-base font-bold text-emerald-400">{result.optimised_distance_km.toFixed(1)} km</p>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500">Distance Saved</p>
              <p className="text-base font-bold text-yellow-400">{result.distance_saved_km.toFixed(1)} km</p>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500">Est. Duration</p>
              <p className="text-base font-bold text-white">{result.estimated_duration_min ?? '—'} min</p>
            </div>
          </div>

          {/* Stop sequence comparison */}
          <div className="grid grid-cols-2 gap-4">
            {/* Original */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Original Sequence</p>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {orig.map((stop, i) => (
                  <div key={i} className="flex items-center gap-2 py-1 px-2 rounded bg-slate-900/40">
                    <span className="text-xs text-slate-500 w-5 text-right">{i + 1}.</span>
                    <span className="text-xs text-slate-300 flex-1 truncate">{stop.stopName}</span>
                    {stop.pickupTime && (
                      <span className="text-xs text-slate-500">{stop.pickupTime}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Optimised */}
            <div>
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Optimised Sequence</p>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {opt.map((stop, i) => {
                  const origIdx = orig.findIndex(o => o.stopName === stop.stopName);
                  const moved = origIdx !== i;
                  return (
                    <div key={i} className={`flex items-center gap-2 py-1 px-2 rounded ${moved ? 'bg-emerald-900/30 border border-emerald-500/20' : 'bg-slate-900/40'}`}>
                      <span className="text-xs text-slate-500 w-5 text-right">{i + 1}.</span>
                      <span className={`text-xs flex-1 truncate ${moved ? 'text-emerald-300' : 'text-slate-300'}`}>{stop.stopName}</span>
                      {moved && <span className="text-[10px] text-emerald-500">↕</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Solver info */}
          <p className="text-xs text-slate-600">
            Solver: Nearest Neighbour + 2-opt · {result.iterations_2opt} iterations · {result.solver_duration_ms}ms
            · {result.original_stop_count - result.matched_stop_count} stops missing coordinates
          </p>

          {/* Action buttons */}
          {result.status === 'SUGGESTED' && (
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => onApply(result.id)}
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
              >
                ✅ Apply Optimised Sequence
              </button>
              <button
                onClick={() => onReject(result.id)}
                className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-red-900/40 hover:border-red-500/30 border border-transparent text-slate-300 text-sm font-semibold transition-colors"
              >
                ❌ Reject
              </button>
            </div>
          )}

          {result.status === 'AUTO_APPLIED' && (
            <p className="text-xs text-blue-400">
              ⚡ Auto-applied because savings ≥ 10%. Route updated {result.applied_at ? new Date(result.applied_at).toLocaleString() : '—'}.
            </p>
          )}

          {result.status === 'APPLIED' && (
            <p className="text-xs text-emerald-400">
              ✅ Applied manually {result.applied_at ? new Date(result.applied_at).toLocaleString() : '—'}.
            </p>
          )}

          {result.status === 'REJECTED' && (
            <p className="text-xs text-red-400">
              ❌ Rejected {result.rejected_at ? new Date(result.rejected_at).toLocaleString() : '—'}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SchoolBusIntelligencePage() {
  const [results, setResults]     = useState<RouteResult[]>([]);
  const [summary, setSummary]     = useState<Summary>({});
  const [filter, setFilter]       = useState<string>('ALL');
  const [loading, setLoading]     = useState(false);
  const [running, setRunning]     = useState(false);
  const [lastRun, setLastRun]     = useState<string | null>(null);
  const [toast, setToast]         = useState<string | null>(null);
  const [totalSaved, setTotalSaved] = useState(0);

  // Schema pre-warm
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
      setTotalSaved(saved);
    } catch {
      showToast('Failed to load results');
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
      // AgentRunResult.output.summary
      const summary = (data?.output as { summary?: string })?.summary ?? 'Optimisation complete';
      showToast(summary);
      await fetchResults(filter !== 'ALL' ? filter : undefined);
    } catch {
      showToast('Agent run failed');
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
        showToast('✅ Optimised sequence applied to route');
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
        showToast('Route optimisation rejected');
        await fetchResults(filter !== 'ALL' ? filter : undefined);
      }
    } catch {
      showToast('Failed to reject');
    }
  };

  const FILTERS = ['ALL', 'SUGGESTED', 'AUTO_APPLIED', 'APPLIED', 'REJECTED'];

  const totalRoutes = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-white/20 rounded-xl px-4 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🗺️ Route Optimisation</h1>
          <p className="text-sm text-slate-400 mt-1">
            AI-powered TSP solver — Nearest Neighbour + 2-opt improvement
          </p>
        </div>
        <button
          onClick={runAgent}
          disabled={running}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-400 hover:to-amber-400 text-slate-900 font-semibold text-sm transition-all disabled:opacity-50"
        >
          {running ? (
            <>
              <span className="animate-spin">⚙️</span>
              Optimising…
            </>
          ) : (
            <>
              🚀 Run Optimisation
            </>
          )}
        </button>
      </div>

      {lastRun && (
        <p className="text-xs text-slate-500">Last run: {lastRun}</p>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total Routes',       value: totalRoutes,                        icon: '🗺️', color: 'text-white' },
          { label: 'Awaiting Approval',  value: summary.SUGGESTED ?? 0,             icon: '⏳', color: 'text-amber-400' },
          { label: 'Auto-Applied',       value: summary.AUTO_APPLIED ?? 0,          icon: '⚡', color: 'text-blue-400' },
          { label: 'Approved & Applied', value: (summary.APPLIED ?? 0),             icon: '✅', color: 'text-emerald-400' },
          { label: 'Total KM Saved',     value: `${totalSaved.toFixed(1)} km`,      icon: '📉', color: 'text-yellow-400' },
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

      {/* How it works banner */}
      <div className="bg-slate-800/40 border border-yellow-500/20 rounded-xl p-4 flex items-start gap-4">
        <div className="text-2xl">🧠</div>
        <div>
          <p className="text-sm font-semibold text-yellow-300">How Route Optimisation Works</p>
          <p className="text-xs text-slate-400 mt-1">
            Phase 1 — <strong className="text-slate-300">Nearest Neighbour</strong>: greedy construction starting from stop 1, always visiting the closest unvisited stop.
            Phase 2 — <strong className="text-slate-300">2-opt</strong>: iteratively reverses route segments until no swap reduces total distance.
            Routes saving ≥ 10% are <strong className="text-blue-300">auto-applied</strong>. Others appear here for operator review.
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              fetchResults(f !== 'ALL' ? f : undefined);
            }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? 'bg-yellow-500 text-slate-900'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {f === 'ALL' ? `All (${totalRoutes})` : f === 'SUGGESTED' ? `Awaiting (${summary.SUGGESTED ?? 0})` : f === 'AUTO_APPLIED' ? `Auto-Applied (${summary.AUTO_APPLIED ?? 0})` : f === 'APPLIED' ? `Applied (${summary.APPLIED ?? 0})` : `Rejected (${summary.REJECTED ?? 0})`}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <span className="animate-spin mr-3">⚙️</span> Loading optimisation results…
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-5xl mb-4">🗺️</p>
          <p className="text-lg font-semibold text-white">No results yet</p>
          <p className="text-slate-400 text-sm mt-2 max-w-md">
            Click <strong>Run Optimisation</strong> to analyse all active school bus routes.
            The agent will calculate optimal stop sequences and show savings here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map(r => (
            <RouteCard
              key={r.id}
              result={r}
              onApply={handleApply}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
