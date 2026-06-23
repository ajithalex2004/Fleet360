'use client';

/**
 * Attachment Type Master — admin UI.
 *
 * Replaces the previous mock-only page (which initialised from the
 * AttachmentType enum and lost data on refresh). Now reads + writes
 * /api/data-masters/attachment-types so types persist per tenant.
 *
 * Each row defines a category of attachment that the maintenance ticket
 * form's multi-attachment widget shows in its Type dropdown. Optional
 * filters:
 *   • appliesTo[]  — restrict the type to certain ticket types (empty = all)
 *   • required     — mark required so the form warns when missing
 *   • allowedMime[]— MIME whitelist (empty = any)
 *   • maxSizeMb    — soft size cap shown in the UI
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Pencil, Trash2, Power, Save, X, AlertCircle, Paperclip,
} from 'lucide-react';

interface AttachmentType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  appliesTo: string[];
  required: boolean;
  maxFileSizeMb: number | null;
  allowedMimeTypes: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const TICKET_TYPES = [
  'MAINTENANCE', 'RENEWAL', 'CLEANING', 'SUPPORT', 'INCIDENT', 'TOWING', 'COMPLAINT',
] as const;

export default function AttachmentTypeMasterPage() {
  const [rows, setRows]       = useState<AttachmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [editing, setEditing] = useState<AttachmentType | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/data-masters/attachment-types');
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
    required: rows.filter(r => r.required).length,
  }), [rows]);

  const toggleActive = async (row: AttachmentType) => {
    const res = await fetch(`/api/data-masters/attachment-types/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    if (res.ok) void load();
  };

  const remove = async (row: AttachmentType) => {
    if (!window.confirm(`Delete "${row.name}"?\n\nIt is soft-deleted, so historical attachments retain the reference.`)) return;
    const res = await fetch(`/api/data-masters/attachment-types/${row.id}`, { method: 'DELETE' });
    if (res.ok) void load();
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-300 flex items-center justify-center">
          <Paperclip className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Attachment Type Master</h1>
          <p className="text-xs text-slate-400">
            Categories shown in the Type dropdown of the multi-attachment widget on ticket forms.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 max-w-md">
        <StatCard label="Total"    value={stats.total}    tone="blue" />
        <StatCard label="Active"   value={stats.active}   tone="emerald" />
        <StatCard label="Required" value={stats.required} tone="rose" />
      </div>

      {/* Search + add */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by code, name, description…"
            className="w-full bg-slate-900 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
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
              <th className="px-4 py-2.5 text-left">Applies To</th>
              <th className="px-4 py-2.5 text-left">Required</th>
              <th className="px-4 py-2.5 text-left">Max Size</th>
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
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No attachment types yet — add the first one.</td></tr>
            ) : (
              filtered.map(row => (
                <tr key={row.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">{row.code}</td>
                  <td className="px-4 py-2.5 text-white">{row.name}</td>
                  <td className="px-4 py-2.5">
                    {row.appliesTo.length === 0 ? (
                      <span className="text-[11px] text-slate-500 italic">All ticket types</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.appliesTo.slice(0, 3).map(t => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono">
                            {t}
                          </span>
                        ))}
                        {row.appliesTo.length > 3 && (
                          <span className="text-[10px] text-slate-500">+{row.appliesTo.length - 3}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.required ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        Required
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs">Optional</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-300 tabular-nums text-xs">
                    {row.maxFileSizeMb == null ? '—' : `${row.maxFileSizeMb} MB`}
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

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'emerald' | 'rose' }) {
  const cls = {
    blue:    'bg-blue-500/10    border-blue-500/30    text-blue-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    rose:    'bg-rose-500/10    border-rose-500/30    text-rose-300',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function EditModal({ initial, onClose, onSaved }: {
  initial: AttachmentType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode]                     = useState(initial?.code ?? '');
  const [name, setName]                     = useState(initial?.name ?? '');
  const [description, setDescription]       = useState(initial?.description ?? '');
  const [appliesTo, setAppliesTo]           = useState<string[]>(initial?.appliesTo ?? []);
  const [required, setRequired]             = useState<boolean>(initial?.required ?? false);
  const [maxFileSizeMb, setMaxFileSizeMb]   = useState<string>(initial?.maxFileSizeMb != null ? String(initial.maxFileSizeMb) : '10');
  const [allowedMime, setAllowedMime]       = useState<string>((initial?.allowedMimeTypes ?? []).join(', '));
  const [sortOrder, setSortOrder]           = useState<string>(initial != null ? String(initial.sortOrder) : '100');
  const [busy, setBusy]                     = useState(false);
  const [err, setErr]                       = useState<string | null>(null);

  const toggleApplies = (t: string) => {
    setAppliesTo(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const submit = async () => {
    if (!code.trim() || !name.trim()) { setErr('Code and name are required'); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        appliesTo,
        required,
        maxFileSizeMb: maxFileSizeMb === '' ? null : Number(maxFileSizeMb),
        allowedMimeTypes: allowedMime.split(',').map(s => s.trim()).filter(Boolean),
        sortOrder: sortOrder === '' ? 100 : Number(sortOrder),
      };
      const res = await fetch(
        initial ? `/api/data-masters/attachment-types/${initial.id}` : '/api/data-masters/attachment-types',
        { method: initial ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Save failed'); return; }
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">{initial ? 'Edit Attachment Type' : 'New Attachment Type'}</h2>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" required>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} disabled={!!initial}
                placeholder="INVOICE"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
              {initial && <p className="text-[10px] text-slate-500 mt-0.5">Code is fixed once saved.</p>}
            </Field>
            <Field label="Name" required>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Invoice"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
          </div>

          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="What this category is used for"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>

          <Field label="Applies To" hint="Leave empty to allow on every ticket type.">
            <div className="flex flex-wrap gap-1.5">
              {TICKET_TYPES.map(t => {
                const active = appliesTo.includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleApplies(t)}
                    className={`px-2.5 py-1 rounded-md text-[11px] border ${
                      active
                        ? 'bg-blue-500/20 text-blue-200 border-blue-500/40'
                        : 'bg-slate-800/60 text-slate-400 border-white/10'
                    }`}>
                    {t}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Required">
              <button type="button" onClick={() => setRequired(v => !v)}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${
                  required
                    ? 'bg-rose-500/15 text-rose-200 border-rose-500/40'
                    : 'bg-slate-800 text-slate-400 border-white/10'
                }`}>
                {required ? 'Required' : 'Optional'}
              </button>
            </Field>
            <Field label="Max Size (MB)">
              <input type="number" min={0} value={maxFileSizeMb}
                onChange={e => setMaxFileSizeMb(e.target.value)}
                placeholder="10"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Sort Order">
              <input type="number" value={sortOrder}
                onChange={e => setSortOrder(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
          </div>

          <Field label="Allowed MIME Types" hint="Comma-separated. Leave empty to accept any. Wildcards OK (e.g. image/*).">
            <input value={allowedMime} onChange={e => setAllowedMime(e.target.value)}
              placeholder="application/pdf, image/*"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>

          {err && <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2"><AlertCircle className="w-3 h-3" /> {err}</div>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
          <button onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">
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
