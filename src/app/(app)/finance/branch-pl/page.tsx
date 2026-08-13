'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface BranchPL {
  branch_id: string | null;
  branch_name: string;
  emirate: string | null;
  cost_center_code: string | null;
  trade_license_no: string | null;
  revenue: number;
  paid: number;
  outstanding: number;
  vat_collected: number;
  invoice_count: number;
  expenses: number;
  gross_profit: number;
  margin_pct: number;
}

interface PLData {
  tenant: { id: string; name: string; trn: string | null; code: string | null };
  period: { start: string; end: string };
  branches: BranchPL[];
  totals: BranchPL & { margin_pct: number };
}

const EMIRATE_FLAGS: Record<string, string> = {
  ABU_DHABI: '🏛️', DUBAI: '🏙️', SHARJAH: '🕌',
  AJMAN: '⛵', UMM_AL_QUWAIN: '🌿', RAS_AL_KHAIMAH: '⛰️', FUJAIRAH: '🌊',
};
const EMIRATE_LABELS: Record<string, string> = {
  ABU_DHABI: 'Abu Dhabi', DUBAI: 'Dubai', SHARJAH: 'Sharjah',
  AJMAN: 'Ajman', UMM_AL_QUWAIN: 'Umm Al Quwain', RAS_AL_KHAIMAH: 'Ras Al Khaimah', FUJAIRAH: 'Fujairah',
};

