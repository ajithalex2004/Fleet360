'use client';

/**
 * Planning Constraints admin — Phase 1 UI.
 *
 * Ops authors PCE rules here. Each row corresponds to one
 * planning_constraints record; the PCE evaluator dispatches on `kind`.
 *
 * Deliberate scope choices:
 *   - Kind picker is a dropdown of the 7 shipping evaluators. Adding a
 *     new kind is one entry in KIND_META below plus the backend
 *     evaluator; no other UI wiring needed.
 *   - Params is a raw JSON textarea rather than per-kind form fields.
 *     Ops author these rarely; a JSON editor is honest ("here's the
 *     schema, fill it in") without pretending the UI enforces the
 *     evaluator's real contract. Kind-specific forms can layer on
 *     later when a rule type gets frequent authoring.
 *   - Enable/disable is inline (a switch in the row) because ops
 *     toggle rules more often than they edit them.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Shield, Plus, Edit2, Trash2, RefreshCw, X } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

// ─── Types (mirror the /api/bus-ops/planning-constraints response) ──

interface PlanningConstraint {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  tenantId: string;
  name: string;
  kind: string;
  action: 'BLOCK' | 'WARN' | 'PENALTY';
  penaltyScore: string | number | null;
  params: Record<string, unknown>;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reason: string | null;
  isEnabled: boolean;
}

// ─── Kind metadata — one entry per PCE evaluator ────────────────────

type KindMeta = {
  kind: string;
  label: string;
  paramsHint: string;
  paramsTemplate: Record<string, unknown>;
};

const KIND_META: KindMeta[] = [
  {
    kind: 'ZONE_VEHICLE_RESTRICTION',
    label: 'Zone × Vehicle × Time',
    paramsHint: 'zonePlaceId + optional seat / group / time-window filters',
    paramsTemplate: { zonePlaceId: '', minSeats: 40, fromHm: 420, toHm: 600 },
  },
  {
    kind: 'PICKUP_TIME_BUFFER',
    label: 'Merge pickup gap',
    paramsHint: 'minBufferMin between merge candidates',
    paramsTemplate: { minBufferMin: 10 },
  },
  {
    kind: 'TRIP_MAX_DURATION',
    label: 'Trip max duration',
    paramsHint: 'maxMinutes per trip',
    paramsTemplate: { maxMinutes: 120 },
  },
  {
    kind: 'PASSENGER_MAX_DETOUR',
    label: 'Passenger max detour',
    paramsHint: 'maxMinutes and/or maxPercent (more restrictive wins)',
    paramsTemplate: { maxMinutes: 20, maxPercent: 25 },
  },
  {
    kind: 'MERGED_ARRIVAL_SLA',
    label: 'Arrival SLA',
    paramsHint: 'toleranceMin past trip.latestArrivalTime',
    paramsTemplate: { toleranceMin: 5 },
  },
  {
    kind: 'ROUTE_STOP_RESTRICTION',
    label: 'Stop × Vehicle',
    paramsHint: 'stopPlaceId + optional seat / group filters',
    paramsTemplate: { stopPlaceId: '', vehicleGroups: ['BUS'] },
  },
  {
    kind: 'VEHICLE_CAPACITY_HARD',
    label: 'Vehicle capacity (hard)',
    paramsHint: 'no params — always compares confirmedCount vs seats',
    paramsTemplate: {},
  },
];

const KIND_BY_ID = new Map(KIND_META.map((k) => [k.kind, k]));

const ACTION_PILL: Record<string, string> = {
  BLOCK: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  WARN: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  PENALTY: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
};

// ─── Page ────────────────────────────────────────────────────────────

export default function PlanningConstraintsPage() {
  const [rows, setRows] = useState<PlanningConstraint[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PlanningConstraint | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bus-ops/planning-constraints');
      const data = res.ok ? await res.json() : [];
      setRows(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const enabledCount = useMemo(() => rows.filter((r) => r.isEnabled).length, [rows]);
  const blockCount = useMemo(() => rows.filter((r) => r.action === 'BLOCK' && r.isEnabled).length, [rows]);

  const toggleEnabled = async (row: PlanningConstraint) => {
    const res = await fetch(`/api/bus-ops/planning-constraints/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: !row.isEnabled }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j?.error ?? 'Toggle failed');
      return;
    }
    await load();
  };

  const remove = async (row: PlanningConstraint) => {
    if (!confirm(`Delete "${row.name}"?\n\nThe rule stops evaluating immediately. Historical evaluations that referenced it are unaffected.`)) return;
    const res = await fetch(`/api/bus-ops/planning-constraints/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j?.error ?? 'Delete failed');
      return;
    }
    await load();
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Planning Constraints"
        subtitle={`${rows.length} defined · ${enabledCount} enabled · ${blockCount} BLOCK-active — evaluated on every plan apply and every merge`}
        icon={Shield}
        accent="violet"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              <Plus className="w-4 h-4" /> New rule
            </button>
          </div>
        }
      />

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-slate-400 animate-pulse">Loading constraints…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-12 text-center">
          <Shield className="mx-auto h-10 w-10 text-slate-600" />
          <p className="mt-3 text-slate-300">No planning constraints defined yet.</p>
          <p className="mt-1 text-sm text-slate-500">Create one to enforce zone bans, arrival SLAs, capacity limits, or passenger detour ceilings.</p>
          <button onClick={() => setEditing('new')} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> Create first rule
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Enabled</th>
                <th className="px-4 py-3 text-right">—</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => {
                const meta = KIND_BY_ID.get(r.kind);
                return (
                  <tr key={r.id} className="text-slate-200 hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      {r.reason && <div className="mt-0.5 text-xs text-slate-500">{r.reason}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div>{meta?.label ?? r.kind}</div>
                      <div className="text-xs text-slate-500">{r.kind}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${ACTION_PILL[r.action] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
                        {r.action}
                        {r.action === 'PENALTY' && r.penaltyScore != null && ` · ${Number(r.penaltyScore)}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {r.effectiveFrom || r.effectiveTo
                        ? `${fmtDate(r.effectiveFrom)} → ${fmtDate(r.effectiveTo)}`
                        : <span className="text-slate-600">always</span>}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleEnabled(r)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${r.isEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`} aria-label={r.isEnabled ? 'Disable rule' : 'Enable rule'}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${r.isEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => setEditing(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200" title="Edit"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => remove(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <ConstraintFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Form modal ─────────────────────────────────────────────────────

interface FormState {
  name: string;
  kind: string;
  action: 'BLOCK' | 'WARN' | 'PENALTY';
  penaltyScore: string;
  paramsText: string;
  effectiveFrom: string;
  effectiveTo: string;
  reason: string;
  isEnabled: boolean;
}

function initialForm(row: PlanningConstraint | null): FormState {
  if (!row) {
    const meta = KIND_META[0];
    return {
      name: '', kind: meta.kind, action: 'BLOCK', penaltyScore: '',
      paramsText: JSON.stringify(meta.paramsTemplate, null, 2),
      effectiveFrom: '', effectiveTo: '', reason: '', isEnabled: true,
    };
  }
  return {
    name: row.name,
    kind: row.kind,
    action: row.action,
    penaltyScore: row.penaltyScore == null ? '' : String(row.penaltyScore),
    paramsText: JSON.stringify(row.params ?? {}, null, 2),
    effectiveFrom: row.effectiveFrom ? row.effectiveFrom.slice(0, 10) : '',
    effectiveTo: row.effectiveTo ? row.effectiveTo.slice(0, 10) : '',
    reason: row.reason ?? '',
    isEnabled: row.isEnabled,
  };
}

function ConstraintFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: PlanningConstraint | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = initial != null;
  const meta = KIND_BY_ID.get(form.kind);

  // When kind changes on a new rule, pre-fill params with the template
  // for that kind. On edit we don't overwrite what the user already had.
  const onKindChange = (kind: string) => {
    setForm((f) => {
      if (isEdit) return { ...f, kind };
      const next = KIND_BY_ID.get(kind);
      return {
        ...f,
        kind,
        paramsText: next ? JSON.stringify(next.paramsTemplate, null, 2) : f.paramsText,
      };
    });
  };

  const save = async () => {
    setError(null);
    if (!form.name.trim()) return setError('Name is required');
    if (form.action === 'PENALTY' && !form.penaltyScore.trim()) {
      return setError('penaltyScore is required when action=PENALTY');
    }
    let params: unknown = {};
    try {
      params = JSON.parse(form.paramsText || '{}');
    } catch {
      return setError('params must be valid JSON');
    }
    if (typeof params !== 'object' || Array.isArray(params) || params == null) {
      return setError('params must be a JSON object');
    }

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      action: form.action,
      penaltyScore: form.action === 'PENALTY' ? Number(form.penaltyScore) : null,
      params,
      effectiveFrom: form.effectiveFrom || null,
      effectiveTo: form.effectiveTo || null,
      reason: form.reason.trim() || null,
      isEnabled: form.isEnabled,
    };
    if (!isEdit) body.kind = form.kind; // kind is immutable on PATCH

    setSaving(true);
    try {
      const url = isEdit
        ? `/api/bus-ops/planning-constraints/${initial!.id}`
        : '/api/bus-ops/planning-constraints';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            {isEdit ? 'Edit planning constraint' : 'New planning constraint'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder='e.g. "Al Khail heavy-bus ban 07-10 AM"' />
          </Field>

          <Field label="Kind" hint={isEdit ? 'kind is immutable on edit' : (meta?.paramsHint ?? undefined)}>
            <select value={form.kind} onChange={(e) => onKindChange(e.target.value)} disabled={isEdit} className={`${inputCls} ${isEdit ? 'opacity-60' : ''}`}>
              {KIND_META.map((k) => (
                <option key={k.kind} value={k.kind}>{k.label} — {k.kind}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Action">
              <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as FormState['action'] })} className={inputCls}>
                <option value="BLOCK">BLOCK — refuse the plan</option>
                <option value="WARN">WARN — flag, allow</option>
                <option value="PENALTY">PENALTY — score into totalCost</option>
              </select>
            </Field>
            <Field label={form.action === 'PENALTY' ? 'Penalty score' : 'Penalty score (unused)'}>
              <input
                type="number"
                step="0.01"
                value={form.penaltyScore}
                onChange={(e) => setForm({ ...form, penaltyScore: e.target.value })}
                disabled={form.action !== 'PENALTY'}
                className={`${inputCls} ${form.action !== 'PENALTY' ? 'opacity-40' : ''}`}
              />
            </Field>
          </div>

          <Field label="Params (JSON)" hint={meta?.paramsHint}>
            <textarea
              value={form.paramsText}
              onChange={(e) => setForm({ ...form, paramsText: e.target.value })}
              rows={8}
              className={`${inputCls} font-mono text-xs`}
              spellCheck={false}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Effective from" hint="optional">
              <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Effective to" hint="optional (inclusive)">
              <input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <Field label="Reason" hint="shown to operators in the checks[] output">
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls} placeholder='e.g. "RTA restriction — heavy vehicles banned in this window"' />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} className="h-4 w-4 rounded border-slate-700 bg-slate-800" />
            Rule is enabled
          </label>

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small building blocks ──────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '∞';
  return iso.slice(0, 10);
}
