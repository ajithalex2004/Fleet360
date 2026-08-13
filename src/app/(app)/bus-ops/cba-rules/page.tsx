'use client';
/**
 * /bus-ops/cba-rules — CBA / union rule-set management.
 *
 * Each tenant can define one or more rule-sets (e.g. "UAE Federal
 * Labour Law 2024", "DPC 2024 CBA", "Weekend Only"). A rule-set is a
 * named bundle of labour rules that the Planning Core reads as
 * runcut work-rules when computing runs/blocks/rosters.
 *
 * The page:
 *   - Lists rule-sets (default first, then alphabetical)
 *   - Lets the user create a new rule-set from a starter template
 *   - Edits a rule-set in a side panel — each rule is a row with a
 *     category label, a value, a unit, and an `enforced` toggle
 *   - Sets a rule-set as the tenant default (the engine falls back to
 *     this when no explicit binding is set)
 *   - Soft-deletes non-system rule-sets
 *
 * Backed by /api/bus-ops/cba.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Plus, Save, Trash2, X, Star, CheckCircle2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import { useFetchedData } from '@/hooks/useFetchedData';
import { CBA_SCHEMA_VERSION, freshCbaRules, type CbaRule, type CbaRules, type CbaRuleCategory } from '@/lib/cba/types';

interface RuleSet {
  id: string; name: string; description: string | null; jurisdiction: string | null;
  isDefault: boolean; isSystem: boolean; rules: CbaRules; schemaVersion: number;
  createdAt: string | null; updatedAt: string | null;
}

const CATEGORY_LABELS: Record<CbaRuleCategory, string> = {
  MAX_WORK_HOURS_PER_DAY:        'Max work hours / day',
  MAX_SPREAD_HOURS_PER_DAY:      'Max spread hours / day',
  MAX_DRIVING_HOURS_CONTINUOUS:  'Max driving hours (continuous)',
  MIN_BREAK_BETWEEN_TRIPS:       'Min break between trips',
  MIN_DAILY_REST:                'Min daily rest',
  MAX_CONSECUTIVE_DAYS:          'Max consecutive work days',
  MAX_WORK_HOURS_PER_WEEK:       'Max work hours / week',
  MAX_OT_HOURS_PER_WEEK:         'Max OT hours / week',
  MIN_WEEKLY_REST_DAYS:          'Min weekly rest days',
  OT_THRESHOLD_HOURS:            'OT threshold hours',
  OT_RATE:                        'OT rate (×)',
  WEEKEND_OT_RATE:                'Weekend OT rate (×)',
  HOLIDAY_OT_RATE:                'Holiday OT rate (×)',
  HOURLY_RATE:                    'Hourly rate (AED)',
  MILEAGE_RATE_PER_KM:            'Mileage rate (AED/km)',
  NIGHT_SHIFT_PREMIUM_RATE:       'Night shift premium (×)',
  MANDATORY_REST_DAY_MASK:        'Mandatory rest day mask',
  WEEKLY_PATTERN:                 'Weekly pattern',
  CUSTOM_PATTERN_STRING:          'Custom pattern string',
  MIN_SHIFT_HOURS:                'Min shift hours',
  MAX_SHIFT_HOURS:                'Max shift hours',
  MIN_SPLIT_BREAK_HOURS:          'Min split-break hours',
  MAX_TRIPS_PER_RUN:              'Max trips per run',
  MIN_DEADHEAD_BETWEEN_TRIPS:     'Min deadhead between trips',
  REPORT_TIME_MIN:                'Report time (min)',
  WRAP_TIME_MIN:                  'Wrap time (min)',
  ENFORCED:                       'Enforcement flag',
  CUSTOM:                         'Custom',
};

const UNITS: Record<string, string> = {
  HOURS: 'h', MINUTES: 'min', AED: 'AED', MULTIPLIER: '×', COUNT: '', PERCENT: '%',
};

function newRuleFromDefaults(rules: CbaRules, cat: CbaRuleCategory, value: number, unit: CbaRule['unit']): CbaRule {
  const existing = rules.rules.find((r) => r.category === cat);
  if (existing) return { ...existing, value, unit, enforced: true };
  return {
    id: `r-${cat.toLowerCase()}-${Date.now().toString(36)}`,
    name: CATEGORY_LABELS[cat],
    category: cat,
    value, unit, enforced: true,
  };
}

export default function CbaRulesPage() {
  const listRes = useFetchedData<RuleSet[]>('/api/bus-ops/cba');
  const ruleSets = useMemo(() => Array.isArray(listRes.data) ? listRes.data : [], [listRes.data]);

  const [editing, setEditing] = useState<RuleSet | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newJurisdiction, setNewJurisdiction] = useState('');

  // Toast state — surfaced whenever a save / update succeeds. Auto-dismisses
  // after 3 s so it doesn't linger. Explicit success message + panel close
  // fix the "clicked Save, nothing happened" impression when the network
  // call actually succeeded.
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const reload = () => listRes.refresh();

  const setDefault = async (id: string) => {
    const rs = ruleSets.find(x => x.id === id);
    const r = await fetch(`/api/bus-ops/cba?id=${id}`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }) });
    if (r.ok) {
      setToast({ kind: 'success', text: `"${rs?.name ?? 'Rule-set'}" is now the default.` });
      reload();
    } else {
      const err = (await r.json().catch(() => ({}))).error ?? 'Failed to set default';
      setToast({ kind: 'error', text: err });
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this rule-set?')) return;
    const rs = ruleSets.find(x => x.id === id);
    const r = await fetch(`/api/bus-ops/cba?id=${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))).error ?? 'Delete failed';
      setToast({ kind: 'error', text: err });
      return;
    }
    setToast({ kind: 'success', text: `Rule-set "${rs?.name ?? id}" deleted.` });
    reload();
  };

  const create = async () => {
    if (!newName) return;
    const rules = freshCbaRules();
    if (newJurisdiction) rules.meta = { ...(rules.meta ?? {}), jurisdiction: newJurisdiction };
    const r = await fetch('/api/bus-ops/cba', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, jurisdiction: newJurisdiction, rules }),
    });
    if (r.ok) {
      setShowNew(false);
      setNewName('');
      setNewJurisdiction('');
      const created = await r.json();
      reload();
      setEditing(created as RuleSet);
      setToast({ kind: 'success', text: `Rule-set "${(created as RuleSet).name}" created — now configure its rules below.` });
    } else {
      const err = (await r.json().catch(() => ({}))).error ?? 'Create failed';
      setToast({ kind: 'error', text: err });
    }
  };

  const saveRule = async (ruleSet: RuleSet, updates: CbaRule[]) => {
    const newRules: CbaRules = { ...ruleSet.rules, rules: updates, schemaVersion: CBA_SCHEMA_VERSION };
    const r = await fetch(`/api/bus-ops/cba?id=${ruleSet.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: newRules }),
    });
    if (r.ok) {
      await r.json(); // consume the response body even if we don't need it
      // Success flow: toast + close the editor panel + refresh the list.
      // Previously the panel stayed open with no feedback, so operators
      // couldn't tell whether the click had done anything.
      setToast({ kind: 'success', text: `Rule-set "${ruleSet.name}" saved.` });
      setEditing(null);
      reload();
    } else {
      const err = (await r.json().catch(() => ({}))).error ?? 'Save failed';
      setToast({ kind: 'error', text: err });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="CBA / Union Rule-Sets"
        subtitle="Define the labour rules that the Planning Core uses when computing runs, blocks, and rosters. Default is applied to every route without an explicit binding."
        icon={ShieldCheck}
        accent="emerald"
        actions={
          <button onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 hover:opacity-90">
            <Plus className="w-4 h-4" /> New Rule-Set
          </button>
        }
      />

      {/* Toast — success (emerald) or error (rose). Auto-dismisses after 3s
          via the useEffect above; clicking the ✕ closes it immediately. */}
      {toast && (
        <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 border ${
          toast.kind === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
        }`}>
          <div className="flex items-center gap-2 text-sm">
            <span aria-hidden="true">{toast.kind === 'success' ? '✓' : '⚠'}</span>
            <span>{toast.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white p-1 -m-1"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {ruleSets.length === 0 ? (
          <p className="text-slate-500 italic lg:col-span-2">No rule-sets yet — create one to start configuring labour rules.</p>
        ) : ruleSets.map((rs) => (
          <div key={rs.id} className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-white truncate">{rs.name}</h3>
                  {rs.isDefault && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">DEFAULT</span>}
                  {rs.isSystem  && <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">SYSTEM</span>}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {rs.jurisdiction ?? 'No jurisdiction'} · {rs.rules.rules.length} rules
                </p>
                {rs.description && <p className="text-xs text-slate-500 mt-1">{rs.description}</p>}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {!rs.isDefault && !rs.isSystem && (
                  <button onClick={() => setDefault(rs.id)} title="Set as tenant default"
                    className="p-2 rounded-lg text-slate-300 hover:text-amber-300 hover:bg-white/5">
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setEditing(rs)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs">Edit</button>
                {!rs.isSystem && (
                  <button onClick={() => del(rs.id)} className="p-2 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            {/* Mini summary of key rules */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] mt-3">
              {(['MAX_WORK_HOURS_PER_DAY','OT_THRESHOLD_HOURS','OT_RATE','HOURLY_RATE','MAX_WORK_HOURS_PER_WEEK'] as CbaRuleCategory[]).map((c) => {
                const r = rs.rules.rules.find((x) => x.category === c);
                if (!r) return null;
                return (
                  <div key={c} className="flex justify-between">
                    <span className="text-slate-400">{CATEGORY_LABELS[c]}</span>
                    <span className="text-white font-mono">{r.value}{UNITS[r.unit] ? ` ${UNITS[r.unit]}` : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* New rule-set dialog */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-800 border-2 border-emerald-500/40 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">New CBA rule-set</h3>
              <button onClick={() => setShowNew(false)} className="text-slate-300 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. UAE Labour Law 2024"
                  className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Jurisdiction</label>
                <input type="text" value={newJurisdiction} onChange={(e) => setNewJurisdiction(e.target.value)} placeholder="e.g. AE, SA, IN"
                  className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
              </div>
              <p className="text-[11px] text-slate-500 italic">A starter template with safe defaults will be created. Edit the rules afterwards.</p>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg border border-white/30 text-white text-sm hover:bg-white/10">Cancel</button>
              <button onClick={create} disabled={!newName} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit panel */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-3xl bg-slate-800 border-2 border-white/20 rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-slate-800 -m-6 p-6 border-b border-white/10 z-10">
              <div>
                <h3 className="text-lg font-bold text-white">{editing.name}</h3>
                <p className="text-xs text-slate-400">{editing.jurisdiction ?? 'No jurisdiction'} · {editing.rules.rules.length} rules</p>
              </div>
              <button onClick={() => setEditing(null)} className="text-slate-300 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <RulesTable rules={editing.rules.rules} onSave={(updated) => saveRule(editing, updated)} disabled={editing.isSystem} />
          </div>
        </div>
      )}
    </div>
  );
}

function RulesTable({ rules, onSave, disabled }: { rules: CbaRule[]; onSave: (r: CbaRule[]) => void; disabled: boolean }) {
  const [local, setLocal] = useState<CbaRule[]>(rules);
  useEffect(() => setLocal(rules), [rules]);
  const dirty = JSON.stringify(local) !== JSON.stringify(rules);

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10 text-slate-400">
            <th className="text-left py-2 px-2">Rule</th>
            <th className="text-left py-2 px-2">Category</th>
            <th className="text-right py-2 px-2 w-24">Value</th>
            <th className="text-left py-2 px-2 w-20">Unit</th>
            <th className="text-center py-2 px-2 w-16">Enforce</th>
            <th className="text-left py-2 px-2">Note</th>
          </tr>
        </thead>
        <tbody>
          {local.map((r, i) => (
            <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-2 px-2 text-white">{r.name}</td>
              <td className="py-2 px-2 text-slate-400 font-mono text-[10px]">{r.category}</td>
              <td className="py-2 px-2">
                <input type="number" step="0.1" value={r.value} disabled={disabled}
                  onChange={(e) => {
                    const next = [...local];
                    next[i] = { ...r, value: Number(e.target.value) };
                    setLocal(next);
                  }}
                  className="w-20 bg-slate-900 border border-white/15 rounded px-2 py-1 text-white text-xs text-right" />
              </td>
              <td className="py-2 px-2 text-slate-400 text-[10px]">{UNITS[r.unit] ?? r.unit}</td>
              <td className="py-2 px-2 text-center">
                <button disabled={disabled} onClick={() => {
                  const next = [...local];
                  next[i] = { ...r, enforced: !r.enforced };
                  setLocal(next);
                }} className={`p-1 rounded ${r.enforced ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {r.enforced ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                </button>
              </td>
              <td className="py-2 px-2">
                <input type="text" value={r.note ?? ''} disabled={disabled} placeholder="—"
                  onChange={(e) => {
                    const next = [...local];
                    next[i] = { ...r, note: e.target.value || undefined };
                    setLocal(next);
                  }}
                  className="w-full bg-slate-900 border border-white/15 rounded px-2 py-1 text-white text-xs" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={() => setLocal(rules)} disabled={!dirty || disabled}
          className="px-4 py-2 rounded-lg border border-white/30 text-white text-sm hover:bg-white/10 disabled:opacity-50">Reset</button>
        <button onClick={() => onSave(local)} disabled={!dirty || disabled}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> Save
        </button>
      </div>
    </div>
  );
}
