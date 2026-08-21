'use client';
/**
 * Focused editor for the four PCE constraints that bound Planning Core.
 *
 * Opened from the "Edit PCE Rules" button on the Planning Core tab. A
 * deep link to /bus-ops/planning-constraints would discard an in-progress
 * plan — date range, hand-edited pay rules, compute results all live in
 * component state — so the common adjustment happens here instead. The
 * full admin page still owns everything else (the other 10 kinds,
 * effective dates, penalty scores, BLOCK vs WARN actions); a link through
 * to it is rendered at the foot of the drawer.
 *
 * Only these four are editable here because only these four change what
 * Planning Core computes:
 *
 *   VEHICLE_MIN_TURNAROUND    minBufferMin  hard floor on vehicle reuse
 *   MAX_VEHICLE_REUSE_WINDOW  maxMinutes    ceiling on the same gap
 *   PICKUP_ZONE_FALLBACK_KM   maxKm         zone-compat fallback distance
 *   DROPOFF_ZONE_FALLBACK_KM  maxKm         stricter dropoff equivalent
 *
 * Each maps to a PlanningConstraint row. Where a tenant has no row for a
 * kind, the engine falls back to a hardcoded default (see
 * route-consolidation-vehicle-reuse-policy.ts) — the drawer shows that
 * fallback greyed as the effective value and POSTs a new row on first
 * save rather than pretending a row exists.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { X, SlidersHorizontal, ExternalLink, Save, AlertTriangle } from 'lucide-react';

/** The subset of PlanningConstraint the drawer reads. */
interface ConstraintRow {
  id: string;
  kind: string;
  name: string;
  params: Record<string, unknown> | null;
  isEnabled: boolean;
}

type FieldKey = 'minBufferMin' | 'maxMinutes' | 'maxKm';

interface KindSpec {
  kind: string;
  label: string;
  field: FieldKey;
  unit: string;
  /** Engine fallback when the tenant has no row for this kind. */
  fallback: number;
  help: string;
  step: number;
}

/**
 * Fallbacks mirror the resolvers in
 * src/lib/planning/route-consolidation-vehicle-reuse-policy.ts and the
 * zone-compat policy. If those change, change these — they are shown to
 * the user as the effective value when no row exists.
 */
const SPECS: KindSpec[] = [
  {
    kind: 'VEHICLE_MIN_TURNAROUND',
    label: 'Minimum turnaround',
    field: 'minBufferMin',
    unit: 'min',
    fallback: 30,
    step: 1,
    help: 'Hard floor. The blocker will not chain two trips onto one vehicle with a smaller gap, and a request body cannot override it.',
  },
  {
    kind: 'MAX_VEHICLE_REUSE_WINDOW',
    label: 'Maximum reuse window',
    field: 'maxMinutes',
    unit: 'min',
    fallback: 180,
    step: 5,
    help: 'Ceiling on the same gap. Past this the two trips are unrelated rather than a back-to-back reuse candidate. Used as a default — Planning Core may override it per run.',
  },
  {
    kind: 'PICKUP_ZONE_FALLBACK_KM',
    label: 'Pickup zone fallback',
    field: 'maxKm',
    unit: 'km',
    fallback: 3.0,
    step: 0.5,
    help: 'Only consulted when neither side has a matching spatial.places id. A shared place always wins over distance.',
  },
  {
    kind: 'DROPOFF_ZONE_FALLBACK_KM',
    label: 'Dropoff zone fallback',
    field: 'maxKm',
    unit: 'km',
    fallback: 1.5,
    step: 0.5,
    help: 'Stricter than pickup by default — a dropoff mismatch strands a rider further from their actual destination.',
  },
];

interface PceRulesDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful save so the caller can refetch if it cares. */
  onSaved?: () => void;
}