function fmt(n: number) { return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function BranchPLPage() {
  const [data,       setData]     = useState<PLData | null>(null);
  const [loading,    setLoading]  = useState(true);
  const [tenantId,   setTenantId] = useState('');
  const [tenants,    setTenants]  = useState<{ id: string; name: string; trn?: string }[]>([]);
  const [startDate,  setStart]    = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0];
  });
  const [endDate, setEnd] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetch('/api/admin/tenants?limit=200')
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const list = Array.isArray(d) ? d : (d.data ?? []);
        setTenants(list);
        if (list.length > 0 && !tenantId) setTenantId(list[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/branch-pl?tenantId=${tenantId}&startDate=${startDate}&endDate=${endDate}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [tenantId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const branches = data?.branches ?? [];
  const totals   = data?.totals;
  const maxRevenue = Math.max(...branches.map(b => b.revenue), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Branch P&amp;L Report</h1>
        <p className="text-slate-400 text-sm mt-1">Cost-center segmented income statement · Multi-emirate branch comparison</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-slate-400 text-xs mb-1.5">Tenant</label>
          <select
            value={tenantId}
            onChange={e => setTenantId(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none min-w-48"
          >
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 text-xs mb-1.5">From</label>
          <input type="date" value={startDate} onChange={e => setStart(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none" />
        </div>
        <div>
          <label className="block text-slate-400 text-xs mb-1.5">To</label>
          <input type="date" value={endDate} onChange={e => setEnd(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none" />
        </div>
        <button onClick={load} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors">
          Run Report
        </button>
      </div>

      {/* Tenant header */}
      {data && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 flex items-center gap-4">
          <span className="text-3xl">🏢</span>
          <div>
            <p className="text-white font-bold text-lg">{data.tenant.name}</p>
            <div className="flex items-center gap-4 mt-1">
              {data.tenant.trn && <span className="text-xs text-slate-400 font-mono">TRN: <strong className="text-white">{data.tenant.trn}</strong></span>}
              <span className="text-xs text-slate-500">Period: {data.period.start} → {data.period.end}</span>
              <span className="text-xs text-slate-500">{branches.length} branch{branches.length !== 1 ? 'es' : ''}</span>
            </div>
          </div>
        </div>
      )}

      {/* Consolidated totals */}
      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Revenue', value: fmt(totals.revenue), color: 'text-emerald-400', icon: '💰' },
            { label: 'Gross Profit', value: fmt(totals.gross_profit), sub: `${totals.margin_pct}% margin`, color: 'text-blue-400', icon: '📈' },
            { label: 'VAT Collected', value: fmt(totals.vat_collected), sub: 'Output VAT 5%', color: 'text-amber-400', icon: '🧾' },
            { label: 'Outstanding', value: fmt(totals.outstanding), sub: `${totals.invoice_count} invoices`, color: 'text-rose-400', icon: '⏳' },
          ].map(k => (
            <div key={k.label} className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <p className="text-slate-400 text-xs">{k.icon} {k.label}</p>
              <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
              {k.sub && <p className="text-slate-600 text-xs mt-1">{k.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Revenue bar chart by branch */}
      {branches.length > 0 && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-5">Revenue by Branch</h2>
          <div className="space-y-4">
            {branches.map(b => {
              const pct = maxRevenue > 0 ? (b.revenue / maxRevenue) * 100 : 0;
              const profitColor = b.margin_pct >= 30 ? 'text-emerald-400' : b.margin_pct >= 10 ? 'text-amber-400' : 'text-red-400';
              return (
                <div key={b.branch_id ?? 'unassigned'}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <span>{b.emirate ? (EMIRATE_FLAGS[b.emirate] ?? '🏢') : '🌐'}</span>
                      <span className="text-slate-300 font-medium">{b.branch_name}</span>
                      {b.cost_center_code && (
                        <span className="font-mono bg-slate-800 border border-white/10 text-slate-500 px-1.5 py-0.5 rounded text-[10px]">{b.cost_center_code}</span>
                      )}
                      {b.emirate && <span className="text-slate-600">{EMIRATE_LABELS[b.emirate] ?? b.emirate}</span>}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white font-semibold">{fmt(b.revenue)}</span>
                      <span className={`font-semibold ${profitColor}`}>{b.margin_pct}%</span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-600 mt-1">
                    <span>{b.invoice_count} invoices · {fmt(b.paid)} collected</span>
                    <span>Outstanding: {fmt(b.outstanding)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed table */}
      {loading ? (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-12 text-center text-slate-500 text-sm">Loading…</div>
      ) : branches.length === 0 ? (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-16 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-white font-medium">No data for this period</p>
          <p className="text-slate-500 text-sm mt-1">Select a tenant with branches and invoiced transactions to see the P&amp;L</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-white font-semibold">Branch P&amp;L Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-xs text-slate-400">
                  <th className="text-left px-6 py-3">Branch / Region</th>
                  <th className="text-right px-4 py-3">Revenue</th>
                  <th className="text-right px-4 py-3">Collected</th>
                  <th className="text-right px-4 py-3">Outstanding</th>
                  <th className="text-right px-4 py-3">VAT Output</th>
                  <th className="text-right px-4 py-3">Expenses</th>
                  <th className="text-right px-4 py-3">Gross Profit</th>
                  <th className="text-right px-4 py-3">Margin</th>
                  <th className="text-right px-4 py-3">Invoices</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {branches.map(b => {
                  const profitBg = b.margin_pct >= 30 ? 'text-emerald-400' : b.margin_pct >= 10 ? 'text-amber-400' : 'text-red-400';
                  return (
                    <tr key={b.branch_id ?? 'unassigned'} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg">{b.emirate ? (EMIRATE_FLAGS[b.emirate] ?? '🏢') : '🌐'}</span>
                          <div>
                            <p className="text-white font-medium">{b.branch_name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {b.emirate && <span className="text-slate-500 text-xs">{EMIRATE_LABELS[b.emirate] ?? b.emirate}</span>}
                              {b.cost_center_code && <span className="font-mono text-slate-600 text-xs">{b.cost_center_code}</span>}
                              {b.trade_license_no && <span className="text-slate-700 text-xs">{b.trade_license_no}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-white font-semibold">{fmt(b.revenue)}</td>
                      <td className="px-4 py-4 text-right text-emerald-400">{fmt(b.paid)}</td>
                      <td className="px-4 py-4 text-right text-amber-400">{fmt(b.outstanding)}</td>
                      <td className="px-4 py-4 text-right text-slate-300">{fmt(b.vat_collected)}</td>
                      <td className="px-4 py-4 text-right text-rose-400">{b.expenses > 0 ? fmt(b.expenses) : <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-4 text-right font-semibold text-white">{fmt(b.gross_profit)}</td>
                      <td className={`px-4 py-4 text-right font-bold ${profitBg}`}>{b.margin_pct}%</td>
                      <td className="px-4 py-4 text-right text-slate-400">{b.invoice_count}</td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                {totals && (
                  <tr className="bg-emerald-500/5 border-t border-emerald-500/20 font-semibold">
                    <td className="px-6 py-4 text-white">CONSOLIDATED TOTAL</td>
                    <td className="px-4 py-4 text-right text-emerald-400">{fmt(totals.revenue)}</td>
                    <td className="px-4 py-4 text-right text-emerald-400">{fmt(totals.paid)}</td>
                    <td className="px-4 py-4 text-right text-amber-400">{fmt(totals.outstanding)}</td>
                    <td className="px-4 py-4 text-right text-slate-300">{fmt(totals.vat_collected)}</td>
                    <td className="px-4 py-4 text-right text-rose-400">{totals.expenses > 0 ? fmt(totals.expenses) : '—'}</td>
                    <td className="px-4 py-4 text-right text-white">{fmt(totals.gross_profit)}</td>
                    <td className="px-4 py-4 text-right text-emerald-400">{totals.margin_pct}%</td>
                    <td className="px-4 py-4 text-right text-slate-400">{totals.invoice_count}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Note */}
      <p className="text-slate-600 text-xs">
        ⓘ Revenue figures are based on issued invoices (non-draft). VAT is 5% UAE standard rate.
        TRN is shared across all branches — this report is for internal management accounting only.
      </p>
    </div>
  );
}
