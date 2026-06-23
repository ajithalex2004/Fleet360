'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';

interface Bucket {
  bucket: string;
  invoice_count: number;
  total_outstanding: number | null;
  total_credit_notes?: number | null;
  customer_count: number;
}

interface CustomerRollup {
  client_name: string;
  invoice_count: number;
  gross_receivable?: number | null;
  total_paid?: number | null;
  total_credit_notes?: number | null;
  total_outstanding: number | null;
  max_age_days: number;
  oldest_due: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_name: string;
  branch: string;
  module: string;
  vehicle_no: string | null;
  due_date: string | null;
  total_amount: number | null;
  paid_amount?: number | null;
  credit_note_amount?: number | null;
  outstanding: number | null;
  age_days: number;
  bucket: string;
  payment_status: string;
}

const fmt = (n: number | null) => n != null ? `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2 })}` : '-';
const fmtD = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB') : '-';

const BUCKET_ORDER = ['CURRENT', '1-30', '31-60', '61-90', '91-120', '120+'];
const BUCKET_COLOR: Record<string, { bar: string; text: string; badge: string }> = {
  CURRENT: { bar: 'bg-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  '1-30': { bar: 'bg-amber-500', text: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  '31-60': { bar: 'bg-orange-500', text: 'text-orange-400', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  '61-90': { bar: 'bg-red-500', text: 'text-red-400', badge: 'bg-red-500/20 text-red-300 border-red-500/30' },
  '91-120': { bar: 'bg-red-700', text: 'text-red-500', badge: 'bg-red-700/20 text-red-400 border-red-600/30' },
  '120+': { bar: 'bg-rose-900', text: 'text-rose-400', badge: 'bg-rose-900/30 text-rose-300 border-rose-600/30' },
};

const BRANCHES = ['All Branches', 'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Fujairah', 'Ras Al Khaimah', 'Umm Al Quwain'];
const MODULES = ['All Modules', 'LEASE', 'RENTAL', 'GENERAL'];

export default function ARAgingPage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [byCustomer, setByCustomer] = useState<CustomerRollup[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [branch, setBranch] = useState('All Branches');
  const [module, setModule] = useState('All Modules');
  const [search, setSearch] = useState('');
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [view, setView] = useState<'buckets' | 'customer' | 'detail'>('buckets');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ as_of_date: asOfDate });
    if (branch !== 'All Branches') p.set('branch', branch);
    if (module !== 'All Modules') p.set('module', module);
    if (search) p.set('search', search);
    const res = await fetch(`/api/finance/ar-aging?${p}`);
    const data = await res.json();
    setBuckets(data.buckets ?? []);
    setByCustomer(data.by_customer ?? []);
    setInvoices(data.invoices ?? []);
    setLoading(false);
  }, [asOfDate, branch, module, search]);

  useEffect(() => { void load(); }, [load]);

  const bucketMap = Object.fromEntries(buckets.map((b) => [b.bucket, b]));
  const totalOutstanding = buckets.reduce((sum, b) => sum + (b.total_outstanding ?? 0), 0);
  const totalCreditNotes = buckets.reduce((sum, b) => sum + (b.total_credit_notes ?? 0), 0);
  const visibleInvoices = activeBucket ? invoices.filter((i) => i.bucket === activeBucket) : invoices;

  function exportData() {
    const rows = visibleInvoices.map((i) => ({
      'Invoice No': i.invoice_number,
      Customer: i.client_name,
      Branch: i.branch,
      Module: i.module,
      'Vehicle No': i.vehicle_no ?? '',
      'Due Date': fmtD(i.due_date),
      'Total (AED)': i.total_amount ?? 0,
      'Paid (AED)': i.paid_amount ?? 0,
      'Credit Notes (AED)': i.credit_note_amount ?? 0,
      'Outstanding (AED)': i.outstanding ?? 0,
      'Age (Days)': i.age_days,
      Bucket: i.bucket,
      Status: i.payment_status,
    }));
    downloadXLSX(`AR-Aging-${asOfDate}.xls`, rows);
  }

  return (
    <div className="text-white">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AR Aging Report</h1>
          <p className="mt-1 text-sm text-slate-400">
            Outstanding receivables by aging bucket with payment and credit-note reconciliation.
          </p>
        </div>
        <button
          onClick={exportData}
          className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-700/40 px-4 py-2.5 text-sm font-medium text-emerald-300 transition-all hover:bg-emerald-700/60"
        >
          Export XLSX
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-400">As of Date</label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Branch</label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white"
          >
            {BRANCHES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Module</label>
          <select
            value={module}
            onChange={(e) => setModule(e.target.value)}
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white"
          >
            {MODULES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs text-slate-400">Search Customer / Invoice</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="mb-6 flex w-fit gap-1 rounded-xl bg-slate-800 p-1">
        {(['buckets', 'customer', 'detail'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-all ${
              view === tab ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab === 'buckets' ? 'Aging Buckets' : tab === 'customer' ? 'By Customer' : 'Invoice Detail'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-500">Loading...</div>
      ) : (
        <>
          {view === 'buckets' && (
            <>
              <div className="mb-6 flex items-center justify-between rounded-2xl border border-white/5 bg-slate-800/60 px-6 py-4">
                <div>
                  <p className="text-sm text-slate-400">Total Outstanding AR</p>
                  <p className="mt-1 text-3xl font-bold text-white">{fmt(totalOutstanding)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-500">As of {fmtD(asOfDate)} · {invoices.length} invoices</p>
                  <p className="mt-1 text-sm text-cyan-400">Credit notes applied: {fmt(totalCreditNotes)}</p>
                </div>
              </div>

              <div className="mb-8 grid grid-cols-6 gap-3">
                {BUCKET_ORDER.map((bk) => {
                  const data = bucketMap[bk] ?? { invoice_count: 0, total_outstanding: 0, total_credit_notes: 0, customer_count: 0 };
                  const pct = totalOutstanding > 0 ? ((data.total_outstanding ?? 0) / totalOutstanding) * 100 : 0;
                  const col = BUCKET_COLOR[bk];
                  const isActive = activeBucket === bk;
                  return (
                    <div
                      key={bk}
                      onClick={() => { setActiveBucket(isActive ? null : bk); setView('detail'); }}
                      className={`cursor-pointer rounded-2xl border p-4 transition-all hover:bg-slate-800 ${
                        isActive ? 'border-emerald-500/50 ring-1 ring-emerald-500/30' : 'border-white/5 bg-slate-800/60'
                      }`}
                    >
                      <p className={`mb-2 text-xs font-bold ${col?.text ?? 'text-white'}`}>{bk === 'CURRENT' ? 'Current' : `${bk} Days`}</p>
                      <p className="text-xl font-bold text-white">{fmt(data.total_outstanding ?? 0)}</p>
                      <p className="mt-1 text-xs text-slate-500">{data.invoice_count} invoices · {data.customer_count} customers</p>
                      <p className="mt-1 text-[11px] text-cyan-400/80">Credit notes {fmt(data.total_credit_notes ?? 0)}</p>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700">
                        <div className={`h-full rounded-full ${col?.bar ?? 'bg-slate-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{pct.toFixed(1)}% of total</p>
                    </div>
                  );
                })}
              </div>

              <div className="mb-6 rounded-2xl border border-white/5 bg-slate-800/60 p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Aging Distribution</p>
                <div className="flex h-8 gap-0.5 overflow-hidden rounded-xl">
                  {BUCKET_ORDER.map((bk) => {
                    const data = bucketMap[bk];
                    const pct = totalOutstanding > 0 ? ((data?.total_outstanding ?? 0) / totalOutstanding) * 100 : 0;
                    const col = BUCKET_COLOR[bk];
                    if (!pct) return null;
                    return (
                      <div
                        key={bk}
                        className={`${col?.bar ?? 'bg-slate-600'} flex cursor-pointer items-center justify-center transition-all hover:opacity-90`}
                        style={{ width: `${pct}%` }}
                        onClick={() => { setActiveBucket(bk); setView('detail'); }}
                        title={`${bk}: ${fmt(data?.total_outstanding ?? null)}`}
                      >
                        {pct > 8 && <span className="text-xs font-bold text-white">{pct.toFixed(0)}%</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-4">
                  {BUCKET_ORDER.map((bk) => (
                    <div key={bk} className="flex items-center gap-1.5">
                      <div className={`h-3 w-3 rounded-sm ${BUCKET_COLOR[bk]?.bar ?? 'bg-slate-600'}`} />
                      <span className="text-xs text-slate-400">{bk === 'CURRENT' ? 'Current' : `${bk}d`}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {view === 'customer' && (
            <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-800/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Customer', '# Invoices', 'Gross', 'Paid', 'Credit Notes', 'Net Outstanding', 'Max Age (Days)', 'Oldest Due', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byCustomer.length === 0 ? (
                    <tr><td colSpan={9} className="py-10 text-center text-slate-500">No outstanding receivables</td></tr>
                  ) : byCustomer.map((c, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                      <td className="px-4 py-3 font-medium text-white">{c.client_name}</td>
                      <td className="px-4 py-3 text-slate-300">{c.invoice_count}</td>
                      <td className="px-4 py-3 text-slate-300">{fmt(c.gross_receivable ?? null)}</td>
                      <td className="px-4 py-3 text-emerald-400">{fmt(c.total_paid ?? null)}</td>
                      <td className="px-4 py-3 text-cyan-400">{fmt(c.total_credit_notes ?? null)}</td>
                      <td className="px-4 py-3 font-semibold text-amber-400">{fmt(c.total_outstanding)}</td>
                      <td className={`px-4 py-3 font-medium ${c.max_age_days > 90 ? 'text-red-400' : c.max_age_days > 30 ? 'text-orange-400' : 'text-slate-300'}`}>
                        {c.max_age_days}d
                      </td>
                      <td className="px-4 py-3 text-slate-400">{fmtD(c.oldest_due)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setSearch(c.client_name); setView('detail'); }}
                          className="text-xs text-emerald-400 underline hover:text-emerald-300"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'detail' && (
            <>
              {activeBucket && (
                <div className="mb-4 flex items-center gap-3">
                  <span className={`rounded-full border px-3 py-1.5 text-xs ${BUCKET_COLOR[activeBucket]?.badge ?? ''}`}>
                    Filtered: {activeBucket === 'CURRENT' ? 'Current' : `${activeBucket} Days`}
                  </span>
                  <button onClick={() => setActiveBucket(null)} className="text-xs text-slate-400 underline hover:text-white">Clear filter</button>
                </div>
              )}
              <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-800/60">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <p className="text-sm text-slate-400">{visibleInvoices.length} invoices</p>
                  <button
                    onClick={exportData}
                    className="rounded-lg border border-emerald-500/20 bg-emerald-700/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-700/50"
                  >
                    Export
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      {['Invoice No.', 'Customer', 'Branch', 'Vehicle', 'Due Date', 'Total', 'Paid', 'Credit Notes', 'Outstanding', 'Age', 'Bucket'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.length === 0 ? (
                      <tr><td colSpan={11} className="py-10 text-center text-slate-500">No invoices</td></tr>
                    ) : visibleInvoices.map((inv) => {
                      const col = BUCKET_COLOR[inv.bucket];
                      return (
                        <tr key={inv.id} className="border-b border-white/5 hover:bg-white/3">
                          <td className="px-4 py-3 font-mono text-xs text-emerald-400">{inv.invoice_number}</td>
                          <td className="px-4 py-3 text-white">{inv.client_name}</td>
                          <td className="px-4 py-3 text-slate-400">{inv.branch}</td>
                          <td className="px-4 py-3 text-slate-400">{inv.vehicle_no ?? '-'}</td>
                          <td className="px-4 py-3 text-slate-300">{fmtD(inv.due_date)}</td>
                          <td className="px-4 py-3 text-slate-300">{fmt(inv.total_amount)}</td>
                          <td className="px-4 py-3 text-emerald-400">{fmt(inv.paid_amount ?? null)}</td>
                          <td className="px-4 py-3 font-semibold text-cyan-400">{fmt(inv.credit_note_amount ?? null)}</td>
                          <td className="px-4 py-3 font-semibold text-amber-400">{fmt(inv.outstanding)}</td>
                          <td className={`px-4 py-3 font-medium ${col?.text ?? 'text-white'}`}>{inv.age_days}d</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${col?.badge ?? ''}`}>
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
