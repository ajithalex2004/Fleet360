'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, DollarSign } from 'lucide-react';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';

interface VATReturn {
  id: string; status: string; periodStart: string; periodEnd: string;
  totalSales: number; totalPurchases: number; outputTax: number; inputTax: number; netTax: number;
  submissionDate?: string | null; paymentDate?: string | null; notes?: string | null;
  createdAt: string;
}

interface Vat201EmirateBox {
  box: string;
  emirate: string;
  amountAed: number;
  vatAmountAed: number;
  adjustmentAed: number;
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
  vat201Boxes?: {
    box1StandardRatedByEmirate: Vat201EmirateBox[];
    box3ReverseChargeSupplies: { amountAed: number; vatAmountAed: number };
    box6ZeroRatedSupplies: { amountAed: number };
    box7ExemptSupplies: { amountAed: number };
    box8TotalSuppliesAndOutputVat: { amountAed: number; vatAmountAed: number };
    box9StandardRatedExpenses: { amountAed: number; recoverableVatAed: number };
    box12TotalDueTax: number;
    box13RecoverableTax: number;
    box14NetVatPayableOrRefundable: number;
  };
}

const fmtAED  = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  SUBMITTED: 'bg-blue-500/20  text-blue-300  border-blue-500/30',
  PAID:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  CANCELLED: 'bg-red-500/20   text-red-400   border-red-500/30',
};

