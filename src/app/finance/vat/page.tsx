'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface VATReturn {
  id: string; status: string; periodStart: string; periodEnd: string;
  totalSales: number; totalPurchases: number; outputTax: number; inputTax: number; netTax: number;
  submissionDate?: string | null; paymentDate?: string | null; notes?: string | null;
  createdAt: string;
}
interface VATSummary {
  period: string; periodStart: string; periodEnd: string;
  totalRevenue: number; totalVatCollected: number; inputVat: number;
  netVatPayable: number; vatRefundable: number;
  breakdown: {
    logistics: { revenue: number; vat: number };
    rac:       { revenue: number; vat: number };
    leasing:   { revenue: number; vat: number };
    invoices:  { revenue: number; vat: number };
  };
}

const fmtAED  = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-slate-500/20 text-slate-300 border-slate-500/30',
  SUBMITTED: 'bg-blue-500/20  text-blue-300  border-blue-500/30',
  PAID:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  CANCELLED: 'bg-red-500/20   text-red-400   border-red-500/30',
};

/* ─────────────────────────── SubmitReturnModal ──────────────── */
function SubmitReturnModal({ summary, onClose, onSaved }: { summary: VATSummary; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    periodStart: summary.periodStart, periodEnd: summary.periodEnd,
    totalSales: summary.totalRevenue, totalPurchases: 0,
    outputTax: summary.totalVatCollected, inputTax: summary.inputVat,
    netTax: summary.netVatPayable, notes: '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const res = await fetch('/api/finance/vat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, status: 'SUBMITTED', submissionDate: new Date().toISOString() }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else alert('Failed to submit VAT return');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Submit VAT Return — {summary.period}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm space-y-2">
            <div className="flex justify-between text-slate-300"><span>Total Sales (excl. VAT)</span><span className="font-medium">{fmtAED(form.totalSales)}</span></div>
            <div className="flex justify-between text-slate-300"><span>Output VAT (5%)</span><span className="font-medium">{fmtAED(form.outputTax)}</span></div>
            <div className="flex justify-between text-slate-300"><span>Input VAT (recoverable)</span><span className="font-medium">−{fmtAED(form.inputTax)}</span></div>
            <div className="flex justify-between font-bold text-base border-t border-white/10 pt-2">
              <span className="text-white">Net VAT Payable</span>
              <span className="text-amber-400">{fmtAED(form.netTax)}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm disabled:opacity-50">
            {saving ? 'Submitting…' : '📤 Submit Return'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ───────────────────────────── */
const QUARTERS = [1, 2, 3, 4];
const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 1, currentYear, currentYear + 1];

export default function VATPage() {
  const now = new Date();
  const [year,    setYear]    = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [summary, setSummary] = useState<VATSummary | null>(null);
  const [returns, setReturns] = useState<VATReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [calcing, setCalcing] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/vat?year=${year}&quarter=${quarter}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setReturns(data.returns ?? []);
      }
    } finally { setLoading(false); }
  }, [year, quarter]);

  useEffect(() => { load(); }, [load]);

  const autoCalc = async () => {
    setCalcing(true);
    await load();
    setCalcing(false);
  };

  const advanceStatus = async (id: string, status: string) => {
    setTransitioning(id);
    await fetch(`/api/finance/vat/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await load();
    setTransitioning(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">VAT Returns</h1>
          <p className="text-slate-400 text-sm mt-0.5">UAE 5% VAT — auto-calculated from all revenue modules</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={quarter} onChange={e => setQuarter(Number(e.target.value))}
            className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            {QUARTERS.map(q => <option key={q} value={q}>Q{q}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={autoCalc} disabled={calcing}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm disabled:opacity-50">
            {calcing ? '⟳ Calculating…' : '⟳ Auto-Calculate'}
          </button>
        </div>
      </div>

      {/* Current Period Summary */}
      {loading ? (
        <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />
      ) : summary && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">{summary.period}</h2>
              <p className="text-slate-400 text-xs">{fmtDate(summary.periodStart)} — {fmtDate(summary.periodEnd)}</p>
            </div>
            <button onClick={() => setShowSubmit(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-sm">
              📤 File VAT Return
            </button>
          </div>

          {/* Main VAT figures */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Revenue', value: fmtAED(summary.totalRevenue), color: 'text-white', icon: '💰' },
              { label: 'Output VAT', value: fmtAED(summary.totalVatCollected), color: 'text-amber-400', icon: '📤' },
              { label: 'Input VAT (Recoverable)', value: fmtAED(summary.inputVat), color: 'text-blue-400', icon: '📥' },
              { label: summary.netVatPayable > 0 ? 'Net VAT Payable' : 'VAT Refundable',
                value: fmtAED(summary.netVatPayable > 0 ? summary.netVatPayable : summary.vatRefundable),
                color: summary.netVatPayable > 0 ? 'text-red-400' : 'text-emerald-400', icon: summary.netVatPayable > 0 ? '⚠️' : '✅' },
            ].map(k => (
              <div key={k.label} className="bg-slate-800/60 border border-white/10 rounded-xl p-4">
                <p className="text-xs text-slate-500">{k.icon} {k.label}</p>
                <p className={`text-lg font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Breakdown by module */}
          <div>
            <h3 className="text-sm font-medium text-white mb-3">Revenue Breakdown by Module</h3>
            <div className="space-y-2">
              {Object.entries(summary.breakdown).map(([module, data]) => {
                const pct = summary.totalRevenue > 0 ? (data.revenue / summary.totalRevenue) * 100 : 0;
                return (
                  <div key={module} className="bg-slate-800/40 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-slate-300 capitalize">{module.toUpperCase()}</span>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-slate-400">Revenue: <span className="text-white">{fmtAED(data.revenue)}</span></span>
                        <span className="text-amber-400">VAT: {fmtAED(data.vat)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full">
                      <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-slate-600 mt-1 text-right">{pct.toFixed(1)}% of total</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filed Returns History */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3">Filed Returns</h2>
        {returns.length === 0 ? (
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-slate-400">No VAT returns filed yet</p>
            <p className="text-slate-600 text-xs mt-1">Use the auto-calculate + file flow above to submit a return</p>
          </div>
        ) : (
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Period</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-right px-5 py-3">Total Sales</th>
                  <th className="text-right px-5 py-3">Output VAT</th>
                  <th className="text-right px-5 py-3">Input VAT</th>
                  <th className="text-right px-5 py-3">Net Payable</th>
                  <th className="text-left px-5 py-3">Submitted</th>
                  <th className="text-right px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {returns.map(r => (
                  <tr key={r.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-white text-xs">{fmtDate(r.periodStart)}</p>
                      <p className="text-slate-500 text-xs">to {fmtDate(r.periodEnd)}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[r.status] ?? STATUS_STYLE.DRAFT}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300 text-xs">{fmtAED(r.totalSales)}</td>
                    <td className="px-5 py-3 text-right text-amber-400 text-xs">{fmtAED(r.outputTax)}</td>
                    <td className="px-5 py-3 text-right text-blue-400 text-xs">{fmtAED(r.inputTax)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-xs">
                      <span className={r.netTax > 0 ? 'text-red-400' : 'text-emerald-400'}>{fmtAED(r.netTax)}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">{fmtDate(r.submissionDate)}</td>
                    <td className="px-5 py-3 text-right">
                      {r.status === 'SUBMITTED' && (
                        <button onClick={() => advanceStatus(r.id, 'PAID')} disabled={transitioning === r.id}
                          className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50">
                          {transitioning === r.id ? '…' : '✓ Mark Paid'}
                        </button>
                      )}
                      {r.status === 'PAID' && <span className="text-xs text-emerald-400">✅ Complete</span>}
                      {r.status === 'DRAFT' && (
                        <button onClick={() => advanceStatus(r.id, 'SUBMITTED')} disabled={transitioning === r.id}
                          className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50">
                          {transitioning === r.id ? '…' : '📤 Submit'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showSubmit && summary && (
        <SubmitReturnModal summary={summary} onClose={() => setShowSubmit(false)} onSaved={load} />
      )}
    </div>
  );
}
