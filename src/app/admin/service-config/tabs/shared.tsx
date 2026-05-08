'use client';

/**
 * Form primitives reused by all 8 rule tabs — Field, Toggle, NumberInput,
 * TextInput, Select, ChipMultiSelect, SaveBar.
 */

import { Save, AlertCircle, CheckCircle2, X, Plus } from 'lucide-react';
import { useState } from 'react';

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
}: {
  configured: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  savedMsg: string | null;
  onSave: () => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-3 border-t border-white/5">
      <button onClick={onSave} disabled={saving}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
        <Save className="w-4 h-4" /> {saving ? 'Saving…' : configured ? 'Save changes' : 'Save'}
      </button>
      {onReset && dirty && !saving && (
        <button onClick={onReset}
          className="px-3 py-2 rounded-lg text-slate-400 hover:text-white text-sm">
          Reset
        </button>
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
