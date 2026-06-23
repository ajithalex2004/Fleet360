'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
type IncStatus   = 'REPORTED' | 'OPEN' | 'UNDER_INVESTIGATION' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
type IncSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type IncType     = 'ACCIDENT' | 'BREAKDOWN' | 'DELAY' | 'MEDICAL' | 'PASSENGER_COMPLAINT' | 'OTHER';

interface Note { id: string; note_type: string; content: string; author: string | null; created_at: string }
interface Incident {
  id: string; incident_no: string | null; incident_type: IncType; severity: IncSeverity;
  status: IncStatus; description: string | null; location: string | null;
  incident_date: string; created_at: string; updated_at: string;
  resolved_at?: string | null; escalated_at?: string | null;
  investigation_started_at?: string | null;
  vehicle_plate?: string | null; driver_name?: string | null;
  assigned_to?: string | null; escalation_level?: string | null;
  resolution_notes?: string | null;
  notes?: Note[];
}

// ── Config ────────────────────────────────────────────────────────────────────
const SEVERITY_CFG: Record<IncSeverity, { label: string; color: string; bg: string; border: string; icon: string }> = {
  CRITICAL: { label: 'Critical', icon: '🔴', color: 'text-red-300',    bg: 'bg-red-500/20',    border: 'border-red-500/40'    },
  HIGH:     { label: 'High',     icon: '🟠', color: 'text-orange-300', bg: 'bg-orange-500/20', border: 'border-orange-500/30' },
  MEDIUM:   { label: 'Medium',   icon: '🟡', color: 'text-amber-300',  bg: 'bg-amber-500/20',  border: 'border-amber-500/30'  },
  LOW:      { label: 'Low',      icon: '🟢', color: 'text-slate-300',  bg: 'bg-slate-500/20',  border: 'border-slate-500/30'  },
};

