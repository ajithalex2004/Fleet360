'use client';

/**
 * Maintenance Type Master — admin UI for managing maintenance sub-types.
 *
 * Reads + writes /api/data-masters/maintenance-types. Each row carries a
 * default priority, optional estimated hours, and optional default
 * assignee — the maintenance ticket creation form uses these to pre-fill
 * fields after the user picks a type.
 *
 * Mirrors the layout of the existing data-masters/attachment-types page so
 * the section feels consistent.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Pencil, Trash2, Power, Save, X, AlertCircle, Wrench,
} from 'lucide-react';

interface MaintenanceType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultPriority: 'Low' | 'Medium' | 'High';
  estimatedHours: number | null;
  defaultAssignee: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const PRIORITIES: MaintenanceType['defaultPriority'][] = ['Low', 'Medium', 'High'];

const PRIO_TONE: Record<MaintenanceType['defaultPriority'], string> = {
  Low:    'bg-slate-700/40 text-slate-300 border-white/10',
  Medium: 'bg-blue-500/15  text-blue-300  border-blue-500/30',
  High:   'bg-rose-500/15  text-rose-300  border-rose-500/30',
};

export default function MaintenanceTypeMasterPage() {
  const [rows, setRows]       = useState<MaintenanceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [editing, setEditing] = useState<MaintenanceType | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/data-masters/maintenance-types');
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setRows(data.types ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.code.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const stats = useMemo(() => ({
    total:    rows.length,
    active:   rows.filter(r => r.isActive).length,
    inactive: rows.filter(r => !r.isActive).length,
  }), [rows]);

  const toggleActive = async (row: MaintenanceType) => {
    const res = await fetch(`/api/data-masters/maintenance-types/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    if (res.ok) void load();
  };

  const remove = async (row: MaintenanceType) => {
    if (!window.confirm(`Delete "${row.name}"?\n\nIt is soft-deleted, so historical tickets retain the reference.`)) return;
    const res = await fetch(`/api/data-masters/maintenance-types/${row.id}`, { method: 'DELETE' });
    if (res.ok) void load();
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center">
          <Wrench className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Maintenance Type Master</h1>
          <p className="text-xs text-slate-400">
            Sub-categories of maintenance work shown as a dropdown when creating maintenance tickets.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 max-w-md">
        <StatCard label="Total"    value={stats.total}    tone="violet" />
        <StatCard label="Active"   value={stats.active}   tone="emerald" />
        <StatCard label="Inactive" value={stats.inactive} tone="slate" />
      </div>

      {/* Search + add */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by code, name, description…"
            className="w-full bg-slate-900 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
        <button onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" /> Add Type
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60 text-slate-400 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5 text-left">Code</th>
              <th className="px-4 py-2.5 text-left">Name</th>
              <th className="px-4 py-2.5 text-left">Default Priority</th>
              <th className="px-4 py-2.5 text-left">Est. Hours</th>
              <th className="px-4 py-2.5 text-left">Default Assignee</th>
              <th className="px-4 py-2.5 text-left">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td colSpan={7} className="px-4 py-3"><div className="h-4 rounded bg-slate-800/60 animate-pulse" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No maintenance types yet — add the first one.</td></tr>
            ) : (
              filtered.map(row => (
                <tr key={row.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">{row.code}</td>
                  <td className="px-4 py-2.5 text-white">{row.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PRIO_TONE[row.defaultPriority]}`}>
                      {row.defaultPriority}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300 tabular-nums text-xs">
                    {row.estimatedHours == null ? '—' : `${row.estimatedHours} h`}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs font-mono truncate max-w-[160px]">
                    {row.defaultAssignee ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => toggleActive(row)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        row.isActive
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-700/40 text-slate-400 border-white/10'
                      }`}>
                      <Power className="w-3 h-3" /> {row.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setEditing(row)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-amber-300 hover:bg-amber-500/10 text-xs">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => remove(row)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-rose-300 hover:bg-rose-500/10 text-xs ml-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }} />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'violet' | 'emerald' | 'slate' }) {
  const cls = {
    violet:  'bg-violet-500/10  border-violet-500/30  text-violet-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    slate:   'bg-slate-700/30   border-white/10       text-slate-300',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function EditModal({ initial, onClose, onSaved }: {
  initial: MaintenanceType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode]                         = useState(initial?.code ?? '');
  const [name, setName]                         = useState(initial?.name ?? '');
  const [description, setDescription]           = useState(initial?.description ?? '');
  const [defaultPriority, setDefaultPriority]   = useState<MaintenanceType['defaultPriority']>(initial?.defaultPriority ?? 'Medium');
  const [estimatedHours, setEstimatedHours]     = useState<string>(initial?.estimatedHours != null ? String(initial.estimatedHours) : '');
  const [defaultAssignee, setDefaultAssignee]   = useState<string>(initial?.defaultAssignee ?? '');
  const [sortOrder, setSortOrder]               = useState<string>(initial != null ? String(initial.sortOrder) : '100');
  const [busy, setBusy]                         = useState(false);
  const [err, setErr]                           = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      setErr('Code and name are required');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        defaultPriority,
        estimatedHours: estimatedHours === '' ? null : Number(estimatedHours),
        defaultAssignee: defaultAssignee.trim() || null,
        sortOrder: sortOrder === '' ? 100 : Number(sortOrder),
      };
      const res = await fetch(
        initial ? `/api/data-masters/maintenance-types/${initial.id}` : '/api/data-masters/maintenance-types',
        { method: initial ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Save failed'); return; }
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">{initial ? 'Edit Maintenance Type' : 'New Maintenance Type'}</h2>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" required>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} disabled={!!initial}
                placeholder="ENGINE_REPAIR"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50" />
              {initial && <p className="text-[10px] text-slate-500 mt-0.5">Code is fixed once saved — change name instead.</p>}
            </Field>
            <Field label="Name" required>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Engine Repair"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </Field>
          </div>

          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="What kind of work this covers"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Default Priority">
              <select value={defaultPriority} onChange={e => setDefaultPriority(e.target.value as MaintenanceType['defaultPriority'])}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Estimated Hours">
              <input type="number" min={0} step={0.5} value={estimatedHours}
                onChange={e => setEstimatedHours(e.target.value)}
                placeholder="—"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </Field>
            <Field label="Sort Order">
              <input type="number" value={sortOrder}
                onChange={e => setSortOrder(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </Field>
          </div>

          <Field label="Default Assignee" hint="Optional. Use email, role:CODE, or email:a@b,c@d (matches the SLA NotifyPicker encoding).">
            <input value={defaultAssignee} onChange={e => setDefaultAssignee(e.target.value)}
              placeholder="role:FLEET_MANAGER"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </Field>

          {err && <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2"><AlertCircle className="w-3 h-3" /> {err}</div>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
          <button onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50">
            <Save className="w-4 h-4" /> {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="px-3 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, hint, required }: { label: string; children: React.ReactNode; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {label}{required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
