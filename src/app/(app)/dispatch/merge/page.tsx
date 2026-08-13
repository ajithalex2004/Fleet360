'use client';
/**
 * Dispatch › Merge Optimizer — Full standalone merge recommendation engine UI
 * Shows all eligible merge pairs, scoring breakdown, and lets dispatchers approve/skip merges.
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface MergePair {
  jobA: { id: string; service_type: string; priority: string; origin_address?: string; destination_address?: string; scheduled_pickup?: string; passenger_count?: number };
  jobB: { id: string; service_type: string; priority: string; origin_address?: string; destination_address?: string; scheduled_pickup?: string; passenger_count?: number };
  eligible: boolean;
  mergeScore: number;
  pickupRoadKm?: number;
  dropoffRoadKm?: number;
  pickupTimeDiffMin?: number;
  combinedPassengers?: number;
  mergeReasons: string[];
  blockReasons: string[];
  routingSource?: string;
  estimatedSavingKm?: number;
}

interface MergeConfig {
  engine: string;
  pickupDistanceKm: number;
  pickupWindowMin: number;
  maxPassengers: number;
  requireDropoff: boolean;
  dropoffDistanceKm?: number;
}

/* ── Score Bar ─────────────────────────────────────────────────────────────── */
function ScoreBar({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 70 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 ${size === 'sm' ? 'h-1' : 'h-2'} bg-slate-800 rounded-full overflow-hidden`}>
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`font-bold tabular-nums ${size === 'sm' ? 'text-xs w-8' : 'text-sm w-10'} ${textColor}`}>{score}</span>
    </div>
  );
}

/* ── Merge Card ────────────────────────────────────────────────────────────── */
function MergeCard({ pair, onMerge, onSkip, merging }: {
  pair: MergePair;
  onMerge: (a: string, b: string) => void;
  onSkip:  (a: string, b: string) => void;
  merging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const scoreBadge = pair.mergeScore >= 70 ? '🥇' : pair.mergeScore >= 50 ? '🥈' : '🥉';
  const SVC_ICON: Record<string, string> = { PASSENGER:'🚗', FREIGHT:'🚚', DELIVERY:'📦', AMBULANCE:'🚑', TECHNICIAN:'🔧', SCHOOL_BUS:'🚌' };

  return (
    <div className={`rounded-2xl border transition-all ${
      pair.mergeScore >= 70 ? 'bg-emerald-500/5 border-emerald-500/25' :
      pair.mergeScore >= 50 ? 'bg-amber-500/5 border-amber-500/20' :
      'bg-slate-900 border-white/10'
    } ${merging ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Header */}
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">{scoreBadge}</span>
            <div>
              <p className="text-white font-semibold text-sm">Merge Score {pair.mergeScore}/100</p>
              <p className="text-slate-500 text-xs">{SVC_ICON[pair.jobA.service_type]} {pair.jobA.service_type} · {pair.combinedPassengers ?? '?'} pax combined</p>
            </div>
          </div>
          {pair.routingSource && (
            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
              pair.routingSource === 'GOOGLE_MAPS' ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' :
              pair.routingSource === 'OSRM'        ? 'bg-green-500/20 border-green-500/30 text-green-400' :
              pair.routingSource === 'MAPBOX'      ? 'bg-violet-500/20 border-violet-500/30 text-violet-400' :
              'bg-slate-700 border-white/10 text-slate-400'
            }`}>{pair.routingSource}</span>
          )}
        </div>

        {/* Score bar */}
        <ScoreBar score={pair.mergeScore} />

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {pair.pickupRoadKm !== undefined && (
            <div className="bg-slate-800/60 rounded-xl p-2.5 text-center">
              <p className="text-white font-bold text-sm">{pair.pickupRoadKm.toFixed(1)} km</p>
              <p className="text-slate-500 text-[10px]">Pickup distance</p>
            </div>
          )}
          {pair.pickupTimeDiffMin !== undefined && (
            <div className="bg-slate-800/60 rounded-xl p-2.5 text-center">
              <p className="text-white font-bold text-sm">{pair.pickupTimeDiffMin.toFixed(0)} min</p>
              <p className="text-slate-500 text-[10px]">Time gap</p>
            </div>
          )}
          {pair.estimatedSavingKm !== undefined && (
            <div className="bg-slate-800/60 rounded-xl p-2.5 text-center">
              <p className="text-emerald-400 font-bold text-sm">~{pair.estimatedSavingKm.toFixed(1)} km</p>
              <p className="text-slate-500 text-[10px]">Est. saving</p>
            </div>
          )}
        </div>

        {/* Jobs */}
        <div className="space-y-2">
          {[pair.jobA, pair.jobB].map((job, i) => (
            <div key={job.id} className="flex items-start gap-3 bg-slate-800/40 rounded-xl px-3 py-2.5">
              <span className="text-slate-500 text-xs font-bold mt-0.5 w-4">{i === 0 ? 'A' : 'B'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-[10px] text-slate-500">{job.id.slice(0,12)}…</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">{job.priority}</span>
                  {job.passenger_count && <span className="text-[10px] text-slate-500">👥 {job.passenger_count}</span>}
                </div>
                <p className="text-slate-300 text-xs truncate">{job.origin_address ?? '—'}</p>
                <p className="text-slate-500 text-[10px] truncate">→ {job.destination_address ?? '—'}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Reasons */}
        {pair.mergeReasons.length > 0 && (
          <div className="space-y-1">
            {pair.mergeReasons.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-emerald-400">
                <span className="flex-shrink-0">✓</span><span>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Expand for scoring breakdown */}
        <button onClick={() => setExpanded(e => !e)}
          className="text-slate-500 text-xs hover:text-slate-300 transition-colors">
          {expanded ? '▲ Hide breakdown' : '▼ Score breakdown'}
        </button>

        {expanded && (
          <div className="space-y-2 bg-slate-800/40 rounded-xl p-3">
            <p className="text-slate-400 text-xs font-semibold mb-2">Scoring components</p>
            {[
              { label:'Pickup proximity (40%)',    val: pair.pickupRoadKm != null    ? Math.round(Math.max(0, 1 - pair.pickupRoadKm / 5) * 40) : null },
              { label:'Time window (30%)',          val: pair.pickupTimeDiffMin != null ? Math.round(Math.max(0, 1 - pair.pickupTimeDiffMin / 30) * 30) : null },
              { label:'Dropoff proximity (20%)',   val: pair.dropoffRoadKm != null   ? Math.round(Math.max(0, 1 - pair.dropoffRoadKm / 5) * 20) : 20 },
              { label:'Capacity headroom (10%)',   val: pair.combinedPassengers != null ? Math.round(Math.max(0, 1 - pair.combinedPassengers / 6) * 10) : null },
            ].map(comp => comp.val != null && (
              <div key={comp.label}>
                <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                  <span>{comp.label}</span><span>{comp.val} pts</span>
                </div>
                <ScoreBar score={comp.val * (100 / (comp.label.includes('40') ? 40 : comp.label.includes('30') ? 30 : comp.label.includes('20') ? 20 : 10))} size="sm" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-5 pb-5">
        <button onClick={() => onMerge(pair.jobA.id, pair.jobB.id)}
          className="flex-1 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold hover:bg-emerald-600/30 transition-all">
          ✅ Merge Trips
        </button>
        <button onClick={() => onSkip(pair.jobA.id, pair.jobB.id)}
          className="px-4 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-400 text-xs hover:text-white transition-all">
          Skip
        </button>
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────────── */
export default function MergeOptimizerPage() {
  const [pairs,    setPairs]    = useState<MergePair[]>([]);
  const [skipped,  setSkipped]  = useState<Set<string>>(new Set());
  const [config,   setConfig]   = useState<MergeConfig | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [scanning, setScanning] = useState(false);
  const [merging,  setMerging]  = useState<string | null>(null);
  const [toast,    setToast]    = useState<{ msg: string; ok: boolean } | null>(null);
  const [merged,   setMerged]   = useState(0);
  const [saved,    setSaved]    = useState(0);

  const pairKey = (a: string, b: string) => [a,b].sort().join('|');

  const load = useCallback(async () => {
    setScanning(true);
    try {
      const r = await fetch('/api/dispatch/merge-candidates?scan=true&tenantId=default');
      const d = await r.json();
      setPairs((d.pairs ?? []).filter((p: MergePair) => p.eligible));
      setConfig(d.config ?? null);
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleMerge(jobIdA: string, jobIdB: string) {
    const key = pairKey(jobIdA, jobIdB);
    setMerging(key);
    try {
      const r = await fetch('/api/dispatch/merge-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIdA, jobIdB, tenantId: 'default' }),
      });
      const d = await r.json();
      if (d.ok) {
        setPairs(prev => prev.filter(p => pairKey(p.jobA.id, p.jobB.id) !== key));
        const savingPair = pairs.find(p => pairKey(p.jobA.id, p.jobB.id) === key);
        setSaved(s => s + (savingPair?.estimatedSavingKm ?? 0));
        setMerged(m => m + 1);
        setToast({ msg: `Trips merged → job ${d.mergedJobId?.slice(0,10)}…`, ok: true });
      } else {
        setToast({ msg: d.error ?? 'Merge failed', ok: false });
      }
    } finally {
      setMerging(null);
      setTimeout(() => setToast(null), 5000);
    }
  }

  function handleSkip(jobIdA: string, jobIdB: string) {
    const key = pairKey(jobIdA, jobIdB);
    setSkipped(prev => new Set([...prev, key]));
  }

  const visiblePairs = pairs.filter(p => !skipped.has(pairKey(p.jobA.id, p.jobB.id)));
  const highScore    = visiblePairs.filter(p => p.mergeScore >= 70).length;

  return (
    <div className="space-y-6 max-w-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl border text-sm font-semibold shadow-xl ${
          toast.ok ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-red-500/20 border-red-500/30 text-red-300'
        }`}>{toast.ok ? '✅' : '❌'} {toast.msg}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🔀 Merge Optimizer</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Three-stage engine: Haversine pre-filter → Routing API road distance → Weighted scoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-400 text-sm font-semibold hover:bg-violet-600/30 transition-all disabled:opacity-50">
            {scanning ? <span className="animate-spin">↻</span> : '🔍'}
            {scanning ? 'Scanning…' : 'Re-scan Pairs'}
          </button>
        </div>
      </div>

      {/* Engine config banner */}
      {config && (
        <div className="flex flex-wrap items-center gap-4 bg-slate-900 border border-white/10 rounded-2xl px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-xs">Routing Engine</span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
              config.engine === 'GOOGLE_MAPS' ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' :
              config.engine === 'OSRM'        ? 'bg-green-500/20 border-green-500/30 text-green-400' :
              config.engine === 'MAPBOX'      ? 'bg-violet-500/20 border-violet-500/30 text-violet-400' :
              'bg-slate-700 border-white/10 text-slate-400'
            }`}>{config.engine}</span>
          </div>
          <div className="flex items-center gap-1 text-xs"><span className="text-slate-500">Pickup ≤</span><span className="text-white font-semibold">{config.pickupDistanceKm} km</span></div>
          <div className="flex items-center gap-1 text-xs"><span className="text-slate-500">Window ≤</span><span className="text-white font-semibold">{config.pickupWindowMin} min</span></div>
          <div className="flex items-center gap-1 text-xs"><span className="text-slate-500">Max pax</span><span className="text-white font-semibold">{config.maxPassengers}</span></div>
          {config.requireDropoff && <div className="flex items-center gap-1 text-xs"><span className="text-slate-500">Dropoff ≤</span><span className="text-white font-semibold">{config.dropoffDistanceKm} km</span></div>}
          <Link href="/admin/tenants" className="ml-auto text-slate-500 text-xs hover:text-slate-300 transition-colors">⚙ Configure →</Link>
        </div>
      )}

      {/* Session stats */}
      {(merged > 0 || saved > 0) && (
        <div className="flex gap-4">
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 flex items-center gap-3">
            <span className="text-emerald-400 text-2xl font-bold">{merged}</span>
            <div>
              <p className="text-emerald-300 text-xs font-semibold">Trips merged this session</p>
              <p className="text-slate-500 text-[10px]">Combined into multi-stop jobs</p>
            </div>
          </div>
          {saved > 0 && (
            <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-3 flex items-center gap-3">
              <span className="text-blue-400 text-2xl font-bold">~{saved.toFixed(1)}</span>
              <div>
                <p className="text-blue-300 text-xs font-semibold">km saved (estimated)</p>
                <p className="text-slate-500 text-[10px]">Reduced fleet kilometres</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pair list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <span className="text-3xl animate-spin">🔀</span>
          <p className="text-slate-500 text-sm">Scanning pending jobs for merge opportunities…</p>
        </div>
      ) : visiblePairs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-slate-900 border border-white/10 h-64 gap-3">
          <span className="text-4xl">🔀</span>
          <p className="text-white font-semibold text-sm">No merge opportunities found</p>
          <p className="text-slate-500 text-xs text-center max-w-sm">
            No pending jobs within {config?.pickupDistanceKm ?? '—'} km and {config?.pickupWindowMin ?? '—'} min of each other.
            New opportunities appear as bookings come in.
          </p>
          <button onClick={load}
            className="mt-2 px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:bg-slate-700 transition-all">
            ↻ Re-scan
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-white font-semibold">{visiblePairs.length} merge opportunities</h2>
            {highScore > 0 && (
              <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400 font-semibold">
                🥇 {highScore} high-confidence (score ≥ 70)
              </span>
            )}
            {skipped.size > 0 && (
              <button onClick={() => setSkipped(new Set())} className="ml-auto text-slate-500 text-xs hover:text-slate-300">
                Restore {skipped.size} skipped
              </button>
            )}
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visiblePairs.map(p => {
              const key = pairKey(p.jobA.id, p.jobB.id);
              return (
                <MergeCard key={key} pair={p}
                  onMerge={handleMerge} onSkip={handleSkip}
                  merging={merging === key}
                />
              );
            })}
          </div>
        </>
      )}

      {/* Methodology note */}
      <div className="rounded-2xl bg-slate-900 border border-white/10 p-5 space-y-2">
        <p className="text-slate-300 text-sm font-semibold">🧠 Three-Stage Merge Engine</p>
        <div className="grid md:grid-cols-3 gap-4 text-xs text-slate-500">
          <div>
            <p className="text-slate-400 font-semibold mb-1">Stage 1 — Haversine Pre-filter</p>
            <p>Fast great-circle distance check. Pairs farther than 2.5× the configured pickup distance are rejected immediately without API calls.</p>
          </div>
          <div>
            <p className="text-slate-400 font-semibold mb-1">Stage 2 — Routing API Road Distance</p>
            <p>Actual road distance via {config?.engine ?? 'Routing API'} (accounts for UAE road network, no shortcuts through the desert). Cached for 1 hour.</p>
          </div>
          <div>
            <p className="text-slate-400 font-semibold mb-1">Stage 3 — Weighted Score 0–100</p>
            <p>40% pickup proximity · 30% time window · 20% dropoff proximity · 10% capacity headroom. Score ≥ 50 = eligible.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
