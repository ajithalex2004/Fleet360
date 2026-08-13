'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';

interface Expense {
  id: string; expense_no: string; category: string; sub_category: string | null;
  description: string; amount: string; currency: string; vat_amount: string;
  total_amount: string; expense_date: string; payment_method: string | null;
  status: string; vehicle_id: string | null; driver_id: string | null;
  cost_centre: string | null; submitted_by: string | null; approved_by: string | null;
  rejected_by: string | null; rejection_reason: string | null; paid_at: string | null;
  notes: string | null; created_at: string;
}

const fmtAED  = (n: string | number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const CATS    = ['FUEL', 'TOLL', 'MAINTENANCE', 'INSURANCE', 'DRIVER_ALLOWANCE', 'OFFICE', 'REPAIRS', 'OTHER'];
const CENTRES = ['RAC', 'LEASING', 'LOGISTICS', 'STAFF', 'SCHOOL', 'ADMIN'];
const STATUSES = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'];
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-slate-500/20 text-slate-300 border-slate-500/30',
  SUBMITTED: 'bg-blue-500/20  text-blue-300  border-blue-500/30',
  APPROVED:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  REJECTED:  'bg-red-500/20   text-red-400   border-red-500/30',
  PAID:      'bg-purple-500/20 text-purple-300 border-purple-500/30',
};
const CAT_ICONS: Record<string, string> = {
  FUEL: '⛽', TOLL: '🛣️', MAINTENANCE: '🔧', INSURANCE: '🛡️',
  DRIVER_ALLOWANCE: '👤', OFFICE: '🏢', REPAIRS: '⚙️', OTHER: '📋',
};

