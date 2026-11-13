'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Sparkles, ShieldAlert, Calculator, Plus } from 'lucide-react';
import {
  RENTAL_VEHICLE_CATEGORIES,
  RENTAL_CUSTOMER_TYPES,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PricingRule {
  id: string;
  name: string;
  vehicleCategory: string;
  baseDailyRate: number;
  weeklyRate?: number;
  monthlyRate?: number;
  currency: string;
  customerType?: string;
  channel?: string;
  isActive: boolean;
  priority: number;
  taxRate: number;
  seasonFrom?: string;
  seasonTo?: string;
  promoCode?: string;
  promoDiscountPct?: number;
  onlineDiscount?: number;
  lateFeePerHour?: number;
  lateFeeCap?: number;
  gracePeriodMin?: number;
  includedKmPerDay?: number;
  excessKmRate?: number;
}

interface AppliedRateEvent {
  id?: string;
  eventCode?: string;
  code?: string;
  name?: string;
  multiplier?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface YieldTraceStep {
  layer?: string;
  step?: string;
  label?: string;
  name?: string;
  multiplier?: number;
  factor?: number;
  dailyRateBefore?: number;
  rateBefore?: number;
  dailyRateAfter?: number;
  rateAfter?: number;
  rationale?: string;
  reason?: string;
  description?: string;
}

interface RateCalcResult {
  appliedRuleId: string | null;
  ruleName: string;
  vehicleCategory: string;
  totalDays: number;
  currency: string;
  dailyRate: number;
  baseRentalCharge: number;
  insuranceCharge: number;
  extraCharges: number;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  breakdown: { label: string; qty: number; unitLabel: string; unitPrice: number; amount: number; type: string }[];
  appliedRateEvent?: AppliedRateEvent | null;
  yieldTrace?: YieldTraceStep[] | { trace?: YieldTraceStep[]; layers?: YieldTraceStep[]; totalAdjustmentPct?: number } | null;
}

/** Synced with canonical RAC categories & customer types */
type CategoryItem = string | { value?: string; code?: string; label?: string };
const VEHICLE_CATEGORIES = (RENTAL_VEHICLE_CATEGORIES as readonly CategoryItem[]).map((item) => {
  const value = typeof item === 'string' ? item : String(item.value ?? item.code ?? '');
  const label =
    typeof item === 'string'
      ? formatRentalCategoryLabel(value)
      : item.label ?? formatRentalCategoryLabel(value);
  return { value, label };
});
type CustTypeItem = string | { value?: string; code?: string };
const CUSTOMER_TYPES = (RENTAL_CUSTOMER_TYPES as readonly CustTypeItem[]).map((item) =>
  (typeof item === 'string' ? item : String(item.value ?? item.code ?? '')).toUpperCase(),
);
const CHANNELS       = ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'];
const CURRENCIES     = ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR'];

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number, c = 'AED') => {
  const val = Number.isFinite(Number(n)) ? Number(n) : 0;
  try {
    return new Intl.NumberFormat('en-AE', { style: 'currency', currency: c || 'AED', minimumFractionDigits: 2 }).format(val);
  } catch {
    return `${c || 'AED'} ${val.toFixed(2)}`;
  }
};
const today = () => new Date().toISOString().split('T')[0];
const addDays = (d: string, n: number) => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split('T')[0];
};

function extractYieldSteps(raw: RateCalcResult['yieldTrace']): YieldTraceStep[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trace)) return raw.trace;
  if (Array.isArray(raw.layers)) return raw.layers;
  return [];
}

