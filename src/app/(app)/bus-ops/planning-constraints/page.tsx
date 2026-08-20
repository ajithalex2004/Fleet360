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

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Shield, Plus, Edit2, Trash2, RefreshCw, X, GitMerge, ArrowRight } from 'lucide-react';
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
    paramsTemplate: { zonePlaceId: '', minSeats: 40, fromHm: 420, toHm: 600, timeZone: 'Asia/Dubai' },
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
    paramsHint: 'trip execution — maxMinutes and/or maxPercent (more restrictive wins)',
    paramsTemplate: { maxMinutes: 20, maxPercent: 25 },
  },
  {
    kind: 'ROUTE_STOP_DEVIATION_MAX',
    label: 'Route stop deviation (design)',
    paramsHint: 'network design — max deviation of consolidated route vs source route',
    paramsTemplate: { maxMinutes: 15, maxPercent: 20 },
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
  {
    kind: 'DEPARTURE_TIME_PROXIMITY',
    label: 'Route Consolidation — departure buffer',
    paramsHint: 'maxMinutes — routes whose departure times differ by more than this are not considered for merging',
    paramsTemplate: { maxMinutes: 60 },
  },
  {
    kind: 'ARRIVAL_TIME_PROXIMITY',
    label: 'Route Consolidation — arrival buffer',
    paramsHint: 'maxMinutes — catches same-departure pairs whose arrival times differ too much (very different trip durations)',
    paramsTemplate: { maxMinutes: 45 },
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
            <Link
              href="/bus-ops/route-consolidation"
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/25"
            >
              <GitMerge className="w-4 h-4" />
              Open Route Consolidation
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
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
  params: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo: string;
  reason: string;
  isEnabled: boolean;
}

function cloneParams(src: Record<string, unknown> | undefined | null): Record<string, unknown> {
  return { ...(src ?? {}) };
}

function initialForm(row: PlanningConstraint | null): FormState {
  if (!row) {
    const meta = KIND_META[0];
    return {
      name: '',
      kind: meta.kind,
      action: 'BLOCK',
      penaltyScore: '',
      params: cloneParams(meta.paramsTemplate),
      effectiveFrom: '',
      effectiveTo: '',
      reason: '',
      isEnabled: true,
    };
  }
  return {
    name: row.name,
    kind: row.kind,
    action: row.action,
    penaltyScore: row.penaltyScore == null ? '' : String(row.penaltyScore),
    params: cloneParams(row.params as Record<string, unknown>),
    effectiveFrom: row.effectiveFrom ? row.effectiveFrom.slice(0, 10) : '',
    effectiveTo: row.effectiveTo ? row.effectiveTo.slice(0, 10) : '',
    reason: row.reason ?? '',
    isEnabled: row.isEnabled,
  };
}

function setParam(
  form: FormState,
  key: string,
  value: unknown,
): FormState {
  return { ...form, params: { ...form.params, [key]: value } };
}

function strParam(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function numParam(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (v == null || v === '') return '';
  return String(v);
}



type ZoneOption = { id: string; name: string; type?: string | null; active?: boolean };
type GroupOption = { value: string; label: string };

const FALLBACK_VEHICLE_GROUPS: GroupOption[] = [
  { value: 'BUS', label: 'BUS' },
  { value: 'COACH', label: 'COACH' },
  { value: 'VAN', label: 'VAN' },
  { value: 'MINIBUS', label: 'MINIBUS' },
  { value: 'SUV', label: 'SUV' },
  { value: 'PASSENGER', label: 'PASSENGER' },
];

function useConstraintLookups() {
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>(FALLBACK_VEHICLE_GROUPS);
  const [loadingLookups, setLoadingLookups] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingLookups(true);
      try {
        const [zRes, vtRes] = await Promise.all([
          fetch('/api/bus-ops/geofences?active=1', { cache: 'no-store' }),
          fetch('/api/fleet/vehicle-types?limit=200&isActive=true', { cache: 'no-store' }),
        ]);
        if (!cancelled && zRes.ok) {
          const zData = await zRes.json();
          const list = Array.isArray(zData) ? zData : Array.isArray(zData?.data) ? zData.data : Array.isArray(zData?.geofences) ? zData.geofences : [];
          setZones(
            list
              .filter((z: any) => z && z.id && z.name && z.active !== false && !z.deletedAt)
              .map((z: any) => ({ id: String(z.id), name: String(z.name), type: z.type ?? null, active: z.active !== false }))
              .sort((a: ZoneOption, b: ZoneOption) => a.name.localeCompare(b.name)),
          );
        }
        if (!cancelled && vtRes.ok) {
          const vtData = await vtRes.json();
          const list = Array.isArray(vtData) ? vtData : Array.isArray(vtData?.data) ? vtData.data : [];
          const seen = new Set<string>();
          const opts: GroupOption[] = [];
          for (const row of list) {
            const g = row?.vehicleGroup ?? row?.vehicle_group;
            if (typeof g === 'string' && g.trim() && !seen.has(g.trim())) {
              seen.add(g.trim());
              opts.push({ value: g.trim(), label: g.trim() });
            }
          }
          opts.sort((a, b) => a.label.localeCompare(b.label));
          setGroups(opts.length ? opts : FALLBACK_VEHICLE_GROUPS);
        }
      } catch {
        /* keep fallbacks */
      } finally {
        if (!cancelled) setLoadingLookups(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { zones, groups, loadingLookups };
}


/** Common IANA zones for staff transport (UAE-first). */
const TIME_ZONE_OPTIONS = [
  'Asia/Dubai',
  'Asia/Muscat',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Kuwait',
  'UTC',
  'Europe/London',
  'Asia/Kolkata',
] as const;

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai';
  } catch {
    return 'Asia/Dubai';
  }
}

/**
 * fromHm / toHm are wall-clock minutes past local midnight in `timeZone`.
 * They are NOT UTC offsets — schedule windows are always local to the depot TZ.
 */
function minutesToTimeInput(v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return '';
  const mins = Math.min(24 * 60 - 1, Math.max(0, Math.round(n)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeInputToMinutes(raw: string): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return undefined;
  }
  return h * 60 + min;
}

function formatHmLabel(mins: unknown, timeZone?: string): string {
  const t = minutesToTimeInput(mins);
  if (!t) return 'not set';
  const tz = timeZone || 'Asia/Dubai';
  return `${t} (${mins} min) · ${tz}`;
}

function TimeHmField({
  label,
  value,
  timeZone,
  onChange,
}: {
  label: string;
  value: unknown;
  timeZone?: string;
  onChange: (minutes: number | undefined) => void;
}) {
  const timeVal = minutesToTimeInput(value);
  return (
    <Field label={label} hint={formatHmLabel(value, timeZone)}>
      <input
        type="time"
        step={60}
        className={inputCls}
        value={timeVal}
        onChange={(e) => onChange(timeInputToMinutes(e.target.value))}
      />
    </Field>
  );
}

function DateField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (isoDate: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          type="date"
          className={inputCls}
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
        />
        {value ? (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-700 px-2 text-xs text-slate-400 hover:text-white"
            onClick={() => onChange('')}
          >
            Clear
          </button>
        ) : null}
      </div>
    </Field>
  );
}

type ValidationResult = { ok: true } | { ok: false; error: string };

function validateConstraintForm(form: FormState): ValidationResult {
  if (!form.name.trim()) return { ok: false, error: 'Name is required' };
  if (form.name.trim().length > 200) return { ok: false, error: 'Name must be 200 characters or less' };

  if (form.action === 'PENALTY') {
    if (!form.penaltyScore.trim()) return { ok: false, error: 'Penalty score is required when action is PENALTY' };
    const ps = Number(form.penaltyScore);
    if (!Number.isFinite(ps) || ps < 0) return { ok: false, error: 'Penalty score must be a number ≥ 0' };
  }

  if (form.effectiveFrom && form.effectiveTo && form.effectiveFrom > form.effectiveTo) {
    return { ok: false, error: 'Effective from must be on or before effective to' };
  }

  const p = form.params;
  const num = (k: string) => {
    const v = p[k];
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  switch (form.kind) {
    case 'ZONE_VEHICLE_RESTRICTION': {
      if (!String(p.zonePlaceId ?? '').trim()) {
        return { ok: false, error: 'Zone is required — select a zone from the list' };
      }
      const from = num('fromHm');
      const to = num('toHm');
      if (from != null && Number.isNaN(from)) return { ok: false, error: 'Invalid from time' };
      if (to != null && Number.isNaN(to)) return { ok: false, error: 'Invalid to time' };
      if (from != null && (from < 0 || from >= 24 * 60)) return { ok: false, error: 'From time out of range' };
      if (to != null && (to < 0 || to >= 24 * 60)) return { ok: false, error: 'To time out of range' };
      // Same-day window: if both set, from should be < to (overnight windows not supported in v1)
      if (from != null && to != null && from >= to) {
        return { ok: false, error: 'From time must be before to time (same-day window; overnight not supported yet)' };
      }
      const minS = num('minSeats');
      const maxS = num('maxSeats');
      if (minS != null && (Number.isNaN(minS) || minS < 0)) return { ok: false, error: 'Min seats must be ≥ 0' };
      if (maxS != null && (Number.isNaN(maxS) || maxS < 0)) return { ok: false, error: 'Max seats must be ≥ 0' };
      if (minS != null && maxS != null && minS > maxS) {
        return { ok: false, error: 'Min seats cannot exceed max seats' };
      }
      const tz = String(p.timeZone ?? '').trim();
      if (tz && !/^[A-Za-z_]+\/[A-Za-z0-9_+\-]+$/.test(tz) && tz !== 'UTC') {
        return { ok: false, error: 'Time zone must be an IANA name (e.g. Asia/Dubai)' };
      }
      break;
    }
    case 'ROUTE_STOP_RESTRICTION': {
      if (!String(p.stopPlaceId ?? '').trim()) return { ok: false, error: 'Stop place ID is required' };
      const minS = num('minSeats');
      const maxS = num('maxSeats');
      if (minS != null && maxS != null && !Number.isNaN(minS) && !Number.isNaN(maxS) && minS > maxS) {
        return { ok: false, error: 'Min seats cannot exceed max seats' };
      }
      break;
    }
    case 'PICKUP_TIME_BUFFER': {
      const b = num('minBufferMin');
      if (b == null) return { ok: false, error: 'Min buffer (minutes) is required' };
      if (Number.isNaN(b) || b < 0 || b > 24 * 60) return { ok: false, error: 'Min buffer must be 0–1440 minutes' };
      break;
    }
    case 'TRIP_MAX_DURATION': {
      const m = num('maxMinutes');
      if (m == null) return { ok: false, error: 'Max duration is required' };
      if (Number.isNaN(m) || m <= 0) return { ok: false, error: 'Max duration must be > 0' };
      break;
    }
    case 'PASSENGER_MAX_DETOUR':
    case 'ROUTE_STOP_DEVIATION_MAX': {
      const mins = num('maxMinutes');
      const pct = num('maxPercent');
      if (mins == null && pct == null) {
        return { ok: false, error: 'Set max minutes and/or max percent' };
      }
      if (mins != null && (Number.isNaN(mins) || mins < 0)) return { ok: false, error: 'Max minutes must be ≥ 0' };
      if (pct != null && (Number.isNaN(pct) || pct < 0 || pct > 500)) {
        return { ok: false, error: 'Max percent must be 0–500' };
      }
      break;
    }
    case 'MERGED_ARRIVAL_SLA': {
      const tol = num('toleranceMin');
      if (tol == null) return { ok: false, error: 'Tolerance (minutes) is required' };
      if (Number.isNaN(tol) || tol < 0) return { ok: false, error: 'Tolerance must be ≥ 0' };
      break;
    }
    case 'VEHICLE_CAPACITY_HARD':
      break;
    case 'DEPARTURE_TIME_PROXIMITY':
    case 'ARRIVAL_TIME_PROXIMITY': {
      const m = num('maxMinutes');
      if (m == null) return { ok: false, error: 'Max minutes apart is required' };
      if (Number.isNaN(m) || m <= 0) return { ok: false, error: 'Max minutes apart must be > 0' };
      break;
    }
    default:
      break;
  }
  return { ok: true };
}


/**
 * Multi-select listbox (WAI-ARIA listbox pattern).
 * Keyboard: Tab focus list · ↑/↓ move · Space/Enter toggle · Home/End · Ctrl/Cmd+A select all.
 */
function MultiSelectChecklist({
  options,
  value,
  onChange,
  emptyLabel = 'No options available',
  label = 'Vehicle groups',
}: {
  options: GroupOption[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  label?: string;
}) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = useMemo(() => new Set(value), [value]);

  const optionId = (index: number) => `${listId}-opt-${index}`;

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };

  const selectAll = () => onChange(options.map((o) => o.value));
  const clearAll = () => onChange([]);

  // Keep active index in range when options change
  React.useEffect(() => {
    if (!options.length) return;
    setActiveIndex((i) => Math.min(Math.max(0, i), options.length - 1));
  }, [options.length]);

  const moveActive = (nextIndex: number) => {
    if (!options.length) return;
    const i = Math.min(Math.max(0, nextIndex), options.length - 1);
    setActiveIndex(i);
    // Scroll active option into view
    const el = document.getElementById(optionId(i));
    el?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!options.length) return;
    const max = options.length - 1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(activeIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveActive(0);
        break;
      case 'End':
        e.preventDefault();
        moveActive(max);
        break;
      case ' ':
      case 'Enter':
        e.preventDefault();
        if (options[activeIndex]) toggle(options[activeIndex].value);
        break;
      case 'a':
      case 'A':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (value.length === options.length) clearAll();
          else selectAll();
        }
        break;
      default:
        // Type-ahead: jump to first option starting with typed letter
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const ch = e.key.toLowerCase();
          const from = activeIndex + 1;
          const ordered = options.map((o, i) => ({ o, i })).slice(from).concat(
            options.map((o, i) => ({ o, i })).slice(0, from),
          );
          const hit = ordered.find(({ o }) => o.label.toLowerCase().startsWith(ch));
          if (hit) {
            e.preventDefault();
            moveActive(hit.i);
          }
        }
        break;
    }
  };

  if (!options.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  const activeId = optionId(activeIndex);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="text-[11px] text-violet-300 hover:text-violet-200 underline-offset-2 hover:underline"
        >
          Select all
        </button>
        <span className="text-slate-600">·</span>
        <button
          type="button"
          onClick={clearAll}
          className="text-[11px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
        >
          Clear
        </button>
        <span className="text-[11px] text-slate-500 ml-auto">
          {value.length === 0 ? 'Any group' : `${value.length} selected`}
        </span>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/60 p-2 space-y-1 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
      >
        {options.map((o, index) => {
          const isSelected = selected.has(o.value);
          const isActive = index === activeIndex;
          return (
            <div
              key={o.value}
              id={optionId(index)}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                setActiveIndex(index);
                toggle(o.value);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none ${
                isActive ? 'ring-1 ring-violet-500/60' : ''
              } ${
                isSelected
                  ? 'bg-violet-500/15 text-violet-100'
                  : 'text-slate-200 hover:bg-slate-800/80'
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  isSelected
                    ? 'border-violet-400 bg-violet-500 text-white'
                    : 'border-slate-600 bg-slate-800 text-transparent'
                }`}
              >
                ✓
              </span>
              <span>{o.label}</span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-600">
        ↑↓ move · Space select · Home/End · Ctrl+A all
      </p>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Selected groups">
          {value.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-500/20"
              title="Remove"
            >
              {v}
              <span className="text-violet-400" aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function selectedGroups(params: Record<string, unknown>): string[] {
  const v = params.vehicleGroups;
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}


/** Kind-specific param fields (replaces raw JSON textarea). */
function ParamsFields({
  kind,
  params,
  onChange,
  zones,
  groups,
  loadingLookups,
}: {
  kind: string;
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  zones: ZoneOption[];
  groups: GroupOption[];
  loadingLookups?: boolean;
}) {
  const set = (key: string, value: unknown) => onChange({ ...params, [key]: value });
  const setNum = (key: string, raw: string) => {
    if (raw.trim() === '') {
      const next = { ...params };
      delete next[key];
      onChange(next);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    set(key, n);
  };

  switch (kind) {
    case 'ZONE_VEHICLE_RESTRICTION': {
      const tz = String(params.timeZone ?? 'Asia/Dubai');
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Zone" hint={loadingLookups ? 'Loading zones…' : zones.length ? 'from Bus Ops geofences' : 'no zones found — create under Geofences'}>
              <select
                className={inputCls}
                value={strParam(params, 'zonePlaceId')}
                onChange={(e) => set('zonePlaceId', e.target.value)}
              >
                <option value="">Select zone…</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}{z.type ? ` (${z.type})` : ''}
                  </option>
                ))}
                {strParam(params, 'zonePlaceId') && !zones.some((z) => z.id === strParam(params, 'zonePlaceId')) ? (
                  <option value={strParam(params, 'zonePlaceId')}>
                    Unknown zone ({strParam(params, 'zonePlaceId').slice(0, 8)}…)
                  </option>
                ) : null}
              </select>
            </Field>
            <Field label="Vehicle groups" hint="optional — leave empty to match any group">
              <MultiSelectChecklist
                options={groups}
                value={selectedGroups(params)}
                onChange={(next) => set('vehicleGroups', next.length ? next : undefined)}
                emptyLabel="No vehicle groups found in fleet types"
              />
            </Field>
            <Field label="Min seats" hint="optional">
              <input type="number" min={0} className={inputCls} value={numParam(params, 'minSeats')} onChange={(e) => setNum('minSeats', e.target.value)} placeholder="40" />
            </Field>
            <Field label="Max seats" hint="optional">
              <input type="number" min={0} className={inputCls} value={numParam(params, 'maxSeats')} onChange={(e) => setNum('maxSeats', e.target.value)} placeholder="60" />
            </Field>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Time window</span>
              <span className="text-[11px] text-slate-500">Wall clock in selected zone (not UTC)</span>
            </div>
            <Field label="Time zone" hint={`Browser: ${browserTimeZone()}`}>
              <select
                className={inputCls}
                value={tz}
                onChange={(e) => set('timeZone', e.target.value)}
              >
                {TIME_ZONE_OPTIONS.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
                {!TIME_ZONE_OPTIONS.includes(tz as typeof TIME_ZONE_OPTIONS[number]) && tz ? (
                  <option value={tz}>{tz}</option>
                ) : null}
              </select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TimeHmField
                label="From time"
                timeZone={tz}
                value={params.fromHm}
                onChange={(mins) => {
                  if (mins === undefined) {
                    const next = { ...params };
                    delete next.fromHm;
                    onChange(next);
                  } else {
                    set('fromHm', mins);
                  }
                }}
              />
              <TimeHmField
                label="To time"
                timeZone={tz}
                value={params.toHm}
                onChange={(mins) => {
                  if (mins === undefined) {
                    const next = { ...params };
                    delete next.toHm;
                    onChange(next);
                  } else {
                    set('toHm', mins);
                  }
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    case 'PICKUP_TIME_BUFFER':
      return (
        <Field label="Min buffer (minutes)">
          <input type="number" className={inputCls} value={numParam(params, 'minBufferMin')} onChange={(e) => setNum('minBufferMin', e.target.value)} placeholder="10" />
        </Field>
      );

    case 'TRIP_MAX_DURATION':
      return (
        <Field label="Max duration (minutes)">
          <input type="number" className={inputCls} value={numParam(params, 'maxMinutes')} onChange={(e) => setNum('maxMinutes', e.target.value)} placeholder="120" />
        </Field>
      );

    case 'PASSENGER_MAX_DETOUR':
    case 'ROUTE_STOP_DEVIATION_MAX':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Max detour (minutes)" hint="optional">
            <input type="number" className={inputCls} value={numParam(params, 'maxMinutes')} onChange={(e) => setNum('maxMinutes', e.target.value)} placeholder="15" />
          </Field>
          <Field label="Max detour (%)" hint="optional; more restrictive wins">
            <input type="number" className={inputCls} value={numParam(params, 'maxPercent')} onChange={(e) => setNum('maxPercent', e.target.value)} placeholder="20" />
          </Field>
        </div>
      );

    case 'MERGED_ARRIVAL_SLA':
      return (
        <Field label="Tolerance past latest arrival (minutes)">
          <input type="number" className={inputCls} value={numParam(params, 'toleranceMin')} onChange={(e) => setNum('toleranceMin', e.target.value)} placeholder="5" />
        </Field>
      );

    case 'ROUTE_STOP_RESTRICTION':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Stop place ID" hint="required">
            <input className={inputCls} value={strParam(params, 'stopPlaceId')} onChange={(e) => set('stopPlaceId', e.target.value)} placeholder="place uuid" />
          </Field>
          <Field label="Vehicle groups" hint="optional — leave empty to match any group">
            <MultiSelectChecklist
              options={groups}
              value={selectedGroups(params)}
              onChange={(next) => set('vehicleGroups', next.length ? next : undefined)}
              emptyLabel="No vehicle groups found in fleet types"
            />
          </Field>
          <Field label="Min seats" hint="optional">
            <input type="number" className={inputCls} value={numParam(params, 'minSeats')} onChange={(e) => setNum('minSeats', e.target.value)} />
          </Field>
          <Field label="Max seats" hint="optional">
            <input type="number" className={inputCls} value={numParam(params, 'maxSeats')} onChange={(e) => setNum('maxSeats', e.target.value)} />
          </Field>
        </div>
      );

    case 'VEHICLE_CAPACITY_HARD':
      return (
        <p className="text-sm text-slate-400 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          No parameters. Compares passenger count to vehicle seating capacity automatically.
        </p>
      );

    case 'DEPARTURE_TIME_PROXIMITY':
      return (
        <Field label="Max departure time diff (minutes)" hint="routes further apart than this are not considered for merging">
          <input type="number" className={inputCls} value={numParam(params, 'maxMinutes')} onChange={(e) => setNum('maxMinutes', e.target.value)} placeholder="60" />
        </Field>
      );

    case 'ARRIVAL_TIME_PROXIMITY':
      return (
        <Field label="Max arrival time diff (minutes)" hint="catches same-departure pairs whose arrival times differ too much (very different trip durations)">
          <input type="number" className={inputCls} value={numParam(params, 'maxMinutes')} onChange={(e) => setNum('maxMinutes', e.target.value)} placeholder="45" />
        </Field>
      );

    default:
      return (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Unknown kind — edit as key/value JSON object keys if needed.</p>
          <textarea
            className={`${inputCls} font-mono text-xs`}
            rows={6}
            value={JSON.stringify(params, null, 2)}
            onChange={(e) => {
              try {
                const p = JSON.parse(e.target.value || '{}');
                if (p && typeof p === 'object' && !Array.isArray(p)) onChange(p);
              } catch { /* keep typing */ }
            }}
            spellCheck={false}
          />
        </div>
      );
  }
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
  const { zones, groups, loadingLookups } = useConstraintLookups();

  // When kind changes on a new rule, pre-fill params with the template
  // for that kind. On edit we don't overwrite what the user already had.
  const onKindChange = (kind: string) => {
    setForm((f) => {
      if (isEdit) return { ...f, kind };
      const next = KIND_BY_ID.get(kind);
      return {
        ...f,
        kind,
        params: next ? cloneParams(next.paramsTemplate) : f.params,
      };
    });
  };

  const save = async () => {
    setError(null);
    const validated = validateConstraintForm(form);
    if (!validated.ok) return setError(validated.error);

    // Strip empty strings / undefined from params
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form.params)) {
      if (v === undefined || v === '') continue;
      params[k] = v;
    }
    // Default TZ for zone windows
    if (form.kind === 'ZONE_VEHICLE_RESTRICTION' && !params.timeZone) {
      params.timeZone = 'Asia/Dubai';
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

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Parameters</span>
              {meta?.paramsHint && <span className="text-xs text-slate-500">{meta.paramsHint}</span>}
            </div>
            <ParamsFields
              kind={form.kind}
              params={form.params}
              onChange={(params) => setForm({ ...form, params })}
              zones={zones}
              groups={groups}
              loadingLookups={loadingLookups}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Effective dates</span>
              <span className="text-[11px] text-slate-500">Calendar dates in tenant ops zone · inclusive end</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DateField
                label="Effective from"
                hint="optional · start of day"
                value={form.effectiveFrom}
                max={form.effectiveTo || undefined}
                onChange={(v) => setForm({ ...form, effectiveFrom: v })}
              />
              <DateField
                label="Effective to"
                hint="optional · inclusive"
                value={form.effectiveTo}
                min={form.effectiveFrom || undefined}
                onChange={(v) => setForm({ ...form, effectiveTo: v })}
              />
            </div>
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
