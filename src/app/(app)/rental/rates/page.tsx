'use client';
import { useState, useEffect, useCallback } from 'react';

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
}

/** Synced with Fleet VEHICLE_SEGMENTS — pricing rules match fleet vehicle categories */
const VEHICLE_CATEGORIES = [
  { value: 'ECONOMY',       label: 'Economy'           },
  { value: 'COMPACT',       label: 'Compact'           },
  { value: 'MID_SIZE',      label: 'Mid-size'          },
  { value: 'FULL_SIZE',     label: 'Full-size'         },
  { value: 'COMPACT_SUV',   label: 'SUV – Compact'     },
  { value: 'MID_SIZE_SUV',  label: 'SUV – Mid-size'    },
  { value: 'FULL_SIZE_SUV', label: 'SUV – Full-size'   },
  { value: 'LUXURY',        label: 'Luxury'            },
  { value: 'PREMIUM',       label: 'Premium'           },
  { value: 'SPORTS',        label: 'Sports'            },
  { value: 'VAN',           label: 'Van / People Mover'},
  { value: 'PICKUP',        label: 'Pickup / Commercial'},
  { value: 'BUS',           label: 'Bus'               },
  { value: 'SPECIAL',       label: 'Special / Heavy'   },
];
const CUSTOMER_TYPES     = ['INDIVIDUAL', 'CORPORATE', 'AIRLINE', 'FREQUENT_FLYER', 'INSURANCE', 'GOVERNMENT'];
const CHANNELS           = ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'];
const CURRENCIES         = ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR'];

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number, c = 'AED') => new Intl.NumberFormat('en-AE', { style: 'currency', currency: c, minimumFractionDigits: 2 }).format(n);
const today = () => new Date().toISOString().split('T')[0];
const addDays = (d: string, n: number) => {
  const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split('T')[0];
};

