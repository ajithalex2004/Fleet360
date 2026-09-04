'use client';
/**
 * Dispatch Jobs Queue — full paginated list with filters, search, manual dispatch controls,
 * and AI Smart Dispatch Optimizer recommendations with 1-click auto-assign.
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface DispatchJob {
  id: string;
  service_type: string;
  priority: string;
  status: string;
  origin_address?: string;
  destination_address?: string;
  passenger_count?: number;
  scheduled_pickup?: string;
  attempt_count: number;
  created_at: string;
  updated_at?: string;
  meta?: Record<string, unknown>;
  assigned_driver_id?: string;
  assigned_vehicle_id?: string;
}

interface DispatchRecommendation {
  id: string;
  job_id: string;
  job_service_type: string;
  job_priority: string;
  recommended_driver_id: string;
  recommended_vehicle_id: string;
  composite_score: number;
  factor_scores: Record<string, number>;
  candidates_evaluated: number;
  reason: string;
  confidence: number;
  status: string;
  driver_name?: string;
  vehicle_code?: string;
  vehicle_type?: string;
}

const STATUS_OPTS = ['ALL','PENDING','SEARCHING','OFFERED','ACCEPTED','IN_PROGRESS','COMPLETED','RETRYING','ESCALATED','FAILED','CANCELLED'];
const SERVICE_OPTS = ['ALL','PASSENGER','FREIGHT','DELIVERY','AMBULANCE','TECHNICIAN','SCHOOL_BUS'];
const PRIORITY_OPTS = ['ALL','P1','P2','P3','EMERGENCY','URGENT','NORMAL','SCHEDULED'];

const STATUS_COLOR: Record<string, string> = {
  PENDING:'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]', SEARCHING:'bg-blue-500/20 text-blue-300',
  OFFERED:'bg-yellow-500/20 text-yellow-300', ACCEPTED:'bg-green-500/20 text-green-300',
  IN_PROGRESS:'bg-cyan-500/20 text-cyan-300', COMPLETED:'bg-emerald-500/20 text-emerald-300',
  RETRYING:'bg-orange-500/20 text-orange-300', ESCALATED:'bg-red-500/20 text-red-300',
  FAILED:'bg-red-700/20 text-red-400', CANCELLED:'bg-[var(--bg-surface-hover)] text-[var(--text-faint)]',
};
const PRIORITY_COLOR: Record<string, string> = {
  P1:'bg-red-500/20 text-red-400 border border-red-500/30',
  P2:'bg-orange-500/20 text-orange-400',
  EMERGENCY:'bg-red-600/30 text-red-300 border border-red-600/40',
  URGENT:'bg-orange-500/20 text-orange-400',
  NORMAL:'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]',
  P3:'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]',
  SCHEDULED:'bg-indigo-500/20 text-indigo-400',
};
const SVC_ICON: Record<string, string> = {
  PASSENGER:'🚗', FREIGHT:'🚚', DELIVERY:'📦', AMBULANCE:'🚑', TECHNICIAN:'🔧', SCHOOL_BUS:'🚌',
};

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-AE', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtAge(s: string) {
  const mins = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins/60)}h ago`;
  return `${Math.floor(mins/1440)}d ago`;
}

/* ── Component ─────────────────────────────────────────────────────────────── */
export default function DispatchJobsPage() {
  const [jobs,            setJobs]            = useState<DispatchJob[]>([]);
  const [recommendations, setRecommendations] = useState<Map<string, DispatchRecommendation>>(new Map());
  const [loading,         setLoading]         = useState(true);
  const [search,          setSearch]          = useState('');
  const [status,          setStatus]          = useState('ALL');
  const [service,         setService]         = useState('ALL');
  const [priority,        setPriority]        = useState('ALL');
  const [page,            setPage]            = useState(1);
  const [total,           setTotal]           = useState(0);
  const [selected,        setSelected]        = useState<Set<string>>(new Set());
  const [actionLoading,   setActionLoading]   = useState<string|null>(null);
  const [selectedJobRec,  setSelectedJobRec]  = useState<DispatchRecommendation|null>(null);
  const [triggeringAi,    setTriggeringAi]    = useState(false);
  const PER_PAGE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ limit: String(PER_PAGE), offset: String((page-1)*PER_PAGE) });
      if (status  !== 'ALL') sp.set('status',  status);
      if (service !== 'ALL') sp.set('serviceType', service);
      if (priority!== 'ALL') sp.set('priority', priority);
      if (search)            sp.set('search',   search);
      
      const [jobsRes, recsRes] = await Promise.all([
        fetch(`/api/dispatch/jobs?${sp}`),
        fetch(`/api/dispatch/recommendations`).catch(() => null),
      ]);

      const d = await jobsRes.json();
      setJobs(d.data ?? []);
      setTotal(d.total ?? 0);

      if (recsRes && recsRes.ok) {
        const recData = await recsRes.json();
        const map = new Map<string, DispatchRecommendation>();
        for (const r of (recData.data ?? [])) {
          map.set(r.job_id, r);
        }
        setRecommendations(map);
      }
    } finally {
      setLoading(false);
    }
  }, [page, status, service, priority, search]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / PER_PAGE);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (selected.size === jobs.length) setSelected(new Set());
    else setSelected(new Set(jobs.map(j => j.id)));
  }

  async function bulkAction(action: string) {
    if (!selected.size) return;
    setActionLoading(action);
    await Promise.all([...selected].map(id =>
      fetch(`/api/dispatch/jobs/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ status: action === 'cancel' ? 'CANCELLED' : action === 'retry' ? 'PENDING' : undefined })
      })
    ));
    setSelected(new Set());
    setActionLoading(null);
    load();
  }

  async function handleTriggerAi() {
    setTriggeringAi(true);
    try {
      await fetch('/api/dispatch/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TRIGGER_AI' }),
      });
      await load();
    } finally {
      setTriggeringAi(false);
    }
  }

  async function handleApplyMatch(rec: DispatchRecommendation) {
    setActionLoading(rec.job_id);
    try {
      await fetch('/api/dispatch/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPLY_MATCH',
          jobId: rec.job_id,
          recommendationId: rec.id,
          driverId: rec.recommended_driver_id,
          vehicleId: rec.recommended_vehicle_id,
        }),
      });
      await load();
      setSelectedJobRec(null);
    } finally {
      setActionLoading(null);
    }
  }

  const pendingWithAiMatches = jobs.filter(j => 
    (j.status === 'PENDING' || j.status === 'SEARCHING') && recommendations.has(j.id)
  );

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--text-main)]">📋 Jobs Queue</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              ⚡ Smart Dispatch Active
            </span>
          </div>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">{total.toLocaleString()} total jobs · page {page}/{totalPages || 1}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleTriggerAi}
            disabled={triggeringAi}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 border border-emerald-500/30 text-emerald-300 text-sm font-semibold hover:from-emerald-600/30 hover:to-cyan-600/30 transition-all disabled:opacity-50"
          >
            {triggeringAi ? '🤖 Optimising Fleet…' : '🤖 AI Dispatch Optimizer'}
          </button>
          <Link href="/dispatch/command"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600/20 border border-blue-600/30 text-blue-400 text-sm font-semibold hover:bg-blue-600/30 transition-all">
            🚦 Command Centre
          </Link>
          <button onClick={load}
            className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-sm hover:bg-[var(--bg-surface-elevated)] transition-all">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* AI Recommendations Banner if pending jobs exist */}
      {pendingWithAiMatches.length > 0 && (
        <div className="bg-gradient-to-r from-emerald-950/40 via-[var(--bg-surface)] to-cyan-950/30 border border-emerald-500/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <h3 className="text-sm font-semibold text-emerald-300">
                AI Dispatch Suggestions Available ({pendingWithAiMatches.length} pending jobs)
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                The 15-factor statistical scoring engine has evaluated live HOS shifts, vehicle health, deadhead distance, and license compliance.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const first = pendingWithAiMatches[0];
                if (first && recommendations.has(first.id)) {
                  setSelectedJobRec(recommendations.get(first.id)!);
                }
              }}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/30 transition-all"
            >
              Review Top Match
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4">
        {/* Search */}
        <div className="flex-1 min-w-48">
          <input
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search address, job ID…"
            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-blue-500/50"
          />
        </div>
        {/* Status */}
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-blue-500/50">
          {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
        </select>
        {/* Service */}
        <select value={service} onChange={e => { setService(e.target.value); setPage(1); }}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-blue-500/50">
          {SERVICE_OPTS.map(s => <option key={s}>{s}</option>)}
        </select>
        {/* Priority */}
        <select value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-blue-500/50">
          {PRIORITY_OPTS.map(p => <option key={p}>{p}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setStatus('ALL'); setService('ALL'); setPriority('ALL'); setPage(1); }}
          className="px-3 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] text-sm border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-all">
          Clear
        </button>
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-2xl px-4 py-3">
          <span className="text-blue-400 text-sm font-semibold">{selected.size} selected</span>
          <button onClick={() => bulkAction('retry')}
            disabled={actionLoading === 'retry'}
            className="px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-semibold hover:bg-green-500/30 transition-all disabled:opacity-50">
            {actionLoading === 'retry' ? '…' : '↩ Retry'}
          </button>
          <button onClick={() => bulkAction('cancel')}
            disabled={actionLoading === 'cancel'}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-all disabled:opacity-50">
            {actionLoading === 'cancel' ? '…' : '✕ Cancel'}
          </button>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto px-3 py-1.5 rounded-lg text-[var(--text-muted)] text-xs hover:text-[var(--text-main)] transition-all">
            Deselect all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-[var(--text-faint)] text-sm">Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <span className="text-3xl">📋</span>
            <p className="text-[var(--text-faint)] text-sm">No jobs match the current filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-faint)] text-xs">
                <th className="px-4 py-3 text-left w-10">
                  <input type="checkbox" checked={selected.size === jobs.length && jobs.length > 0}
                    onChange={toggleAll} className="rounded accent-blue-500" />
                </th>
                <th className="px-4 py-3 text-left">Job ID</th>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">AI Recommendation</th>
                <th className="px-4 py-3 text-left">Origin → Destination</th>
                <th className="px-4 py-3 text-left">Pax</th>
                <th className="px-4 py-3 text-left">Pickup</th>
                <th className="px-4 py-3 text-left">Age</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {jobs.map(j => {
                const rec = recommendations.get(j.id);
                const isPending = j.status === 'PENDING' || j.status === 'SEARCHING';

                return (
                  <tr key={j.id}
                    className={`hover:bg-[var(--bg-surface-hover)] transition-colors ${selected.has(j.id) ? 'bg-blue-500/5' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(j.id)}
                        onChange={() => toggleSelect(j.id)} className="rounded accent-blue-500" />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-[var(--text-muted)] select-all">{j.id.slice(0,12)}…</span>
                      {j.meta && (j.meta as any).multiStop && (
                        <span className="ml-1 px-1 py-0.5 rounded text-[9px] bg-violet-500/20 text-violet-400 font-bold">MERGED</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      <span className="mr-1">{SVC_ICON[j.service_type] ?? '🚗'}</span>
                      {j.service_type}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_COLOR[j.priority] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                        {j.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[j.status] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                        {j.status}
                      </span>
                    </td>
                    
                    {/* AI Recommendation Column */}
                    <td className="px-4 py-3 max-w-xs">
                      {rec ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              rec.composite_score >= 0.85
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            }`}>
                              🤖 {Math.round(rec.composite_score * 100)}% Match
                            </span>
                            <span className="text-xs font-medium text-[var(--text-main)] truncate">
                              {rec.vehicle_code ?? rec.recommended_vehicle_id} · {rec.driver_name ?? rec.recommended_driver_id}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] line-clamp-1">
                            {rec.reason}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--text-faint)]">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-[var(--text-muted)] text-xs truncate">{j.origin_address ?? '—'}</p>
                      <p className="text-[var(--text-faint)] text-xs truncate">{j.destination_address ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs text-center">{j.passenger_count ?? 1}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs whitespace-nowrap">
                      {j.scheduled_pickup ? fmtDate(j.scheduled_pickup) : 'ASAP'}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-faint)] text-xs">{fmtAge(j.created_at)}</td>
                    
                    {/* Actions Column */}
                    <td className="px-4 py-3 text-right">
                      {isPending && rec ? (
                        <button
                          onClick={() => handleApplyMatch(rec)}
                          disabled={actionLoading === j.id}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-600/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-600/30 transition-all disabled:opacity-50"
                        >
                          {actionLoading === j.id ? '…' : '⚡ Accept Match'}
                        </button>
                      ) : rec ? (
                        <button
                          onClick={() => setSelectedJobRec(rec)}
                          className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-xs font-medium hover:text-[var(--text-main)] transition-all"
                        >
                          Details
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            fetch('/api/dispatch/recommendations', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'TRIGGER_AI', jobId: j.id }),
                            }).then(() => load());
                          }}
                          className="px-2 py-1 rounded-lg text-xs text-blue-400 hover:bg-blue-500/10 transition-all"
                        >
                          Score AI
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[var(--text-faint)] text-xs">
            Showing {(page-1)*PER_PAGE + 1}–{Math.min(page*PER_PAGE, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-xs hover:bg-[var(--bg-surface-elevated)] transition-all disabled:opacity-40">
              ← Prev
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p = totalPages <= 7 ? i+1 : page <= 4 ? i+1 : page >= totalPages-3 ? totalPages-6+i : page-3+i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-xl text-xs font-semibold transition-all ${
                    p === page ? 'bg-blue-600 text-white' : 'bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-elevated)]'
                  }`}>{p}</button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-xs hover:bg-[var(--bg-surface-elevated)] transition-all disabled:opacity-40">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal / Drawer */}
      {selectedJobRec && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
                🤖 AI Dispatch Breakdown
              </h3>
              <button onClick={() => setSelectedJobRec(null)} className="text-[var(--text-muted)] hover:text-white text-xl">✕</button>
            </div>

            <div className="p-3 bg-[var(--bg-surface-hover)] rounded-xl border border-[var(--border-subtle)] space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--text-muted)]">Candidate Driver:</span>
                <span className="font-semibold text-[var(--text-main)]">{selectedJobRec.driver_name ?? selectedJobRec.recommended_driver_id}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--text-muted)]">Candidate Vehicle:</span>
                <span className="font-semibold text-[var(--text-main)]">{selectedJobRec.vehicle_code ?? selectedJobRec.recommended_vehicle_id}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--text-muted)]">Match Score:</span>
                <span className="font-bold text-emerald-400">{Math.round(selectedJobRec.composite_score * 100)}%</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Operational Rationale</h4>
              <p className="text-sm text-[var(--text-main)] bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl leading-relaxed">
                {selectedJobRec.reason}
              </p>
            </div>

            {selectedJobRec.factor_scores && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Factor Scores (15-Dimensional Model)</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(selectedJobRec.factor_scores).slice(0, 8).map(([k, v]) => (
                    <div key={k} className="flex justify-between p-2 rounded-lg bg-[var(--bg-surface-hover)]">
                      <span className="text-[var(--text-muted)] capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                      <span className="font-semibold text-[var(--text-main)]">{Math.round((v as number) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setSelectedJobRec(null)}
                className="px-4 py-2 rounded-xl text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
              >
                Close
              </button>
              <button
                onClick={() => handleApplyMatch(selectedJobRec)}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-all shadow-lg"
              >
                ⚡ Assign Candidate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Legend */}
      <div className="flex flex-wrap gap-2 pt-2">
        {Object.entries(STATUS_COLOR).map(([s, cls]) => (
          <span key={s} className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{s}</span>
        ))}
      </div>
    </div>
  );
}
