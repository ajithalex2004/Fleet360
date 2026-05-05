'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { downloadXLSX, downloadCSV } from '@/lib/exportUtils';

interface Bucket { bucket: string; invoice_count: number; total_outstanding: number | null; customer_count: number; }
interface CustomerRollup { client_name: string; invoice_count: number; total_outstanding: number | null; max_age_days: number; oldest_due: string | null; }
interface InvoiceRow {
  id: string; invoice_number: string; client_name: string; branch: string; module: string;
  vehicle_no: string | null; due_date: string | null; total_amount: number | null;
  outstanding: number | null; age_days: number; bucket: string; payment_status: string;
}

const fmt = (n: number | null) => n != null ? `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2 })}` : '—';
const fmtD = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB') : '—';

const BUCKET_ORDER = ['CURRENT', '1-30', '31-60', '61-90', '91-120', '120+'];
const BUCKET_COLOR: Record<string, { bar: string; text: string; badge: string }> = {
  'CURRENT': { bar: 'bg-emerald-500',  text: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  '1-30':    { bar: 'bg-amber-500',    text: 'text-amber-400',   badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  '31-60':   { bar: 'bg-orange-500',   text: 'text-orange-400',  badge: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  '61-90':   { bar: 'bg-red-500',      text: 'text-red-400',     badge: 'bg-red-500/20 text-red-300 border-red-500/30' },
  '91-120':  { bar: 'bg-red-700',      text: 'text-red-500',     badge: 'bg-red-700/20 text-red-400 border-red-600/30' },
  '120+':    { bar: 'bg-rose-900',     text: 'text-rose-400',    badge: 'bg-rose-900/30 text-rose-300 border-rose-600/30' },
};

const BRANCHES = ['All Branches','Dubai','Abu Dhabi','Sharjah','Ajman','Fujairah','Ras Al Khaimah','Umm Al Quwain'];
const MODULES  = ['All Modules','LEASE','RENTAL','GENERAL'];

export default function ARAgingPage() {
  const [buckets,      setBuckets]      = useState<Bucket[]>([]);
  const [byCustomer,   setByCustomer]   = useState<CustomerRollup[]>([]);
  const [invoices,     setInvoices]     = useState<InvoiceRow[]>([]);
  const [asOfDate,     setAsOfDate]     = useState(new Date().toISOString().split('T')[0]);
  const [branch,       setBranch]       = useState('All Branches');
  const [module,       setModule]       = useState('All Modules');
  const [search,       setSearch]       = useState('');
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [view,         setView]         = useState<'buckets' | 'customer' | 'detail'>('buckets');
  const [loading,      setLoading]      = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ as_of_date: asOfDate });
    if (branch !== 'All Branches') p.set('branch', branch);
    if (module !== 'All Modules')  p.set('module', module);
    if (search)                    p.set('search', search);
    const res  = await fetch(`/api/finance/ar-aging?${p}`);
    const data = await res.json();
    setBuckets(data.buckets ?? []);
    setByCustomer(data.by_customer ?? []);
    setInvoices(data.invoices ?? []);
    setLoading(false);
  }, [asOfDate, branch, module, search]);

  useEffect(() => { load(); }, [load]);

  const bucketMap = Object.fromEntries(buckets.map(b => [b.bucket, b]));
  const totalOutstanding = buckets.reduce((s, b) => s + (b.total_outstanding ?? 0), 0);

  const visibleInvoices = activeBucket
    ? invoices.filter(i => i.bucket === activeBucket)
    : invoices;

  function exportData() {
    const rows = visibleInvoices.map(i => ({
      'Invoice No':     i.invoice_number,
      'Customer':       i.client_name,
      'Branch':         i.branch,
      'Module':         i.module,
      'Vehicle No':     i.vehicle_no ?? '',
      'Due Date':       fmtD(i.due_date),
      'Total (AED)':    i.total_amount ?? 0,
      'Outstanding (AED)': i.outstanding ?? 0,
      'Age (Days)':     i.age_days,
      'Bucket':         i.bucket,
      'Status':         i.payment_status,
    }));
    downloadXLSX(`AR-Aging-${asOfDate}.xls`, rows);
  }

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">AR Aging Report</h1>
          <p className="text-slate-400 text-sm mt-1">Outstanding receivables by aging bucket · standard 0–30 / 31–60 / 61–90 / 91–120 / 120+ days</p>
        </div>
        <button onClick={exportData}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700/40 hover:bg-emerald-700/60 border border-emerald-500/30 text-emerald-300 text-sm font-medium transition-all">
          ⬇ Export XLSX
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="text-xs text-slate-400 block mb-1">As of Date</label>
          <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white" />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Branch</label>
          <select value={branch} onChange={e => setBranch(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white">
            {BRANCHES.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Module</label>
          <select value={module} onChange={e => setModule(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white">
            {MODULES.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-slate-400 block mb-1">Search Customer / Invoice</label>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500" />
        </div>
      </div>

      {/* View tabs */}
      <div className="flex bg-slate-800 rounded-xl p-1 gap-1 mb-6 w-fit">
        {(['buckets','customer','detail'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${view === v ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {v === 'buckets' ? '📊 Aging Buckets' : v === 'customer' ? '👥 By Customer' : '📋 Invoice Detail'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-500">Loading…</div>
      ) : (
        <>
          {/* ── Bucket Summary View ────────────────────────────────────────── */}
          {view === 'buckets' && (
            <>
              {/* Total banner */}
              <div className="bg-slate-800/60 border border-white/5 rounded-2xl px-6 py-4 mb-6 flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">Total Outstanding AR</p>
                  <p className="text-3xl font-bold text-white mt-1">{fmt(totalOutstanding)}</p>
                </div>
                <p className="text-slate-500 text-sm">As of {fmtD(asOfDate)} · {invoices.length} invoices</p>
              </div>

              {/* Bucket cards */}
              <div className="grid grid-cols-6 gap-3 mb-8">
                {BUCKET_ORDER.map(bk => {
                  const data = bucketMap[bk] ?? { invoice_count: 0, total_outstanding: 0, customer_count: 0 };
                  const pct  = totalOutstanding > 0 ? ((data.total_outstanding ?? 0) / totalOutstanding) * 100 : 0;
                  const col  = BUCKET_COLOR[bk];
                  const isActive = activeBucket === bk;
                  return (
                    <div key={bk}
                      onClick={() => { setActiveBucket(isActive ? null : bk); setView('detail'); }}
                      className={`bg-slate-800/60 border rounded-2xl p-4 cursor-pointer transition-all hover:bg-slate-800 ${isActive ? 'border-emerald-500/50 ring-1 ring-emerald-500/30' : 'border-white/5'}`}>
                      <p className={`text-xs font-bold mb-2 ${col?.text ?? 'text-white'}`}>{bk === 'CURRENT' ? 'Current' : `${bk} Days`}</p>
                      <p className="text-xl font-bold text-white">{fmt(data.total_outstanding)}</p>
                      <p className="text-slate-500 text-xs mt-1">{data.invoice_count} invoices · {data.customer_count} customers</p>
                      {/* Mini bar */}
                      <div className="mt-3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${col?.bar ?? 'bg-slate-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <p className="text-slate-600 text-xs mt-1">{pct.toFixed(1)}% of total</p>
                    </div>
                  );
                })}
              </div>

              {/* Waterfall bar */}
              <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-5 mb-6">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4">Aging Distribution</p>
                <div className="flex h-8 rounded-xl overflow-hidden gap-0.5">
                  {BUCKET_ORDER.map(bk => {
                    const data = bucketMap[bk];
                    const pct  = totalOutstanding > 0 ? ((data?.total_outstanding ?? 0) / totalOutstanding) * 100 : 0;
                    const col  = BUCKET_COLOR[bk];
                    if (!pct) return null;
                    return (
                      <div key={bk} className={`${col?.bar ?? 'bg-slate-600'} flex items-center justify-center transition-all hover:opacity-90 cursor-pointer`}
                        style={{ width: `${pct}%` }}
                        onClick={() => { setActiveBucket(bk); setView('detail'); }}
                        title={`${bk}: ${fmt(data?.total_outstanding ?? null)}`}>
                        {pct > 8 && <span className="text-white text-xs font-bold">{pct.toFixed(0)}%</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-4 mt-3">
                  {BUCKET_ORDER.map(bk => (
                    <div key={bk} className="flex items-center gap-1.5">
                      <div className={`w-3 h-3 rounded-sm ${BUCKET_COLOR[bk]?.bar ?? 'bg-slate-600'}`} />
                      <span className="text-slate-400 text-xs">{bk === 'CURRENT' ? 'Current' : `${bk}d`}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Customer View ──────────────────────────────────────────────── */}
          {view === 'customer' && (
            <div className="bg-slate-800/60 border border-white/5 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Customer','# Invoices','Total Outstanding','Max Age (Days)','Oldest Due',''].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byCustomer.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-10 text-slate-500">No outstanding receivables</td></tr>
                  ) : byCustomer.map((c, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                      <td className="px-4 py-3 text-white font-medium">{c.client_name}</td>
                      <td className="px-4 py-3 text-slate-300">{c.invoice_count}</td>
                      <td className="px-4 py-3 text-amber-400 font-semibold">{fmt(c.total_outstanding)}</td>
                      <td className={`px-4 py-3 font-medium ${c.max_age_days > 90 ? 'text-red-400' : c.max_age_days > 30 ? 'text-orange-400' : 'text-slate-300'}`}>
                        {c.max_age_days}d
                      </td>
                      <td className="px-4 py-3 text-slate-400">{fmtD(c.oldest_due)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => { setSearch(c.client_name); setView('detail'); }}
                          className="text-xs text-emerald-400 hover:text-emerald-300 underline">
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Invoice Detail View ────────────────────────────────────────── */}
          {view === 'detail' && (
            <>
              {activeBucket && (
                <div className="flex items-center gap-3 mb-4">
                  <span className={`text-xs px-3 py-1.5 rounded-full border ${BUCKET_COLOR[activeBucket]?.badge ?? ''}`}>
                    Filtered: {activeBucket === 'CURRENT' ? 'Current' : `${activeBucket} Days`}
                  </span>
                  <button onClick={() => setActiveBucket(null)} className="text-xs text-slate-400 hover:text-white underline">Clear filter</button>
                </div>
              )}
              <div className="bg-slate-800/60 border border-white/5 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <p className="text-slate-400 text-sm">{visibleInvoices.length} invoices</p>
                  <button onClick={exportData}
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700/30 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-700/50">
                    ⬇ Export
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      {['Invoice No.','Customer','Branch','Vehicle','Due Date','Total','Outstanding','Age','Bucket'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-10 text-slate-500">No invoices</td></tr>
                    ) : visibleInvoices.map(inv => {
                      const col = BUCKET_COLOR[inv.bucket];
                      return (
                        <tr key={inv.id} className="border-b border-white/5 hover:bg-white/3">
                          <td className="px-4 py-3 font-mono text-emerald-400 text-xs">{inv.invoice_number}</td>
                          <td className="px-4 py-3 text-white">{inv.client_name}</td>
                          <td className="px-4 py-3 text-slate-400">{inv.branch}</td>
                          <td className="px-4 py-3 text-slate-400">{inv.vehicle_no ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-300">{fmtD(inv.due_date)}</td>
                          <td className="px-4 py-3 text-slate-300">{fmt(inv.total_amount)}</td>
                          <td className="px-4 py-3 text-amber-400 font-semibold">{fmt(inv.outstanding)}</td>
                          <td className={`px-4 py-3 font-medium ${col?.text ?? 'text-white'}`}>{inv.age_days}d</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${col?.badge ?? ''}`}>
                              {inv.bucket === 'CURRENT' ? 'Current' : `${inv.bucket}d`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
