'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface BudgetEntry {
  id: string;
  category: string;
  year: number;
  month?: number | null;
  budgetAmount: number;
  actualAmount: number;
  variance: number;
  variancePct: number;
  isOverBudget: boolean;
  utilizationPct: number;
  notes?: string | null;
  source: 'LIVE' | 'MANUAL';
}
interface BudgetSummary {
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  overBudgetCount: number;
}

const CATEGORY_ICON: Record<string, string> = {
  MAINTENANCE: '🔧', FUEL: '⛽', LEASING: '🔑', STAFF_TRANSPORT: '🚌',
  SCHOOL_BUS: '🏫', RAC: '🚗', LOGISTICS: '📦', INSURANCE: '🛡️', OTHER: '📋',
};
const fmtAED = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const MONTHS = ['All Year','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 1, currentYear, currentYear + 1];

/* ─────────────────────────── AddBudgetModal ─────────────────── */
function AddBudgetModal({ year, onClose, onSaved }: { year: number; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ category: 'MAINTENANCE', budgetAmount: 0, notes: '' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.budgetAmount) return alert('Enter budget amount');
    setSaving(true);
    const res = await fetch('/api/finance/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, year }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else alert('Failed to create budget entry');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Add Budget Entry — {year}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Category</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
              {Object.keys(CATEGORY_ICON).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Budget Amount (AED)</label>
            <input type="number" value={form.budgetAmount} min={0} step={100}
              onChange={e => setForm(f => ({ ...f, budgetAmount: Number(e.target.value) }))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Add Budget'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── VarianceBar ────────────────────── */
function VarianceBar({ entry }: { entry: BudgetEntry }) {
  const pct = entry.utilizationPct;
  const color = pct >= 100 ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : pct >= 50 ? 'bg-blue-500' : 'bg-emerald-500';

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{CATEGORY_ICON[entry.category] ?? '📋'}</span>
          <div>
            <p className="text-sm font-medium text-white">{entry.category.replace('_', ' ')}</p>
            {entry.notes && <p className="text-xs text-slate-500">{entry.notes}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {entry.source === 'LIVE' && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">LIVE</span>
          )}
          {entry.isOverBudget ? (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
              +{entry.variancePct}% over
            </span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              {pct}% used
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 bg-slate-700 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(100, pct)}%` }} />
        {pct > 100 && (
          <div className="absolute inset-y-0 right-0 w-1 bg-red-500 animate-pulse" />
        )}
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-slate-500">Budget</p>
          <p className="text-white font-medium">{fmtAED(entry.budgetAmount)}</p>
        </div>
        <div>
          <p className="text-slate-500">Actual</p>
          <p className={`font-medium ${entry.isOverBudget ? 'text-red-400' : 'text-slate-200'}`}>{fmtAED(entry.actualAmount)}</p>
        </div>
        <div>
          <p className="text-slate-500">Variance</p>
          <p className={`font-medium ${entry.isOverBudget ? 'text-red-400' : 'text-emerald-400'}`}>
            {entry.isOverBudget ? '+' : ''}{fmtAED(Math.abs(entry.variance))}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ───────────────────────────── */
export default function BudgetsPage() {
  const now = new Date();
  const [year,     setYear]     = useState(now.getFullYear());
  const [month,    setMonth]    = useState(0); // 0 = full year
  const [budgets,  setBudgets]  = useState<BudgetEntry[]>([]);
  const [summary,  setSummary]  = useState<BudgetSummary | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd,  setShowAdd]  = useState(false);
  const [viewMode, setViewMode] = useState<'cards'|'table'>('cards');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (month) params.set('month', String(month));
      const res = await fetch(`/api/finance/budgets?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setBudgets(data.budgets ?? []);
        setSummary(data.summary ?? null);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const overBudget  = budgets.filter(b => b.isOverBudget);
  const onTrack     = budgets.filter(b => !b.isOverBudget && b.utilizationPct >= 50);
  const underUsed   = budgets.filter(b => b.utilizationPct < 50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Budget vs Actual</h1>
          <p className="text-slate-400 text-sm mt-0.5">Live actuals pulled from all operational modules</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={() => load(true)} disabled={refreshing}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm disabled:opacity-50">
            {refreshing ? '⟳' : '⟳'} Refresh
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-sm">
            + Add Budget
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Total Budget</p>
            <p className="text-xl font-bold mt-1 text-white">{fmtAED(summary.totalBudget)}</p>
          </div>
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Total Actual</p>
            <p className={`text-xl font-bold mt-1 ${summary.totalActual > summary.totalBudget ? 'text-red-400' : 'text-emerald-400'}`}>
              {fmtAED(summary.totalActual)}
            </p>
          </div>
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Variance</p>
            <p className={`text-xl font-bold mt-1 ${summary.totalVariance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {summary.totalVariance > 0 ? '+' : ''}{fmtAED(Math.abs(summary.totalVariance))}
            </p>
          </div>
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Over Budget</p>
            <p className={`text-xl font-bold mt-1 ${summary.overBudgetCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {summary.overBudgetCount} categories
            </p>
          </div>
        </div>
      )}

      {/* Overall utilisation bar */}
      {summary && summary.totalBudget > 0 && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-white font-medium">Overall Budget Utilisation</span>
            <span className={summary.totalActual > summary.totalBudget ? 'text-red-400 font-bold' : 'text-slate-300'}>
              {Math.round((summary.totalActual / summary.totalBudget) * 100)}%
            </span>
          </div>
          <div className="h-4 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${summary.totalActual > summary.totalBudget ? 'bg-red-500' : summary.totalActual / summary.totalBudget > 0.85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, (summary.totalActual / summary.totalBudget) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>AED 0</span>
            <span>{fmtAED(summary.totalBudget)}</span>
          </div>
        </div>
      )}

      {/* Alert banner */}
      {overBudget.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="text-red-400 font-medium">{overBudget.length} categories are over budget</p>
            <p className="text-red-400/70 text-xs">{overBudget.map(b => b.category.replace('_',' ')).join(', ')}</p>
          </div>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <button onClick={() => setViewMode('cards')}
          className={`px-3 py-1.5 rounded-lg text-xs ${viewMode === 'cards' ? 'bg-amber-500 text-black font-semibold' : 'bg-slate-800 text-slate-400'}`}>
          📊 Cards
        </button>
        <button onClick={() => setViewMode('table')}
          className={`px-3 py-1.5 rounded-lg text-xs ${viewMode === 'table' ? 'bg-amber-500 text-black font-semibold' : 'bg-slate-800 text-slate-400'}`}>
          📋 Table
        </button>
        <span className="text-xs text-slate-500 ml-2">
          🟢 {underUsed.length} under-utilized · 🔵 {onTrack.length} on track · 🔴 {overBudget.length} over budget
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4">{[...Array(6)].map((_,i) => <div key={i} className="h-40 bg-slate-800/60 rounded-2xl animate-pulse" />)}</div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-2 gap-4">
          {budgets.map(b => <VarianceBar key={b.id} entry={b} />)}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Category</th>
                <th className="text-left px-5 py-3">Source</th>
                <th className="text-right px-5 py-3">Budget</th>
                <th className="text-right px-5 py-3">Actual</th>
                <th className="text-right px-5 py-3">Variance</th>
                <th className="text-left px-5 py-3">Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => (
                <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3">
                    <span className="mr-2">{CATEGORY_ICON[b.category] ?? '📋'}</span>
                    <span className="text-white">{b.category.replace('_',' ')}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border ${b.source === 'LIVE' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-700/30 text-slate-400 border-slate-600/30'}`}>
                      {b.source}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-300">{fmtAED(b.budgetAmount)}</td>
                  <td className={`px-5 py-3 text-right font-medium ${b.isOverBudget ? 'text-red-400' : 'text-white'}`}>{fmtAED(b.actualAmount)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${b.isOverBudget ? 'text-red-400' : 'text-emerald-400'}`}>
                    {b.isOverBudget ? '+' : '-'}{fmtAED(Math.abs(b.variance))}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-700 rounded-full">
                        <div className={`h-full rounded-full ${b.utilizationPct >= 100 ? 'bg-red-500' : b.utilizationPct >= 85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, b.utilizationPct)}%` }} />
                      </div>
                      <span className="text-xs text-slate-400 w-10 text-right">{b.utilizationPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {summary && (
              <tfoot>
                <tr className="border-t border-white/10 bg-slate-800/40 font-semibold">
                  <td className="px-5 py-3 text-slate-300" colSpan={2}>TOTAL</td>
                  <td className="px-5 py-3 text-right text-white">{fmtAED(summary.totalBudget)}</td>
                  <td className={`px-5 py-3 text-right ${summary.totalActual > summary.totalBudget ? 'text-red-400' : 'text-emerald-400'}`}>{fmtAED(summary.totalActual)}</td>
                  <td className={`px-5 py-3 text-right ${summary.totalVariance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {summary.totalVariance > 0 ? '+' : ''}{fmtAED(Math.abs(summary.totalVariance))}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {summary.totalBudget > 0 ? Math.round((summary.totalActual / summary.totalBudget) * 100) : 0}% overall
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {showAdd && <AddBudgetModal year={year} onClose={() => setShowAdd(false)} onSaved={() => load()} />}
    </div>
  );
}
