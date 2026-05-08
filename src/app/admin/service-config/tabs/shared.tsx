'use client';

/**
 * Form primitives reused by all rule tabs — Field, Toggle, NumberInput,
 * TextInput, Select, ChipMultiSelect, SaveBar, Section, HistoryDrawer.
 */

import { Save, AlertCircle, CheckCircle2, X, Plus, History, RotateCcw, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { RuleCategory } from '@/types/service-rules';

/** Props shared by every rule tab. Phase 2E threads the active scope and
 *  a name-lookup map so each tab can render its inheritance indicator. */
export interface RuleTabProps {
  typeId: string;
  /** Active scope from the page-level scope picker. Undefined = root. */
  scopeId?: string;
  /** scope_id → display name + isRoot flag, for the inheritance chip. */
  scopeLookup?: Record<string, { name: string; isRoot: boolean }>;
}

export function Field({ label, children, hint, required }: {
  label: string; children: React.ReactNode; hint?: string; required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className={`w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${props.className ?? ''}`} />
  );
}

export function NumberInput({ value, onChange, ...rest }: {
  value: number | null;
  onChange: (v: number | null) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <input type="number"
      value={value === null ? '' : value}
      onChange={e => {
        const v = e.target.value;
        onChange(v === '' ? null : Number(v));
      }}
      {...rest}
      className={`w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${rest.className ?? ''}`} />
  );
}

export function Select<T extends string>({ value, options, onChange }: {
  value: T;
  options: readonly T[] | T[];
  onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)}
      className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Toggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm text-left transition-all ${
        checked
          ? 'bg-violet-500/15 border-violet-500/40 text-violet-100'
          : 'bg-slate-800/60 border-white/10 text-slate-300 hover:border-white/20'
      }`}>
      <span className={`w-9 h-5 rounded-full relative shrink-0 ${checked ? 'bg-violet-500' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className="flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-[10px] text-slate-500 font-normal mt-0.5">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * Multi-value text input: comma/Enter to add, X to remove. The label is
 * shown above the chips to keep the API uniform with Field.
 */
export function ChipMultiSelect({
  values, onChange, suggestions, placeholder = 'Type and press Enter…',
}: {
  values: string[];
  onChange: (next: string[]) => void;
  suggestions?: readonly string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (values.includes(t)) { setDraft(''); return; }
    onChange([...values, t]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-200 border border-violet-500/30">
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))}
              className="hover:text-rose-300">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-[10px] text-slate-500">No values yet.</span>
        )}
      </div>
      <div className="flex gap-1.5">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
          }}
          placeholder={placeholder}
          className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
        <button type="button" onClick={() => add(draft)}
          className="px-3 py-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.filter(s => !values.includes(s)).slice(0, 12).map(s => (
            <button key={s} type="button" onClick={() => add(s)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-white/5 hover:border-violet-500/40 hover:text-violet-200">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Save bar with status messaging — used at the bottom of every tab. */
export function SaveBar({
  configured, dirty, saving, error, savedMsg, onSave, onReset,
  typeId, category, scopeId, ownedScope, scopeLookup, onRolledBack,
}: {
  configured: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  savedMsg: string | null;
  onSave: () => void;
  onReset?: () => void;
  /** When provided, renders a "History" button that opens the drawer. */
  typeId?: string;
  category?: RuleCategory;
  /** The scope being edited. History + save flow at this scope. */
  scopeId?: string;
  /** Where the active row actually lives — null when running on defaults,
   *  ancestor scope when inherited, equal to scopeId when overridden here. */
  ownedScope?: string | null;
  /** Maps scope_id → display name for the "inherited from {scope}" chip. */
  scopeLookup?: Record<string, { name: string; isRoot: boolean }>;
  /** Called after a successful rollback so the parent can re-load. */
  onRolledBack?: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  // Inheritance status for the indicator chip:
  //   - configured + ownedScope === scopeId → overridden at this scope
  //   - configured + ownedScope !== scopeId → inherited from ancestor
  //   - not configured                      → using defaults
  const inheritedFrom = configured && ownedScope && ownedScope !== scopeId
    ? scopeLookup?.[ownedScope]
    : null;
  const overriddenHere = configured && ownedScope && ownedScope === scopeId;

  return (
    <>
      <div className="flex items-center gap-2 pt-3 border-t border-white/5 flex-wrap">
        <button onClick={onSave} disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : overriddenHere ? 'Save changes' : inheritedFrom ? 'Override at this scope' : 'Save'}
        </button>
        {onReset && dirty && !saving && (
          <button onClick={onReset}
            className="px-3 py-2 rounded-lg text-slate-400 hover:text-white text-sm">
            Reset
          </button>
        )}
        {typeId && category && (
          <button onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5"
            title="View change history at this scope and roll back">
            <History className="w-3.5 h-3.5" /> History
          </button>
        )}
        {/* Inheritance indicator chip */}
        {inheritedFrom && (
          <span className="text-[11px] text-blue-300 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/30">
            <AlertCircle className="w-3 h-3" /> Inherited from <strong>{inheritedFrom.name}</strong>
          </span>
        )}
        {overriddenHere && (
          <span className="text-[11px] text-emerald-300 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> Overridden at this scope
          </span>
        )}
        {!configured && (
          <span className="text-[11px] text-amber-300/80 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Using defaults — not yet saved
          </span>
        )}
        {savedMsg && (
          <span className="text-xs text-emerald-300 inline-flex items-center gap-1 ml-auto">
            <CheckCircle2 className="w-3 h-3" /> {savedMsg}
          </span>
        )}
        {error && (
          <span className="text-xs text-rose-300 inline-flex items-center gap-1 ml-auto">
            <AlertCircle className="w-3 h-3" /> {error}
          </span>
        )}
      </div>

      {historyOpen && typeId && category && (
        <HistoryDrawer
          typeId={typeId}
          category={category}
          scopeId={scopeId}
          onClose={() => setHistoryOpen(false)}
          onRolledBack={() => { setHistoryOpen(false); onRolledBack?.(); }} />
      )}
    </>
  );
}

// ── History drawer ──────────────────────────────────────────────────────────

interface RuleVersion {
  id: string;
  category: string;
  rules: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
  updatedBy: string | null;
  active: boolean;
}

function HistoryDrawer({
  typeId, category, scopeId, onClose, onRolledBack,
}: {
  typeId: string;
  category: RuleCategory;
  /** History is per-scope. Falls back to root when omitted. */
  scopeId?: string;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const [versions, setVersions]   = useState<RuleVersion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [busyId, setBusyId]       = useState<string | null>(null);

  const qs = scopeId ? `?scopeId=${scopeId}` : '';
  const url = `/api/admin/service-config/types/${typeId}/rules/${category}/history${qs}`;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(url);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Load failed');
      setVersions(d.versions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const rollback = async (id: string) => {
    if (!window.confirm('Roll back to this version? A new active row will be created at this scope with these rules; the historical row stays untouched.')) return;
    setBusyId(id); setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: id }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d?.error ?? 'Rollback failed'); return; }
      onRolledBack();
    } finally { setBusyId(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-slate-900 border-l border-white/10 shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900 border-b border-white/10 px-5 py-4 flex items-center gap-2 z-10">
          <History className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-semibold text-white">Change history</h3>
          <span className="text-xs text-slate-500 font-mono">{category}</span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {loading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-lg bg-slate-800/40 animate-pulse" />)}
            </div>
          )}
          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">{error}</div>
          )}
          {!loading && versions.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-8">No saved versions yet.</div>
          )}
          {versions.map(v => (
            <VersionRow key={v.id}
              version={v}
              busy={busyId === v.id}
              onRollback={() => rollback(v.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VersionRow({ version, busy, onRollback }: {
  version: RuleVersion;
  busy: boolean;
  onRollback: () => void;
}) {
  const from = new Date(version.effectiveFrom);
  const to = version.effectiveTo ? new Date(version.effectiveTo) : null;
  const fmt = (d: Date) => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${
      version.active
        ? 'bg-emerald-500/10 border-emerald-500/40'
        : 'bg-slate-800/40 border-white/10'
    }`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {version.active && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                Active
              </span>
            )}
            <span className="text-[11px] font-mono text-slate-400">{version.id.slice(0, 8)}</span>
          </div>
          <div className="text-[11px] text-slate-300">
            {fmt(from)} {to ? <>→ {fmt(to)}</> : <span className="text-slate-500">→ now</span>}
          </div>
          {version.updatedBy && (
            <div className="text-[10px] text-slate-500 inline-flex items-center gap-1 mt-1">
              <User className="w-3 h-3" /> {version.updatedBy}
            </div>
          )}
        </div>
        {!version.active && (
          <button type="button" onClick={onRollback} disabled={busy}
            className="text-[10px] px-2 py-1 rounded bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 inline-flex items-center gap-1 disabled:opacity-50">
            <RotateCcw className="w-3 h-3" /> {busy ? 'Rolling back…' : 'Rollback'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Section header used to group related fields within a tab. */
export function Section({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{title}</h4>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
