'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';

/* ── Types ───────────────────────────────────────────────────────────────── */
interface Vehicle {
  vehicle_no: string; module: string; branch: string;
  invoice_count: number; gross_revenue: number; collected: number;
  outstanding: number; vat_collected: number;
  maint_cost: number; maint_count: number; depreciation: number;
  total_cost: number; net_margin: number; margin_pct: number;
  first_invoice: string | null; last_invoice: string | null;
}
interface Customer {
  client_name: string; client_email: string | null;
  invoice_count: number; lifetime_revenue: number; total_paid: number;
  outstanding: number; avg_invoice: number; relationship_days: number;
  modules_used: number; vehicles_rented: number; branches_used: number;
  module_list: string; first_invoice: string | null; last_invoice: string | null;
}
interface BranchRow {
  branch: string; module: string; invoice_count: number;
  gross_revenue: number; collected: number; vat_amount: number; customer_count: number;
}
interface Totals { gross_revenue: number; collected: number; outstanding: number; maint_cost: number; depreciation: number; net_margin: number; }

const fmt  = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtD = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB') : '—';
const pct  = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

const MARGIN_COLOR = (m: number) =>
  m >= 50 ? 'text-emerald-400' : m >= 20 ? 'text-teal-400' : m >= 0 ? 'text-amber-400' : 'text-red-400';

const BRANCHES = ['','Dubai','Abu Dhabi','Sharjah','Ajman','Fujairah','Ras Al Khaimah','Umm Al Quwain'];
const MODULES  = ['','LEASE','RENTAL','GENERAL'];