/* ─────────────────────────── SubmitReturnModal ──────────────── */
function SubmitReturnModal({ summary, onClose, onSaved }: { summary: VATSummary; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    periodStart: summary.periodStart, periodEnd: summary.periodEnd,
    totalSales: summary.totalRevenue, totalPurchases: summary.vat201Boxes?.box9StandardRatedExpenses.amountAed ?? 0,
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
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">Submit UAE Form VAT 201 — {summary.period}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm space-y-2">
            <div className="flex justify-between text-[var(--text-muted)]"><span>Box 8: Total Supplies (excl. VAT)</span><span className="font-medium">{fmtAED(form.totalSales)}</span></div>
            <div className="flex justify-between text-[var(--text-muted)]"><span>Box 12: Total Due Output Tax (5%)</span><span className="font-medium">{fmtAED(form.outputTax)}</span></div>
            <div className="flex justify-between text-[var(--text-muted)]"><span>Box 13: Recoverable Input Tax</span><span className="font-medium">−{fmtAED(form.inputTax)}</span></div>
            <div className="flex justify-between font-bold text-base border-t border-[var(--border-subtle)] pt-2">
              <span className="text-[var(--text-main)]">Box 14: Net VAT Payable</span>
              <span className="text-amber-400">{fmtAED(form.netTax)}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">FTA EmaraTax Submission Notes / Reference</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3} className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] resize-none" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm disabled:opacity-50">
            {saving ? 'Submitting…' : '📤 Submit VAT 201 Return'}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">UAE VAT Returns & FTA Audit File (FAF)</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">UAE Form VAT 201 (Box 1a–1g Emirate Breakdown) & FTA Audit File v1.0.0 — auto-calculated from all revenue modules</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={quarter} onChange={e => setQuarter(Number(e.target.value))}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
            {QUARTERS.map(q => <option key={q} value={q}>Q{q}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
          <a
            href={`/api/finance/vat?year=${year}&quarter=${quarter}&format=faf`}
            className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-medium">
            ⬇ Download FTA Audit File (FAF)
          </a>
          <button onClick={autoCalc} disabled={calcing}
            className="px-4 py-2 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] rounded-xl text-sm disabled:opacity-50">
            {calcing ? '⟳ Calculating…' : '⟳ Auto-Calculate'}
          </button>
        </div>
      </div>

      {/* Current Period Summary */}
      {loading ? (
        <div className="h-64 bg-[var(--bg-surface)]/60 rounded-2xl animate-pulse" />
      ) : summary && (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-main)]">{summary.period}</h2>
              <p className="text-[var(--text-muted)] text-xs">{fmtDate(summary.periodStart)} — {fmtDate(summary.periodEnd)}</p>
            </div>
            <button onClick={() => setShowSubmit(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-sm">
              📤 File Form VAT 201 Return
            </button>
          </div>

          {/* Main VAT figures */}
          <StatGrid cols={4}>
            <KpiCard label="Total Revenue (Excl. VAT)" value={fmtAED(summary.totalRevenue)} icon={DollarSign} accent="slate" />
            <KpiCard label="Output VAT (Box 12)" value={fmtAED(summary.totalVatCollected)} icon={ArrowUpRight} accent="amber" />
            <KpiCard label="Input VAT Recoverable (Box 13)" value={fmtAED(summary.inputVat)} icon={ArrowDownLeft} accent="cyan" />
            <KpiCard
              label={summary.netVatPayable > 0 ? 'Net VAT Payable (Box 14)' : 'VAT Refundable (Box 14)'}
              value={fmtAED(summary.netVatPayable > 0 ? summary.netVatPayable : summary.vatRefundable)}
              icon={summary.netVatPayable > 0 ? AlertTriangle : CheckCircle2}
              accent={summary.netVatPayable > 0 ? 'rose' : 'emerald'}
            />
          </StatGrid>

          {/* UAE Form VAT 201 Box 1a-1g Emirate Breakdown */}
          {summary.vat201Boxes && (
            <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">UAE FTA Form VAT 201 — Box 1a–1g Standard Rated Supplies by Emirate</h3>
                  <p className="text-xs text-[var(--text-faint)]">Required by Federal Tax Authority EmaraTax portal for quarterly/monthly VAT returns</p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
                  Form VAT 201
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase">
                    <th className="text-left px-4 py-2.5">Box</th>
                    <th className="text-left px-4 py-2.5">Description / Emirate</th>
                    <th className="text-right px-4 py-2.5">Amount (AED)</th>
                    <th className="text-right px-4 py-2.5">VAT Amount (AED)</th>
                    <th className="text-right px-4 py-2.5">Adjustment (AED)</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.vat201Boxes.box1StandardRatedByEmirate.map(row => (
                    <tr key={row.box} className="border-b border-[var(--border-subtle)]/60 hover:bg-[var(--bg-surface)]/40">
                      <td className="px-4 py-2 font-mono font-bold text-amber-400">Box {row.box}</td>
                      <td className="px-4 py-2 text-[var(--text-main)]">Standard rated supplies in {row.emirate}</td>
                      <td className="px-4 py-2 text-right font-mono text-[var(--text-main)]">{fmtAED(row.amountAed)}</td>
                      <td className="px-4 py-2 text-right font-mono text-amber-400">{fmtAED(row.vatAmountAed)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">{fmtAED(row.adjustmentAed)}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-[var(--border-subtle)]/60">
                    <td className="px-4 py-2 font-mono font-bold text-[var(--text-muted)]">Box 3</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">Supplies subject to reverse charge provisions</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">{fmtAED(summary.vat201Boxes.box3ReverseChargeSupplies.amountAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">{fmtAED(summary.vat201Boxes.box3ReverseChargeSupplies.vatAmountAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-faint)]">—</td>
                  </tr>
                  <tr className="border-b border-[var(--border-subtle)]/60">
                    <td className="px-4 py-2 font-mono font-bold text-[var(--text-muted)]">Box 6</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">Zero-rated supplies</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">{fmtAED(summary.vat201Boxes.box6ZeroRatedSupplies.amountAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-faint)]">AED 0.00</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-faint)]">—</td>
                  </tr>
                  <tr className="border-b border-[var(--border-subtle)]/60">
                    <td className="px-4 py-2 font-mono font-bold text-[var(--text-muted)]">Box 7</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">Exempt supplies</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">{fmtAED(summary.vat201Boxes.box7ExemptSupplies.amountAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-faint)]">AED 0.00</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-faint)]">—</td>
                  </tr>
                  <tr className="border-b border-[var(--border-subtle)]/60 bg-amber-500/5 font-semibold">
                    <td className="px-4 py-2 font-mono text-amber-400">Box 8</td>
                    <td className="px-4 py-2 text-[var(--text-main)]">Total value of all supplies and Output VAT due</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-main)]">{fmtAED(summary.vat201Boxes.box8TotalSuppliesAndOutputVat.amountAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-amber-400">{fmtAED(summary.vat201Boxes.box8TotalSuppliesAndOutputVat.vatAmountAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">AED 0.00</td>
                  </tr>
                  <tr className="border-b border-[var(--border-subtle)]/60">
                    <td className="px-4 py-2 font-mono font-bold text-blue-400">Box 9</td>
                    <td className="px-4 py-2 text-[var(--text-main)]">Standard rated expenses (Recoverable Input VAT)</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-main)]">{fmtAED(summary.vat201Boxes.box9StandardRatedExpenses.amountAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-blue-400">{fmtAED(summary.vat201Boxes.box9StandardRatedExpenses.recoverableVatAed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">AED 0.00</td>
                  </tr>
                  <tr className="bg-[var(--bg-surface)] font-bold">
                    <td className="px-4 py-2.5 font-mono text-emerald-400">Box 14</td>
                    <td className="px-4 py-2.5 text-[var(--text-main)]">Net VAT payable (or reclaimable) for the period</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[var(--text-faint)]">—</td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{fmtAED(summary.vat201Boxes.box14NetVatPayableOrRefundable)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[var(--text-faint)]">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Breakdown by module */}
          <div>
            <h3 className="text-sm font-medium text-[var(--text-main)] mb-3">Revenue Breakdown by Module</h3>
            <div className="space-y-2">
              {Object.entries(summary.breakdown).map(([module, data]) => {
                const pct = summary.totalRevenue > 0 ? (data.revenue / summary.totalRevenue) * 100 : 0;
                return (
                  <div key={module} className="bg-[var(--bg-surface)]/40 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-[var(--text-muted)] capitalize">{module.toUpperCase()}</span>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-[var(--text-muted)]">Revenue: <span className="text-[var(--text-main)]">{fmtAED(data.revenue)}</span></span>
                        <span className="text-amber-400">VAT: {fmtAED(data.vat)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-surface-hover)] rounded-full">
                      <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-[var(--text-faint)] mt-1 text-right">{pct.toFixed(1)}% of total</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filed Returns History */}
      <div>
        <h2 className="text-lg font-bold text-[var(--text-main)] mb-3">Filed Returns</h2>
        {returns.length === 0 ? (
          <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-12 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-[var(--text-muted)]">No VAT returns filed yet</p>
            <p className="text-[var(--text-faint)] text-xs mt-1">Use the auto-calculate + file flow above to submit a return</p>
          </div>
        ) : (
          <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase tracking-wider">
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
                  <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-surface)]/40 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-[var(--text-main)] text-xs">{fmtDate(r.periodStart)}</p>
                      <p className="text-[var(--text-faint)] text-xs">to {fmtDate(r.periodEnd)}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[r.status] ?? STATUS_STYLE.DRAFT}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-[var(--text-muted)] text-xs">{fmtAED(r.totalSales)}</td>
                    <td className="px-5 py-3 text-right text-amber-400 text-xs">{fmtAED(r.outputTax)}</td>
                    <td className="px-5 py-3 text-right text-blue-400 text-xs">{fmtAED(r.inputTax)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-xs">
                      <span className={r.netTax > 0 ? 'text-red-400' : 'text-emerald-400'}>{fmtAED(r.netTax)}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{fmtDate(r.submissionDate)}</td>
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
