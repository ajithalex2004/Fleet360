/**
 * RateBasisEditor — authoring UI for a rate contract's quantity-based pricing.
 *
 * A contract can price its line-haul base three ways:
 *   - flat    base_rate is the whole base (today's behavior; no basis stored)
 *   - per_km  rate per km × shipment distance
 *   - per_kg  rate per kg × shipment weight
 * and per_km / per_kg may carry a tiered breakpoint table so longer/heavier
 * moves earn a different unit rate ("distance break" / "weight break").
 *
 * The value round-trips through the contract's metadata JSONB under `rateBasis`
 * in the exact shape the Go engine parses (rateengine.ParseRateBasis). The live
 * preview mirrors rateengine.Evaluate so the operator sees the computed base
 * before saving — including the honest fall-back to the flat base_rate when a
 * quantity is unknown at quote time.
 *
 * Helpers are exported so the host form can hydrate (rateBasisFromMetadata),
 * serialize (rateBasisToPayload), and block submit (validateRateBasis).
 */
'use client';

import React, { useMemo, useState } from 'react';
import { Calculator, Plus, Trash2, FlaskConical, Equal, Route, Weight } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

export type RateBasisMode = 'flat' | 'per_km' | 'per_kg';

export interface RateBasisTier {
  minQuantity: number;
  ratePerUnit: number | null;
  flatAmount: number | null;
}

export interface RateBasisValue {
  mode: RateBasisMode;
  ratePerUnit: number | null; // the floor rate, used below every breakpoint
  breakpoints: RateBasisTier[];
}

export function emptyRateBasis(): RateBasisValue {
  return { mode: 'flat', ratePerUnit: null, breakpoints: [] };
}

// ── Round-trip with metadata.rateBasis ────────────────────────────────────────

/** Hydrate the editor value from a contract's metadata blob. */
export function rateBasisFromMetadata(metadata: Record<string, unknown> | null | undefined): RateBasisValue {
  const raw = metadata?.rateBasis;
  if (!raw || typeof raw !== 'object') return emptyRateBasis();
  const r = raw as Record<string, unknown>;
  const mode = r.mode === 'per_km' || r.mode === 'per_kg' ? r.mode : 'flat';
  if (mode === 'flat') return emptyRateBasis();

  const breakpoints: RateBasisTier[] = Array.isArray(r.breakpoints)
    ? r.breakpoints.map((item) => {
        const t = (item ?? {}) as Record<string, unknown>;
        return {
          minQuantity: numOrZero(t.minQuantity),
          ratePerUnit: numOrNull(t.ratePerUnit),
          flatAmount: numOrNull(t.flatAmount),
        };
      })
    : [];

  return { mode, ratePerUnit: numOrNull(r.ratePerUnit), breakpoints };
}

type Tier = { minQuantity: number; ratePerUnit?: number; flatAmount?: number };
type Payload = { mode: 'per_km' | 'per_kg'; ratePerUnit: number; breakpoints: Tier[] };

/** Serialize to the persisted shape, or undefined when the basis is flat/empty. */
export function rateBasisToPayload(value: RateBasisValue): Payload | undefined {
  if (value.mode === 'flat') return undefined;
  const ratePerUnit = Math.max(0, value.ratePerUnit ?? 0);
  const breakpoints: Tier[] = [];
  for (const t of value.breakpoints) {
    const minQuantity = Math.max(0, t.minQuantity ?? 0);
    const flat = Math.max(0, t.flatAmount ?? 0);
    const rate = Math.max(0, t.ratePerUnit ?? 0);
    if (flat > 0) breakpoints.push({ minQuantity, flatAmount: flat });
    else if (rate > 0) breakpoints.push({ minQuantity, ratePerUnit: rate });
  }
  if (ratePerUnit <= 0 && breakpoints.length === 0) return undefined;
  return { mode: value.mode, ratePerUnit, breakpoints };
}

/** Return a list of blocking issues; empty array = valid. Flat is always valid. */
export function validateRateBasis(value: RateBasisValue): string[] {
  if (value.mode === 'flat') return [];
  const issues: string[] = [];
  const floor = value.ratePerUnit ?? 0;
  const validTiers = value.breakpoints.filter(
    (t) => (t.flatAmount ?? 0) > 0 || (t.ratePerUnit ?? 0) > 0,
  );
  if (floor <= 0 && validTiers.length === 0) {
    issues.push('Set a positive rate per unit, or at least one breakpoint tier.');
  }
  value.breakpoints.forEach((t, i) => {
    if ((t.minQuantity ?? 0) < 0) issues.push(`Tier ${i + 1}: "From" can't be negative.`);
    if ((t.flatAmount ?? 0) <= 0 && (t.ratePerUnit ?? 0) <= 0) {
      issues.push(`Tier ${i + 1}: enter a rate per unit or a flat amount.`);
    }
  });
  return issues;
}

