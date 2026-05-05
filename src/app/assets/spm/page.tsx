'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpmStats {
  total_cycles: number;
  active_cycles: number;
  paused_cycles: number;
  due_in_7_days: number;
  overdue: number;
  open_tickets: number;
  completed_this_month: number;
  last_run_at: string | null;
}

interface SpmCycle {
  id: string;
  cycle_code: string;
  name: string;
  asset_id: string;
  asset_name?: string;
  asset_no?: string;
  category?: string;
  location?: string;
  domain?: string;
  maintenance_type: string;
  interval_days: number;
  priority: string;
  status: string;
  next_run_date?: string | null;
  days_remaining?: number | null;
  assigned_to?: string;
  estimated_duration_min?: number;
  description?: string;
  notes?: string;
  first_run_date?: string | null;
  created_at?: string;
}

interface SpmTicket {
  id: string;
  ticket_code: string;
  cycle_id: string;
  cycle_name?: string;
  asset_name?: string;
  status: string;
  priority: string;
  scheduled_date?: string;
  notes?: string;
}

interface ChecklistItem {
  id?: string;
  description: string;
  is_mandatory: boolean;
}

interface Assignee {
  id: string;
  display_name: string;
  username: string;
  email: string;
  department: string;
  position: string;
  initials: string;
}

interface SpmNotification {
  id: string;
  ticket_id?: string;
  cycle_id?: string;
  user_id: string;
  user_name: string;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  ticket_code?: string;
  cycle_code?: string;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

function priorityBadge(priority: string) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-500/20 text-red-400 border border-red-500/30',
    HIGH: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    LOW: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  };
  return map[priority] ?? 'bg-slate-700 text-slate-400';
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    PAUSED: 'bg-slate-600/40 text-slate-400 border border-slate-600/40',
    ARCHIVED: 'bg-slate-700/40 text-slate-500 border border-slate-700/40',
  };
  return map[status] ?? 'bg-slate-700 text-slate-400';
}

function daysRemainingPill(days: number | null | undefined) {
  if (days === null || days === undefined) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/60 text-slate-500">Not scheduled</span>;
  }
  if (days < 0) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">{Math.abs(days)}d overdue</span>;
  }
  if (days <= 7) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">{days}d</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">{days}d</span>;
}

function formatDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(d?: string | null) {
  if (!d) return 'Never';
  return new Date(d).toLocaleString('en-AE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Toast Stack ─────────────────────────────────────────────────────────────

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 min-w-[320px] max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-xl border text-sm font-medium transition-all ${
            t.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-200' :
            t.type === 'error'   ? 'bg-red-900/90 border-red-500/40 text-red-200' :
                                   'bg-slate-800 border-white/10 text-slate-200'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            {t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}
          </span>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-white ml-1 shrink-0">✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="p-8 space-y-6 animate-pulse">
      <div className="h-8 bg-slate-800 rounded w-80" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="h-12 bg-slate-800 rounded-xl" />
      <div className="h-64 bg-slate-800 rounded-xl" />
    </div>
  );
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

  const select = (u: Assignee) => {
    onChange(u);
    setSearch('');
    setResults([]);
    setOpen(false);
  };

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

// ─── Notification Bell ────────────────────────────────────────────────────────

function NotificationBell({ userId }: { userId?: string }) {
  const [notifications, setNotifications] = useState<SpmNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const params = new URLSearchParams({ unread: 'false' });
      if (userId) params.set('user_id', userId);
      const r = await fetch(`/api/assets/spm/notifications?${params}`);
      const data = await r.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch { /* silent */ }
  }, [userId]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    if (!userId) return;
    await fetch('/api/assets/spm/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_all: true, user_id: userId }),
    });
    fetchNotifications();
  };

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const typeIcon: Record<string, string> = {
    TICKET_ASSIGNED: '🎫',
    TICKET_DUE: '⏰',
    TICKET_OVERDUE: '🚨',
    STATUS_CHANGED: '🔄',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => !o); if (!open) fetchNotifications(); }}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 border border-white/10 hover:bg-slate-700 hover:border-white/20 transition-colors"
        title="Notifications"
      >
        <span className="text-base">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-slate-900">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
            <span className="text-white text-sm font-semibold">SPM Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500 text-sm">No notifications</div>
            ) : notifications.map(n => (
              <div key={n.id} className={`px-4 py-3 border-b border-white/5 hover:bg-white/3 transition-colors ${!n.is_read ? 'bg-yellow-500/5' : ''}`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-base shrink-0 mt-0.5">{typeIcon[n.type] ?? '📌'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-200 text-xs leading-snug">{n.message}</p>
                    {n.ticket_code && (
                      <p className="text-slate-500 text-[10px] mt-0.5">Ticket: {n.ticket_code}</p>
                    )}
                    <p className="text-slate-600 text-[10px] mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0 mt-1" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Cycle Modal ──────────────────────────────────────────────────────────

const EMPTY_CYCLE_FORM = {
  name: '',
  description: '',
  asset_id: '',
  asset_name: '',
  asset_category: '',
  asset_location: '',
  asset_domain: '',
  maintenance_type: 'PREVENTIVE',
  interval_days: 30,
  first_run_date: '',
  priority: 'MEDIUM',
  assigned_to: '',
  estimated_duration_min: 60,
  notes: '',
};

function AddCycleModal({ onClose, onCreated, pushToast }: {
  onClose: () => void;
  onCreated: () => void;
  pushToast: (msg: string, type?: Toast['type']) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_CYCLE_FORM });
  const [assignee, setAssignee] = useState<Assignee | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetResults, setAssetResults] = useState<{ id: string; name: string; asset_no?: string; category_name?: string; warehouse_location?: string; domain?: string }[]>([]);
  const [assetSearching, setAssetSearching] = useState(false);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemMandatory, setNewItemMandatory] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const searchAssets = useCallback(async (q: string) => {
    if (!q.trim()) { setAssetResults([]); return; }
    setAssetSearching(true);
    try {
      const r = await fetch(`/api/assets/registry?search=${encodeURIComponent(q)}&limit=10`);
      const data = await r.json();
      setAssetResults(Array.isArray(data) ? data : (data.assets ?? []));
    } catch {
      setAssetResults([]);
    } finally {
      setAssetSearching(false);
    }
  }, []);

  const assetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAssetInput = (val: string) => {
    setAssetSearch(val);
    if (assetTimer.current) clearTimeout(assetTimer.current);
    assetTimer.current = setTimeout(() => searchAssets(val), 350);
  };

  const selectAsset = (a: typeof assetResults[0]) => {
    setForm(f => ({
      ...f,
      asset_id: a.id,
      asset_name: a.name,
      asset_category: a.category_name ?? '',
      asset_location: a.warehouse_location ?? '',
      asset_domain: a.domain ?? '',
    }));
    setAssetSearch(a.name + (a.asset_no ? ` (${a.asset_no})` : ''));
    setAssetResults([]);
  };

  const addChecklistItem = () => {
    if (!newItemDesc.trim()) return;
    setChecklistItems(c => [...c, { description: newItemDesc.trim(), is_mandatory: newItemMandatory }]);
    setNewItemDesc('');
    setNewItemMandatory(true);
  };

  const removeChecklistItem = (idx: number) => {
    setChecklistItems(c => c.filter((_, i) => i !== idx));
  };

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.asset_id) { pushToast('Please select an asset', 'error'); return; }
    if (!form.name.trim()) { pushToast('Cycle name is required', 'error'); return; }
    setSubmitting(true);
    try {
      const cycleRes = await fetch('/api/assets/spm/cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          asset_id: form.asset_id,
          maintenance_type: form.maintenance_type,
          interval_days: Number(form.interval_days),
          first_run_at: form.first_run_date || null,
          priority: form.priority,
          assigned_to: assignee?.display_name || null,
          assigned_to_user_id: assignee?.id || null,
          assigned_to_email: assignee?.email || null,
          estimated_duration_mins: Number(form.estimated_duration_min) || null,
          notes: form.notes || null,
        }),
      });
      if (!cycleRes.ok) throw new Error('Failed to create cycle');
      const cycle = await cycleRes.json();
      // Post checklist items
      if (checklistItems.length > 0) {
        await Promise.all(checklistItems.map(item =>
          fetch('/api/assets/spm/checklist-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cycle_id: cycle.id, description: item.description, is_mandatory: item.is_mandatory }),
          })
        ));
      }
      pushToast('Maintenance cycle created successfully', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      pushToast((err instanceof Error ? err.message : null) ?? 'Failed to create cycle', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/8 sticky top-0 bg-slate-900 z-10">
          <div>
            <h2 className="text-white font-bold text-lg">New Maintenance Cycle</h2>
            <p className="text-slate-400 text-xs mt-0.5">Set up a recurring preventive maintenance schedule</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Cycle Name <span className="text-red-400">*</span></label>
            <input value={form.name} onChange={f('name')} required placeholder="e.g. Monthly Generator Inspection"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/20 transition-colors" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Description</label>
            <textarea value={form.description} onChange={f('description')} rows={2} placeholder="Brief description of this maintenance cycle..."
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/20 transition-colors resize-none" />
          </div>

          {/* Asset Search */}
          <div className="relative">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Asset <span className="text-red-400">*</span></label>
            <input
              value={assetSearch}
              onChange={e => handleAssetInput(e.target.value)}
              placeholder="Type to search assets..."
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/20 transition-colors"
            />
            {assetSearching && <div className="absolute right-3 top-9 text-slate-500 text-xs">Searching…</div>}
            {assetResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-white/10 rounded-lg overflow-hidden shadow-xl">
                {assetResults.map(a => (
                  <button key={a.id} type="button" onClick={() => selectAsset(a)}
                    className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors">
                    <div className="text-white text-sm font-medium">{a.name}</div>
                    <div className="text-slate-500 text-xs">{a.asset_no} · {a.category_name} · {a.warehouse_location}</div>
                  </button>
                ))}
              </div>
            )}
            {/* Auto-filled fields */}
            {form.asset_id && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[['Category', form.asset_category], ['Location', form.asset_location], ['Domain', form.asset_domain]].map(([label, val]) => (
                  <div key={label} className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-1.5">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
                    <div className="text-slate-300 text-xs font-medium truncate">{val || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Maintenance Type</label>
              <select value={form.maintenance_type} onChange={f('maintenance_type')}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors">
                {['PREVENTIVE', 'INSPECTION', 'CALIBRATION', 'CLEANING', 'LUBRICATION', 'REPLACEMENT', 'TESTING'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Priority</label>
              <select value={form.priority} onChange={f('priority')}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors">
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Interval + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Interval (Days)</label>
              <input type="number" min={1} value={form.interval_days} onChange={f('interval_days')}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Est. Duration (min)</label>
              <input type="number" min={0} value={form.estimated_duration_min} onChange={f('estimated_duration_min')}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors" />
            </div>
          </div>

          {/* First Run Date */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">First Run Date</label>
            <input type="date" value={form.first_run_date} onChange={f('first_run_date')}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors" />
          </div>

          {/* Assigned To — User Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Assigned To</label>
            <UserPicker value={assignee} onChange={setAssignee} />
            {assignee && (
              <p className="text-slate-500 text-xs mt-1.5">
                {assignee.position && <span className="mr-2">{assignee.position}</span>}
                <span className="text-slate-600">{assignee.email}</span>
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={f('notes')} rows={2} placeholder="Additional notes..."
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors resize-none" />
          </div>

          {/* Checklist Items */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Checklist Items</label>
            <div className="space-y-2 mb-3">
              {checklistItems.length === 0 && (
                <p className="text-slate-600 text-xs italic">No checklist items yet. Add items below.</p>
              )}
              {checklistItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${item.is_mandatory ? 'bg-red-400' : 'bg-slate-500'}`} />
                  <span className="text-slate-300 text-sm flex-1">{item.description}</span>
                  <span className="text-[10px] text-slate-500">{item.is_mandatory ? 'Required' : 'Optional'}</span>
                  <button type="button" onClick={() => removeChecklistItem(i)} className="text-slate-600 hover:text-red-400 text-xs ml-1 transition-colors">✕</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newItemDesc} onChange={e => setNewItemDesc(e.target.value)} placeholder="Add checklist item description..."
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }}}
                className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors" />
              <label className="flex items-center gap-1.5 text-slate-400 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={newItemMandatory} onChange={e => setNewItemMandatory(e.target.checked)} className="accent-red-400" />
                Mandatory
              </label>
              <button type="button" onClick={addChecklistItem}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors">
                + Add
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2 border-t border-white/8">
            <button type="button" onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-lg text-sm transition-colors flex items-center gap-2">
              {submitting && <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
              {submitting ? 'Creating…' : 'Create Cycle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Cycle Detail Drawer ──────────────────────────────────────────────────────

function CycleDetailDrawer({ cycle, onClose, onAction, pushToast }: {
  cycle: SpmCycle;
  onClose: () => void;
  onAction: () => void;
  pushToast: (msg: string, type?: Toast['type']) => void;
}) {
  const [detail, setDetail] = useState<(SpmCycle & { tickets?: SpmTicket[]; checklist?: ChecklistItem[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');

  useEffect(() => {
    fetch(`/api/assets/spm/cycles/${cycle.id}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cycle.id]);

  const doAction = async (action: 'pause' | 'resume' | 'archive') => {
    setActing(action);
    try {
      const r = await fetch(`/api/assets/spm/cycles/${cycle.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error('Action failed');
      pushToast(`Cycle ${action}d successfully`, 'success');
      onAction();
      onClose();
    } catch {
      pushToast(`Failed to ${action} cycle`, 'error');
    } finally {
      setActing('');
    }
  };

  const d = detail ?? cycle;
  const tickets: SpmTicket[] = (detail as { tickets?: SpmTicket[] })?.tickets?.slice(0, 5) ?? [];
  const checklist: ChecklistItem[] = (detail as { checklist?: ChecklistItem[] })?.checklist ?? [];

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-slate-950 w-full max-w-[480px] h-full flex flex-col shadow-2xl border-l border-white/8 overflow-y-auto">
        {/* Drawer Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/8 sticky top-0 bg-slate-950 z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-slate-500">{d.cycle_code}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${statusBadge(d.status)}`}>{d.status}</span>
            </div>
            <h2 className="text-white font-bold text-base">{d.name}</h2>
            <p className="text-slate-400 text-sm mt-0.5">{d.asset_name ?? 'Unknown Asset'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 mt-1">✕</button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-slate-700 border-t-yellow-500 rounded-full animate-spin" />
          </div>
        )}

        {!loading && (
          <div className="flex-1 p-6 space-y-5">
            {/* Meta */}
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Type', d.maintenance_type],
                ['Priority', d.priority],
                ['Interval', `${d.interval_days} days`],
                ['Est. Duration', d.estimated_duration_min ? `${d.estimated_duration_min} min` : '—'],
                ['Next Run', formatDate(d.next_run_date)],
                ['Days Remaining', ''],
                ['Assigned To', d.assigned_to || '—'],
                ['Category', d.category || '—'],
              ].map(([k, v]) => k === 'Days Remaining' ? (
                <div key={k} className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{k}</div>
                  {daysRemainingPill(d.days_remaining)}
                </div>
              ) : (
                <div key={k} className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{k}</div>
                  <div className="text-slate-200 text-sm font-medium truncate">{v || '—'}</div>
                </div>
              ))}
            </div>

            {/* Description */}
            {d.description && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Description</p>
                <p className="text-slate-300 text-sm leading-relaxed">{d.description}</p>
              </div>
            )}

            {/* Checklist */}
            {checklist.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Checklist ({checklist.length} items)</p>
                <div className="space-y-1.5">
                  {checklist.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-800/40 rounded-lg px-3 py-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.is_mandatory ? 'bg-red-400' : 'bg-slate-500'}`} />
                      <span className="text-slate-300 text-sm flex-1">{item.description}</span>
                      {item.is_mandatory && <span className="text-[10px] text-red-400">Required</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Last 5 Tickets */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent Tickets</p>
              {tickets.length === 0 ? (
                <p className="text-slate-600 text-sm italic">No tickets generated yet</p>
              ) : (
                <div className="space-y-2">
                  {tickets.map(tk => (
                    <div key={tk.id} className="flex items-center justify-between bg-slate-800/40 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-xs font-mono text-slate-400">{tk.ticket_code}</span>
                        <div className="text-slate-300 text-xs">{formatDate(tk.scheduled_date)}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                        tk.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-400' :
                        tk.status === 'IN_PROGRESS' ? 'bg-amber-500/20 text-amber-400' :
                        tk.status === 'OPEN' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-slate-700 text-slate-500'
                      }`}>{tk.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            {d.notes && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Notes</p>
                <p className="text-slate-400 text-sm">{d.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="p-6 border-t border-white/8 flex gap-2 flex-wrap">
          {d.status === 'ACTIVE' && (
            <button onClick={() => doAction('pause')} disabled={!!acting}
              className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
              {acting === 'pause' ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : '⏸'}
              Pause
            </button>
          )}
          {d.status === 'PAUSED' && (
            <button onClick={() => doAction('resume')} disabled={!!acting}
              className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
              {acting === 'resume' ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : '▶'}
              Resume
            </button>
          )}
          {d.status !== 'ARCHIVED' && (
            <button onClick={() => doAction('archive')} disabled={!!acting}
              className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg border border-red-500/20 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
              {acting === 'archive' ? <span className="w-3.5 h-3.5 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" /> : '🗑'}
              Archive
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const MAINTENANCE_TYPES = ['ALL', 'PREVENTIVE', 'INSPECTION', 'CALIBRATION', 'CLEANING', 'LUBRICATION', 'REPLACEMENT', 'TESTING'];
const STATUSES_FILTER = ['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED'];
const PRIORITIES_FILTER = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function SpmDashboardPage() {
  const [stats, setStats] = useState<SpmStats | null>(null);
  const [cycles, setCycles] = useState<SpmCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [runningScheduler, setRunningScheduler] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<SpmCycle | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const pushToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), []);

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch('/api/assets/spm/stats');
      const d = await r.json();
      setStats(d);
    } catch {
      setError('Failed to load SPM stats');
    }
  }, []);

  const fetchCycles = useCallback(async () => {
    setCyclesLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (priorityFilter !== 'ALL') params.set('priority', priorityFilter);
      if (search.trim()) params.set('search', search.trim());
      if (typeFilter !== 'ALL') params.set('maintenance_type', typeFilter);
      const r = await fetch(`/api/assets/spm/cycles?${params}`);
      const d = await r.json();
      setCycles(Array.isArray(d) ? d : []);
    } catch {
      setError('Failed to load cycles');
    } finally {
      setCyclesLoading(false);
    }
  }, [statusFilter, priorityFilter, search, typeFilter]);

  useEffect(() => {
    Promise.all([fetchStats(), fetchCycles()]).finally(() => setLoading(false));
  }, [fetchStats, fetchCycles]);

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(fetchCycles, 400);
  };

  const runScheduler = async () => {
    setRunningScheduler(true);
    try {
      const r = await fetch('/api/assets/spm/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: 'MANUAL' }),
      });
      const d = await r.json();
      pushToast(`✅ Scheduler ran — ${d.tickets_generated} ticket${d.tickets_generated !== 1 ? 's' : ''} generated in ${d.duration_ms}ms`, 'success');
      fetchStats();
      fetchCycles();
    } catch {
      pushToast('Failed to run scheduler', 'error');
    } finally {
      setRunningScheduler(false);
    }
  };

  const cycleAction = async (cycle: SpmCycle, action: 'pause' | 'resume' | 'archive', e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await fetch(`/api/assets/spm/cycles/${cycle.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error();
      pushToast(`Cycle ${action}d`, 'success');
      fetchCycles();
      fetchStats();
    } catch {
      pushToast(`Failed to ${action} cycle`, 'error');
    }
  };

  if (loading) return <Skeleton />;

  const s = stats;

  return (
    <div className="p-8 space-y-6 min-h-screen bg-slate-950">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <span>⚠️</span> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">🔧 Scheduled Preventive Maintenance</h1>
          <p className="text-slate-500 text-xs font-mono mt-1 uppercase tracking-widest">SPM_ALGORITHM_OS</p>
          {s?.last_run_at && (
            <p className="text-slate-500 text-xs mt-1">Last run: <span className="text-slate-400">{formatDateTime(s.last_run_at)}</span></p>
          )}
          {!s?.last_run_at && (
            <p className="text-slate-600 text-xs mt-1">Scheduler has never run</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={runScheduler}
            disabled={runningScheduler}
            className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 disabled:cursor-not-allowed text-black font-semibold rounded-lg text-sm transition-colors"
          >
            {runningScheduler
              ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              : '▶'}
            {runningScheduler ? 'Running…' : 'Run Scheduler Now'}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg text-sm border border-white/10 transition-colors"
          >
            ⊕ New Cycle
          </button>
          <NotificationBell />
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Cycles */}
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Total Cycles</p>
          <p className="text-3xl font-bold text-white">{s?.total_cycles ?? '—'}</p>
          <p className="text-slate-600 text-xs mt-1">{s?.paused_cycles ?? 0} paused</p>
        </div>
        {/* Active */}
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Active</p>
          <p className="text-3xl font-bold text-emerald-400">{s?.active_cycles ?? '—'}</p>
          <p className="text-slate-600 text-xs mt-1">{s?.completed_this_month ?? 0} done this month</p>
        </div>
        {/* Due in 7 Days */}
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Due in 7 Days</p>
          <p className="text-3xl font-bold text-amber-400">{s?.due_in_7_days ?? '—'}</p>
          <p className="text-slate-600 text-xs mt-1">{s?.open_tickets ?? 0} open tickets</p>
        </div>
        {/* Overdue */}
        <div className={`bg-slate-900 rounded-xl p-5 transition-all ${(s?.overdue ?? 0) > 0 ? 'border border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.15)] animate-pulse-border' : 'border border-white/8'}`}>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Overdue</p>
          <p className={`text-3xl font-bold ${(s?.overdue ?? 0) > 0 ? 'text-red-400' : 'text-slate-400'}`}>{s?.overdue ?? '—'}</p>
          <p className="text-slate-600 text-xs mt-1">{(s?.overdue ?? 0) > 0 ? 'Action required' : 'All on schedule'}</p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by name, code, or asset…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors">
          {STATUSES_FILTER.map(s => <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s}</option>)}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors">
          {PRIORITIES_FILTER.map(p => <option key={p} value={p}>{p === 'ALL' ? 'All Priorities' : p}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500/50 transition-colors">
          {MAINTENANCE_TYPES.map(t => <option key={t} value={t}>{t === 'ALL' ? 'All Types' : t}</option>)}
        </select>
      </div>

      {/* ── Cycles Table ── */}
      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h2 className="text-white font-semibold text-sm">Maintenance Cycles</h2>
          <span className="text-slate-500 text-xs">{cycles.length} cycle{cycles.length !== 1 ? 's' : ''}</span>
        </div>

        {cyclesLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-slate-700 border-t-yellow-500 rounded-full animate-spin" />
          </div>
        ) : cycles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-4xl">🔧</span>
            <p className="text-slate-400 font-medium">No maintenance cycles found</p>
            <p className="text-slate-600 text-sm">Create your first cycle to start tracking preventive maintenance</p>
            <button onClick={() => setShowAddModal(true)}
              className="mt-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold rounded-lg text-sm transition-colors">
              ⊕ New Cycle
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs uppercase tracking-wide border-b border-white/8">
                  <th className="text-left px-4 py-3 font-semibold">Cycle Code</th>
                  <th className="text-left px-4 py-3 font-semibold">Asset</th>
                  <th className="text-left px-4 py-3 font-semibold">Category</th>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-center px-4 py-3 font-semibold">Interval</th>
                  <th className="text-left px-4 py-3 font-semibold">Priority</th>
                  <th className="text-left px-4 py-3 font-semibold">Next Run</th>
                  <th className="text-center px-4 py-3 font-semibold">Days Left</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-center px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {cycles.map((cycle, idx) => (
                  <tr
                    key={cycle.id}
                    onClick={() => setSelectedCycle(cycle)}
                    className={`cursor-pointer transition-colors hover:bg-white/5 ${idx % 2 === 0 ? 'bg-slate-800/40' : 'bg-slate-900'}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{cycle.cycle_code}</td>
                    <td className="px-4 py-3">
                      <div className="text-white font-medium text-sm">{cycle.asset_name ?? '—'}</div>
                      {cycle.asset_no && <div className="text-slate-500 text-xs">{cycle.asset_no}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{cycle.category ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-700/60 text-slate-400 uppercase tracking-wide">{cycle.maintenance_type}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-400 text-xs">{cycle.interval_days}d</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${priorityBadge(cycle.priority)}`}>
                        {cycle.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDate(cycle.next_run_date)}</td>
                    <td className="px-4 py-3 text-center">{daysRemainingPill(cycle.days_remaining)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${statusBadge(cycle.status)}`}>
                        {cycle.status}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-center">
                        {/* Pause/Resume toggle */}
                        {cycle.status === 'ACTIVE' && (
                          <button
                            onClick={e => cycleAction(cycle, 'pause', e)}
                            title="Pause"
                            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-xs"
                          >⏸</button>
                        )}
                        {cycle.status === 'PAUSED' && (
                          <button
                            onClick={e => cycleAction(cycle, 'resume', e)}
                            title="Resume"
                            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-emerald-500/20 text-emerald-500 hover:text-emerald-300 transition-colors text-xs"
                          >▶</button>
                        )}
                        {/* Edit */}
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedCycle(cycle); }}
                          title="View Details"
                          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-xs"
                        >✎</button>
                        {/* Archive */}
                        {cycle.status !== 'ARCHIVED' && (
                          <button
                            onClick={e => cycleAction(cycle, 'archive', e)}
                            title="Archive"
                            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors text-xs"
                          >🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals & Drawers */}
      {showAddModal && (
        <AddCycleModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { fetchCycles(); fetchStats(); }}
          pushToast={pushToast}
        />
      )}
      {selectedCycle && (
        <CycleDetailDrawer
          cycle={selectedCycle}
          onClose={() => setSelectedCycle(null)}
          onAction={() => { fetchCycles(); fetchStats(); }}
          pushToast={pushToast}
        />
      )}
    </div>
  );
}
