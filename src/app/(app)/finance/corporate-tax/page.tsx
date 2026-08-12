'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface CTEstimate {
  year: number; revenue: number; deductions: number;
  addBacks: number; extraDeductions: number; exemptIncome: number;
  taxableIncome: number; threshold: number; aboveThreshold: number;
  ctRate: number; ctLiability: number; effectiveRate: number;
  isSBREligible: boolean; sbrThreshold: number; filingDeadline: string;
}

interface CTReturn {
  id: string; tax_year: number; period_from: string; period_to: string;
  status: string; revenue: string; taxable_income: string; ct_liability: string;
  tax_paid: string; balance_due: string; is_sbr_eligible: boolean;
  filing_deadline: string; filed_at: string | null; notes: string | null;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n));
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'text-slate-400 bg-slate-700/50 border-slate-500/30',
  FILED:     'text-emerald-400 bg-emerald-900/20 border-emerald-500/30',
  AMENDED:   'text-amber-400 bg-amber-900/20 border-amber-500/30',
  ASSESSED:  'text-blue-400 bg-blue-900/20 border-blue-500/30',
};

/* ── Create Return Modal ── */
function CreateReturnModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    taxYear: new Date().getFullYear(),
    periodFrom: `${new Date().getFullYear()}-01-01`,
    periodTo: `${new Date().getFullYear()}-12-31`,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500';

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/finance/corporate-tax', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taxYear: form.taxYear, periodFrom: form.periodFrom, periodTo: form.periodTo, notes: form.notes }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else alert('Failed to create return');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Create CT Return</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tax Year</label>
            <input type="number" value={form.taxYear} onChange={e => setForm(f=>({...f, taxYear: parseInt(e.target.value)}))} className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Period From</label>
              <input type="date" value={form.periodFrom} onChange={e => setForm(f=>({...f, periodFrom: e.target.value}))} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Period To</label>
              <input type="date" value={form.periodTo} onChange={e => setForm(f=>({...f, periodTo: e.target.value}))} className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f=>({...f, notes: e.target.value}))} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500" />
          </div>
          <div className="bg-blue-900/20 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
            💡 Revenue and deductions will be auto-calculated from your operational data for the selected period.
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Computing…' : 'Create Return'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CorporateTaxPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [estimate, setEstimate] = useState<CTEstimate | null>(null);
  const [returns, setReturns] = useState<CTReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [eRes, rRes] = await Promise.all([
      fetch(`/api/finance/corporate-tax?type=estimate&year=${year}`),
      fetch('/api/finance/corporate-tax'),
    ]);
    if (eRes.ok) setEstimate(await eRes.json());
    if (rRes.ok) { const d = await rRes.json(); setReturns(d.data ?? []); }
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const file = async (id: string) => {
    await fetch('/api/finance/corporate-tax', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'file', returnId: id }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">UAE Corporate Tax</h1>
          <p className="text-slate-400 text-sm mt-0.5">9% CT on taxable income above AED 375,000 · FTA Compliance</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500">
            {[2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm">
            + Create CT Return
          </button>
        </div>
      </div>

      {/* UAE CT Rules Banner */}
      <div className="bg-gradient-to-r from-slate-800/60 to-emerald-900/20 border border-emerald-500/20 rounded-2xl p-4">
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-slate-400">CT Rate</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">9%</p>
            <p className="text-xs text-slate-500">on income above threshold</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Threshold (0% band)</p>
            <p className="text-2xl font-bold text-white mt-1">AED 375K</p>
            <p className="text-xs text-slate-500">zero-rate below this</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Small Business Relief</p>
            <p className="text-2xl font-bold text-white mt-1">AED 3M</p>
            <p className="text-xs text-slate-500">revenue threshold</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Filing Deadline</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">9 months</p>
            <p className="text-xs text-slate-500">after fiscal year end</p>
          </div>
        </div>
      </div>

      {/* Live Estimate */}
      {loading ? <div className="h-48 bg-slate-800/60 rounded-2xl animate-pulse" /> : estimate && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">FY {year} — Live CT Estimate</h2>
            {estimate.isSBREligible && (
              <span className="px-3 py-1 bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-full">
                ✓ Small Business Relief Eligible (Revenue ≤ AED 3M)
              </span>
            )}
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-6">
              {/* Computation waterfall */}
              <div className="space-y-0">
                {[
                  { label: 'Total Revenue',               value: estimate.revenue,          color: 'text-emerald-400', border: false },
                  { label: 'Less: Allowable Deductions',  value: -estimate.deductions,       color: 'text-red-400',     border: false },
                  { label: 'Add-backs (disallowed exp.)', value: estimate.addBacks,           color: 'text-amber-400',   border: false },
                  { label: 'Less: Exempt Income',         value: -estimate.exemptIncome,     color: 'text-blue-400',    border: true  },
                  { label: 'TAXABLE INCOME',              value: estimate.taxableIncome,     color: 'text-white',       border: false, bold: true },
                  { label: 'Less: Threshold (0% band)',   value: -estimate.threshold,        color: 'text-slate-400',   border: false },
                  { label: 'Income Above Threshold',      value: estimate.aboveThreshold,    color: 'text-slate-300',   border: true  },
                  { label: `CT @ ${estimate.ctRate}%`,    value: estimate.ctLiability,       color: estimate.ctLiability > 0 ? 'text-red-400' : 'text-emerald-400', border: false, bold: true },
                ].map((row, i) => (
                  <div key={i} className={`flex items-center justify-between py-2 ${row.border ? 'border-b border-white/20 mb-1' : ''}`}>
                    <span className={`text-sm ${row.bold ? 'font-bold text-white' : 'text-slate-400'}`}>{row.label}</span>
                    <span className={`text-sm font-mono ${row.color} ${row.bold ? 'font-bold text-lg' : ''}`}>
                      AED {row.value < 0 ? `(${fmt(Math.abs(row.value))})` : fmt(row.value)}
                    </span>
                  </div>
                ))}
              </div>
              {/* Summary panel */}
              <div className="space-y-3">
                <div className={`p-4 rounded-2xl border ${estimate.ctLiability === 0 ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
                  <p className="text-xs text-slate-400">Estimated CT Liability</p>
                  <p className={`text-3xl font-bold mt-1 ${estimate.ctLiability === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    AED {fmt(estimate.ctLiability)}
                  </p>
                  {estimate.isSBREligible && <p className="text-xs text-emerald-400 mt-1">✓ Nil — Small Business Relief applied</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/60 rounded-xl p-3">
                    <p className="text-xs text-slate-400">Effective Rate</p>
                    <p className="text-xl font-bold text-white mt-1">{estimate.effectiveRate}%</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3">
                    <p className="text-xs text-slate-400">Filing Deadline</p>
                    <p className="text-xl font-bold text-amber-400 mt-1">{estimate.filingDeadline}</p>
                  </div>
                </div>
                <div className="bg-slate-800/60 rounded-xl p-3">
                  <p className="text-xs text-slate-400">Taxable vs Total Revenue</p>
                  <div className="mt-2 bg-slate-700 rounded-full h-2">
                    <div className="bg-amber-500 h-2 rounded-full"
                      style={{ width: `${Math.min(100, estimate.revenue > 0 ? (estimate.taxableIncome / estimate.revenue) * 100 : 0)}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {estimate.revenue > 0 ? Math.round((estimate.taxableIncome / estimate.revenue) * 100) : 0}% of revenue is taxable
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CT Returns History */}
      <div>
        <h2 className="text-sm font-bold text-white mb-3">CT Returns History</h2>
        {returns.length === 0 ? (
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-8 text-center">
            <p className="text-slate-500 text-sm">No CT returns created yet.</p>
          </div>
        ) : (
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Tax Year</th>
                  <th className="text-left px-4 py-3">Period</th>
                  <th className="text-left px-4 py-3 w-24">Status</th>
                  <th className="text-right px-4 py-3">Revenue</th>
                  <th className="text-right px-4 py-3">Taxable Income</th>
                  <th className="text-right px-4 py-3">CT Liability</th>
                  <th className="text-right px-4 py-3">Tax Paid</th>
                  <th className="text-right px-4 py-3">Balance Due</th>
                  <th className="text-left px-4 py-3">Filing Deadline</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {returns.map(r => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-bold text-white">FY {r.tax_year}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{r.period_from} → {r.period_to}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLE[r.status] ?? ''}`}>
                        {r.status}
                      </span>
                      {r.is_sbr_eligible && <span className="ml-1 text-xs text-emerald-500" title="SBR">★</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-300">AED {fmt(parseFloat(r.revenue))}</td>
                    <td className="px-4 py-3 text-right text-sm text-slate-300">AED {fmt(parseFloat(r.taxable_income))}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-amber-400">AED {fmt(parseFloat(r.ct_liability))}</td>
                    <td className="px-4 py-3 text-right text-sm text-emerald-400">AED {fmt(parseFloat(r.tax_paid))}</td>
                    <td className={`px-4 py-3 text-right text-sm font-bold ${parseFloat(r.balance_due) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      AED {fmt(parseFloat(r.balance_due))}
                    </td>
                    <td className={`px-4 py-3 text-xs ${new Date(r.filing_deadline) < new Date() && r.status !== 'FILED' ? 'text-red-400 font-bold' : 'text-slate-400'}`}>
                      {r.filing_deadline}
                    </td>
                    <td className="px-4 py-3">
                      {r.status === 'DRAFT' && (
                        <button onClick={() => file(r.id)}
                          className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium">
                          File
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

      {showCreate && <CreateReturnModal onClose={() => setShowCreate(false)} onSaved={load} />}
    </div>
  );
}