/* ── Main Page ───────────────────────────────────────────────────────────── */
export default function RevenueAnalysisPage() {
  const [view,      setView]      = useState<'vehicle' | 'customer' | 'branch'>('vehicle');
  const [vehicles,  setVehicles]  = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches,  setBranches]  = useState<BranchRow[]>([]);
  const [totals,    setTotals]    = useState<Totals | null>(null);
  const [branch,    setBranch]    = useState('');
  const [module,    setModule]    = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(true);
  const [sortKey,   setSortKey]   = useState<string>('gross_revenue');
  const [sortDir,   setSortDir]   = useState<'desc' | 'asc'>('desc');

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ view });
    if (branch)   p.set('branch',    branch);
    if (module)   p.set('module',    module);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo)   p.set('date_to',   dateTo);
    if (search)   p.set('search',    search);
    const res  = await fetch(`/api/finance/revenue-analysis?${p}`);
    const data = await res.json();
    setVehicles(data.vehicles ?? []);
    setCustomers(data.customers ?? []);
    setBranches(data.branches ?? []);
    setTotals(data.totals ?? null);
    setLoading(false);
  }, [view, branch, module, dateFrom, dateTo, search]);

  useEffect(() => { load(); }, [load]);

  function sort<T>(arr: T[], key: keyof T) {
    return [...arr].sort((a, b) => {
      const va = a[key] as number, vb = b[key] as number;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }
  function toggleSort(key: string) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }
  const SortIcon = ({ k }: { k: string }) =>
    <span className="ml-1 opacity-50">{sortKey === k ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>;

  function exportVehicles() {
    downloadXLSX('Revenue-by-Vehicle.xls', vehicles.map(v => ({
      'Vehicle No':     v.vehicle_no,  'Module': v.module, 'Branch': v.branch,
      'Invoices':       v.invoice_count, 'Gross Revenue': v.gross_revenue,
      'Collected':      v.collected, 'Outstanding': v.outstanding,
      'Maint Cost':     v.maint_cost, 'Depreciation': v.depreciation,
      'Total Cost':     v.total_cost, 'Net Margin': v.net_margin, 'Margin %': v.margin_pct,
    })));
  }
  function exportCustomers() {
    downloadXLSX('Revenue-by-Customer.xls', customers.map(c => ({
      'Customer':       c.client_name, 'Email': c.client_email ?? '',
      'Invoices':       c.invoice_count, 'Lifetime Revenue': c.lifetime_revenue,
      'Total Paid':     c.total_paid, 'Outstanding': c.outstanding,
      'Avg Invoice':    c.avg_invoice, 'Relationship Days': c.relationship_days,
      'Modules Used':   c.module_list, 'Vehicles Used': c.vehicles_rented,
    })));
  }

  const sortedVehicles  = sort(vehicles,  sortKey as keyof Vehicle);
  const sortedCustomers = sort(customers, sortKey as keyof Customer);

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Revenue Analysis</h1>
          <p className="text-slate-400 text-sm mt-1">Vehicle profitability · Customer lifetime value · Branch breakdown</p>
        </div>
        <button onClick={view === 'vehicle' ? exportVehicles : exportCustomers}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700/40 hover:bg-emerald-700/60 border border-emerald-500/30 text-emerald-300 text-sm font-medium">
          ⬇ Export XLSX
        </button>
      </div>

      {/* View tabs */}
      <div className="flex bg-slate-800 rounded-xl p-1 gap-1 mb-6 w-fit">
        {(['vehicle','customer','branch'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${view === v ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {v === 'vehicle' ? '🚗 By Vehicle' : v === 'customer' ? '👥 By Customer' : '🏢 By Branch'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select value={branch} onChange={e => setBranch(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white">
          <option value="">All Branches</option>
          {BRANCHES.filter(Boolean).map(b => <option key={b}>{b}</option>)}
        </select>
        <select value={module} onChange={e => setModule(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white">
          <option value="">All Modules</option>
          {MODULES.filter(Boolean).map(m => <option key={m}>{m}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          placeholder="From"
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={view === 'vehicle' ? 'Search vehicle no…' : 'Search customer…'}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 flex-1 min-w-[180px]" />
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-500">Loading…</div>
      ) : (
        <>
          {/* ── Vehicle View ──────────────────────────────────────────────── */}
          {view === 'vehicle' && (
            <>
              {/* Summary totals */}
              {totals && (
                <div className="grid grid-cols-6 gap-3 mb-6">
                  {[
                    { label: 'Gross Revenue',  value: fmt(totals.gross_revenue), icon: '💰', color: 'from-emerald-600 to-teal-600' },
                    { label: 'Collected',      value: fmt(totals.collected),     icon: '✅', color: 'from-blue-600 to-indigo-600' },
                    { label: 'Outstanding',    value: fmt(totals.outstanding),   icon: '⏳', color: 'from-amber-600 to-orange-600' },
                    { label: 'Maint Cost',     value: fmt(totals.maint_cost),    icon: '🔧', color: 'from-slate-600 to-slate-700' },
                    { label: 'Depreciation',   value: fmt(totals.depreciation),  icon: '📉', color: 'from-slate-600 to-slate-700' },
                    { label: 'Net Margin',     value: fmt(totals.net_margin),    icon: '📊', color: totals.net_margin >= 0 ? 'from-emerald-700 to-teal-700' : 'from-red-700 to-rose-700' },
                  ].map(c => (
                    <div key={c.label} className={`bg-gradient-to-br ${c.color} rounded-2xl p-4`}>
                      <p className="text-xl mb-1">{c.icon}</p>
                      <p className="text-base font-bold text-white leading-tight">{c.value}</p>
                      <p className="text-white/70 text-xs mt-0.5">{c.label}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-slate-800/60 border border-white/5 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      {[
                        ['Vehicle No.','vehicle_no'], ['Module','module'], ['Branch','branch'],
                        ['Invoices','invoice_count'], ['Gross Revenue','gross_revenue'],
                        ['Collected','collected'], ['Maint Cost','maint_cost'],
                        ['Depreciation','depreciation'], ['Net Margin','net_margin'], ['Margin %','margin_pct'],
                      ].map(([label, key]) => (
                        <th key={key} onClick={() => toggleSort(key)}
                          className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase text-left cursor-pointer hover:text-white">
                          {label}<SortIcon k={key} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedVehicles.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-10 text-slate-500">No vehicle revenue data yet. Link vehicle_no to invoices to see profitability.</td></tr>
                    ) : sortedVehicles.map((v, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                        <td className="px-4 py-3 font-mono text-white font-medium">{v.vehicle_no}</td>
                        <td className="px-4 py-3"><span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-xs">{v.module}</span></td>
                        <td className="px-4 py-3 text-slate-400">{v.branch}</td>
                        <td className="px-4 py-3 text-slate-300">{v.invoice_count}</td>
                        <td className="px-4 py-3 text-white font-semibold">{fmt(v.gross_revenue)}</td>
                        <td className="px-4 py-3 text-emerald-400">{fmt(v.collected)}</td>
                        <td className="px-4 py-3 text-orange-400">{v.maint_cost > 0 ? fmt(v.maint_cost) : '—'}</td>
                        <td className="px-4 py-3 text-slate-400">{v.depreciation > 0 ? fmt(v.depreciation) : '—'}</td>
                        <td className={`px-4 py-3 font-semibold ${v.net_margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(v.net_margin)}</td>
                        <td className={`px-4 py-3 font-bold ${MARGIN_COLOR(v.margin_pct)}`}>{pct(v.margin_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Customer View ──────────────────────────────────────────────── */}
          {view === 'customer' && (
            <div className="bg-slate-800/60 border border-white/5 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {[
                      ['Customer','client_name'], ['Lifetime Revenue','lifetime_revenue'],
                      ['Total Paid','total_paid'], ['Outstanding','outstanding'],
                      ['Avg Invoice','avg_invoice'], ['Invoices','invoice_count'],
                      ['Rel. Days','relationship_days'], ['Modules','modules_used'],
                      ['Vehicles','vehicles_rented'],
                    ].map(([label, key]) => (
                      <th key={key} onClick={() => toggleSort(key)}
                        className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase text-left cursor-pointer hover:text-white">
                        {label}<SortIcon k={key} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedCustomers.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-10 text-slate-500">No customer data found</td></tr>
                  ) : sortedCustomers.map((c, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                      <td className="px-4 py-3">
                        <p className="text-white font-medium">{c.client_name}</p>
                        <p className="text-slate-500 text-xs">{c.client_email ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-emerald-400 font-semibold">{fmt(c.lifetime_revenue)}</td>
                      <td className="px-4 py-3 text-white">{fmt(c.total_paid)}</td>
                      <td className={`px-4 py-3 ${c.outstanding > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                        {c.outstanding > 0 ? fmt(c.outstanding) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{fmt(c.avg_invoice)}</td>
                      <td className="px-4 py-3 text-slate-300">{c.invoice_count}</td>
                      <td className="px-4 py-3 text-slate-400">{c.relationship_days}d</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{c.module_list}</td>
                      <td className="px-4 py-3 text-slate-400">{c.vehicles_rented}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Branch View ────────────────────────────────────────────────── */}
          {view === 'branch' && (
            <div className="space-y-4">
              {/* Group by branch */}
              {Array.from(new Set(branches.map(b => b.branch))).map(branchName => {
                const rows   = branches.filter(b => b.branch === branchName);
                const total  = rows.reduce((s, b) => s + b.gross_revenue, 0);
                const vat    = rows.reduce((s, b) => s + b.vat_amount, 0);
                const cust   = Math.max(...rows.map(b => b.customer_count));
                return (
                  <div key={branchName} className="bg-slate-800/60 border border-white/5 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 bg-slate-900/40 border-b border-white/5">
                      <div>
                        <p className="text-white font-semibold">{branchName}</p>
                        <p className="text-slate-500 text-xs mt-0.5">{cust} customers</p>
                      </div>
                      <div className="flex gap-6 text-right">
                        <div><p className="text-xs text-slate-500">Revenue</p><p className="text-emerald-400 font-bold">{fmt(total)}</p></div>
                        <div><p className="text-xs text-slate-500">VAT</p><p className="text-amber-400 font-semibold">{fmt(vat)}</p></div>
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-b border-white/5 last:border-0">
                            <td className="px-5 py-3 text-slate-400 text-xs w-32">
                              <span className="bg-slate-700 px-2 py-0.5 rounded">{r.module}</span>
                            </td>
                            <td className="px-4 py-3 text-slate-300">{r.invoice_count} invoices</td>
                            <td className="px-4 py-3 text-white font-medium">{fmt(r.gross_revenue)}</td>
                            <td className="px-4 py-3 text-teal-400">{fmt(r.collected)}</td>
                            <td className="px-4 py-3 text-amber-400 text-xs">VAT: {fmt(r.vat_amount)}</td>
                            <td className="px-4 py-3">
                              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden w-24">
                                <div className="h-full bg-emerald-500 rounded-full"
                                  style={{ width: `${total > 0 ? (r.gross_revenue / total) * 100 : 0}%` }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              {branches.length === 0 && (
                <div className="text-center py-16 text-slate-500">No branch revenue data found</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