export function PceRulesDrawer({ open, onClose, onSaved }: PceRulesDrawerProps) {
  const [rows, setRows]       = useState<ConstraintRow[]>([]);
  const [values, setValues]   = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const byKind = useMemo(() => {
    const m = new Map<string, ConstraintRow>();
    // Mirrors the resolvers' `orderBy: { createdAt: 'asc' }` + findFirst:
    // where a tenant has several rows of one kind, the engine reads the
    // oldest enabled one, so that is the row this drawer must edit.
    for (const r of rows) if (r.isEnabled && !m.has(r.kind)) m.set(r.kind, r);
    return m;
  }, [rows]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch('/api/bus-ops/planning-constraints?enabled=1');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load constraints (${res.status})`);
        }
        const data = (await res.json()) as ConstraintRow[];
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load constraints');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Seed the inputs once rows land. Empty string means "not overridden" —
  // the placeholder then shows the engine fallback.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const spec of SPECS) {
      const row = byKind.get(spec.kind);
      const v = row?.params?.[spec.field];
      next[spec.kind] = typeof v === 'number' ? String(v) : '';
    }
    setValues(next);
  }, [byKind]);

  const effective = (spec: KindSpec): number => {
    const raw = values[spec.kind];
    const n = raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : spec.fallback;
  };

  /**
   * Turnaround is a floor and the reuse window is a ceiling on the same
   * gap, so a floor above the ceiling makes every pair unreusable — the
   * blocker would silently return single-trip blocks. Caught here rather
   * than after a confusing compute.
   */
  const crossFieldError = useMemo(() => {
    const min = effective(SPECS[0]);
    const max = effective(SPECS[1]);
    return min > max
      ? `Minimum turnaround (${min} min) exceeds the maximum reuse window (${max} min) — no vehicle could ever be reused.`
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const save = async () => {
    if (crossFieldError) return;
    setSaving(true);
    setError(null);
    try {
      for (const spec of SPECS) {
        const raw = values[spec.kind];
        if (raw === '') continue; // left at the engine fallback
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`${spec.label} must be a positive number.`);
        }
        const existing = byKind.get(spec.kind);
        if (existing) {
          const current = existing.params?.[spec.field];
          if (typeof current === 'number' && current === n) continue; // unchanged
          const res = await fetch(`/api/bus-ops/planning-constraints/${existing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ params: { ...(existing.params ?? {}), [spec.field]: n } }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `Failed to update ${spec.label}`);
          }
        } else {
          // No row for this kind yet — the tenant was on the engine
          // fallback. Create one rather than silently doing nothing.
          const res = await fetch('/api/bus-ops/planning-constraints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: spec.label,
              kind: spec.kind,
              action: 'BLOCK',
              params: { [spec.field]: n },
              isEnabled: true,
              reason: 'Created from the Planning Core PCE drawer',
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `Failed to create ${spec.label}`);
          }
        }
      }
      setSavedAt(Date.now());
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Escape closes — expected of any drawer, and cheap to honour.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit PCE rules"
        className="relative w-full max-w-md h-full overflow-y-auto bg-slate-900 border-l border-white/10 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-slate-900/95 backdrop-blur px-5 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center">
              <SlidersHorizontal className="w-4.5 h-4.5 text-[#E8C547]" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white">Edit PCE Rules</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                The four constraints that bound Planning Core.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {loading && <p className="text-sm text-slate-400">Loading constraints…</p>}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          {crossFieldError && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{crossFieldError}</span>
            </div>
          )}

          {!loading && SPECS.map(spec => {
            const overridden = values[spec.kind] !== '';
            return (
              <div key={spec.kind} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={`pce-${spec.kind}`} className="text-sm font-semibold text-white">
                    {spec.label}
                  </label>
                  {!overridden && (
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      engine default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id={`pce-${spec.kind}`}
                    type="number"
                    min={0}
                    step={spec.step}
                    value={values[spec.kind] ?? ''}
                    placeholder={String(spec.fallback)}
                    onChange={e => setValues(v => ({ ...v, [spec.kind]: e.target.value }))}
                    className="w-32 bg-slate-950 border border-white/15 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
                  />
                  <span className="text-xs text-slate-400">{spec.unit}</span>
                  {overridden && (
                    <button
                      onClick={() => setValues(v => ({ ...v, [spec.kind]: '' }))}
                      className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
                    >
                      reset to default
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{spec.help}</p>
              </div>
            );
          })}
        </div>

        <div className="sticky bottom-0 border-t border-white/10 bg-slate-900/95 backdrop-blur px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving || loading || Boolean(crossFieldError)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B8860B] px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save rules'}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5"
            >
              Cancel
            </button>
            {savedAt && !saving && (
              <span className="text-xs text-emerald-300">Saved</span>
            )}
          </div>
          <a
            href="/bus-ops/planning-constraints"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Full Planning Constraints admin — all kinds, effective dates, BLOCK/WARN
          </a>
        </div>
      </div>
    </div>
  );
}

export default PceRulesDrawer;
