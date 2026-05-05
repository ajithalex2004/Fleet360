'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface TaxCategory { id: string; code: string; name: string; rate: string; description: string | null; is_default: boolean; is_active: boolean; fta_code: string | null; }
interface TaxSummary {
  period: { year: number; quarter: number; startDate: string; endDate: string };
  output: { vat: number; invoices: number };
  input:  { vat: number };
  net:    { vat: number; payable: boolean };
  categories: TaxCategory[];
}

const fmtAED = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const QUARTERS = [1, 2, 3, 4];
const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 1, currentYear, currentYear + 1];

const CAT_STYLE: Record<string, string> = {
  STANDARD:     'bg-amber-500/20 text-amber-300 border-amber-500/30',
  ZERO:         'bg-blue-500/20  text-blue-300  border-blue-500/30',
  EXEMPT:       'bg-slate-500/20 text-slate-300 border-slate-500/30',
  OUT_OF_SCOPE: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

/* ── Category Edit Modal ── */
function CategoryModal({ cat, onClose, onSaved }: { cat?: TaxCategory; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    code: cat?.code ?? '', name: cat?.name ?? '', rate: cat?.rate ?? '0',
    description: cat?.description ?? '', ftaCode: cat?.fta_code ?? '',
    isDefault: cat?.is_default ?? false, isActive: cat?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    await fetch('/api/finance/tax', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, rate: parseFloat(form.rate) }),
    });
    setSaving(false);
    onSaved(); onClose();
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">{cat ? 'Edit' : 'Add'} Tax Category</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Code</label>
              <input value={form.code} onChange={s('code')} placeholder="STANDARD" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Rate (%)</label>
              <input type="number" value={form.rate} onChange={s('rate')} placeholder="5.00" step="0.01" className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name</label>
            <input value={form.name} onChange={s('name')} placeholder="Standard Rate" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description</label>
            <textarea value={form.description} onChange={s('description')} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">FTA Box Code</label>
            <input value={form.ftaCode} onChange={s('ftaCode')} placeholder="1a" className={inp} />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                className="w-4 h-4 rounded accent-amber-500" />
              <span className="text-sm text-slate-300">Default Rate</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4 rounded accent-emerald-500" />
              <span className="text-sm text-slate-300">Active</span>
            </label>
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : '✓ Save Category'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function TaxPage() {
  const now = new Date();
  const [year, setYear]       = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [categories, setCats] = useState<TaxCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'overview' | 'categories' | 'audit'>('overview');
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<TaxCategory | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const [sumRes, catRes] = await Promise.all([
      fetch(`/api/finance/tax?type=summary&year=${year}&quarter=${quarter}`, { cache: 'no-store' }),
      fetch('/api/finance/tax?type=categories', { cache: 'no-store' }),
    ]);
    if (sumRes.ok) setSummary(await sumRes.json());
    if (catRes.ok) { const d = await catRes.json(); setCats(d.data ?? []); }
    setLoading(false);
  }, [year, quarter]);

  useEffect(() => { load(); }, [load]);

  const logAudit = async (action: string, notes: string) => {
    await fetch('/api/finance/tax', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'audit_log', action, notes, performedBy: 'Finance Manager', entityType: 'VAT_RETURN' }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tax Engine</h1>
          <p className="text-slate-400 text-sm mt-0.5">UAE VAT — FTA compliance with Input/Output tracking</p>
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
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1 w-fit">
        {(['overview', 'categories', 'audit'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {t === 'overview' ? '📊 Overview' : t === 'categories' ? '🏷️ Categories' : '📋 Audit Log'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {loading ? (
            <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />
          ) : summary && (
            <div className="space-y-4">
              {/* VAT summary cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                  <p className="text-xs text-slate-500">📤 Output VAT (Collected)</p>
                  <p className="text-3xl font-bold text-amber-400 mt-2">{fmtAED(summary.output.vat)}</p>
                  <p className="text-xs text-slate-500 mt-1">From {summary.output.invoices} invoices</p>
                </div>
                <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                  <p className="text-xs text-slate-500">📥 Input VAT (Recoverable)</p>
                  <p className="text-3xl font-bold text-blue-400 mt-2">{fmtAED(summary.input.vat)}</p>
                  <p className="text-xs text-slate-500 mt-1">Fuel + maintenance purchases</p>
                </div>
                <div className={`border rounded-2xl p-5 ${summary.net.payable ? 'bg-red-900/20 border-red-500/30' : 'bg-emerald-900/20 border-emerald-500/30'}`}>
                  <p className="text-xs text-slate-500">{summary.net.payable ? '⚠️ Net VAT Payable' : '✅ VAT Refundable'}</p>
                  <p className={`text-3xl font-bold mt-2 ${summary.net.payable ? 'text-red-400' : 'text-emerald-400'}`}>
                    {fmtAED(Math.abs(summary.net.vat))}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Q{summary.period.quarter} {summary.period.year}</p>
                </div>
              </div>

              {/* Period info */}
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Q{summary.period.quarter} {summary.period.year} VAT Period</p>
                    <p className="text-xs text-slate-400">{summary.period.startDate} → {summary.period.endDate}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => logAudit('CALCULATE', `VAT calculated for Q${summary.period.quarter} ${summary.period.year}`)}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-semibold">
                      ⟳ Recalculate & Log
                    </button>
                    <button onClick={() => logAudit('SUBMIT', `VAT return submitted for Q${summary.period.quarter} ${summary.period.year}`)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold">
                      📤 Log Submission
                    </button>
                  </div>
                </div>
              </div>

              {/* UAE VAT Return Box Mapping */}
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-white mb-4">UAE FTA VAT Return — Box Mapping</h3>
                <div className="space-y-2">
                  {[
                    { box: '1a', label: 'Standard-Rated Domestic Supplies', amount: summary.output.vat / 0.05, vat: summary.output.vat },
                    { box: '1b', label: 'Zero-Rated Supplies', amount: 0, vat: 0 },
                    { box: '1c', label: 'Exempt Supplies', amount: 0, vat: 0 },
                    { box: '9',  label: 'Total Value of Standard-Rated Expenses (Input VAT)', amount: summary.input.vat / 0.05, vat: summary.input.vat },
                    { box: '12', label: 'Net VAT Due', amount: null, vat: summary.net.vat },
                  ].map(row => (
                    <div key={row.box} className="grid grid-cols-4 gap-3 text-xs py-2 border-b border-white/5 last:border-0">
                      <span className="text-amber-400 font-mono font-bold">Box {row.box}</span>
                      <span className="col-span-2 text-slate-300">{row.label}</span>
                      <span className={`text-right font-semibold ${row.box === '12' ? (summary.net.payable ? 'text-red-400' : 'text-emerald-400') : 'text-white'}`}>
                        {fmtAED(row.vat)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setEditCat(undefined); setShowCatModal(true); }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl text-sm">
              + Add Category
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {categories.map(cat => (
              <div key={cat.id} className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CAT_STYLE[cat.code] ?? 'text-slate-300'}`}>
                      {cat.code}
                    </span>
                    {cat.is_default && <span className="ml-2 text-xs text-amber-400">★ Default</span>}
                  </div>
                  <button onClick={() => { setEditCat(cat); setShowCatModal(true); }}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5">
                    Edit
                  </button>
                </div>
                <p className="text-xl font-bold text-white">{cat.rate}%</p>
                <p className="text-sm font-medium text-slate-200 mt-1">{cat.name}</p>
                {cat.description && <p className="text-xs text-slate-400 mt-1">{cat.description}</p>}
                {cat.fta_code && <p className="text-xs text-amber-400 mt-2 font-mono">FTA Box: {cat.fta_code}</p>}
                {!cat.is_active && <p className="text-xs text-red-400 mt-1">● Inactive</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <AuditLog />
      )}

      {showCatModal && (
        <CategoryModal cat={editCat} onClose={() => setShowCatModal(false)} onSaved={load} />
      )}
    </div>
  );
}

function AuditLog() {
  const [logs, setLogs] = useState<Record<string, string>[]>([]);
  useEffect(() => {
    fetch('/api/finance/tax?type=audit', { cache: 'no-store' })
      .then(r => r.json()).then(d => setLogs(d.data ?? [])).catch(() => {});
  }, []);

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
      {logs.length === 0 ? (
        <div className="p-12 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-slate-400">No audit entries yet</p>
          <p className="text-slate-600 text-xs mt-1">Recalculate or submit a VAT return to create audit entries</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
              <th className="text-left px-5 py-3">Action</th>
              <th className="text-left px-5 py-3">Entity</th>
              <th className="text-left px-5 py-3">Performed By</th>
              <th className="text-left px-5 py-3">Notes</th>
              <th className="text-left px-5 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={String(l.id)} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40">
                <td className="px-5 py-3">
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full text-xs font-medium">
                    {String(l.action)}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-300 text-xs">{String(l.entity_type ?? '—')}</td>
                <td className="px-5 py-3 text-slate-300 text-xs">{String(l.performed_by ?? '—')}</td>
                <td className="px-5 py-3 text-slate-400 text-xs">{String(l.notes ?? '—')}</td>
                <td className="px-5 py-3 text-slate-400 text-xs">{new Date(String(l.created_at)).toLocaleString('en-AE')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