// ── Empty rule form ───────────────────────────────────────────────────────────
const emptyRule = (): Partial<PricingRule> => ({
  name: '', vehicleCategory: 'ECONOMY', baseDailyRate: 0, currency: 'AED',
  isActive: true, priority: 0, taxRate: 5, gracePeriodMin: 30,
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RateEnginePage() {
  const [rules, setRules]           = useState<PricingRule[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [filterActive, setFilterActive] = useState('');

  const [showForm, setShowForm]     = useState(false);
  const [editRule, setEditRule]     = useState<Partial<PricingRule>>(emptyRule());
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  // Rate Calculator state
  const [calcOpen, setCalcOpen]     = useState(false);
  const [calcInput, setCalcInput]   = useState({
    vehicleCategory: 'ECONOMY',
    pickupDate: today(),
    dropoffDate: addDays(today(), 3),
    customerType: 'INDIVIDUAL',
    channel: 'DIRECT',
    currency: 'AED',
    promoCode: '',
    insurancePlanCode: '',
  });
  const [calcResult, setCalcResult] = useState<RateCalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError]   = useState('');

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
      setRules(json.data ?? []);
      setTotal(json.total ?? 0);
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
    setSaving(true); setFormError('');
    try {
      const method = editRule.id ? 'PUT' : 'POST';
      const url    = editRule.id ? '/api/rental/rates/' + editRule.id : '/api/rental/rates';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editRule) });
      if (!res.ok) { const e = await res.json(); setFormError(e.error ?? 'Save failed'); return; }
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
    await fetch('/api/rental/rates/' + id, { method: 'DELETE' });
    fetchRules();
  };

  // ── Calculate rate ───────────────────────────────────────────────────────
  const calcRate = async () => {
    setCalcLoading(true); setCalcError(''); setCalcResult(null);
    try {
      const res  = await fetch('/api/rental/rates/calculate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calcInput),
      });
      const json = await res.json();
      if (!res.ok) { setCalcError(json.error ?? 'Calculation failed'); return; }
      setCalcResult(json);
    } finally {
      setCalcLoading(false);
    }
  };

  const filteredRules = search
    ? rules.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.vehicleCategory.toLowerCase().includes(search.toLowerCase()))
    : rules;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Rate Engine</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage pricing rules for all vehicle categories</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setCalcOpen(!calcOpen)}
            className="px-4 py-2 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 transition text-sm font-medium"
          >
            🧮 Rate Calculator
          </button>
          <button
            onClick={() => { setEditRule(emptyRule()); setShowForm(true); setFormError(''); }}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition text-sm font-medium"
          >
            + New Pricing Rule
          </button>
        </div>
      </div>

      {/* Rate Calculator Panel */}
      {calcOpen && (
        <div className="bg-slate-800/60 border border-teal-500/20 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-teal-300 flex items-center gap-2">🧮 Rate Calculator Preview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Vehicle Category</label>
              <select
                value={calcInput.vehicleCategory}
                onChange={e => setCalcInput(p => ({ ...p, vehicleCategory: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Pickup Date</label>
              <input type="date" value={calcInput.pickupDate}
                onChange={e => setCalcInput(p => ({ ...p, pickupDate: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Dropoff Date</label>
              <input type="date" value={calcInput.dropoffDate}
                onChange={e => setCalcInput(p => ({ ...p, dropoffDate: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Customer Type</label>
              <select value={calcInput.customerType}
                onChange={e => setCalcInput(p => ({ ...p, customerType: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                {CUSTOMER_TYPES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Channel</label>
              <select value={calcInput.channel}
                onChange={e => setCalcInput(p => ({ ...p, channel: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                {CHANNELS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Currency</label>
              <select value={calcInput.currency}
                onChange={e => setCalcInput(p => ({ ...p, currency: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Promo Code</label>
              <input type="text" value={calcInput.promoCode} placeholder="Optional"
                onChange={e => setCalcInput(p => ({ ...p, promoCode: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Insurance Plan</label>
              <input type="text" value={calcInput.insurancePlanCode} placeholder="e.g. CDW"
                onChange={e => setCalcInput(p => ({ ...p, insurancePlanCode: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
            </div>
          </div>
          <button
            onClick={calcRate} disabled={calcLoading}
            className="px-6 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition text-sm font-medium disabled:opacity-50"
          >
            {calcLoading ? 'Calculating…' : 'Calculate Rate'}
          </button>

          {calcError && <p className="text-red-400 text-sm">{calcError}</p>}

          {calcResult && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Applied Rule</span>
                <span className="text-sm text-white font-medium">{calcResult.ruleName}</span>
              </div>
              <div className="bg-slate-700/50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-400 border-b border-slate-600">
                      <th className="px-4 py-2 text-left">Description</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right">Unit Price</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcResult.breakdown.map((bl, i) => (
                      <tr key={i} className={`border-b border-slate-700/50 ${bl.type === 'DISCOUNT' ? 'text-amber-400' : bl.type === 'TAX' ? 'text-slate-400' : 'text-white'}`}>
                        <td className="px-4 py-2">{bl.label}</td>
                        <td className="px-4 py-2 text-right">{bl.qty} {bl.unitLabel}</td>
                        <td className="px-4 py-2 text-right">{fmt(bl.unitPrice, calcResult.currency)}</td>
                        <td className="px-4 py-2 text-right font-medium">{fmt(bl.amount, calcResult.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-emerald-500/10 font-bold text-emerald-300">
                      <td className="px-4 py-3" colSpan={3}>TOTAL ({calcResult.totalDays} day{calcResult.totalDays !== 1 ? 's' : ''})</td>
                      <td className="px-4 py-3 text-right text-lg">{fmt(calcResult.totalAmount, calcResult.currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text" placeholder="Search rules…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm w-56"
        />
        <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm">
          <option value="">All Categories</option>
          {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filterActive} onChange={e => { setFilterActive(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm">
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <span className="ml-auto text-slate-400 text-sm self-center">{total} rule{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Rules Table */}
      <div className="bg-slate-800/60 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading…</div>
        ) : filteredRules.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-400 text-lg">No pricing rules found</p>
            <p className="text-slate-500 text-sm mt-1">Create your first rule to get started</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-slate-400">
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
                <tr key={rule.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-4 py-3 text-white font-medium">
                    {rule.name}
                    {rule.promoCode && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        PROMO: {rule.promoCode}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300">
                      {rule.vehicleCategory}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-white font-mono">
                    {fmt(rule.baseDailyRate, rule.currency)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300 font-mono">
                    {rule.weeklyRate ? fmt(rule.weeklyRate, rule.currency) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300 font-mono">
                    {rule.monthlyRate ? fmt(rule.monthlyRate, rule.currency) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{rule.customerType ?? 'All'}</td>
                  <td className="px-4 py-3 text-slate-300">{rule.channel ?? 'All'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">
                      {rule.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rule.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/50 text-slate-400'}`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => { setEditRule({ ...rule }); setShowForm(true); setFormError(''); }}
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
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 text-sm">
            ← Prev
          </button>
          <span className="text-slate-400 text-sm">Page {page} of {Math.ceil(total / limit)}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total}
            className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 text-sm">
            Next →
          </button>
        </div>
      )}

      {/* Rule Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">{editRule.id ? 'Edit Pricing Rule' : 'New Pricing Rule'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            <div className="p-6 space-y-5">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">{formError}</div>
              )}

              {/* Basic Info */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">Rule Name *</label>
                    <input type="text" value={editRule.name ?? ''} placeholder="e.g. Standard Economy — Summer 2025"
                      onChange={e => setEditRule(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Vehicle Category *</label>
                    <select value={editRule.vehicleCategory ?? 'ECONOMY'}
                      onChange={e => setEditRule(p => ({ ...p, vehicleCategory: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                      {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Currency</label>
                    <select value={editRule.currency ?? 'AED'}
                      onChange={e => setEditRule(p => ({ ...p, currency: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                      {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Priority (higher = preferred)</label>
                    <input type="number" value={editRule.priority ?? 0}
                      onChange={e => setEditRule(p => ({ ...p, priority: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                  <div className="flex items-center gap-3 pt-5">
                    <input type="checkbox" id="isActive" checked={editRule.isActive ?? true}
                      onChange={e => setEditRule(p => ({ ...p, isActive: e.target.checked }))}
                      className="w-4 h-4 accent-emerald-500" />
                    <label htmlFor="isActive" className="text-sm text-slate-300">Active</label>
                  </div>
                </div>
              </div>

              {/* Rates */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Rates</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Base Daily Rate *</label>
                    <input type="number" step="0.01" value={editRule.baseDailyRate ?? 0}
                      onChange={e => setEditRule(p => ({ ...p, baseDailyRate: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Weekly Rate (7-day total)</label>
                    <input type="number" step="0.01" value={editRule.weeklyRate ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, weeklyRate: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="Auto from daily" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Monthly Rate (30-day total)</label>
                    <input type="number" step="0.01" value={editRule.monthlyRate ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, monthlyRate: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="Auto from daily" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tax Rate (%)</label>
                    <input type="number" step="0.01" value={editRule.taxRate ?? 5}
                      onChange={e => setEditRule(p => ({ ...p, taxRate: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Online Discount (%)</label>
                    <input type="number" step="0.01" value={editRule.onlineDiscount ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, onlineDiscount: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="0" />
                  </div>
                </div>
              </div>

              {/* Segmentation */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Customer Segmentation</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Customer Type (blank = all)</label>
                    <select value={editRule.customerType ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, customerType: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                      <option value="">All Customers</option>
                      {CUSTOMER_TYPES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Channel (blank = all)</label>
                    <select value={editRule.channel ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, channel: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                      <option value="">All Channels</option>
                      {CHANNELS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Season */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Season / Validity</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Season From</label>
                    <input type="date" value={editRule.seasonFrom?.split('T')[0] ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, seasonFrom: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Season To</label>
                    <input type="date" value={editRule.seasonTo?.split('T')[0] ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, seasonTo: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                </div>
              </div>

              {/* Promo */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Promo Code</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Promo Code</label>
                    <input type="text" value={editRule.promoCode ?? ''} placeholder="e.g. SUMMER25"
                      onChange={e => setEditRule(p => ({ ...p, promoCode: e.target.value || undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Promo Discount (%)</label>
                    <input type="number" step="0.01" value={editRule.promoDiscountPct ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, promoDiscountPct: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="0" />
                  </div>
                </div>
              </div>

              {/* Late Fees / KM */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Late Return & Mileage Policy</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Grace Period (min)</label>
                    <input type="number" value={editRule.gracePeriodMin ?? 30}
                      onChange={e => setEditRule(p => ({ ...p, gracePeriodMin: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Late Fee / Hour</label>
                    <input type="number" step="0.01" value={editRule.lateFeePerHour ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, lateFeePerHour: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Late Fee Cap</label>
                    <input type="number" step="0.01" value={editRule.lateFeeCap ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, lateFeeCap: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="No cap" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Included KM / Day</label>
                    <input type="number" value={editRule.includedKmPerDay ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, includedKmPerDay: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="Unlimited" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Excess KM Rate</label>
                    <input type="number" step="0.01" value={editRule.excessKmRate ?? ''}
                      onChange={e => setEditRule(p => ({ ...p, excessKmRate: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" placeholder="0 per km" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end p-6 border-t border-white/10">
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm">
                Cancel
              </button>
              <button onClick={saveRule} disabled={saving}
                className="px-6 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving…' : editRule.id ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
