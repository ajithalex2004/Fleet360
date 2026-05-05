'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface ModuleStat {
  label: string;
  type: 'cost' | 'revenue' | 'cash';
  total: number;
  invoiceCount?: number;
  transactionCount?: number;
  currency: string;
}

interface FinanceSummary {
  period: { from: string | null; to: string | null };
  modules: {
    maintenance: ModuleStat;
    rental:      ModuleStat;
    leasing:     ModuleStat;
    general:     ModuleStat;
    financeInv:  ModuleStat;
    payments:    ModuleStat;
  };
  summary: {
    totalRevenue: number;
    totalCosts: number;
    grossProfit: number;
    grossMarginPct: number;
    currency: string;
  };
  trends: {
    maintenance: Array<{ month: string; total: number; count: number }>;
    rental:      Array<{ month: string; total: number; count: number }>;
    invoices:    Array<{ month: string; total: number; count: number }>;
  };
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

const MODULE_META: Record<string, { icon: string; color: string; bar: string }> = {
  maintenance: { icon: '🔧', color: 'text-amber-400',  bar: 'bg-amber-500' },
  rental:      { icon: '🚗', color: 'text-blue-400',   bar: 'bg-blue-500' },
  leasing:     { icon: '📄', color: 'text-violet-400', bar: 'bg-violet-500' },
  general:     { icon: '🧾', color: 'text-slate-300',  bar: 'bg-slate-400' },
  financeInv:  { icon: '🧾', color: 'text-emerald-400',bar: 'bg-emerald-500' },
  payments:    { icon: '💳', color: 'text-green-400',  bar: 'bg-green-500' },
};

export default function FinanceDashboard() {
  const [data, setData]     = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    try {
      const res = await fetch('/api/finance/summary?' + params);
      if (res.ok) {
        setData(await res.json());
      } else {
        // Non-blocking: show zero data + soft warning
        const errBody = await res.json().catch(() => ({}));
        setError(errBody?.details ?? `API returned ${res.status} — showing cached zeros`);
        // Still render the dashboard with zeros so navigation works
        setData(prev => prev ?? {
          period: { from: null, to: null },
          modules: {
            maintenance: { label:'Vehicle Maintenance', type:'cost',    total:0, invoiceCount:0, currency:'AED' },
            rental:      { label:'Rent-A-Car (RAC)',    type:'revenue', total:0, invoiceCount:0, currency:'AED' },
            leasing:     { label:'Vehicle Leasing',     type:'revenue', total:0, invoiceCount:0, currency:'AED' },
            general:     { label:'General Invoicing',   type:'revenue', total:0, invoiceCount:0, currency:'AED' },
            financeInv:  { label:'Finance Invoices',    type:'revenue', total:0, invoiceCount:0, currency:'AED' },
            payments:    { label:'Received Payments',   type:'cash',    total:0, transactionCount:0, currency:'AED' },
          },
          summary: { totalRevenue:0, totalCosts:0, grossProfit:0, grossMarginPct:0, currency:'AED' },
          trends:  { maintenance:[], rental:[], invoices:[] },
        });
      }
    } catch {
      setError('Network error — check database connectivity');
      setData(prev => prev ?? {
        period: { from: null, to: null },
        modules: {
          maintenance: { label:'Vehicle Maintenance', type:'cost',    total:0, invoiceCount:0, currency:'AED' },
          rental:      { label:'Rent-A-Car (RAC)',    type:'revenue', total:0, invoiceCount:0, currency:'AED' },
          leasing:     { label:'Vehicle Leasing',     type:'revenue', total:0, invoiceCount:0, currency:'AED' },
          general:     { label:'General Invoicing',   type:'revenue', total:0, invoiceCount:0, currency:'AED' },
          financeInv:  { label:'Finance Invoices',    type:'revenue', total:0, invoiceCount:0, currency:'AED' },
          payments:    { label:'Received Payments',   type:'cash',    total:0, transactionCount:0, currency:'AED' },
        },
        summary: { totalRevenue:0, totalCosts:0, grossProfit:0, grossMarginPct:0, currency:'AED' },
        trends:  { maintenance:[], rental:[], invoices:[] },
      });
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const s   = data?.summary;
  const mods = data?.modules;
  const maxRevenue = Math.max(
    mods?.rental.total      ?? 0,
    mods?.leasing.total     ?? 0,
    mods?.general.total     ?? 0,
    mods?.maintenance.total ?? 0,
    1,
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Finance Hub</h1>
          <p className="text-slate-400 mt-1">Cross-module financial aggregation — read-only reporting layer</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50" />
          </div>
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo(''); }}
              className="px-3 py-2 text-xs text-slate-400 hover:text-white bg-slate-800 border border-white/10 rounded-lg">
              Clear
            </button>
          )}
          <button onClick={load} className="px-4 py-2 text-sm bg-slate-800 border border-white/10 text-slate-300 rounded-xl hover:bg-slate-700">
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5 flex items-center gap-3 text-sm">
          <span className="text-amber-400">⚠</span>
          <span className="text-amber-300 flex-1 text-xs">{error}</span>
          <button onClick={load} className="px-3 py-1 bg-amber-500/20 rounded-lg text-xs text-amber-300 hover:bg-amber-500/30">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-4 border-slate-700 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      ) : s && (
        <>
          {/* P&L Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Total Revenue',
                value: s.totalRevenue,
                icon: '📈',
                color: 'text-emerald-400',
                bg: 'from-emerald-500/10 to-teal-500/10',
                border: 'border-emerald-500/20',
                sub: 'Rental + Leasing + General',
              },
              {
                label: 'Vehicle Costs',
                value: s.totalCosts,
                icon: '🔧',
                color: 'text-amber-400',
                bg: 'from-amber-500/10 to-yellow-500/10',
                border: 'border-amber-500/20',
                sub: 'Approved maintenance spend',
              },
              {
                label: 'Gross Profit',
                value: s.grossProfit,
                icon: '💰',
                color: s.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400',
                bg: s.grossProfit >= 0 ? 'from-emerald-500/10 to-teal-500/10' : 'from-red-500/10 to-rose-500/10',
                border: s.grossProfit >= 0 ? 'border-emerald-500/20' : 'border-red-500/20',
                sub: `${s.grossMarginPct}% margin`,
              },
              {
                label: 'Cash Received',
                value: mods?.payments.total ?? 0,
                icon: '💳',
                color: 'text-blue-400',
                bg: 'from-blue-500/10 to-indigo-500/10',
                border: 'border-blue-500/20',
                sub: `${mods?.payments.transactionCount ?? 0} transactions`,
              },
            ].map(card => (
              <div key={card.label} className={`bg-gradient-to-br ${card.bg} border ${card.border} rounded-2xl p-6`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-slate-400 text-sm font-medium">{card.label}</p>
                  <span className="text-2xl">{card.icon}</span>
                </div>
                <p className={`text-3xl font-bold ${card.color}`}>AED {fmt(card.value)}</p>
                <p className="text-xs text-slate-500 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Gross Margin Bar */}
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">P&amp;L Overview</h2>
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                s.grossMarginPct >= 30 ? 'bg-green-500/20 text-green-400' :
                s.grossMarginPct >= 0  ? 'bg-amber-500/20 text-amber-400' :
                'bg-red-500/20 text-red-400'
              }`}>{s.grossMarginPct}% margin</span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Revenue</span><span>AED {fmt(s.totalRevenue)}</span>
                </div>
                <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Costs</span><span>AED {fmt(s.totalCosts)}</span>
                </div>
                <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct(s.totalCosts, s.totalRevenue)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Gross Profit</span><span>AED {fmt(s.grossProfit)}</span>
                </div>
                <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${s.grossProfit >= 0 ? 'bg-teal-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.abs(pct(s.grossProfit, s.totalRevenue))}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Module Breakdown */}
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">Revenue &amp; Cost by Module</h2>
              <p className="text-sm text-slate-400 mt-0.5">Each module owns its own transactions — Finance aggregates read-only</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/60">
                  <tr>
                    {['Module', 'Type', 'Amount (AED)', 'Documents', 'Share of Revenue', ''].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {mods && (Object.entries(mods) as Array<[string, ModuleStat]>).map(([key, mod]) => {
                    const meta  = MODULE_META[key] ?? { icon: '📦', color: 'text-slate-300', bar: 'bg-slate-500' };
                    const share = key !== 'maintenance' && key !== 'payments'
                      ? pct(mod.total, s.totalRevenue) : null;
                    return (
                      <tr key={key} className="hover:bg-white/5 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{meta.icon}</span>
                            <span className="font-medium text-white">{mod.label}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                            mod.type === 'revenue' ? 'bg-emerald-500/20 text-emerald-400' :
                            mod.type === 'cost'    ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {mod.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`text-lg font-bold ${meta.color}`}>
                            {fmt(mod.total)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-400 text-xs">
                          {mod.invoiceCount !== undefined && `${mod.invoiceCount} invoices`}
                          {mod.transactionCount !== undefined && `${mod.transactionCount} txns`}
                        </td>
                        <td className="px-5 py-4 w-48">
                          {share !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div className={`h-full ${meta.bar} rounded-full`} style={{ width: `${share}%` }} />
                              </div>
                              <span className="text-xs text-slate-400 w-8 text-right">{share}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {key === 'rental'      && <a href="/rental/invoices" className="text-xs text-blue-400 hover:underline">View →</a>}
                          {key === 'leasing'     && <a href="/leasing/invoices" className="text-xs text-violet-400 hover:underline">View →</a>}
                          {key === 'maintenance' && <a href="/maintenance/invoices" className="text-xs text-amber-400 hover:underline">View →</a>}
                          {key === 'payments'    && <a href="/finance/payments" className="text-xs text-green-400 hover:underline">View →</a>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly Trends */}
          {(data!.trends.maintenance.length > 0 || data!.trends.rental.length > 0 || data!.trends.invoices.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {([
                { key: 'maintenance' as const, label: 'Maintenance Costs', color: 'bg-amber-500', textColor: 'text-amber-400' },
                { key: 'rental'      as const, label: 'Rental Revenue',    color: 'bg-blue-500',  textColor: 'text-blue-400' },
                { key: 'invoices'    as const, label: 'Finance Invoices',  color: 'bg-emerald-500', textColor: 'text-emerald-400' },
              ]).map(({ key, label, color, textColor }) => {
                const rows = data!.trends[key];
                if (!rows.length) return null;
                const max = Math.max(...rows.map(r => r.total), 1);
                return (
                  <div key={key} className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
                    <h3 className="text-base font-semibold text-white mb-5">{label}</h3>
                    <div className="space-y-3">
                      {rows.map(r => (
                        <div key={r.month} className="flex items-center gap-3">
                          <span className="text-xs text-slate-400 w-16 flex-shrink-0">{r.month}</span>
                          <div className="flex-1 h-5 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full flex items-center justify-end pr-2`}
                              style={{ width: `${pct(r.total, max)}%`, minWidth: '2px' }}>
                              {pct(r.total, max) > 20 && (
                                <span className="text-xs text-white font-semibold">{fmt(r.total)}</span>
                              )}
                            </div>
                          </div>
                          <span className={`text-xs font-semibold w-24 text-right ${textColor}`}>AED {fmt(r.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Architecture note */}
          <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-5 flex items-start gap-4">
            <span className="text-2xl">ℹ️</span>
            <div>
              <p className="text-sm font-semibold text-white mb-1">Hub-and-Spoke Finance Architecture</p>
              <p className="text-sm text-slate-400">
                Finance Hub is a <em>read-only aggregation layer</em>. Each operational module (Rental, Leasing, Maintenance) independently
                processes its own payments without Finance team approval. This dashboard consolidates those numbers in real time.
                No transaction is blocked waiting for Finance — the hub reads, never writes.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
