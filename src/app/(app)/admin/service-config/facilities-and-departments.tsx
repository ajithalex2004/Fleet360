'use client';

/**
 * Two admin panels on /admin/service-config:
 *   • FacilitiesTemplateCard — installs the Facilities Management catalogue
 *   • DepartmentsPanel       — rename / hide / add triage & forwarding departments
 */

import { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, Loader2, Plus, Users, Eye, EyeOff, Save, X } from 'lucide-react';

const card = 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4';
const input = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50';

export function FacilitiesTemplateCard({ onInstalled }: { onInstalled: () => void }) {
  const [status, setStatus] = useState<{ installed: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/service-config/templates/facilities');
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) setStatus({ installed: data.installed, total: data.total });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const install = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/service-config/templates/facilities', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Install failed');
      setMsg({ ok: true, text: data.typesAdded > 0 ? `Added ${data.typesAdded} Facilities request types.` : 'Already installed — nothing changed.' });
      await load();
      onInstalled();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Install failed' });
    } finally {
      setBusy(false);
    }
  };

  const complete = status && status.installed >= status.total;
  return (
    <section className={card} aria-labelledby="fm-template-title">
      <div className="flex items-start gap-3">
        <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300"><Building2 className="w-5 h-5" /></span>
        <div className="flex-1 min-w-0">
          <h2 id="fm-template-title" className="text-sm font-semibold text-[var(--text-main)]">Facilities Management catalogue</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Adds 16 request types in 4 categories: hard services (HVAC, electrical, plumbing, lifts, fire safety, fabric),
            soft services, workplace and security &amp; safety. Each has location fields, an SLA per priority and a
            ticket prefix, plus 4 FM departments. Existing settings are never overwritten.
          </p>
          {status && (
            <p className="text-xs mt-2 text-[var(--text-muted)]">
              {complete
                ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" /> Installed ({status.total} types)</span>
                : `${status.installed} of ${status.total} types installed`}
            </p>
          )}
          {msg && <p role="status" className={`text-xs mt-2 ${msg.ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{msg.text}</p>}
        </div>
        <button type="button" onClick={install} disabled={busy || !!complete}
          className={`${btn} bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-700 dark:text-amber-200 shrink-0`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {complete ? 'Installed' : 'Install'}
        </button>
      </div>
    </section>
  );
}

interface Dept {
  key: string; label: string; shortLabel: string; description: string;
  tone: string; isSystem: boolean; isActive: boolean; sortOrder: number;
}

const TONES = ['slate', 'amber', 'rose', 'emerald', 'blue', 'violet', 'cyan', 'gold'];
const TONE_DOT: Record<string, string> = {
  slate: 'bg-slate-400', amber: 'bg-amber-500', rose: 'bg-rose-500', emerald: 'bg-emerald-500',
  blue: 'bg-blue-500', violet: 'bg-violet-500', cyan: 'bg-cyan-500', gold: 'bg-yellow-500',
};

export function DepartmentsPanel() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [editing, setEditing] = useState<Dept | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/service-config/departments');
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) setDepts(data.departments);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (d: Dept) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/service-config/departments', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Save failed');
      setDepts(data.departments);
      setEditing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    setIsNew(true); setErr(null);
    setEditing({ key: '', label: '', shortLabel: '', description: '', tone: 'slate', isSystem: false, isActive: true, sortOrder: 100 });
  };

  return (
    <section className={card} aria-labelledby="dept-title">
      <div className="flex items-center gap-3 mb-3">
        <span className="p-2 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300"><Users className="w-5 h-5" /></span>
        <div className="flex-1">
          <h2 id="dept-title" className="text-sm font-semibold text-[var(--text-main)]">Departments</h2>
          <p className="text-xs text-[var(--text-muted)]">Teams tickets are forwarded to from triage. Rename, hide or add your own.</p>
        </div>
        <button type="button" onClick={startNew} className={`${btn} bg-violet-600/15 hover:bg-violet-600/25 border border-violet-500/40 text-violet-700 dark:text-violet-200`}>
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      <ul className="divide-y divide-[var(--border-subtle)] max-h-64 overflow-y-auto">
        {depts.map((d) => (
          <li key={d.key} className="flex items-center gap-2 py-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${TONE_DOT[d.tone] ?? 'bg-slate-400'}`} aria-hidden="true" />
            <span className={`flex-1 truncate ${d.isActive ? 'text-[var(--text-main)]' : 'text-[var(--text-faint)] line-through'}`}>{d.label}</span>
            <code className="text-[10px] text-[var(--text-faint)]">{d.key}</code>
            {d.isSystem && <span className="text-[9px] uppercase tracking-wider text-[var(--text-faint)]">sys</span>}
            <button type="button" onClick={() => { setIsNew(false); setErr(null); setEditing(d); }}
              className="text-xs text-violet-600 dark:text-violet-300 hover:underline">Edit</button>
            {d.key !== 'OPERATIONS_TRIAGE' && (
              <button type="button" onClick={() => save({ ...d, isActive: !d.isActive })} disabled={busy}
                aria-label={d.isActive ? `Hide ${d.label}` : `Show ${d.label}`}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)]">
                {d.isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <form className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border-subtle)] pt-3"
          onSubmit={(e) => { e.preventDefault(); void save(editing); }}>
          <label className="text-xs text-[var(--text-muted)] space-y-1">Key
            <input className={input} value={editing.key} disabled={!isNew} required
              onChange={(e) => setEditing({ ...editing, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
              placeholder="e.g. FM_MEP" />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">Label
            <input className={input} value={editing.label} required maxLength={80}
              onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">Short label
            <input className={input} value={editing.shortLabel} maxLength={24}
              onChange={(e) => setEditing({ ...editing, shortLabel: e.target.value })} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">Colour
            <select className={input} value={editing.tone} onChange={(e) => setEditing({ ...editing, tone: e.target.value })}>
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="col-span-2 text-xs text-[var(--text-muted)] space-y-1">Description
            <input className={input} value={editing.description} maxLength={240}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </label>
          {err && <p role="alert" className="col-span-2 text-xs text-rose-600 dark:text-rose-300">{err}</p>}
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={`${btn} text-[var(--text-muted)]`}><X className="w-3.5 h-3.5" /> Cancel</button>
            <button type="submit" disabled={busy} className={`${btn} bg-violet-600 text-white hover:bg-violet-500`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
