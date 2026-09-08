'use client';
import React, { useState } from 'react';
import { Banknote, RefreshCw, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { useFetchedData } from '@/hooks/useFetchedData';
import { useLanguage } from '@/contexts/LanguageContext';

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

const EMPTY_FINANCE: FinanceSummary = {
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
};

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
  general:     { icon: '🧾', color: 'text-[var(--text-muted)]',  bar: 'bg-slate-400' },
  financeInv:  { icon: '🧾', color: 'text-emerald-400',bar: 'bg-emerald-500' },
  payments:    { icon: '💳', color: 'text-green-400',  bar: 'bg-green-500' },
};

export default function FinanceDashboard() {
  const { tLabel } = useLanguage();
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');

  // Session-scoped fetch cache. The date range is part of the URL —
  // changing the filter creates a new cache key, which is what we want
  // (different periods are different queries).
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  const summaryUrl = '/api/finance/summary' + (params.toString() ? `?${params.toString()}` : '');

  const { data: rawData, loading: dataLoading, error: dataError,
          refresh: refreshSummary } =
    useFetchedData<FinanceSummary>(summaryUrl);

  const data: FinanceSummary = rawData ?? EMPTY_FINANCE;
  const loading = dataLoading;
  const error   = dataError ? 'Network error — check database connectivity' : '';

  const reload = () => { refreshSummary(); };

  const s   = data?.summary;
  const mods = data?.modules;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Hub"
        subtitle="Cross-module financial aggregation — read-only reporting layer"
        icon={Banknote}
        accent="emerald"
        actions={
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)]">{tLabel('From')}</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)]">{tLabel('To')}</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-emerald-500/50" />
            </div>
            {(from || to) && (
              <button onClick={() => { setFrom(''); setTo(''); }}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">
                <X className="w-3 h-3" /> {tLabel('Clear')}
              </button>
            )}
            <button onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]">
              <RefreshCw className="w-3.5 h-3.5" /> {tLabel('Refresh')}
            </button>
          </>
        }
      />

      {error && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5 flex items-center gap-3 text-sm">
          <span className="text-amber-400">⚠</span>
          <span className="text-amber-300 flex-1 text-xs">{tLabel(error)}</span>
          <button onClick={reload} className="px-3 py-1 bg-amber-500/20 rounded-lg text-xs text-amber-300 hover:bg-amber-500/30">{tLabel('Retry')}</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-4 border-[var(--border-subtle)] border-t-emerald-500 rounded-full animate-spin" />
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
                tone: 'from-emerald-500 to-teal-600',
                sub: 'Rental + Leasing + General',
              },
              {
                label: 'Vehicle Costs',
                value: s.totalCosts,
                icon: '🔧',
                tone: 'from-amber-500 to-orange-600',
                sub: 'Approved maintenance spend',
              },
              {
                label: 'Gross Profit',
                value: s.grossProfit,
                icon: '💰',
                tone: s.grossProfit >= 0 ? 'from-emerald-500 to-teal-600' : 'from-red-500 to-rose-600',
                sub: `${s.grossMarginPct}% ${tLabel('margin')}`,
              },
              {
                label: 'Cash Received',
                value: mods?.payments.total ?? 0,
                icon: '💳',
                tone: 'from-blue-500 to-indigo-600',
                sub: `${mods?.payments.transactionCount ?? 0} ${tLabel('transactions')}`,
              },
            ].map(card => (
              <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.tone} p-6 shadow-sm`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white/80 text-sm font-medium">{tLabel(card.label)}</p>
                  <span className="text-2xl">{card.icon}</span>
                </div>
                <p className="text-3xl font-bold text-white">AED {fmt(card.value)}</p>
                <p className="text-xs text-white/60 mt-1">{tLabel(card.sub)}</p>
              </div>
            ))}
          </div>

          {/* Gross Margin Bar */}
          <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--text-main)]">{tLabel('P&L Overview')}</h2>
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                s.grossMarginPct >= 30 ? 'bg-green-500/20 text-green-400' :
                s.grossMarginPct >= 0  ? 'bg-amber-500/20 text-amber-400' :
                'bg-red-500/20 text-red-400'
              }`}>{s.grossMarginPct}% {tLabel('margin')}</span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                  <span>{tLabel('Revenue')}</span><span>AED {fmt(s.totalRevenue)}</span>
                </div>
                <div className="h-2.5 bg-[var(--bg-surface-hover)] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                  <span>{tLabel('Costs')}</span><span>AED {fmt(s.totalCosts)}</span>
                </div>
                <div className="h-2.5 bg-[var(--bg-surface-hover)] rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct(s.totalCosts, s.totalRevenue)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                  <span>{tLabel('Gross Profit')}</span><span>AED {fmt(s.grossProfit)}</span>
                </div>
                <div className="h-2.5 bg-[var(--bg-surface-hover)] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${s.grossProfit >= 0 ? 'bg-teal-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.abs(pct(s.grossProfit, s.totalRevenue))}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Module Breakdown */}
          <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-lg font-semibold text-[var(--text-main)]">{tLabel('Revenue & Cost by Module')}</h2>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">{tLabel('Each module owns its own transactions — Finance aggregates read-only')}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-surface)]/60">
                  <tr>
                    {['Module', 'Type', 'Amount (AED)', 'Documents', 'Share of Revenue', ''].map(h => (
                      <th key={h} className="px-5 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{tLabel(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {mods && (Object.entries(mods) as Array<[string, ModuleStat]>).map(([key, mod]) => {
                    const meta  = MODULE_META[key] ?? { icon: '📦', color: 'text-[var(--text-muted)]', bar: 'bg-slate-500' };
                    const share = key !== 'maintenance' && key !== 'payments'
                      ? pct(mod.total, s.totalRevenue) : null;
                    return (
                      <tr key={key} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{meta.icon}</span>
                            <span className="font-medium text-[var(--text-main)]">{tLabel(mod.label)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                            mod.type === 'revenue' ? 'bg-emerald-500/20 text-emerald-400' :
                            mod.type === 'cost'    ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {tLabel(mod.type.toUpperCase())}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`text-lg font-bold ${meta.color}`}>
                            {fmt(mod.total)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-[var(--text-muted)] text-xs">
                          {mod.invoiceCount !== undefined && `${mod.invoiceCount} ${tLabel('invoices')}`}
                          {mod.transactionCount !== undefined && `${mod.transactionCount} ${tLabel('txns')}`}
                        </td>
                        <td className="px-5 py-4 w-48">
                          {share !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-[var(--bg-surface-hover)] rounded-full overflow-hidden">
                                <div className={`h-full ${meta.bar} rounded-full`} style={{ width: `${share}%` }} />
                              </div>
                              <span className="text-xs text-[var(--text-muted)] w-8 text-right rtl:text-left">{share}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {key === 'rental'      && <a href="/rental/invoices" className="text-xs text-blue-400 hover:underline">{tLabel('View →')}</a>}
                          {key === 'leasing'     && <a href="/leasing/invoices" className="text-xs text-violet-400 hover:underline">{tLabel('View →')}</a>}
                          {key === 'maintenance' && <a href="/maintenance/invoices" className="text-xs text-amber-400 hover:underline">{tLabel('View →')}</a>}
                          {key === 'payments'    && <a href="/finance/payments" className="text-xs text-green-400 hover:underline">{tLabel('View →')}</a>}
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
                  <div key={key} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6">
                    <h3 className="text-base font-semibold text-[var(--text-main)] mb-5">{tLabel(label)}</h3>
                    <div className="space-y-3">
                      {rows.map(r => (
                        <div key={r.month} className="flex items-center gap-3">
                          <span className="text-xs text-[var(--text-muted)] w-16 flex-shrink-0">{r.month}</span>
                          <div className="flex-1 h-5 bg-[var(--bg-surface-hover)] rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full flex items-center justify-end pr-2`}
                              style={{ width: `${pct(r.total, max)}%`, minWidth: '2px' }}>
                              {pct(r.total, max) > 20 && (
                                <span className="text-xs text-[var(--text-main)] font-semibold">{fmt(r.total)}</span>
                              )}
                            </div>
                          </div>
                          <span className={`text-xs font-semibold w-24 text-right rtl:text-left ${textColor}`}>AED {fmt(r.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Architecture note */}
          <div className="bg-[var(--bg-surface)]/30 border border-[var(--border-subtle)] rounded-2xl p-5 flex items-start gap-4">
            <span className="text-2xl">ℹ️</span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-main)] mb-1">{tLabel('Hub-and-Spoke Finance Architecture')}</p>
              <p className="text-sm text-[var(--text-muted)]">
                {tLabel('Finance Hub is a read-only aggregation layer. Each operational module (Rental, Leasing, Maintenance) independently processes its own payments without Finance team approval. This dashboard consolidates those numbers in real time. No transaction is blocked waiting for Finance — the hub reads, never writes.')}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
