'use client';
/**
 * Dispatch Jobs Queue — full paginated list with filters, search, manual dispatch controls
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
}

const STATUS_OPTS = ['ALL','PENDING','SEARCHING','OFFERED','ACCEPTED','IN_PROGRESS','COMPLETED','RETRYING','ESCALATED','FAILED','CANCELLED'];
const SERVICE_OPTS = ['ALL','PASSENGER','FREIGHT','DELIVERY','AMBULANCE','TECHNICIAN','SCHOOL_BUS'];
const PRIORITY_OPTS = ['ALL','P1','P2','P3','EMERGENCY','URGENT','NORMAL','SCHEDULED'];

const STATUS_COLOR: Record<string, string> = {
  PENDING:'bg-slate-700 text-slate-300', SEARCHING:'bg-blue-500/20 text-blue-300',
  OFFERED:'bg-yellow-500/20 text-yellow-300', ACCEPTED:'bg-green-500/20 text-green-300',
  IN_PROGRESS:'bg-cyan-500/20 text-cyan-300', COMPLETED:'bg-emerald-500/20 text-emerald-300',
  RETRYING:'bg-orange-500/20 text-orange-300', ESCALATED:'bg-red-500/20 text-red-300',
  FAILED:'bg-red-700/20 text-red-400', CANCELLED:'bg-slate-800 text-slate-500',
};
const PRIORITY_COLOR: Record<string, string> = {
  P1:'bg-red-500/20 text-red-400 border border-red-500/30',
  P2:'bg-orange-500/20 text-orange-400',
  EMERGENCY:'bg-red-600/30 text-red-300 border border-red-600/40',
  URGENT:'bg-orange-500/20 text-orange-400',
  NORMAL:'bg-slate-700 text-slate-400',
  P3:'bg-slate-700 text-slate-400',
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
  const [jobs,    setJobs]    = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('ALL');
  const [service, setService] = useState('ALL');
  const [priority,setPriority]= useState('ALL');
  const [page,    setPage]    = useState(1);
  const [total,   setTotal]   = useState(0);
  const [selected,setSelected]= useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string|null>(null);
  const PER_PAGE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ limit: String(PER_PAGE), offset: String((page-1)*PER_PAGE) });
      if (status  !== 'ALL') sp.set('status',  status);
      if (service !== 'ALL') sp.set('serviceType', service);
      if (priority!== 'ALL') sp.set('priority', priority);
      if (search)            sp.set('search',   search);
      const r = await fetch(`/api/dispatch/jobs?${sp}`);
      const d = await r.json();
      setJobs(d.data ?? []);
      setTotal(d.total ?? 0);
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

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📋 Jobs Queue</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total.toLocaleString()} total jobs · page {page}/{totalPages || 1}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dispatch/command"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600/20 border border-blue-600/30 text-blue-400 text-sm font-semibold hover:bg-blue-600/30 transition-all">
            🚦 Command Centre
          </Link>
          <button onClick={load}
            className="px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:bg-slate-700 transition-all">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-slate-900 border border-white/10 rounded-2xl p-4">
        {/* Search */}
        <div className="flex-1 min-w-48">
          <input
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search address, job ID…"
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
          />
        </div>
        {/* Status */}
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
          {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
        </select>
        {/* Service */}
        <select value={service} onChange={e => { setService(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
          {SERVICE_OPTS.map(s => <option key={s}>{s}</option>)}
        </select>
        {/* Priority */}
        <select value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
          {PRIORITY_OPTS.map(p => <option key={p}>{p}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setStatus('ALL'); setService('ALL'); setPriority('ALL'); setPage(1); }}
          className="px-3 py-2 rounded-xl text-slate-400 hover:text-white text-sm border border-white/10 hover:bg-slate-800 transition-all">
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
            className="ml-auto px-3 py-1.5 rounded-lg text-slate-400 text-xs hover:text-white transition-all">
            Deselect all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl bg-slate-900 border border-white/10 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-500 text-sm">Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <span className="text-3xl">📋</span>
            <p className="text-slate-500 text-sm">No jobs match the current filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-500 text-xs">
                <th className="px-4 py-3 text-left w-10">
                  <input type="checkbox" checked={selected.size === jobs.length && jobs.length > 0}
                    onChange={toggleAll} className="rounded accent-blue-500" />
                </th>
                <th className="px-4 py-3 text-left">Job ID</th>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Origin → Destination</th>
                <th className="px-4 py-3 text-left">Pax</th>
                <th className="px-4 py-3 text-left">Pickup</th>
                <th className="px-4 py-3 text-left">Attempts</th>
                <th className="px-4 py-3 text-left">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {jobs.map(j => (
                <tr key={j.id}
                  className={`hover:bg-white/[0.03] transition-colors ${selected.has(j.id) ? 'bg-blue-500/5' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(j.id)}
                      onChange={() => toggleSelect(j.id)} className="rounded accent-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-400 select-all">{j.id.slice(0,12)}…</span>
                    {j.meta && (j.meta as any).multiStop && (
                      <span className="ml-1 px-1 py-0.5 rounded text-[9px] bg-violet-500/20 text-violet-400 font-bold">MERGED</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    <span className="mr-1">{SVC_ICON[j.service_type] ?? '🚗'}</span>
                    {j.service_type}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_COLOR[j.priority] ?? 'bg-slate-700 text-slate-400'}`}>
                      {j.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[j.status] ?? 'bg-slate-700 text-slate-300'}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-slate-300 text-xs truncate">{j.origin_address ?? '—'}</p>
                    <p className="text-slate-500 text-xs truncate">{j.destination_address ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs text-center">{j.passenger_count ?? 1}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {j.scheduled_pickup ? fmtDate(j.scheduled_pickup) : 'ASAP'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${j.attempt_count >= 3 ? 'text-red-400' : j.attempt_count >= 2 ? 'text-orange-400' : 'text-slate-400'}`}>
                      {j.attempt_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtAge(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-xs">
            Showing {(page-1)*PER_PAGE + 1}–{Math.min(page*PER_PAGE, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-xs hover:bg-slate-700 transition-all disabled:opacity-40">
              ← Prev
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p = totalPages <= 7 ? i+1 : page <= 4 ? i+1 : page >= totalPages-3 ? totalPages-6+i : page-3+i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-xl text-xs font-semibold transition-all ${
                    p === page ? 'bg-blue-600 text-white' : 'bg-slate-800 border border-white/10 text-slate-400 hover:bg-slate-700'
                  }`}>{p}</button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-xs hover:bg-slate-700 transition-all disabled:opacity-40">
              Next →
            </button>
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