// ── Preview — mirrors rateengine.Evaluate ─────────────────────────────────────

interface PreviewResult { base: number; applied: boolean; note: string }

export function previewRateBasis(value: RateBasisValue, fallbackFlat: number, quantity: number): PreviewResult {
  const flat = Math.max(0, fallbackFlat || 0);
  if (value.mode === 'flat') return { base: round2(flat), applied: false, note: 'flat base rate' };

  const unit = value.mode === 'per_km' ? 'km' : 'kg';
  const q = Math.max(0, quantity || 0);
  if (q <= 0) return { base: round2(flat), applied: false, note: `no ${unit} → flat fallback` };

  const tier = selectTier(value.breakpoints, q);
  let base: number;
  let rate = 0;
  if (tier && (tier.flatAmount ?? 0) > 0) {
    base = round2(Math.max(0, tier.flatAmount ?? 0));
  } else {
    rate = Math.max(0, tier && (tier.ratePerUnit ?? 0) > 0 ? (tier.ratePerUnit ?? 0) : (value.ratePerUnit ?? 0));
    base = round2(rate * q);
  }
  if (base <= 0) return { base: round2(flat), applied: false, note: 'computes 0 → flat fallback' };

  const tierNote = tier ? ` (tier ≥${fmt(tier.minQuantity)}${rate > 0 ? ` @ ${fmt(rate)}/${unit}` : ' flat'})` : ` @ ${fmt(rate)}/${unit}`;
  return { base, applied: true, note: tierNote };
}

function selectTier(tiers: RateBasisTier[], q: number): RateBasisTier | null {
  let chosen: RateBasisTier | null = null;
  for (const t of tiers) {
    if ((t.minQuantity ?? 0) <= q && (chosen === null || (t.minQuantity ?? 0) > (chosen.minQuantity ?? 0))) {
      chosen = t;
    }
  }
  return chosen;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  value: RateBasisValue;
  onChange: (v: RateBasisValue) => void;
  /** The contract's base_rate — the flat fallback, used in the preview. */
  fallbackFlat: number;
  currency: string;
}

const MODES: Array<{ key: RateBasisMode; label: string; icon: typeof Equal }> = [
  { key: 'flat', label: 'Flat', icon: Equal },
  { key: 'per_km', label: 'Per km', icon: Route },
  { key: 'per_kg', label: 'Per kg', icon: Weight },
];

const inputCls =
  'w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40';
const cellCls =
  'w-full bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40';