// ── Empty rule form ───────────────────────────────────────────────────────────
const emptyRule = (): Partial<PricingRule> => ({
  name: '', vehicleCategory: 'ECONOMY', baseDailyRate: 0, currency: 'AED',
  isActive: true, priority: 0, taxRate: 5, gracePeriodMin: 30,
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RateEnginePage() {
  const [rules, setRules]               = useState<PricingRule[]>([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [loading, setLoading]           = useState(false);
  const [search, setSearch]             = useState('');
  const [filterCat, setFilterCat]       = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [rbacError, setRbacError]       = useState('');

  const [showForm, setShowForm]   = useState(false);
  const [editRule, setEditRule]   = useState<Partial<PricingRule>>(emptyRule());
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');

  // Rate Calculator state
  const [calcOpen, setCalcOpen] = useState(true);
  const [calcInput, setCalcInput] = useState({
    vehicleCategory: 'ECONOMY',
    pickupDate: today(),
    dropoffDate: addDays(today(), 3),
    customerType: 'INDIVIDUAL',
    channel: 'DIRECT',
    currency: 'AED',
    promoCode: '',
    insurancePlanCode: '',
  });
  const [calcResult, setCalcResult]   = useState<RateCalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError]     = useState('');

  const limit = 20;

  // ── Fetch rules ─────────────────────────────────────────────────────────
  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterCat)    sp.set('vehicleCategory', filterCat);
      if (filterActive) sp.set('isActive', filterActive);
      const res  = await fetch('/api/rental/rates?' + sp.toString());
      const json = await res.json();
      const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      setRules(list);
      setTotal(typeof json?.total === 'number' ? json.total : list.length);
    } finally {
      setLoading(false);
    }
  }, [page, filterCat, filterActive]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  // ── Save rule ────────────────────────────────────────────────────────────
  const saveRule = async () => {
    if (!editRule.name?.trim() || !editRule.vehicleCategory || !editRule.baseDailyRate) {
      setFormError('Name, vehicle category, and base daily rate are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    setRbacError('');
    try {
      const method = editRule.id ? 'PUT' : 'POST';
      const url    = editRule.id ? '/api/rental/rates/' + editRule.id : '/api/rental/rates';
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editRule),
      });
      if (res.status === 403) {
        const e = await res.json().catch(() => ({}));
        const msg = e.error ? `Requires RAC Manager permission — ${e.error}` : 'Requires RAC Manager permission to create or edit Master Price List tariffs.';
        setFormError(msg);
        setRbacError(msg);
        return;
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setFormError(e.error ?? 'Save failed');
        return;
      }
      setShowForm(false);
      setEditRule(emptyRule());
      fetchRules();
    } finally {
      setSaving(false);
    }
  };

  // ── Delete rule ──────────────────────────────────────────────────────────
  const deleteRule = async (id: string) => {
    if (!confirm('Delete this pricing rule?')) return;
    setRbacError('');
    const res = await fetch('/api/rental/rates/' + id, { method: 'DELETE' });
    if (res.status === 403) {
      const e = await res.json().catch(() => ({}));
      setRbacError(
        e.error
          ? `Requires RAC Manager permission — ${e.error}`
          : 'Requires RAC Manager permission — Operators cannot delete Master Price List tariff rules.'
      );
      return;
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setRbacError(e.error ?? 'Failed to delete pricing rule.');
      return;
    }
    fetchRules();
  };

  // ── Calculate rate ───────────────────────────────────────────────────────
  const calcRate = async () => {
    setCalcLoading(true);
    setCalcError('');
    setCalcResult(null);
    try {
      const res = await fetch('/api/rental/rates/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calcInput),
      });
      const json = await res.json();
      if (!res.ok) {
        setCalcError(json.error ?? 'Calculation failed');
        return;
      }
      setCalcResult(json);
    } finally {
      setCalcLoading(false);
    }
  };

  const filteredRules = search
    ? rules.filter(
        r =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.vehicleCategory.toLowerCase().includes(search.toLowerCase())
      )
    : rules;

  const yieldSteps = calcResult ? extractYieldSteps(calcResult.yieldTrace) : [];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Master Price List &amp; Rate Engine</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            Single source of truth for RAC daily/weekly/monthly tariffs, promos, event surge &amp; yield quotes
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setCalcOpen(!calcOpen)}
            className="px-4 py-2 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 transition text-sm font-medium flex items-center gap-2"
          >
            <Calculator className="h-4 w-4" />
            {calcOpen ? 'Hide Rate Calculator' : 'Rate Calculator'}
          </button>
          <button
            onClick={() => { setEditRule(emptyRule()); setShowForm(true); setFormError(''); setRbacError(''); }}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> New Tariff Rule
          </button>
        </div>
      </div>

      {/* RBAC 403 Banner */}
      {rbacError && (
        <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 px-4 py-3 text-amber-300 text-sm flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Requires RAC Manager permission</div>
              <div className="text-xs text-amber-200/90 mt-0.5">{rbacError}</div>
            </div>
          </div>
          <button
            onClick={() => setRbacError('')}
            className="text-amber-300 hover:text-white text-xs px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Rate Calculator Panel */}
      {calcOpen && (
        <div className="bg-[var(--bg-surface)]/60 border border-teal-500/20 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-teal-300 flex items-center gap-2">
            <Calculator className="h-5 w-5" /> Live Master Rate &amp; Yield Calculator
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Vehicle Category</label>
              <select
                value={calcInput.vehicleCategory}
                onChange={e => setCalcInput(p => ({ ...p, vehicleCategory: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              >
                {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Pickup Date</label>
              <input
                type="date"
                value={calcInput.pickupDate}
                onChange={e => setCalcInput(p => ({ ...p, pickupDate: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Dropoff Date</label>
              <input
                type="date"
                value={calcInput.dropoffDate}
                onChange={e => setCalcInput(p => ({ ...p, dropoffDate: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Customer Type</label>
              <select
                value={calcInput.customerType}
                onChange={e => setCalcInput(p => ({ ...p, customerType: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              >
                {CUSTOMER_TYPES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Channel</label>
              <select
                value={calcInput.channel}
                onChange={e => setCalcInput(p => ({ ...p, channel: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              >
                {CHANNELS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Currency</label>
              <select
                value={calcInput.currency}
                onChange={e => setCalcInput(p => ({ ...p, currency: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              >
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Promo Code</label>
              <input
                type="text"
                value={calcInput.promoCode}
                placeholder="Optional"
                onChange={e => setCalcInput(p => ({ ...p, promoCode: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Insurance Plan</label>
              <input
                type="text"
                value={calcInput.insurancePlanCode}
                placeholder="e.g. CDW"
                onChange={e => setCalcInput(p => ({ ...p, insurancePlanCode: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              />
            </div>
          </div>
          <button
            onClick={calcRate}
            disabled={calcLoading}
            className="px-6 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition text-sm font-medium disabled:opacity-50"
          >
            {calcLoading ? 'Calculating…' : 'Calculate Rate'}
          </button>

          {calcError && <p className="text-red-400 text-sm">{calcError}</p>}

          {calcResult && (
            <div className="mt-4 space-y-4">
              {/* Applied Rule & Event Surge Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--text-muted)]">Applied Tariff:</span>
                  <span className="text-[var(--text-main)] font-semibold">{calcResult.ruleName}</span>
                </div>

                {calcResult.appliedRateEvent && (
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/35 text-rose-300 text-xs font-semibold">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      Event Surge: {calcResult.appliedRateEvent.name ?? calcResult.appliedRateEvent.eventCode ?? calcResult.appliedRateEvent.code ?? 'Active Event'}
                    </span>
                    {calcResult.appliedRateEvent.multiplier != null && (
                      <span className="font-mono bg-rose-500/20 px-1.5 py-0.5 rounded">
                        {Number(calcResult.appliedRateEvent.multiplier).toFixed(2)}×
                        {' '}({Number(calcResult.appliedRateEvent.multiplier) >= 1 ? '+' : ''}
                        {((Number(calcResult.appliedRateEvent.multiplier) - 1) * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Breakdown Table */}
              <div className="bg-[var(--bg-surface-hover)]/50 rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border-strong)]">
                      <th className="px-4 py-2 text-left">Description</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right">Unit Price</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(calcResult.breakdown ?? []).map((bl, i) => (
                      <tr
                        key={i}
                        className={`border-b border-[var(--border-subtle)]/50 ${
                          bl.type === 'DISCOUNT'
                            ? 'text-amber-400'
                            : bl.type === 'TAX'
                            ? 'text-[var(--text-muted)]'
                            : 'text-[var(--text-main)]'
                        }`}
                      >
                        <td className="px-4 py-2">{bl.label}</td>
                        <td className="px-4 py-2 text-right">{bl.qty} {bl.unitLabel}</td>
                        <td className="px-4 py-2 text-right">{fmt(bl.unitPrice, calcResult.currency)}</td>
                        <td className="px-4 py-2 text-right font-medium">{fmt(bl.amount, calcResult.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-emerald-500/10 font-bold text-emerald-300">
                      <td className="px-4 py-3" colSpan={3}>
                        TOTAL ({calcResult.totalDays} day{calcResult.totalDays !== 1 ? 's' : ''})
                      </td>
                      <td className="px-4 py-3 text-right text-lg">{fmt(calcResult.totalAmount, calcResult.currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Step-by-Step Yield Trace */}
              {yieldSteps.length > 0 && (
                <div className="rounded-xl bg-[var(--bg-surface)]/70 border border-cyan-500/25 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      Step-by-Step Dynamic Yield Trace
                    </div>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Effective Daily Rate: <strong className="text-[var(--text-main)]">{fmt(calcResult.dailyRate, calcResult.currency)}</strong>
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {yieldSteps.map((st, idx) => {
                      const mult = Number(st.multiplier ?? st.factor ?? 1);
                      const pct = (mult - 1) * 100;
                      const before = st.dailyRateBefore ?? st.rateBefore;
                      const after = st.dailyRateAfter ?? st.rateAfter;
                      const tag = st.layer ?? st.step ?? `STEP ${idx + 1}`;
                      const title = st.label ?? st.name ?? tag;
                      const note = st.rationale ?? st.reason ?? st.description;
                      return (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                              {String(tag).replace(/_/g, ' ')}
                            </span>
                            <span className="font-medium text-[var(--text-main)]">{title}</span>
                            {note && <span className="text-[var(--text-muted)] truncate hidden sm:inline">— {note}</span>}
                          </div>
                          <div className="flex items-center gap-3 font-mono">
                            {before != null && after != null && (
                              <span className="text-[var(--text-muted)]">
                                {fmt(before, calcResult.currency)} → <strong className="text-[var(--text-main)]">{fmt(after, calcResult.currency)}</strong>
                              </span>
                            )}
                            <span
                              className={`px-1.5 py-0.5 rounded font-semibold ${
                                pct > 0
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : pct < 0
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-[var(--bg-surface)] text-[var(--text-faint)]'
                              }`}
                            >
                              {mult.toFixed(2)}× ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search tariff rules…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm w-56"
        />
        <select
          value={filterCat}
          onChange={e => { setFilterCat(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
        >
          <option value="">All Categories</option>
          {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select
          value={filterActive}
          onChange={e => { setFilterActive(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <span className="ml-auto text-[var(--text-muted)] text-sm self-center">
          {total} rule{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Rules Table */}
      <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[var(--text-muted)]">Loading…</div>
        ) : filteredRules.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[var(--text-muted)] text-lg">No pricing rules found</p>
            <p className="text-[var(--text-faint)] text-sm mt-1">Create your first rule to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                  <th className="px-4 py-3 text-left">Rule Name</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-right">Daily Rate</th>
                  <th className="px-4 py-3 text-right">Weekly</th>
                  <th className="px-4 py-3 text-right">Monthly</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Channel</th>
                  <th className="px-4 py-3 text-center">Priority</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map(rule => (
                  <tr key={rule.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition">
                    <td className="px-4 py-3 text-[var(--text-main)] font-medium">
                      {rule.name}
                      {rule.promoCode && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          PROMO: {rule.promoCode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300">
                        {formatRentalCategoryLabel(rule.vehicleCategory)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-main)] font-mono">
                      {fmt(rule.baseDailyRate, rule.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)] font-mono">
                      {rule.weeklyRate ? fmt(rule.weeklyRate, rule.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)] font-mono">
                      {rule.monthlyRate ? fmt(rule.monthlyRate, rule.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{rule.customerType ?? 'All'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{rule.channel ?? 'All'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--bg-surface-hover)] text-[var(--text-muted)]">
                        {rule.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rule.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-[var(--bg-surface-hover)]/50 text-[var(--text-muted)]'}`}>
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => {
                            setEditRule({
                              ...rule,
                              vehicleCategory:
                                normalizeRentalCategory(rule.vehicleCategory) || rule.vehicleCategory,
                            });
                            setShowForm(true);
                            setFormError('');
                          }}
                          className="px-3 py-1 rounded text-xs bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="px-3 py-1 rounded text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 text-sm"
          >
            ← Prev
          </button>
          <span className="text-[var(--text-muted)] text-sm">Page {page} of {Math.ceil(total / limit)}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page * limit >= total}
            className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 text-sm"
          >
            Next →
          </button>
        </div>
      )}

      {/* Rule Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)]">
              <h2 className="text-lg font-bold text-[var(--text-main)]">
                {editRule.id ? 'Edit Pricing Rule' : 'New Pricing Rule'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl">×</button>
            </div>
            <div className="p-6 space-y-5">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Basic Info */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-3 uppercase tracking-wider">Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Rule Name *</label>
                    <input
                      type="text"
                      value={editRule.name ?? ''}
                      placeholder="e.g. Standard Economy — Summer 2025"
                      onChange={e => setEditRule(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Vehicle Category *</label>
                    <select
                      value={editRule.vehicleCategory ?? 'ECONOMY'}
                      onChange={e => setEditRule(p => ({ ...p, vehicleCategory: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    >
                      {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Currency</label>
                    <select
                      value={editRule.currency ?? 'AED'}
                      onChange={e => setEditRule(p => ({ ...p, currency: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    >
                      {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Priority (higher = preferred)</label>
                    <input
                      type="number"
                      value={editRule.priority ?? 0}
                      onChange={e => setEditRule(p => ({ ...p, priority: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-5">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={editRule.isActive ?? true}
                      onChange={e => setEditRule(p => ({ ...p, isActive: e.target.checked }))}
                      className="w-4 h-4 accent-emerald-500"
                    />
                    <label htmlFor="isActive" className="text-sm text-[var(--text-muted)]">Active</label>
                  </div>
                </div>
              </div>

              {/* Rates */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-3 uppercase tracking-wider">Rates</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Base Daily Rate *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.baseDailyRate ?? 0}
                      onChange={e => setEditRule(p => ({ ...p, baseDailyRate: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Weekly Rate (7-day total)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.weeklyRate ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, weeklyRate: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="Auto from daily"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Monthly Rate (30-day total)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.monthlyRate ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, monthlyRate: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="Auto from daily"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Tax Rate (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.taxRate ?? 5}
                      onChange={e => setEditRule(p => ({ ...p, taxRate: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Online Discount (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.onlineDiscount ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, onlineDiscount: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Segmentation */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-3 uppercase tracking-wider">Customer Segmentation</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Customer Type (blank = all)</label>
                    <select
                      value={editRule.customerType ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, customerType: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    >
                      <option value="">All Customers</option>
                      {CUSTOMER_TYPES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Channel (blank = all)</label>
                    <select
                      value={editRule.channel ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, channel: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    >
                      <option value="">All Channels</option>
                      {CHANNELS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Season */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-3 uppercase tracking-wider">Season / Validity</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Season From</label>
                    <input
                      type="date"
                      value={editRule.seasonFrom?.split('T')[0] ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, seasonFrom: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Season To</label>
                    <input
                      type="date"
                      value={editRule.seasonTo?.split('T')[0] ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, seasonTo: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Promo */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-3 uppercase tracking-wider">Promo Code</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Promo Code</label>
                    <input
                      type="text"
                      value={editRule.promoCode ?? ''}
                      placeholder="e.g. SUMMER25"
                      onChange={e => setEditRule(p => ({ ...p, promoCode: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Promo Discount (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.promoDiscountPct ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, promoDiscountPct: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Late Fees / KM */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-3 uppercase tracking-wider">Late Return &amp; Mileage Policy</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Grace Period (min)</label>
                    <input
                      type="number"
                      value={editRule.gracePeriodMin ?? 30}
                      onChange={e => setEditRule(p => ({ ...p, gracePeriodMin: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Late Fee / Hour</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.lateFeePerHour ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, lateFeePerHour: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Late Fee Cap</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.lateFeeCap ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, lateFeeCap: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="No cap"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Included KM / Day</label>
                    <input
                      type="number"
                      value={editRule.includedKmPerDay ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, includedKmPerDay: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="Unlimited"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Excess KM Rate</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editRule.excessKmRate ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, excessKmRate: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                      placeholder="0 per km"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end p-6 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setShowForm(false)}
                className="px-5 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={saving}
                className="px-6 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving…' : editRule.id ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
