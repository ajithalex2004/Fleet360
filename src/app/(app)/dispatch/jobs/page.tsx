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
          <h1 className="text-2xl font-bold text-[var(--text-main)]">📋 Jobs Queue</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">{total.toLocaleString()} total jobs · page {page}/{totalPages || 1}</p>
        </div>
        <div className="flex items-center gap-3">
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
                <th className="px-4 py-3 text-left">Origin → Destination</th>
                <th className="px-4 py-3 text-left">Pax</th>
                <th className="px-4 py-3 text-left">Pickup</th>
                <th className="px-4 py-3 text-left">Attempts</th>
                <th className="px-4 py-3 text-left">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {jobs.map(j => (
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
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-[var(--text-muted)] text-xs truncate">{j.origin_address ?? '—'}</p>
                    <p className="text-[var(--text-faint)] text-xs truncate">{j.destination_address ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs text-center">{j.passenger_count ?? 1}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs whitespace-nowrap">
                    {j.scheduled_pickup ? fmtDate(j.scheduled_pickup) : 'ASAP'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${j.attempt_count >= 3 ? 'text-red-400' : j.attempt_count >= 2 ? 'text-orange-400' : 'text-[var(--text-muted)]'}`}>
                      {j.attempt_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-faint)] text-xs">{fmtAge(j.created_at)}</td>
                </tr>
              ))}
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

      {/* Status Legend */}
      <div className="flex flex-wrap gap-2 pt-2">
        {Object.entries(STATUS_COLOR).map(([s, cls]) => (
          <span key={s} className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{s}</span>
        ))}
      </div>
    </div>
  );
}
