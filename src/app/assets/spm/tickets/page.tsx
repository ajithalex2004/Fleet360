'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assignee {
  id: string;
  display_name: string;
  username: string;
  email: string;
  department: string;
  position: string;
  initials: string;
}

// ─── User Picker ──────────────────────────────────────────────────────────────

function UserPicker({ value, onChange }: {
  value: Assignee | null;
  onChange: (user: Assignee | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Assignee[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchUsers = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/assets/spm/assignees?search=${encodeURIComponent(q)}`);
      const data = await r.json();
      setResults(Array.isArray(data) ? data : []);
      setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleInput = (val: string) => {
    setSearch(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchUsers(val), 300);
  };

  const select = (u: Assignee) => { onChange(u); setSearch(''); setResults([]); setOpen(false); };
  const clear = () => { onChange(null); setSearch(''); setResults([]); };

  return (
    <div ref={ref} className="relative">
      {value ? (
        <div className="flex items-center gap-3 bg-slate-800 border border-yellow-500/30 rounded-lg px-3 py-2.5">
          <div className="w-8 h-8 rounded-full bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center text-yellow-300 text-xs font-bold shrink-0">
            {value.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-medium truncate">{value.display_name}</div>
            <div className="text-slate-400 text-xs truncate">{value.department || value.email}</div>
          </div>
          <button type="button" onClick={clear} className="text-slate-500 hover:text-white transition-colors text-sm">✕</button>
        </div>
      ) : (
        <div>
          <input
            value={search}
            onChange={e => handleInput(e.target.value)}
            onFocus={() => { if (results.length > 0) setOpen(true); else fetchUsers(''); }}
            placeholder="Search team members…"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/20 transition-colors"
          />
          {loading && <div className="absolute right-3 top-3 text-slate-500 text-xs">Searching…</div>}
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
          {results.map(u => (
            <button key={u.id} type="button" onClick={() => select(u)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
              <div className="w-8 h-8 rounded-full bg-slate-700 border border-white/10 flex items-center justify-center text-slate-300 text-xs font-bold shrink-0">
                {u.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-medium truncate">{u.display_name}</div>
                <div className="text-slate-500 text-xs truncate">{u.department}{u.department && u.email ? ' · ' : ''}{u.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SpmTicket {
  id: string;
  ticket_code: string;
  cycle_id: string;
  cycle_name?: string;
  cycle_code?: string;
  asset_id?: string;
  asset_name?: string;
  asset_no?: string;
  category?: string;
  maintenance_type?: string;
  triggered_by: 'SCHEDULER' | 'MANUAL';
  priority: string;
  status: string;
  scheduled_date?: string | null;
  assigned_to?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_email?: string | null;
  findings?: string | null;
  resolution_notes?: string | null;
  technician_notes?: string | null;
  completed_at?: string | null;
  created_at?: string;
}

interface TicketCheck {
  id: string;
  description: string;
  is_mandatory: boolean;
  is_completed: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  notes?: string | null;
}

interface TicketDetail extends SpmTicket {
  checks?: TicketCheck[];
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    OPEN: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    IN_PROGRESS: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    COMPLETED: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    CANCELLED: 'bg-slate-700/60 text-slate-500 border border-slate-600/30',
  };
  return map[status] ?? 'bg-slate-700 text-slate-400';
}

function priorityBadge(priority: string) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-500/20 text-red-400 border border-red-500/30',
    HIGH: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    LOW: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  };
  return map[priority] ?? 'bg-slate-700 text-slate-400';
}

function formatDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Toast Stack ─────────────────────────────────────────────────────────────

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 min-w-[320px] max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 shadow-xl border text-sm font-medium ${
            t.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-200' :
            t.type === 'error'   ? 'bg-red-900/90 border-red-500/40 text-red-200' :
                                   'bg-slate-800 border-white/10 text-slate-200'
          }`}
        >
          <span className="mt-0.5 shrink-0">{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-white ml-1 shrink-0">✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="p-8 space-y-6 animate-pulse">
      <div className="h-6 bg-slate-800 rounded w-56" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="h-10 bg-slate-800 rounded-xl" />
      <div className="h-72 bg-slate-800 rounded-xl" />
    </div>
  );
}

// ─── Ticket Detail Modal ──────────────────────────────────────────────────────

function TicketDetailModal({ ticket, onClose, onUpdated, pushToast }: {
  ticket: SpmTicket;
  onClose: () => void;
  onUpdated: () => void;
  pushToast: (msg: string, type?: Toast['type']) => void;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState('');

  const [findings, setFindings] = useState(ticket.findings ?? '');
  const [resolutionNotes, setResolutionNotes] = useState(ticket.resolution_notes ?? '');
  const [techNotes, setTechNotes] = useState(ticket.technician_notes ?? '');
  const [assignee, setAssignee] = useState<Assignee | null>(
    ticket.assigned_to_user_id
      ? {
          id: ticket.assigned_to_user_id as string,
          display_name: ticket.assigned_to ?? '',
          username: '',
          email: ticket.assigned_to_email as string ?? '',
          department: '',
          position: '',
          initials: ((ticket.assigned_to ?? '').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()),
        }
      : null
  );
  const [checks, setChecks] = useState<TicketCheck[]>([]);

  useEffect(() => {
    fetch(`/api/assets/spm/tickets/${ticket.id}`)
      .then(r => r.json())
      .then(d => {
        setDetail(d);
        setFindings(d.findings ?? '');
        setResolutionNotes(d.resolution_notes ?? '');
        setTechNotes(d.technician_notes ?? '');
        if (d.assigned_to_user_id) {
          setAssignee({
            id: d.assigned_to_user_id,
            display_name: d.assigned_to ?? '',
            username: '',
            email: d.assigned_to_email ?? '',
            department: '',
            position: '',
            initials: ((d.assigned_to ?? '').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()),
          });
        }
        setChecks(d.checks ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ticket.id]);

  const currentStatus = detail?.status ?? ticket.status;

  const transitionStatus = async (newStatus: string) => {
    setTransitioning(newStatus);
    try {
      const r = await fetch(`/api/assets/spm/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      setDetail(d => d ? { ...d, status: updated.status } : null);
      pushToast(`Ticket moved to ${newStatus.replace('_', ' ')}`, 'success');
      onUpdated();
    } catch {
      pushToast('Failed to update status', 'error');
    } finally {
      setTransitioning('');
    }
  };

  const toggleCheck = async (check: TicketCheck, idx: number) => {
    const newChecks = [...checks];
    newChecks[idx] = { ...check, is_completed: !check.is_completed };
    setChecks(newChecks);
    // Optimistic update — in a real implementation you'd PATCH the check item
  };

  const saveChanges = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/assets/spm/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findings: findings || null,
          resolution_notes: resolutionNotes || null,
          technician_notes: techNotes || null,
          assigned_to: assignee?.display_name || null,
          assigned_to_user_id: assignee?.id || null,
          assigned_to_email: assignee?.email || null,
        }),
      });
      if (!r.ok) throw new Error();
      pushToast('Ticket updated successfully', 'success');
      onUpdated();
    } catch {
      pushToast('Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const d = detail ?? ticket;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/8 sticky top-0 bg-slate-900 z-10">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-mono text-slate-500">{d.ticket_code}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${statusBadge(currentStatus)}`}>{currentStatus.replace('_', ' ')}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${priorityBadge(d.priority)}`}>{d.priority}</span>
            </div>
            <h2 className="text-white font-bold text-base">{d.cycle_name ?? 'Maintenance Ticket'}</h2>
            <p className="text-slate-400 text-sm">{d.asset_name ?? '—'} {d.asset_no ? `· ${d.asset_no}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 ml-4 shrink-0">✕</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-slate-700 border-t-yellow-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Meta */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                ['Type', d.maintenance_type ?? '—'],
                ['Scheduled', formatDate(d.scheduled_date)],
                ['Triggered By', d.triggered_by === 'SCHEDULER' ? '🤖 Scheduler' : '👤 Manual'],
              ].map(([k, v]) => (
                <div key={k} className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-500 uppercase tracking-wide text-[10px] mb-1">{k}</div>
                  <div className="text-slate-200 font-medium">{v}</div>
                </div>
              ))}
            </div>

            {/* Status Workflow */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">Status Actions</p>
              <div className="flex flex-wrap gap-2">
                {currentStatus === 'OPEN' && (
                  <button
                    onClick={() => transitionStatus('IN_PROGRESS')}
                    disabled={!!transitioning}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {transitioning === 'IN_PROGRESS' ? <span className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" /> : '▶'}
                    Start Work
                  </button>
                )}
                {currentStatus === 'IN_PROGRESS' && (
                  <>
                    <button
                      onClick={() => transitionStatus('COMPLETED')}
                      disabled={!!transitioning}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {transitioning === 'COMPLETED' ? <span className="w-3.5 h-3.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" /> : '✅'}
                      Mark Complete
                    </button>
                    <button
                      onClick={() => transitionStatus('CANCELLED')}
                      disabled={!!transitioning}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {transitioning === 'CANCELLED' ? <span className="w-3.5 h-3.5 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" /> : '❌'}
                      Cancel
                    </button>
                  </>
                )}
                {(currentStatus === 'COMPLETED' || currentStatus === 'CANCELLED') && (
                  <div className="px-4 py-2 bg-slate-800/60 text-slate-500 rounded-lg text-sm italic">
                    Ticket is {currentStatus.toLowerCase()} — no further actions available
                  </div>
                )}
              </div>
            </div>

            {/* Checklist */}
            {checks.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">
                  Checklist ({checks.filter(c => c.is_completed).length}/{checks.length} done)
                </p>
                <div className="space-y-2">
                  {checks.map((check, i) => (
                    <label key={check.id} className="flex items-start gap-3 bg-slate-800/40 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-slate-800/60 transition-colors">
                      <input
                        type="checkbox"
                        checked={check.is_completed}
                        onChange={() => toggleCheck(check, i)}
                        className="mt-0.5 accent-emerald-400"
                      />
                      <div className="flex-1">
                        <span className={`text-sm ${check.is_completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                          {check.description}
                        </span>
                        {check.is_mandatory && (
                          <span className="ml-2 text-[10px] text-red-400 font-semibold">Required</span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Assigned To — User Picker */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Assigned To</label>
              <UserPicker value={assignee} onChange={setAssignee} />
              {assignee && (
                <p className="text-slate-600 text-xs mt-1.5">{assignee.email}</p>
              )}
            </div>

            {/* Findings */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Findings</label>
              <textarea
                value={findings}
                onChange={e => setFindings(e.target.value)}
                rows={3}
                placeholder="Document any findings observed during this maintenance…"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors resize-none"
              />
            </div>

            {/* Resolution Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Resolution Notes</label>
              <textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                rows={3}
                placeholder="How was this resolved? What actions were taken?…"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors resize-none"
              />
            </div>

            {/* Technician Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Technician Notes</label>
              <textarea
                value={techNotes}
                onChange={e => setTechNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes for the technician…"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors resize-none"
              />
            </div>

            {/* Save */}
            <div className="flex justify-end gap-3 pt-2 border-t border-white/8">
              <button onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors">
                Close
              </button>
              <button onClick={saveChanges} disabled={saving}
                className="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors flex items-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ['ALL', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const PRIORITY_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function SpmTicketsPage() {
  const [tickets, setTickets] = useState<SpmTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SpmTicket | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const pushToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), []);

  const fetchTickets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (priorityFilter !== 'ALL') params.set('priority', priorityFilter);
      if (search.trim()) params.set('search', search.trim());
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const r = await fetch(`/api/assets/spm/tickets?${params}`);
      const d = await r.json();
      setTickets(Array.isArray(d) ? d : []);
    } catch {
      setError('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, search, dateFrom, dateTo]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(fetchTickets, 400);
  };

  // KPI counts derived from the current ticket list
  const openCount = tickets.filter(t => t.status === 'OPEN').length;
  const inProgressCount = tickets.filter(t => t.status === 'IN_PROGRESS').length;
  const completedCount = tickets.filter(t => t.status === 'COMPLETED').length;

  if (loading) return <Skeleton />;

  return (
    <div className="p-8 space-y-6 min-h-screen bg-[#0c1a3e]">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <span>⚠️</span> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* ── Header ── */}
      <div>
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-3">
          <Link href="/assets" className="hover:text-slate-300 transition-colors">Assets</Link>
          <span>›</span>
          <Link href="/assets/spm" className="hover:text-slate-300 transition-colors">SPM</Link>
          <span>›</span>
          <span className="text-slate-300">Tickets</span>
        </nav>
        <h1 className="text-2xl font-bold text-white">🎫 Maintenance Tickets</h1>
        <p className="text-slate-400 text-sm mt-1">Track and manage all preventive maintenance work orders</p>
      </div>

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Open Tickets</p>
          <p className="text-3xl font-bold text-blue-400">{openCount}</p>
          <p className="text-slate-600 text-xs mt-1">Awaiting action</p>
        </div>
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">In Progress</p>
          <p className="text-3xl font-bold text-amber-400">{inProgressCount}</p>
          <p className="text-slate-600 text-xs mt-1">Currently being worked</p>
        </div>
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Completed This Month</p>
          <p className="text-3xl font-bold text-emerald-400">{completedCount}</p>
          <p className="text-slate-600 text-xs mt-1">Successfully closed</p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search ticket code or asset name…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors">
          {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s.replace('_', ' ')}</option>)}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors">
          {PRIORITY_FILTERS.map(p => <option key={p} value={p}>{p === 'ALL' ? 'All Priorities' : p}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 text-xs">From</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 text-xs">To</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors" />
        </div>
      </div>

      {/* ── Tickets Table ── */}
      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h2 className="text-white font-semibold text-sm">Tickets</h2>
          <span className="text-slate-500 text-xs">{tickets.length} ticket{tickets.length !== 1 ? 's' : ''}</span>
        </div>

        {tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-4xl">🎫</span>
            <p className="text-slate-400 font-medium">No tickets found</p>
            <p className="text-slate-600 text-sm">Run the SPM scheduler to generate maintenance tickets</p>
            <Link href="/assets/spm"
              className="mt-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold rounded-lg text-sm transition-colors">
              Go to SPM Dashboard
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs uppercase tracking-wide border-b border-white/8">
                  <th className="text-left px-4 py-3 font-semibold">Ticket Code</th>
                  <th className="text-left px-4 py-3 font-semibold">Cycle</th>
                  <th className="text-left px-4 py-3 font-semibold">Asset</th>
                  <th className="text-left px-4 py-3 font-semibold">Category</th>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-center px-4 py-3 font-semibold">Triggered By</th>
                  <th className="text-left px-4 py-3 font-semibold">Priority</th>
                  <th className="text-left px-4 py-3 font-semibold">Scheduled</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-left px-4 py-3 font-semibold">Assigned To</th>
                  <th className="text-center px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tickets.map((ticket, idx) => (
                  <tr
                    key={ticket.id}
                    className={`transition-colors hover:bg-white/5 ${idx % 2 === 0 ? 'bg-slate-800/40' : 'bg-slate-900'}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">{ticket.ticket_code}</td>
                    <td className="px-4 py-3">
                      <div className="text-white text-sm font-medium">{ticket.cycle_name ?? '—'}</div>
                      {ticket.cycle_code && <div className="text-slate-500 text-xs font-mono">{ticket.cycle_code}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-200 text-sm">{ticket.asset_name ?? '—'}</div>
                      {ticket.asset_no && <div className="text-slate-500 text-xs">{ticket.asset_no}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{ticket.category ?? '—'}</td>
                    <td className="px-4 py-3">
                      {ticket.maintenance_type ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-700/60 text-slate-400 uppercase tracking-wide">
                          {ticket.maintenance_type}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span title={ticket.triggered_by} className="text-base">
                        {ticket.triggered_by === 'SCHEDULER' ? '🤖' : '👤'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${priorityBadge(ticket.priority)}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDate(ticket.scheduled_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${statusBadge(ticket.status)}`}>
                        {ticket.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ticket.assigned_to_user_id ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center text-yellow-300 text-[9px] font-bold shrink-0">
                            {(ticket.assigned_to ?? '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
                          </div>
                          <span className="text-slate-300 text-xs truncate max-w-[80px]">{ticket.assigned_to}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-xs">{ticket.assigned_to ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSelectedTicket(ticket)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium rounded-lg border border-white/8 transition-colors"
                      >
                        View / Update
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onUpdated={fetchTickets}
          pushToast={pushToast}
        />
      )}
    </div>
  );
}