const STATUS_CFG: Record<IncStatus, { label: string; icon: string; color: string; bg: string; border: string; next: string | null }> = {
  REPORTED:             { label: 'Reported',             icon: '📢', color: 'text-sky-300',     bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     next: 'UNDER_INVESTIGATION' },
  OPEN:                 { label: 'Open',                 icon: '🔓', color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     next: 'UNDER_INVESTIGATION' },
  UNDER_INVESTIGATION:  { label: 'Investigating',        icon: '🔍', color: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   next: 'RESOLVED'             },
  IN_PROGRESS:          { label: 'In Progress',          icon: '⚙️', color: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   next: 'RESOLVED'             },
  ESCALATED:            { label: 'Escalated',            icon: '🚨', color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     next: 'RESOLVED'             },
  RESOLVED:             { label: 'Resolved',             icon: '✅', color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', next: 'CLOSED'               },
  CLOSED:               { label: 'Closed',               icon: '🔒', color: 'text-slate-300',   bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   next: null                   },
};

const TYPE_ICON: Record<string, string> = {
  ACCIDENT: '💥', BREAKDOWN: '🔧', DELAY: '⏱️', MEDICAL: '🚑', PASSENGER_COMPLAINT: '📢', OTHER: '⚠️',
};
const INCIDENT_TYPES: IncType[] = ['ACCIDENT', 'BREAKDOWN', 'DELAY', 'MEDICAL', 'PASSENGER_COMPLAINT', 'OTHER'];
const SEVERITIES: IncSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// ── Report Modal ──────────────────────────────────────────────────────────────
function ReportModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    incidentType: 'ACCIDENT' as IncType, severity: 'MEDIUM' as IncSeverity,
    description: '', location: '',
    incidentDate: new Date().toISOString().slice(0, 10),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) onCreated(); else { const d = await res.json(); setErr(d.error ?? 'Failed'); }
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-white font-semibold">🚨 Report Incident</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">✕</button>
        </div>
        <form onSubmit={save} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Type</label>
              <select value={form.incidentType} onChange={set('incidentType')}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500/40">
                {INCIDENT_TYPES.map(t => <option key={t} value={t}>{TYPE_ICON[t]} {t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Severity</label>
              <select value={form.severity} onChange={set('severity')}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                {SEVERITIES.map(s => <option key={s} value={s}>{SEVERITY_CFG[s].icon} {s}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Location</label>
            <input value={form.location} onChange={set('location')} placeholder="Where did it occur?"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Description *</label>
            <textarea value={form.description} onChange={set('description')} required rows={3}
              placeholder="Describe the incident in detail…"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40 resize-none" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Incident Date</label>
            <input type="date" value={form.incidentDate} onChange={set('incidentDate')}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
          </div>
          {err && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-400 px-4 py-2 rounded-lg border border-white/10 hover:text-white transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="text-sm font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg transition-colors">
              {saving ? 'Reporting…' : '🚨 Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Incident Detail Drawer ────────────────────────────────────────────────────
function IncidentDrawer({ incident, onClose, onUpdated }: { incident: Incident; onClose: () => void; onUpdated: () => void }) {
  const [detail,    setDetail]    = useState<Incident | null>(null);
  const [loadingD,  setLoadingD]  = useState(true);
  const [note,      setNote]      = useState('');
  const [noteType,  setNoteType]  = useState<'INVESTIGATION' | 'ESCALATION' | 'UPDATE' | 'RESOLUTION'>('INVESTIGATION');
  const [author,    setAuthor]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateTo, setEscalateTo]     = useState('');
  const [resolveNote, setResolveNote]   = useState('');
  const [resolveBy,   setResolveBy]     = useState('');
  const [showResolve, setShowResolve]   = useState(false);

  const load = useCallback(async () => {
    setLoadingD(true);
    try {
      const res = await fetch(`/api/incidents/${incident.id}`);
      if (res.ok) setDetail(await res.json());
    } catch { /* silent */ }
    finally { setLoadingD(false); }
  }, [incident.id]);

  useEffect(() => { load(); }, [load]);

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/incidents/${incident.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteType, content: note, author: author || 'Officer' }),
      });
      setNote('');
      load(); onUpdated();
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  async function transition(status: IncStatus, extra?: Record<string, string>) {
    setAdvancing(true);
    try {
      await fetch(`/api/incidents/${incident.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'transition', status, ...extra }),
      });
      load(); onUpdated();
    } catch { /* silent */ }
    finally { setAdvancing(false); }
  }

  const inc = detail ?? incident;
  const stCfg = STATUS_CFG[inc.status] ?? STATUS_CFG.OPEN;
  const svCfg = SEVERITY_CFG[inc.severity] ?? SEVERITY_CFG.MEDIUM;

  const NOTE_TYPE_COLORS: Record<string, string> = {
    INVESTIGATION: 'text-amber-400', ESCALATION: 'text-red-400', UPDATE: 'text-blue-400', RESOLUTION: 'text-emerald-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-slate-900 border-l border-white/10 overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{TYPE_ICON[inc.incident_type] ?? '⚠️'}</span>
                <p className="text-white font-bold">{inc.incident_no ?? inc.id.slice(0, 8)}</p>
              </div>
              <div className="flex gap-2 mt-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${stCfg.bg} ${stCfg.color} ${stCfg.border}`}>
                  {stCfg.icon} {stCfg.label}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${svCfg.bg} ${svCfg.color} ${svCfg.border}`}>
                  {svCfg.icon} {svCfg.label}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl flex-shrink-0">✕</button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Details */}
          <div className="space-y-2 text-sm">
            {inc.description && <p className="text-slate-300 bg-slate-800/60 rounded-xl p-3 text-sm">{inc.description}</p>}
            {[
              ['📍 Location',  inc.location],
              ['📅 Date',      inc.incident_date ? new Date(inc.incident_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null],
              ['🚗 Vehicle',   (inc as unknown as Record<string, unknown>).vehicle_plate as string | null],
              ['👤 Driver',    (inc as unknown as Record<string, unknown>).driver_name as string | null],
              ['🧑 Assigned',  inc.assigned_to],
            ].map(([label, val]) => val ? (
              <div key={label as string} className="flex gap-3 text-xs">
                <span className="text-slate-500 flex-shrink-0 w-24">{label}</span>
                <span className="text-slate-200">{val}</span>
              </div>
            ) : null)}
          </div>

          {/* Workflow Actions */}
          {String(inc.status) !== 'CLOSED' && (
            <div>
              <p className="text-xs text-red-400 uppercase tracking-wider font-semibold mb-2">Actions</p>
              <div className="flex flex-wrap gap-2">
                {inc.status === 'REPORTED' || inc.status === 'OPEN' ? (
                  <button disabled={advancing} onClick={() => transition('UNDER_INVESTIGATION')}
                    className="text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-2 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50">
                    🔍 Start Investigation
                  </button>
                ) : null}
                {(inc.status === 'UNDER_INVESTIGATION' || inc.status === 'IN_PROGRESS') ? (
                  <button disabled={advancing} onClick={() => setShowEscalate(true)}
                    className="text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30 px-3 py-2 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50">
                    🚨 Escalate
                  </button>
                ) : null}
                {inc.status !== 'RESOLVED' && String(inc.status) !== 'CLOSED' ? (
                  <button disabled={advancing} onClick={() => setShowResolve(true)}
                    className="text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-2 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50">
                    ✅ Resolve
                  </button>
                ) : null}
                {inc.status === 'RESOLVED' ? (
                  <button disabled={advancing} onClick={() => transition('CLOSED')}
                    className="text-xs font-semibold bg-slate-700 text-slate-300 border border-white/10 px-3 py-2 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50">
                    🔒 Close
                  </button>
                ) : null}
              </div>

              {/* Escalate form */}
              {showEscalate && (
                <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-red-300 font-semibold">Escalate to</p>
                  <input value={escalateTo} onChange={e => setEscalateTo(e.target.value)} placeholder="e.g. Fleet Manager, Safety Officer…"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none" />
                  <div className="flex gap-2">
                    <button onClick={() => setShowEscalate(false)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 transition-colors">Cancel</button>
                    <button disabled={advancing || !escalateTo.trim()} onClick={() => { transition('ESCALATED', { escalationLevel: escalateTo, assignedTo: escalateTo }); setShowEscalate(false); }}
                      className="text-xs font-semibold bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                      {advancing ? '…' : 'Escalate'}
                    </button>
                  </div>
                </div>
              )}

              {/* Resolve form */}
              {showResolve && (
                <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-emerald-300 font-semibold">Resolution Details</p>
                  <textarea value={resolveNote} onChange={e => setResolveNote(e.target.value)} rows={2}
                    placeholder="How was this resolved?"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none resize-none" />
                  <input value={resolveBy} onChange={e => setResolveBy(e.target.value)} placeholder="Resolved by (name)"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none" />
                  <div className="flex gap-2">
                    <button onClick={() => setShowResolve(false)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 transition-colors">Cancel</button>
                    <button disabled={advancing} onClick={() => { transition('RESOLVED', { resolutionNotes: resolveNote, resolvedBy: resolveBy }); setShowResolve(false); }}
                      className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                      {advancing ? '…' : '✅ Resolve'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timeline / Notes */}
          <div>
            <p className="text-xs text-red-400 uppercase tracking-wider font-semibold mb-3">Investigation Notes</p>
            {loadingD ? (
              <div className="animate-pulse space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-800 rounded-lg" />)}</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(!detail?.notes || detail.notes.length === 0) ? (
                  <p className="text-xs text-slate-600 text-center py-4">No notes yet — add the first investigation note below.</p>
                ) : detail.notes.map(n => (
                  <div key={n.id} className="bg-slate-800/60 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold uppercase ${NOTE_TYPE_COLORS[n.note_type] ?? 'text-slate-400'}`}>{n.note_type}</span>
                      <span className="text-slate-600 text-[10px]">{n.author}</span>
                      <span className="text-slate-700 text-[10px] ml-auto">{new Date(n.created_at).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                    <p className="text-xs text-slate-300">{n.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Add note */}
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                {(['INVESTIGATION', 'ESCALATION', 'UPDATE', 'RESOLUTION'] as const).map(t => (
                  <button key={t} onClick={() => setNoteType(t)}
                    className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
                      noteType === t ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-slate-800 text-slate-500 border-white/10'
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                placeholder="Add investigation note…"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none resize-none" />
              <div className="flex gap-2">
                <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Your name"
                  className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none" />
                <button onClick={addNote} disabled={saving || !note.trim()}
                  className="text-xs font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors">
                  {saving ? '…' : '+ Note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ActiveIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [typeFilter, setTypeFilter] = useState<IncType | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<IncStatus | 'ACTIVE' | 'ALL'>('ACTIVE');
  const [sevFilter, setSevFilter]   = useState<IncSeverity | 'ALL'>('ALL');
  const [showNew,   setShowNew]   = useState(false);
  const [selected,  setSelected]  = useState<Incident | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/incidents', { cache: 'no-store' });
      if (res.ok) { const d = await res.json(); setIncidents(d.incidents ?? []); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSearch(v: string) {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(load, 500);
  }

  const ACTIVE_STATUSES: IncStatus[] = ['REPORTED', 'OPEN', 'UNDER_INVESTIGATION', 'IN_PROGRESS', 'ESCALATED'];

  const filtered = incidents.filter(i => {
    const matchType   = typeFilter === 'ALL' || i.incident_type === typeFilter;
    const matchStatus = statusFilter === 'ALL'
      ? true
      : statusFilter === 'ACTIVE'
        ? ACTIVE_STATUSES.includes(i.status)
        : i.status === statusFilter;
    const matchSev    = sevFilter === 'ALL' || i.severity === sevFilter;
    const matchSearch = !search || [i.incident_no, i.description, i.location]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()));
    return matchType && matchStatus && matchSev && matchSearch;
  });

  const statCounts = {
    active:       incidents.filter(i => ACTIVE_STATUSES.includes(i.status)).length,
    escalated:    incidents.filter(i => i.status === 'ESCALATED').length,
    investigating:incidents.filter(i => i.status === 'UNDER_INVESTIGATION').length,
    resolved:     incidents.filter(i => i.status === 'RESOLVED').length,
    critical:     incidents.filter(i => i.severity === 'CRITICAL').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Incident Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">Full workflow: Report → Investigate → Escalate → Resolve → Close</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-slate-400 border border-white/10 px-3 py-2 rounded-xl hover:border-white/20 hover:text-white transition-colors">↺</button>
          <button onClick={() => setShowNew(true)}
            className="text-sm font-semibold bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl transition-colors">
            🚨 Report Incident
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Active',       value: statCounts.active,       color: 'text-red-400',     icon: '🔴' },
          { label: 'Escalated',    value: statCounts.escalated,    color: 'text-red-400',     icon: '🚨' },
          { label: 'Investigating',value: statCounts.investigating, color: 'text-amber-400',   icon: '🔍' },
          { label: 'Resolved',     value: statCounts.resolved,     color: 'text-emerald-400', icon: '✅' },
          { label: 'Critical',     value: statCounts.critical,     color: 'text-red-300',     icon: '🔴' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 text-center">
            <p className="text-xs text-slate-500">{s.icon} {s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Critical / Escalated alert banner */}
      {(statCounts.critical > 0 || statCounts.escalated > 0) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-5 py-3 flex items-center gap-3">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-red-300 text-sm font-medium">
            {statCounts.escalated > 0 ? `${statCounts.escalated} escalated incident${statCounts.escalated > 1 ? 's' : ''} require immediate attention.` : ''}
            {statCounts.critical > 0 ? ` ${statCounts.critical} critical severity incident${statCounts.critical > 1 ? 's' : ''} active.` : ''}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input type="text" placeholder="Search by number, description, location…"
          value={search} onChange={e => handleSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40" />

        {/* Status filter */}
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl overflow-hidden p-1">
          {(['ACTIVE', 'ALL', 'RESOLVED', 'CLOSED'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
                statusFilter === s ? 'bg-red-500/20 text-red-300' : 'text-slate-400 hover:text-white'
              }`}>{s}</button>
          ))}
        </div>

        <select value={sevFilter} onChange={e => setSevFilter(e.target.value as IncSeverity | 'ALL')}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
          <option value="ALL">All Severity</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{SEVERITY_CFG[s].icon} {s}</option>)}
        </select>

        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as IncType | 'ALL')}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
          <option value="ALL">All Types</option>
          {INCIDENT_TYPES.map(t => <option key={t} value={t}>{TYPE_ICON[t]} {t.replace('_', ' ')}</option>)}
        </select>
      </div>

      {/* Incident table */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-sm text-slate-300 font-medium">{filtered.length} incident{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="animate-pulse p-4 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-5xl mb-3">🚨</div>
            <p className="text-slate-400 text-sm">No incidents found</p>
            <button onClick={() => setShowNew(true)} className="mt-4 text-sm font-semibold bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl transition-colors">Report First Incident</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Incident</th>
                  <th className="text-left px-3 py-3">Type</th>
                  <th className="text-left px-3 py-3">Severity</th>
                  <th className="text-left px-3 py-3">Status</th>
                  <th className="text-left px-3 py-3">Location</th>
                  <th className="text-left px-3 py-3">Date</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(inc => {
                  const stCfg = STATUS_CFG[inc.status] ?? STATUS_CFG.OPEN;
                  const svCfg = SEVERITY_CFG[inc.severity] ?? SEVERITY_CFG.MEDIUM;
                  return (
                    <tr key={inc.id} className="hover:bg-white/5 transition-colors cursor-pointer"
                      onClick={() => setSelected(inc)}>
                      <td className="px-5 py-3">
                        <p className="text-white font-medium text-xs font-mono">{inc.incident_no ?? inc.id.slice(0, 8)}</p>
                        {inc.description && <p className="text-slate-500 text-xs mt-0.5 truncate max-w-[200px]">{inc.description}</p>}
                      </td>
                      <td className="px-3 py-3 text-slate-300 text-xs">
                        {TYPE_ICON[inc.incident_type] ?? '⚠️'} {inc.incident_type.replace('_', ' ')}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${svCfg.bg} ${svCfg.color} ${svCfg.border}`}>
                          {svCfg.icon} {svCfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${stCfg.bg} ${stCfg.color} ${stCfg.border}`}>
                          {stCfg.icon} {stCfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-400 text-xs max-w-[160px] truncate">{inc.location ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-400 text-xs">
                        {new Date(inc.incident_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </td>
                      <td className="px-3 py-3 text-xs" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setSelected(inc)}
                          className="text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-white/5 transition-colors">→</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <ReportModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      {selected && <IncidentDrawer incident={selected} onClose={() => setSelected(null)} onUpdated={load} />}
    </div>
  );
}