/* ── Add Expense Modal ── */
function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    category: 'FUEL', subCategory: '', description: '', amount: '', vatAmount: '0',
    expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'BANK_TRANSFER',
    costCentre: '', vehicleId: '', driverId: '', notes: '', submittedBy: '',
  });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const totalAmount = (parseFloat(form.amount || '0') + parseFloat(form.vatAmount || '0')).toFixed(2);

  const save = async () => {
    if (!form.category || !form.description || !form.amount) return;
    setSaving(true);
    const res = await fetch('/api/finance/expenses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount), vatAmount: parseFloat(form.vatAmount || '0') }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else alert('Failed to save expense');
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">New Expense</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category *</label>
              <select value={form.category} onChange={s('category')} className={inp}>
                {CATS.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cost Centre</label>
              <select value={form.costCentre} onChange={s('costCentre')} className={inp}>
                <option value="">— Select —</option>
                {CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description *</label>
            <input value={form.description} onChange={s('description')} placeholder="Fuel for vehicle ABC-1234" className={inp} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Amount (excl. VAT) *</label>
              <input type="number" value={form.amount} onChange={s('amount')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">VAT Amount</label>
              <input type="number" value={form.vatAmount} onChange={s('vatAmount')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Total</label>
              <div className="w-full bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-emerald-400 font-semibold">
                AED {totalAmount}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expense Date *</label>
              <input type="date" value={form.expenseDate} onChange={s('expenseDate')} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Payment Method</label>
              <select value={form.paymentMethod} onChange={s('paymentMethod')} className={inp}>
                <option value="CASH">💵 Cash</option>
                <option value="BANK_TRANSFER">🏦 Bank Transfer</option>
                <option value="CHEQUE">📋 Cheque</option>
                <option value="CARD">💳 Card</option>
                <option value="PDC">📅 PDC</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Vehicle ID</label>
              <input value={form.vehicleId} onChange={s('vehicleId')} placeholder="Optional" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Submitted By</label>
              <input value={form.submittedBy} onChange={s('submittedBy')} placeholder="Your name" className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={s('notes')} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-emerald-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : '✓ Create Expense'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary]   = useState<{status: string; count: string; total: string}[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('ALL');
  const [catFilter, setCatFilter] = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('status', tab);
    if (catFilter)     params.set('category', catFilter);
    const res = await fetch(`/api/finance/expenses?${params}`, { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); setExpenses(d.data ?? []); setSummary(d.summary ?? []); }
    setLoading(false);
  }, [tab, catFilter]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, act: string, extra = {}) => {
    setActioning(id);
    await fetch(`/api/finance/expenses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act, ...extra }),
    });
    setActioning(null);
    load();
  };

  const summOf = (s: string) => summary.find(x => x.status === s);
  const totalApproved = parseFloat(summOf('APPROVED')?.total ?? '0') + parseFloat(summOf('PAID')?.total ?? '0');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Expense Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">Operational expenses with approval workflow</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => downloadXLSX(`Expenses-${new Date().toISOString().split('T')[0]}.xls`, expenses.map(e => ({
            'Expense No':   e.expense_no, 'Category': e.category, 'Sub-Category': e.sub_category ?? '',
            'Description':  e.description, 'Amount (AED)': Number(e.amount),
            'VAT (AED)':    Number(e.vat_amount), 'Total (AED)': Number(e.total_amount),
            'Date':         e.expense_date, 'Method': e.payment_method ?? '',
            'Cost Centre':  e.cost_centre ?? '', 'Status': e.status,
            'Submitted By': e.submitted_by ?? '', 'Approved By': e.approved_by ?? '',
          })))}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm border border-white/10">
            ⬇ Export XLSX
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm">
            + New Expense
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUSES.filter(s => s !== 'ALL').map(s => {
          const d = summOf(s);
          return (
            <div key={s} className="bg-slate-900/60 border border-white/10 rounded-xl p-3">
              <p className="text-xs text-slate-500">{s}</p>
              <p className={`text-xl font-bold mt-0.5 ${STATUS_STYLE[s]?.split(' ')[1] ?? 'text-white'}`}>{d?.count ?? 0}</p>
              <p className="text-xs text-slate-500">{fmtAED(d?.total ?? '0')}</p>
            </div>
          );
        })}
      </div>

      {/* Approval Queue Banner */}
      {(parseInt(summOf('SUBMITTED')?.count ?? '0') > 0) && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-blue-400 text-lg">📥</span>
          <p className="text-sm text-blue-300 font-medium">
            {summOf('SUBMITTED')?.count} expense{parseInt(summOf('SUBMITTED')?.count ?? '0') > 1 ? 's' : ''} pending approval — {fmtAED(summOf('SUBMITTED')?.total ?? '0')}
          </p>
          <button onClick={() => setTab('SUBMITTED')} className="ml-auto text-xs px-3 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">
            Review →
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1 flex-wrap">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setTab(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {s} {s !== 'ALL' && `(${summOf(s)?.count ?? 0})`}
            </button>
          ))}
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
          <option value="">All Categories</option>
          {CATS.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {c}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />
      ) : expenses.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <p className="text-slate-400">No expenses found</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Expense #</th>
                <th className="text-left px-5 py-3">Category</th>
                <th className="text-left px-5 py-3">Description</th>
                <th className="text-left px-5 py-3">Centre</th>
                <th className="text-right px-5 py-3">Total</th>
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3 text-white font-mono text-xs font-medium">{e.expense_no}</td>
                  <td className="px-5 py-3 text-slate-300 text-xs">{CAT_ICONS[e.category]} {e.category.replace('_',' ')}</td>
                  <td className="px-5 py-3 text-slate-300 text-xs max-w-xs truncate">{e.description}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">{e.cost_centre ?? '—'}</td>
                  <td className="px-5 py-3 text-right font-medium text-white text-xs">{fmtAED(e.total_amount)}</td>
                  <td className="px-5 py-3 text-slate-300 text-xs">{fmtDate(e.expense_date)}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[e.status] ?? ''}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {e.status === 'DRAFT' && (
                        <button onClick={() => action(e.id, 'submit', { submittedBy: 'Finance' })}
                          disabled={actioning === e.id}
                          className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50">
                          {actioning === e.id ? '…' : 'Submit'}
                        </button>
                      )}
                      {e.status === 'SUBMITTED' && (
                        <>
                          <button onClick={() => action(e.id, 'approve', { approvedBy: 'Finance Manager' })}
                            disabled={actioning === e.id}
                            className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50">
                            {actioning === e.id ? '…' : '✓ Approve'}
                          </button>
                          <button onClick={() => action(e.id, 'reject', { rejectedBy: 'Finance Manager', rejectionReason: 'Review required' })}
                            disabled={actioning === e.id}
                            className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50">
                            ✕
                          </button>
                        </>
                      )}
                      {e.status === 'APPROVED' && (
                        <button onClick={() => action(e.id, 'mark_paid')}
                          disabled={actioning === e.id}
                          className="text-xs px-2 py-1 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50">
                          {actioning === e.id ? '…' : '💸 Mark Paid'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={load} />}
    </div>
  );
}
