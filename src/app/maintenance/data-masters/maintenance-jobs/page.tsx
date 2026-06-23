'use client';

/**
 * Maintenance Jobs Master — admin UI.
 *
 * Reads + writes /api/data-masters/maintenance-jobs. Each job row links
 * to a parent Maintenance Type (PREVENTIVE / CORRECTIVE / EMERGENCY /
 * INSPECTION). Replaces the hardcoded MAINTENANCE_JOBS_DATABASE constant
 * that previously lived in /maintenance/create.
 *
 * Layout mirrors the maintenance-types page — stats cards, search, table
 * grouped by parent type with inline expand for type sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Pencil, Trash2, Power, Save, X, AlertCircle, Wrench,
  ChevronDown, ChevronRight,
} from 'lucide-react';

interface MaintenanceType {
  id: string;
  code: string;
  name: string;
  defaultPriority: 'Low' | 'Medium' | 'High';
}

interface MaintenanceJob {
  id: string;
  maintenanceTypeId: string;
  maintenanceTypeCode?: string;
  maintenanceTypeName?: string;
  code: string;
  name: string;
  description: string | null;
  estimatedHours: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export default function MaintenanceJobsMasterPage() {
  const [jobs, setJobs]               = useState<MaintenanceJob[]>([]);
  const [types, setTypes]             = useState<MaintenanceType[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [editing, setEditing]         = useState<MaintenanceJob | { newForType: string } | null>(null);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [jobsRes, typesRes] = await Promise.all([
        fetch('/api/data-masters/maintenance-jobs'),
        fetch('/api/data-masters/maintenance-types?activeOnly=true'),
      ]);
      if (!jobsRes.ok) throw new Error(`Jobs failed (${jobsRes.status})`);
      if (!typesRes.ok) throw new Error(`Types failed (${typesRes.status})`);
      const jobsData = await jobsRes.json();
      const typesData = await typesRes.json();
      setJobs(jobsData.jobs ?? []);
      setTypes(typesData.types ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(j =>
      j.code.toLowerCase().includes(q) ||
      j.name.toLowerCase().includes(q) ||
      (j.description ?? '').toLowerCase().includes(q) ||
      (j.maintenanceTypeName ?? '').toLowerCase().includes(q),
    );
  }, [jobs, search]);

  // Group by parent type so the table reads as one section per type.
  const grouped = useMemo(() => {
    const out: Record<string, MaintenanceJob[]> = {};
    for (const j of filtered) {
      const k = j.maintenanceTypeCode ?? '_UNGROUPED';
      (out[k] ??= []).push(j);
    }
    return out;
  }, [filtered]);

  const stats = useMemo(() => ({
    total:    jobs.length,
    active:   jobs.filter(j => j.isActive).length,
    inactive: jobs.filter(j => !j.isActive).length,
    types:    new Set(jobs.map(j => j.maintenanceTypeId)).size,
  }), [jobs]);

  const toggleActive = async (row: MaintenanceJob) => {
    const res = await fetch(`/api/data-masters/maintenance-jobs/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    if (res.ok) void load();
  };

  const remove = async (row: MaintenanceJob) => {
    if (!window.confirm(`Delete "${row.name}"?\n\nIt is soft-deleted, so historical maintenance requests retain the reference.`)) return;
    const res = await fetch(`/api/data-masters/maintenance-jobs/${row.id}`, { method: 'DELETE' });
    if (res.ok) void load();
  };

  const toggleSection = (typeCode: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev);
      next.has(typeCode) ? next.delete(typeCode) : next.add(typeCode);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center">
          <Wrench className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Maintenance Jobs Master</h1>
          <p className="text-xs text-slate-400">
            Specific work items — Oil Change, Brake Pad Replacement, etc. Each job belongs to a parent Maintenance Type.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 max-w-2xl">
        <StatCard label="Total Jobs" value={stats.total}    tone="amber" />
        <StatCard label="Active"     value={stats.active}   tone="emerald" />
        <StatCard label="Inactive"   value={stats.inactive} tone="slate" />
        <StatCard label="Types"      value={stats.types}    tone="violet" />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs by code, name, type…"
            className="w-full bg-slate-900 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
        {types.length > 0 && (
          <select
            onChange={e => { if (e.target.value) setEditing({ newForType: e.target.value }); e.target.value = ''; }}
            className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg px-3 py-2 cursor-pointer focus:outline-none">
            <option value="">+ Add Job…</option>
            {types.map(t => (
              <option key={t.id} value={t.id}>Add to {t.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Sectioned table — one section per parent maintenance type */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-6 mb-2 rounded bg-slate-800/60 animate-pulse" />
            ))}
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 text-center text-slate-500 text-sm">
            No jobs found. Use the dropdown above to add the first one.
          </div>
        ) : (
          Object.entries(grouped).map(([typeCode, typeJobs]) => {
            const collapsed = collapsedTypes.has(typeCode);
            const typeName = typeJobs[0]?.maintenanceTypeName ?? typeCode;
            return (
              <div key={typeCode} className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
                <button onClick={() => toggleSection(typeCode)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/40 hover:bg-slate-800/60 text-left">
                  {collapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  <span className="text-sm font-semibold text-white">{typeName}</span>
                  <span className="text-[10px] font-mono text-slate-500">{typeCode}</span>
                  <span className="ml-auto text-xs text-slate-400 tabular-nums">{typeJobs.length} {typeJobs.length === 1 ? 'job' : 'jobs'}</span>
                </button>
                {!collapsed && (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800/30 text-slate-400 text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-2 text-left">Code</th>
                        <th className="px-4 py-2 text-left">Name</th>
                        <th className="px-4 py-2 text-left">Est. Hours</th>
                        <th className="px-4 py-2 text-left">Status</th>
                        <th className="px-4 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {typeJobs.map(row => (
                        <tr key={row.id} className="border-t border-white/5 hover:bg-white/5">
                          <td className="px-4 py-2 text-slate-300 font-mono text-xs truncate max-w-[180px]" title={row.code}>{row.code}</td>
                          <td className="px-4 py-2 text-white">{row.name}</td>
                          <td className="px-4 py-2 text-slate-300 tabular-nums text-xs">
                            {row.estimatedHours == null ? '—' : `${row.estimatedHours} h`}
                          </td>
                          <td className="px-4 py-2">
                            <button onClick={() => toggleActive(row)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                                row.isActive
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-slate-700/40 text-slate-400 border-white/10'
                              }`}>
                              <Power className="w-3 h-3" /> {row.isActive ? 'Active' : 'Inactive'}
                            </button>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button onClick={() => setEditing(row)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-amber-300 hover:bg-amber-500/10 text-xs">
                              <Pencil className="w-3 h-3" /> Edit
                            </button>
                            <button onClick={() => remove(row)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-rose-300 hover:bg-rose-500/10 text-xs ml-1">
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal
          initial={'newForType' in editing ? null : editing}
          forTypeId={'newForType' in editing ? editing.newForType : (editing as MaintenanceJob).maintenanceTypeId}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }} />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'emerald' | 'slate' | 'violet' }) {
  const cls = {
    amber:   'bg-amber-500/10  border-amber-500/30  text-amber-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    slate:   'bg-slate-700/30   border-white/10       text-slate-300',
    violet:  'bg-violet-500/10  border-violet-500/30  text-violet-300',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function EditModal({ initial, forTypeId, types, onClose, onSaved }: {
  initial: MaintenanceJob | null;
  forTypeId: string;
  types: MaintenanceType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [maintenanceTypeId, setMaintenanceTypeId] = useState<string>(initial?.maintenanceTypeId ?? forTypeId);
  const [code, setCode]                           = useState(initial?.code ?? '');
  const [name, setName]                           = useState(initial?.name ?? '');
  const [description, setDescription]             = useState(initial?.description ?? '');
  const [estimatedHours, setEstimatedHours]       = useState<string>(initial?.estimatedHours != null ? String(initial.estimatedHours) : '');
  const [sortOrder, setSortOrder]                 = useState<string>(initial != null ? String(initial.sortOrder) : '100');
  const [busy, setBusy]                           = useState(false);
  const [err, setErr]                             = useState<string | null>(null);

  const submit = async () => {
    if (!maintenanceTypeId) { setErr('Pick a parent maintenance type'); return; }
    if (!code.trim() || !name.trim()) { setErr('Code and name are required'); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        maintenanceTypeId,
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        estimatedHours: estimatedHours === '' ? null : Number(estimatedHours),
        sortOrder: sortOrder === '' ? 100 : Number(sortOrder),
      };
      const res = await fetch(
        initial ? `/api/data-masters/maintenance-jobs/${initial.id}` : '/api/data-masters/maintenance-jobs',
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
          <h2 className="text-lg font-bold text-white">{initial ? 'Edit Maintenance Job' : 'New Maintenance Job'}</h2>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3">
          <Field label="Maintenance Type" required>
            <select value={maintenanceTypeId} onChange={e => setMaintenanceTypeId(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
              <option value="">— Select a type —</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" required>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} disabled={!!initial}
                placeholder="OIL_CHANGE"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50" />
              {initial && <p className="text-[10px] text-slate-500 mt-0.5">Code is fixed once saved.</p>}
            </Field>
            <Field label="Name" required>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Oil Change"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </Field>
          </div>

          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="Notes for technicians (optional)"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Estimated Hours">
              <input type="number" min={0} step={0.5} value={estimatedHours}
                onChange={e => setEstimatedHours(e.target.value)}
                placeholder="—"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </Field>
            <Field label="Sort Order">
              <input type="number" value={sortOrder}
                onChange={e => setSortOrder(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </Field>
          </div>

          {err && <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2"><AlertCircle className="w-3 h-3" /> {err}</div>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
          <button onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50">
            <Save className="w-4 h-4" /> {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="px-3 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {label}{required && <span className="text-rose-400">*</span>}
      </label>
      {children}
    </div>
  );
}
