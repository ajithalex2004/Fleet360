'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTenantPortal } from '../layout';

/* ─────────────────────────── Types ─────────────────────────── */
interface PLModule {
  label: string;
  total: number;
  currency: string;
}

interface PLSummary {
  period?: { from: string | null; to: string | null };
  modules?: {
    rental?: PLModule;
    school_bus?: PLModule;
    maintenance?: PLModule;
    general?: PLModule;
  };
  summary?: {
    totalRevenue: number;
    totalCosts: number;
    grossProfit: number;
    grossMarginPct?: number;
    currency: string;
  };
}

interface Invoice {
  id: string;
  invoiceNumber?: string;
  invoice_number?: string;
  amount: number;
  currency?: string;
  status: string;
  dueDate?: string;
  due_date?: string;
  issueDate?: string;
  issue_date?: string;
  description?: string;
  clientName?: string;
  client_name?: string;
}

interface BankReconEntry {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  reconciled: boolean;
  reference?: string;
}

/* ─────────────────────────── Helpers ─────────────────────────── */
function fmt(n: number, currency = 'AED') {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n ?? 0);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

const STATUS_BADGE: Record<string, string> = {
  PAID:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  PENDING: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  OVERDUE: 'bg-red-500/20 text-red-300 border-red-500/30',
  DRAFT:   'bg-slate-500/20 text-slate-300 border-slate-500/30',
  paid:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  pending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  overdue: 'bg-red-500/20 text-red-300 border-red-500/30',
  draft:   'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

function agingBucket(dueDateStr: string | undefined): string {
  if (!dueDateStr) return 'Current';
  const due = new Date(dueDateStr);
  const now = new Date();
  const days = Math.floor((now.getTime() - due.getTime()) / 86400000);
  if (days <= 0)  return 'Current';
  if (days <= 30) return '1–30 days';
  if (days <= 60) return '31–60 days';
  return '60+ days';
}

const AGING_COLOR: Record<string, string> = {
  'Current':    'bg-emerald-500/20 text-emerald-300',
  '1–30 days':  'bg-amber-500/20 text-amber-300',
  '31–60 days': 'bg-orange-500/20 text-orange-300',
  '60+ days':   'bg-red-500/20 text-red-300',
};

/* ─────────────────────────── Sub-components ─────────────────────────── */
function KpiCard({ icon, label, value, sub, colorClass = 'border-cyan-500/20 bg-cyan-500/5' }: {
  icon: string; label: string; value: string; sub?: string; colorClass?: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${colorClass}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="text-xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <span className="text-xl">{icon}</span>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
        active
          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
      }`}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────── Tab 1: P&L Summary ─────────────────────────── */
function PLTab({ tenantId, hasRAC, hasBus }: { tenantId: string; hasRAC: boolean; hasBus: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = today.slice(0, 4) + '-01-01';

  const [from, setFrom] = useState(yearStart);
  const [to, setTo]     = useState(today);
  const [data, setData] = useState<PLSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const modules = [hasRAC ? 'RAC' : null, hasBus ? 'SCHOOL_BUS' : null].filter(Boolean).join(',');
    fetch(`/api/finance/management-accounts?type=income_statement&from=${from}&to=${to}&tenantId=${tenantId}&modules=${modules}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setData(d))
      .catch(() => setError('Unable to load P&L data'))
      .finally(() => setLoading(false));
  }, [from, to, tenantId, hasRAC, hasBus]);

  useEffect(() => { if (tenantId) load(); }, [load, tenantId]);

  const summary = data?.summary;
  const racRev  = data?.modules?.rental?.total ?? 0;
  const busRev  = data?.modules?.school_bus?.total ?? 0;
  const totalRev = summary?.totalRevenue ?? (racRev + busRev);
  const cogs     = summary?.totalCosts ?? 0;
  const netProfit = summary?.grossProfit ?? (totalRev - cogs);
  const margin    = pct(netProfit, totalRev);
  const currency  = summary?.currency ?? 'AED';

  return (
    <div className="space-y-6">
      {/* Date pickers */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>
        <button onClick={load}
          className="px-4 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-sm font-medium hover:bg-cyan-500/30 transition-colors">
          Apply
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <p className="text-slate-500 text-xs mt-1">Check your API connection or date range</p>
        </div>
      ) : (
        <>
          {/* Revenue breakdown */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Revenue Breakdown</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {hasRAC && (
                <KpiCard icon="🚗" label="RAC Revenue" value={fmt(racRev, currency)}
                  colorClass="border-blue-500/20 bg-blue-500/5" />
              )}
              {hasBus && (
                <KpiCard icon="🚌" label="School Bus Revenue" value={fmt(busRev, currency)}
                  colorClass="border-amber-500/20 bg-amber-500/5" />
              )}
              <KpiCard icon="💰" label="Total Revenue" value={fmt(totalRev, currency)}
                colorClass="border-cyan-500/20 bg-cyan-500/5" />
            </div>
          </div>

          {/* P&L summary */}
          <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5">
              <h3 className="text-sm font-semibold text-white">Income Statement</h3>
              <p className="text-xs text-slate-500 mt-0.5">{fmtDate(from)} – {fmtDate(to)}</p>
            </div>
            <div className="p-6 space-y-3">
              {[
                { label: 'Total Revenue',  value: totalRev,  color: 'text-white font-semibold' },
                { label: 'COGS / Expenses', value: -cogs,   color: 'text-red-400' },
                null,
                { label: 'Net Profit',     value: netProfit, color: netProfit >= 0 ? 'text-emerald-400 font-bold text-lg' : 'text-red-400 font-bold text-lg' },
              ].map((row, i) => row === null ? (
                <div key={i} className="border-t border-white/10 pt-3" />
              ) : (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">{row.label}</span>
                  <span className={`text-sm ${row.color}`}>{fmt(row.value, currency)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-500">Net Margin</span>
                <span className={`text-xs font-semibold ${margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {margin}%
                </span>
              </div>
            </div>
          </div>

          {!data && (
            <div className="rounded-2xl border border-white/5 bg-slate-800/20 p-8 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-slate-400 text-sm font-medium">No P&L data for this period</p>
              <p className="text-slate-600 text-xs mt-1">Try adjusting the date range or check your module activity</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Tab 2: Platform Invoices ─────────────────────────── */
function PlatformInvoicesTab({ tenantId }: { tenantId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch(`/api/finance/invoices?clientTenantId=${tenantId}&prefix=SUB`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const rows = Array.isArray(d) ? d : d?.invoices ?? d?.data ?? [];
        setInvoices(rows);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tenantId]);

  const overdue   = invoices.filter(i => i.status?.toUpperCase() === 'OVERDUE');
  const pending   = invoices.filter(i => i.status?.toUpperCase() === 'PENDING');
  const overdueAmt = overdue.reduce((s, i) => s + (i.amount ?? 0), 0);
  const pendingAmt = pending.reduce((s, i) => s + (i.amount ?? 0), 0);
  const totalOutstanding = overdueAmt + pendingAmt;

  return (
    <div className="space-y-4">
      {totalOutstanding > 0 && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="text-red-300 font-semibold text-sm">Outstanding Platform Subscription Balance</p>
            <p className="text-red-400 text-xs mt-0.5">
              {fmt(overdueAmt)} overdue · {fmt(pendingAmt)} pending ·{' '}
              <span className="font-bold">{fmt(totalOutstanding)} total outstanding</span>
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-3xl mb-3">🧾</p>
            <p className="text-slate-400 text-sm font-medium">No platform invoices yet</p>
            <p className="text-slate-600 text-xs mt-1">Subscription invoices raised by the platform operator will appear here</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Invoice #</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Due Date</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const num = inv.invoiceNumber ?? inv.invoice_number;
                const due = inv.dueDate ?? inv.due_date;
                const st  = inv.status?.toUpperCase() ?? 'PENDING';
                return (
                  <tr key={inv.id} className="border-b border-white/5 hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-cyan-400">{num ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300 truncate max-w-xs">{inv.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{fmt(inv.amount, inv.currency)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[st] ?? STATUS_BADGE.PENDING}`}>
                        {st}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right text-xs ${st === 'OVERDUE' ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>
                      {fmtDate(due)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Tab 3: Customer Invoices ─────────────────────────── */
function CustomerInvoicesTab({ tenantId }: { tenantId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch(`/api/finance/invoices?tenantId=${tenantId}&excludePrefix=SUB`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const rows = Array.isArray(d) ? d : d?.invoices ?? d?.data ?? [];
        setInvoices(rows);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tenantId]);

  const totalRaised      = invoices.reduce((s, i) => s + (i.amount ?? 0), 0);
  const totalCollected   = invoices.filter(i => i.status?.toUpperCase() === 'PAID').reduce((s, i) => s + (i.amount ?? 0), 0);
  const totalOutstanding = totalRaised - totalCollected;

  const buckets: Record<string, Invoice[]> = { 'Current': [], '1–30 days': [], '31–60 days': [], '60+ days': [] };
  invoices.forEach(inv => {
    if (inv.status?.toUpperCase() !== 'PAID') {
      const b = agingBucket(inv.dueDate ?? inv.due_date);
      buckets[b]?.push(inv);
    }
  });

  return (
    <div className="space-y-5">
      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard icon="📤" label="Total Raised" value={fmt(totalRaised)}
          colorClass="border-cyan-500/20 bg-cyan-500/5" />
        <KpiCard icon="✅" label="Collected" value={fmt(totalCollected)}
          colorClass="border-emerald-500/20 bg-emerald-500/5" />
        <KpiCard icon="⏳" label="Outstanding" value={fmt(totalOutstanding)}
          colorClass={`border-${totalOutstanding > 0 ? 'amber' : 'slate'}-500/20 bg-${totalOutstanding > 0 ? 'amber' : 'slate'}-500/5`} />
      </div>

      {/* Aging buckets */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Aging Analysis</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(buckets).map(([bucket, rows]) => (
            <div key={bucket} className={`rounded-xl border border-white/8 bg-slate-800/30 p-3 ${AGING_COLOR[bucket] ?? ''}`}>
              <p className="text-xs font-semibold">{bucket}</p>
              <p className="text-xl font-bold mt-1">{rows.length}</p>
              <p className="text-xs opacity-70 mt-0.5">{fmt(rows.reduce((s, i) => s + (i.amount ?? 0), 0))}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-3xl mb-3">💳</p>
            <p className="text-slate-400 text-sm font-medium">No customer invoices yet</p>
            <p className="text-slate-600 text-xs mt-1">Invoices you raise to your customers will appear here</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Invoice #</th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Aging</th>
                <th className="px-4 py-3 text-right">Due</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const num  = inv.invoiceNumber ?? inv.invoice_number;
                const due  = inv.dueDate ?? inv.due_date;
                const st   = inv.status?.toUpperCase() ?? 'PENDING';
                const client = inv.clientName ?? inv.client_name;
                const bucket = agingBucket(due);
                return (
                  <tr key={inv.id} className="border-b border-white/5 hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-cyan-400">{num ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300 truncate max-w-[140px]">{client ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{fmt(inv.amount, inv.currency)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[st] ?? STATUS_BADGE.PENDING}`}>
                        {st}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {st !== 'PAID' && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${AGING_COLOR[bucket] ?? ''}`}>
                          {bucket}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400">{fmtDate(due)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Tab 4: Bank Recon ─────────────────────────── */
function BankReconTab({ tenantId }: { tenantId: string }) {
  const [entries, setEntries] = useState<BankReconEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/finance/bank-reconciliation?tenantId=${tenantId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const rows = Array.isArray(d) ? d : d?.entries ?? d?.data ?? [];
        setEntries(rows);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tenantId]);

  const credits       = entries.filter(e => e.type === 'CREDIT').reduce((s, e) => s + (e.amount ?? 0), 0);
  const debits        = entries.filter(e => e.type === 'DEBIT').reduce((s, e) => s + (e.amount ?? 0), 0);
  const reconciled    = entries.filter(e => e.reconciled).length;
  const unreconciled  = entries.filter(e => !e.reconciled).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="⬆️" label="Total Credits" value={fmt(credits)} colorClass="border-emerald-500/20 bg-emerald-500/5" />
        <KpiCard icon="⬇️" label="Total Debits"  value={fmt(debits)}  colorClass="border-red-500/20 bg-red-500/5" />
        <KpiCard icon="✅" label="Reconciled"    value={reconciled.toString()}   colorClass="border-cyan-500/20 bg-cyan-500/5" />
        <KpiCard icon="⏳" label="Unreconciled"  value={unreconciled.toString()} colorClass={`border-${unreconciled > 0 ? 'amber' : 'slate'}-500/20 bg-${unreconciled > 0 ? 'amber' : 'slate'}-500/5`} />
      </div>

      <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-3xl mb-3">🏦</p>
            <p className="text-slate-400 text-sm font-medium">No bank statement entries</p>
            <p className="text-slate-600 text-xs mt-1">Import your bank statement to begin reconciliation</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-left">Reference</th>
                <th className="px-4 py-3 text-center">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-white/5 hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(e.date)}</td>
                  <td className="px-4 py-3 text-slate-300 truncate max-w-xs">{e.description}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.reference ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      e.type === 'CREDIT'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-red-500/20 text-red-300'
                    }`}>
                      {e.type}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${e.type === 'CREDIT' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {e.type === 'DEBIT' ? '−' : '+'}{fmt(e.amount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.reconciled
                      ? <span className="text-emerald-400 text-sm">✓</span>
                      : <span className="text-slate-600 text-sm">—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */
const TABS = ['P&L Summary', 'My Invoices (Platform)', 'Customer Invoices', 'Bank Reconciliation'] as const;
type Tab = typeof TABS[number];

export default function TenantFinancePage() {
  const params = useParams();
  const slug = (params?.tenantSlug as string) ?? '';
  const { tenant, hasModule } = useTenantPortal();

  const [activeTab, setActiveTab] = useState<Tab>('P&L Summary');

  const hasRAC = hasModule('RAC');
  const hasBus = hasModule('SCHOOL_BUS') || hasModule('school_bus');

  if (!tenant) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading financial data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Finance Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">{tenant.name} · Financial overview scoped to your modules</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/8 pb-3">
        {TABS.map(tab => (
          <TabBtn key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>
            {tab === 'P&L Summary'                && '📊 '}
            {tab === 'My Invoices (Platform)'     && '🧾 '}
            {tab === 'Customer Invoices'          && '💳 '}
            {tab === 'Bank Reconciliation'        && '🏦 '}
            {tab}
          </TabBtn>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'P&L Summary' && (
        <PLTab tenantId={tenant.id} hasRAC={hasRAC} hasBus={hasBus} />
      )}
      {activeTab === 'My Invoices (Platform)' && (
        <PlatformInvoicesTab tenantId={tenant.id} />
      )}
      {activeTab === 'Customer Invoices' && (
        <CustomerInvoicesTab tenantId={tenant.id} />
      )}
      {activeTab === 'Bank Reconciliation' && (
        <BankReconTab tenantId={tenant.id} />
      )}
    </div>
  );
}
