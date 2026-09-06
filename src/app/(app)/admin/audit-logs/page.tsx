'use client';
/* eslint-disable react/jsx-key */
import React, { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
interface AuditLog {
  id: string;
  tenant_id?: string;
  tenant_name?: string;
  branch_id?: string;
  branch_name?: string;
  entity_type: string;
  entity_id?: string;
  entity_name?: string;
  user_id?: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  action: string;
  details?: string;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  login_time?: string;
  logout_time?: string;
  created_at: string;
}

interface PageMeta { total: number; page: number; pages: number; limit: number; }
interface Tenant   { id: string; name: string; }
interface Branch   { id: string; branch_name: string; emirate: string; }

// ── Constants ─────────────────────────────────────────────────────────────────
const ENTITY_TYPES = [
  'Branch','User','Vehicle','Trip','Driver','Contract',
  'Invoice','Payment','Booking','Incident','Document',
  'Login','Settings','Role','Tenant',
];

const ACTIONS = [
  'CREATE','UPDATE','DELETE','VIEW','EXPORT',
  'LOGIN','LOGOUT','APPROVE','REJECT','ASSIGN',
];

const ACTION_META: Record<string, { color: string; bg: string; icon: string }> = {
  CREATE:  { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: '✚' },
  UPDATE:  { color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',       icon: '✎' },
  DELETE:  { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',         icon: '✕' },
  VIEW:    { color: 'text-[var(--text-muted)]',   bg: 'bg-[var(--bg-surface-hover)]/40 border-[var(--border-subtle)]',         icon: '👁' },
  EXPORT:  { color: 'text-violet-400',  bg: 'bg-violet-500/10 border-violet-500/20',   icon: '↓' },
  LOGIN:   { color: 'text-cyan-400',    bg: 'bg-cyan-500/10 border-cyan-500/20',        icon: '→' },
  LOGOUT:  { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',     icon: '←' },
  APPROVE: { color: 'text-teal-400',    bg: 'bg-teal-500/10 border-teal-500/20',       icon: '✓' },
  REJECT:  { color: 'text-rose-400',    bg: 'bg-rose-500/10 border-rose-500/20',       icon: '✗' },
  ASSIGN:  { color: 'text-indigo-400',  bg: 'bg-indigo-500/10 border-indigo-500/20',   icon: '↗' },
};

const EMIRATE_FLAGS: Record<string, string> = {
  ABU_DHABI:'🏛️', DUBAI:'🏙️', SHARJAH:'🕌', AJMAN:'⛵',
  UMM_AL_QUWAIN:'🌿', RAS_AL_KHAIMAH:'⛰️', FUJAIRAH:'🌊',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AE', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false,
  });
}
function fmtTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-AE', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false });
}
function sessionDuration(login?: string, logout?: string) {
  if (!login || !logout) return null;
  const ms = new Date(logout).getTime() - new Date(login).getTime();
  if (ms < 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ActionBadge({ action }: { action: string }) {
  const m = ACTION_META[action] ?? { color:'text-[var(--text-muted)]', bg:'bg-[var(--bg-surface-hover)]/40 border-[var(--border-subtle)]', icon:'·' };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${m.bg} ${m.color}`}>
      <span className="text-[10px]">{m.icon}</span>{action}
    </span>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function DetailDrawer({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  const dur = sessionDuration(log.login_time, log.logout_time);
  const rows: [string, React.ReactNode][] = [
    ['Log ID',           <span className="font-mono text-xs">{log.id}</span>],
    ['Timestamp',        fmtDate(log.created_at)],
    ['Tenant',           log.tenant_name ?? log.tenant_id ?? '—'],
    ['Branch',           log.branch_name ?? log.branch_id ?? '—'],
    ['Entity Type',      log.entity_type],
    ['Entity',           log.entity_name ? `${log.entity_name}${log.entity_id ? ` (${log.entity_id})` : ''}` : log.entity_id ?? '—'],
    ['User ID',          <span className="font-mono text-xs">{log.user_id ?? '—'}</span>],
    ['User Name',        log.user_name ?? '—'],
    ['User Email',       log.user_email ?? '—'],
    ['User Role',        log.user_role ?? '—'],
    ['Action',           <ActionBadge action={log.action} />],
    ['Details',          log.details ?? '—'],
    ['IP Address',       log.ip_address ?? '—'],
    ['User Agent',       <span className="text-xs break-all">{log.user_agent ?? '—'}</span>],
    ['Session ID',       <span className="font-mono text-xs">{log.session_id ?? '—'}</span>],
    ['Login Time',       fmtDate(log.login_time)],
    ['Logout Time',      fmtDate(log.logout_time)],
    ['Session Duration', dur ? <span className="text-emerald-400 font-medium">{dur}</span> : '—'],
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-end z-50">
      <div className="w-full max-w-lg h-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] flex-shrink-0">
          <div>
            <h2 className="text-[var(--text-main)] font-bold text-base">Audit Log Detail</h2>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">{fmtDate(log.created_at)}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start gap-3 py-2.5 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-faint)] text-xs w-36 flex-shrink-0 pt-0.5">{label}</span>
              <span className="text-[var(--text-main)] text-sm flex-1">{value}</span>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex-shrink-0">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-sm hover:text-[var(--text-main)] transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditLogsPage() {
  const [logs,     setLogs]     = useState<AuditLog[]>([]);
  const [meta,     setMeta]     = useState<PageMeta>({ total:0, page:1, pages:1, limit:50 });
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [page,     setPage]     = useState(1);

  const [filter, setFilter] = useState({
    tenantId:'', branchId:'', entityType:'', userId:'',
    action:'', search:'', dateFrom:'', dateTo:'',
  });

  const [tenants,  setTenants]  = useState<Tenant[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Load tenants once
  useEffect(() => {
    fetch('/api/admin/tenants?limit=200', { cache:'no-store' })
      .then(r => r.json())
      .then(d => setTenants((Array.isArray(d) ? d : d.data ?? []).map((t: Tenant) => ({ id:t.id, name:t.name }))))
      .catch(() => {});
  }, []);

  // Load branches whenever tenant changes
  useEffect(() => {
    setBranches([]);
    setFilter(f => ({ ...f, branchId:'' }));
    if (!filter.tenantId) return;
    fetch(`/api/tenant-branches?tenantId=${filter.tenantId}&includeInactive=true`, { cache:'no-store' })
      .then(r => r.json())
      .then(d => setBranches((d.data ?? []).map((b: Branch) => ({ id:b.id, branch_name:b.branch_name, emirate:b.emirate }))))
      .catch(() => {});
  }, [filter.tenantId]);  

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.tenantId)   params.set('tenantId',   filter.tenantId);
      if (filter.branchId)   params.set('branchId',   filter.branchId);
      if (filter.entityType) params.set('entityType', filter.entityType);
      if (filter.userId)     params.set('userId',     filter.userId);
      if (filter.action)     params.set('action',     filter.action);
      if (filter.search)     params.set('search',     filter.search);
      if (filter.dateFrom)   params.set('dateFrom',   filter.dateFrom);
      if (filter.dateTo)     params.set('dateTo',     filter.dateTo);
      params.set('page', String(pg));
      params.set('limit', '50');

      const res  = await fetch(`/api/admin/audit-logs?${params}`, { cache:'no-store' });
      const data = await res.json().catch(() => ({}));
      setLogs(Array.isArray(data.data) ? data.data : []);
      setMeta({
        total: Number(data.total  ?? 0),
        page:  Number(data.page   ?? 1),
        pages: Number(data.pages  ?? 1),
        limit: Number(data.limit  ?? 50),
      });
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [filter]);

  // Reset to page 1 whenever filter changes
  useEffect(() => { setPage(1); load(1); }, [filter]); // eslint-disable-line
  useEffect(() => { load(page); }, [page]);             // eslint-disable-line

  // CSV export
  const exportCSV = () => {
    const headers = ['Timestamp','Tenant','Branch','Entity Type','Entity','User ID','User Name','User Email','User Role','Action','Details','IP Address','Login Time','Logout Time','Session Duration'];
    const csvRows = logs.map(l => [
      fmtDate(l.created_at), l.tenant_name ?? '', l.branch_name ?? '',
      l.entity_type, l.entity_name ?? l.entity_id ?? '',
      l.user_id ?? '', l.user_name ?? '', l.user_email ?? '', l.user_role ?? '',
      l.action, l.details ?? '', l.ip_address ?? '',
      fmtDate(l.login_time), fmtDate(l.logout_time),
      sessionDuration(l.login_time, l.logout_time) ?? '',
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
    const csv  = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const hasFilter = Object.values(filter).some(Boolean);

  const actionCounts = logs.reduce<Record<string,number>>((acc,l) => {
    acc[l.action] = (acc[l.action] ?? 0) + 1; return acc;
  }, {});

  // Selected branch label for breadcrumb
  const selectedBranch = branches.find(b => b.id === filter.branchId);
  const selectedTenant = tenants.find(t => t.id === filter.tenantId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">User Audit Log</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Complete record of all user actions · {(meta.total ?? 0).toLocaleString()} total entries
          </p>
          {/* Active scope breadcrumb */}
          {(selectedTenant || selectedBranch) && (
            <div className="flex items-center gap-1.5 mt-2 text-xs">
              <span className="text-[var(--text-faint)]">Showing:</span>
              {selectedTenant && (
                <span className="bg-red-500/10 text-red-300 border border-red-500/20 px-2 py-0.5 rounded-full">
                  🏢 {selectedTenant.name}
                </span>
              )}
              {selectedTenant && selectedBranch && <span className="text-[var(--text-faint)]">›</span>}
              {selectedBranch && (
                <span className="bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full">
                  {EMIRATE_FLAGS[selectedBranch.emirate] ?? '🏛️'} {selectedBranch.branch_name}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={exportCSV}
          disabled={logs.length === 0}
          className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-main)] px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Action chips */}
      {Object.keys(actionCounts).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(actionCounts).sort((a,b) => b[1]-a[1]).map(([act, cnt]) => {
            const m = ACTION_META[act];
            return (
              <button key={act}
                onClick={() => setFilter(f => ({ ...f, action: f.action === act ? '' : act }))}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${filter.action === act ? (m?.bg ?? 'bg-[var(--bg-surface-hover)]/40 border-[var(--border-strong)]') + ' ' + (m?.color ?? 'text-[var(--text-main)]') : 'bg-[var(--bg-surface)]/60 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
              >
                <span>{m?.icon ?? '·'}</span>{act} <span className="opacity-60">({cnt})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
        <p className="text-[var(--text-muted)] text-xs font-semibold uppercase tracking-wide">Filter Audit Logs</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

          {/* Keyword search */}
          <div className="lg:col-span-1">
            <label className="block text-[var(--text-faint)] text-xs mb-1">Keyword Search</label>
            <input type="text" placeholder="User name, email, entity, details…"
              value={filter.search}
              onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-red-500/40"
            />
          </div>

          {/* Tenant */}
          <div>
            <label className="block text-[var(--text-faint)] text-xs mb-1">Tenant</label>
            <select value={filter.tenantId}
              onChange={e => setFilter(f => ({ ...f, tenantId: e.target.value, branchId: '' }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-red-500/40"
            >
              <option value="">All Tenants</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Branch — only enabled when a tenant is selected */}
          <div>
            <label className="block text-xs mb-1 flex items-center gap-1.5">
              <span className={filter.tenantId ? 'text-[var(--text-muted)]' : 'text-[var(--text-faint)]'}>Branch</span>
              {!filter.tenantId && <span className="text-[var(--text-faint)] text-[10px]">(select a tenant first)</span>}
              {filter.tenantId && branches.length === 0 && <span className="text-[var(--text-faint)] text-[10px]">(no branches found)</span>}
            </label>
            <select value={filter.branchId}
              onChange={e => setFilter(f => ({ ...f, branchId: e.target.value }))}
              disabled={!filter.tenantId || branches.length === 0}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <option value="">All Branches</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {EMIRATE_FLAGS[b.emirate] ?? '🏛️'} {b.branch_name}
                </option>
              ))}
            </select>
          </div>

          {/* Entity Type */}
          <div>
            <label className="block text-[var(--text-faint)] text-xs mb-1">Entity Type</label>
            <select value={filter.entityType}
              onChange={e => setFilter(f => ({ ...f, entityType: e.target.value }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-red-500/40"
            >
              <option value="">All Entity Types</option>
              {ENTITY_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {/* Action */}
          <div>
            <label className="block text-[var(--text-faint)] text-xs mb-1">Action</label>
            <select value={filter.action}
              onChange={e => setFilter(f => ({ ...f, action: e.target.value }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-red-500/40"
            >
              <option value="">All Actions</option>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* User ID */}
          <div>
            <label className="block text-[var(--text-faint)] text-xs mb-1">User ID</label>
            <input type="text" value={filter.userId} placeholder="Paste user UUID…"
              onChange={e => setFilter(f => ({ ...f, userId: e.target.value }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm font-mono placeholder-[var(--text-faint)] focus:outline-none focus:border-red-500/40"
            />
          </div>

          {/* Date From */}
          <div>
            <label className="block text-[var(--text-faint)] text-xs mb-1">Date From</label>
            <input type="date" value={filter.dateFrom}
              onChange={e => setFilter(f => ({ ...f, dateFrom: e.target.value }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-red-500/40"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-[var(--text-faint)] text-xs mb-1">Date To</label>
            <input type="date" value={filter.dateTo}
              onChange={e => setFilter(f => ({ ...f, dateTo: e.target.value }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-red-500/40"
            />
          </div>

          {/* Clear */}
          {hasFilter && (
            <div className="flex items-end">
              <button
                onClick={() => setFilter({ tenantId:'', branchId:'', entityType:'', userId:'', action:'', search:'', dateFrom:'', dateTo:'' })}
                className="w-full py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-sm transition-colors"
              >
                ✕ Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        {/* Table header bar */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-[var(--text-main)] font-semibold text-sm">
            Audit Entries
            <span className="text-[var(--text-faint)] font-normal ml-2">
              {(meta.total ?? 0) > 0
                ? `${(((meta.page??1)-1)*(meta.limit??50))+1}–${Math.min((meta.page??1)*(meta.limit??50), meta.total??0)} of ${(meta.total??0).toLocaleString()}`
                : '0 results'}
            </span>
          </h2>
          {(meta.pages ?? 1) > 1 && (
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p-1)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition-colors">
                ← Prev
              </button>
              <span className="text-[var(--text-muted)] text-xs">Page {meta.page ?? 1} / {meta.pages ?? 1}</span>
              <button disabled={page >= (meta.pages ?? 1)} onClick={() => setPage(p => p+1)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition-colors">
                Next →
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-16 text-center text-[var(--text-faint)] text-sm">Loading audit logs…</div>
        ) : logs.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-[var(--text-main)] font-medium">No audit logs found</p>
            <p className="text-[var(--text-faint)] text-sm mt-1">
              {hasFilter
                ? 'No entries match the current filters — try adjusting or clearing them.'
                : 'User actions will appear here as they interact with the platform.'}
            </p>
            {hasFilter && (
              <button
                onClick={() => setFilter({ tenantId:'', branchId:'', entityType:'', userId:'', action:'', search:'', dateFrom:'', dateTo:'' })}
                className="mt-4 text-red-400 text-sm hover:text-red-300 transition-colors">
                ✕ Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-surface)]/50 text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                  <th className="text-left px-4 py-3 whitespace-nowrap">Timestamp</th>
                  <th className="text-left px-4 py-3">Tenant</th>
                  <th className="text-left px-4 py3">Branch</th>
                  <th className="text-left px-4 py-3">Entity Type</th>
                  <th className="text-left px-4 py-3">Entity</th>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Login Time</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Logout Time</th>
                  <th className="text-left px-4 py-3">Session</th>
                  <th className="text-left px-4 py-3">IP</th>
                  <th className="px-4 py-3"/>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map(log => {
                  const dur = sessionDuration(log.login_time, log.logout_time);
                  return (
                    <tr key={log.id} onClick={() => setSelected(log)}
                      className="hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer">

                      {/* Timestamp */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-[var(--text-main)] text-xs font-medium">
                          {new Date(log.created_at).toLocaleDateString('en-AE', { day:'2-digit', month:'short', year:'numeric' })}
                        </p>
                        <p className="text-[var(--text-faint)] text-xs">{fmtTime(log.created_at)}</p>
                      </td>

                      {/* Tenant */}
                      <td className="px-4 py-3">
                        <p className="text-[var(--text-muted)] text-xs">{log.tenant_name ?? '—'}</p>
                      </td>

                      {/* Branch */}
                      <td className="px-4 py-3">
                        {log.branch_name ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                            🏛️ {log.branch_name}
                          </span>
                        ) : <span className="text-[var(--text-faint)] text-xs">—</span>}
                      </td>

                      {/* Entity Type */}
                      <td className="px-4 py-3">
                        <span className="text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] px-2 py-0.5 rounded-md">{log.entity_type}</span>
                      </td>

                      {/* Entity */}
                      <td className="px-4 py-3">
                        <p className="text-[var(--text-muted)] text-xs max-w-[110px] truncate">{log.entity_name ?? '—'}</p>
                        {log.entity_id && <p className="text-[var(--text-faint)] text-[10px] font-mono">{log.entity_id.slice(0,8)}…</p>}
                      </td>

                      {/* User */}
                      <td className="px-4 py-3">
                        <p className="text-[var(--text-main)] text-xs font-medium">{log.user_name ?? log.user_id ?? '—'}</p>
                        {log.user_email && <p className="text-[var(--text-faint)] text-[10px]">{log.user_email}</p>}
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        {log.user_role
                          ? <span className="text-xs bg-violet-500/10 text-violet-300 border border-violet-500/20 px-2 py-0.5 rounded-full">{log.user_role}</span>
                          : <span className="text-[var(--text-faint)]">—</span>}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3">
                        <ActionBadge action={log.action} />
                        {log.details && <p className="text-[var(--text-faint)] text-[10px] mt-0.5 max-w-[130px] truncate">{log.details}</p>}
                      </td>

                      {/* Login Time */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.login_time
                          ? <><p className="text-cyan-400 text-xs">{fmtTime(log.login_time)}</p>
                              <p className="text-[var(--text-faint)] text-[10px]">{new Date(log.login_time).toLocaleDateString('en-AE',{day:'2-digit',month:'short'})}</p></>
                          : <span className="text-[var(--text-faint)] text-xs">—</span>}
                      </td>

                      {/* Logout Time */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.logout_time
                          ? <><p className="text-amber-400 text-xs">{fmtTime(log.logout_time)}</p>
                              <p className="text-[var(--text-faint)] text-[10px]">{new Date(log.logout_time).toLocaleDateString('en-AE',{day:'2-digit',month:'short'})}</p></>
                          : <span className="text-[var(--text-faint)] text-xs">—</span>}
                      </td>

                      {/* Session Duration */}
                      <td className="px-4 py-3">
                        {dur ? <span className="text-xs text-emerald-400 font-medium">{dur}</span>
                             : <span className="text-[var(--text-faint)] text-xs">—</span>}
                      </td>

                      {/* IP */}
                      <td className="px-4 py-3">
                        <span className="text-[var(--text-faint)] text-xs font-mono">{log.ip_address ?? '—'}</span>
                      </td>

                      {/* View button */}
                      <td className="px-4 py-3">
                        <button onClick={e => { e.stopPropagation(); setSelected(log); }}
                          className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-main)] px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition-colors whitespace-nowrap">
                          View →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Bottom pagination */}
        {(meta.pages ?? 1) > 1 && !loading && (
          <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <p className="text-[var(--text-faint)] text-xs">{(meta.total ?? 0).toLocaleString()} total entries</p>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p-1)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition-colors">← Previous</button>
              {Array.from({ length: Math.min(5, meta.pages ?? 1) }, (_, i) => {
                const totalPages = meta.pages ?? 1;
                const pg = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${pg === page ? 'bg-red-600 border-red-500 text-white' : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                    {pg}
                  </button>
                );
              })}
              <button disabled={page >= (meta.pages ?? 1)} onClick={() => setPage(p => p+1)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition-colors">Next →</button>
            </div>
          </div>
        )}
      </div>

      {selected && <DetailDrawer log={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