export default function RateBasisEditor({ value, onChange, fallbackFlat, currency }: Props) {
  const [sampleQty, setSampleQty] = useState<number>(600);
  const unit = value.mode === 'per_km' ? 'km' : 'kg';
  const issues = useMemo(() => validateRateBasis(value), [value]);
  const preview = useMemo(
    () => previewRateBasis(value, fallbackFlat, sampleQty),
    [value, fallbackFlat, sampleQty],
  );

  const setMode = (mode: RateBasisMode) => onChange({ ...value, mode });
  const setFloor = (n: number | null) => onChange({ ...value, ratePerUnit: n });
  const setTier = (i: number, patch: Partial<RateBasisTier>) =>
    onChange({ ...value, breakpoints: value.breakpoints.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const addTier = () =>
    onChange({ ...value, breakpoints: [...value.breakpoints, { minQuantity: 0, ratePerUnit: null, flatAmount: null }] });
  const removeTier = (i: number) =>
    onChange({ ...value, breakpoints: value.breakpoints.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
          <Calculator className="w-4 h-4 text-amber-300" strokeWidth={2} />
        </div>
        <div>
          <p className="text-sm font-medium text-white">Pricing basis</p>
          <p className="text-xs text-slate-500">How this contract derives its line-haul base rate</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {MODES.map((m) => {
          const active = value.mode === m.key;
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2.5 transition-colors ${
                active
                  ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                  : 'bg-slate-800 border-white/10 text-slate-300 hover:border-white/20'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={2} />
              <span className="text-xs font-medium">{m.label}</span>
            </button>
          );
        })}
      </div>

      {value.mode === 'flat' ? (
        <p className="text-xs text-slate-500">
          The contract&rsquo;s base rate is used as the line-haul base. Switch to per&nbsp;km or
          per&nbsp;kg to price by shipment distance or weight.
        </p>
      ) : (
        <>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
              Rate per {unit} · floor
            </label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-2.5 text-sm text-slate-500">{currency}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={value.ratePerUnit ?? ''}
                onChange={(e) => setFloor(e.target.value === '' ? null : Number(e.target.value))}
                placeholder="0.00"
                className={`${inputCls} pl-12`}
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-1">
              Used when a shipment&rsquo;s {unit === 'km' ? 'distance' : 'weight'} is below every
              breakpoint. The base rate field above is the flat fallback when {unit === 'km' ? 'distance' : 'weight'} is
              unknown at quote time.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-300">
                Breakpoints <span className="text-slate-600 font-normal">· optional tiered rate table</span>
              </p>
              <button
                type="button"
                onClick={addTier}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2.5 py-1 text-xs hover:bg-amber-500/20"
              >
                <Plus className="w-3 h-3" /> Add tier
              </button>
            </div>

            {value.breakpoints.length === 0 ? (
              <p className="text-[11px] text-slate-600 rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2">
                No tiers — every shipment uses the floor rate above. Add a tier to charge a different
                rate (or a flat amount) past a {unit} threshold. The matching tier&rsquo;s rate applies to
                the whole {unit === 'km' ? 'distance' : 'weight'}.
              </p>
            ) : (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="grid grid-cols-[1.1fr_1fr_1fr_28px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <div>From ({unit})</div>
                  <div>Rate / {unit}</div>
                  <div>or Flat amount</div>
                  <div />
                </div>
                {value.breakpoints.map((t, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1.1fr_1fr_1fr_28px] gap-2 px-3 py-2 items-center border-b border-white/5 last:border-b-0"
                  >
                    <input
                      type="number"
                      min={0}
                      step="1"
                      inputMode="decimal"
                      value={t.minQuantity ?? ''}
                      onChange={(e) => setTier(i, { minQuantity: e.target.value === '' ? 0 : Number(e.target.value) })}
                      placeholder="0"
                      className={cellCls}
                      aria-label={`Tier ${i + 1} from ${unit}`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={t.ratePerUnit ?? ''}
                      onChange={(e) => setTier(i, { ratePerUnit: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="—"
                      disabled={(t.flatAmount ?? 0) > 0}
                      className={`${cellCls} disabled:opacity-40`}
                      aria-label={`Tier ${i + 1} rate per ${unit}`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={t.flatAmount ?? ''}
                      onChange={(e) => setTier(i, { flatAmount: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="—"
                      className={cellCls}
                      aria-label={`Tier ${i + 1} flat amount`}
                    />
                    <button
                      type="button"
                      onClick={() => removeTier(i)}
                      aria-label={`Remove tier ${i + 1}`}
                      className="text-slate-500 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-600 mt-1.5">
              Fill a rate per {unit} <span className="text-slate-500">or</span> a flat amount per tier — if
              both, the flat amount wins.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3.5 py-2.5">
            <FlaskConical className="w-4 h-4 text-emerald-300 shrink-0" />
            <div className="text-xs text-emerald-200/90">
              Preview:{' '}
              <span className="text-white font-medium">
                {fmt(sampleQty)} {unit}
              </span>{' '}
              → base{' '}
              <span className="text-white font-medium">
                {currency} {preview.base.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>{' '}
              <span className={preview.applied ? 'text-emerald-300' : 'text-amber-300/80'}>{preview.note}</span>
            </div>
            <input
              type="number"
              min={0}
              step="1"
              inputMode="decimal"
              value={sampleQty}
              onChange={(e) => setSampleQty(Number(e.target.value) || 0)}
              aria-label="Sample quantity for preview"
              className="ml-auto w-20 bg-slate-900/60 border border-emerald-500/30 rounded-lg px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-emerald-400/50"
            />
          </div>

          {issues.length > 0 && (
            <ul className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 space-y-1">
              {issues.map((msg, i) => (
                <li key={i}>• {msg}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ── number helpers ────────────────────────────────────────────────────────────

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function numOrZero(v: unknown): number {
  return numOrNull(v) ?? 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function fmt(n: number): string {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
