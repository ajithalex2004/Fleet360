'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';
import { DrawerPortal } from '@/components/ui/DrawerPortal';

interface Expense {
  id: string; expense_no: string; category: string; sub_category: string | null;
  description: string; amount: string; currency: string; vat_amount: string;
  total_amount: string; expense_date: string; payment_method: string | null;
  status: string; vehicle_id: string | null; driver_id: string | null;
  cost_centre: string | null; submitted_by: string | null; approved_by: string | null;
  rejected_by: string | null; rejection_reason: string | null; paid_at: string | null;
  notes: string | null; created_at: string;
  reference_no?: string | null; receipt_url?: string | null;
  submitted_at?: string | null; approved_at?: string | null; rejected_at?: string | null;
  updated_at?: string | null;
}

const fmtAED  = (n: string | number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const fmtDateTime = (s: string | null | undefined) => s ? new Date(s).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const EDITABLE = ['DRAFT', 'REJECTED'];
const PAY_LABELS: Record<string, string> = {
  CASH: '💵 Cash', BANK_TRANSFER: '🏦 Bank Transfer', CHEQUE: '📋 Cheque', CARD: '💳 Card', PDC: '📅 PDC',
};
const CATS    = ['FUEL', 'TOLL', 'MAINTENANCE', 'INSURANCE', 'DRIVER_ALLOWANCE', 'OFFICE', 'REPAIRS', 'OTHER'];
const CENTRES = ['RAC', 'LEASING', 'LOGISTICS', 'STAFF', 'SCHOOL', 'ADMIN'];
const STATUSES = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'];
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  SUBMITTED: 'bg-blue-500/20  text-blue-300  border-blue-500/30',
  APPROVED:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  REJECTED:  'bg-red-500/20   text-red-400   border-red-500/30',
  PAID:      'bg-purple-500/20 text-purple-300 border-purple-500/30',
};
const CAT_ICONS: Record<string, string> = {
  FUEL: '⛽', TOLL: '🛣️', MAINTENANCE: '🔧', INSURANCE: '🛡️',
  DRIVER_ALLOWANCE: '👤', OFFICE: '🏢', REPAIRS: '⚙️', OTHER: '📋',
};

/* ── Create / Edit Expense Modal ── */
function ExpenseFormModal({ expense, onClose, onSaved }: { expense?: Expense; onClose: () => void; onSaved: () => void }) {
  const editing = !!expense;
  const [form, setForm] = useState({
    category:      expense?.category ?? 'FUEL',
    subCategory:   expense?.sub_category ?? '',
    description:   expense?.description ?? '',
    amount:        expense ? String(Number(expense.amount)) : '',
    vatAmount:     expense ? String(Number(expense.vat_amount ?? 0)) : '0',
    expenseDate:   expense?.expense_date ? String(expense.expense_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    paymentMethod: expense?.payment_method ?? 'BANK_TRANSFER',
    costCentre:    expense?.cost_centre ?? '',
    vehicleId:     expense?.vehicle_id ?? '',
    driverId:      expense?.driver_id ?? '',
    referenceNo:   expense?.reference_no ?? '',
    notes:         expense?.notes ?? '',
    submittedBy:   expense?.submitted_by ?? '',
  });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const totalAmount = (parseFloat(form.amount || '0') + parseFloat(form.vatAmount || '0')).toFixed(2);

  const save = async () => {
    if (!form.category || !form.description || !form.amount) return alert('Category, description and amount are required');
    setSaving(true);
    const payload = { ...form, amount: parseFloat(form.amount), vatAmount: parseFloat(form.vatAmount || '0') };
    const res = editing
      ? await fetch(`/api/finance/expenses/${expense!.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', ...payload }),
        })
      : await fetch('/api/finance/expenses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else alert((await res.json().catch(() => ({}))).error ?? 'Failed to save expense');
  };

  const inp = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">{editing ? `Edit ${expense!.expense_no}` : 'New Expense'}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Category *</label>
              <select value={form.category} onChange={s('category')} className={inp}>
                {CATS.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Cost Centre</label>
              <select value={form.costCentre} onChange={s('costCentre')} className={inp}>
                <option value="">— Select —</option>
                {CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Description *</label>
            <input value={form.description} onChange={s('description')} placeholder="Fuel for vehicle ABC-1234" className={inp} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Amount (excl. VAT) *</label>
              <input type="number" value={form.amount} onChange={s('amount')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">VAT Amount</label>
              <input type="number" value={form.vatAmount} onChange={s('vatAmount')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Total</label>
              <div className="w-full bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-emerald-400 font-semibold">
                AED {totalAmount}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Expense Date *</label>
              <input type="date" value={form.expenseDate} onChange={s('expenseDate')} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Payment Method</label>
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
              <label className="block text-xs text-[var(--text-muted)] mb-1">Vehicle ID</label>
              <input value={form.vehicleId} onChange={s('vehicleId')} placeholder="Optional" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Reference No.</label>
              <input value={form.referenceNo} onChange={s('referenceNo')} placeholder="Receipt / bill no." className={inp} />
            </div>
          </div>
          {!editing && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Submitted By</label>
              <input value={form.submittedBy} onChange={s('submittedBy')} placeholder="Your name" className={inp} />
            </div>
          )}
          {editing && expense!.status === 'REJECTED' && (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Saving returns this rejected expense to DRAFT so it can be resubmitted.
            </p>
          )}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
            <textarea value={form.notes} onChange={s('notes')} rows={2}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] resize-none focus:outline-none focus:border-emerald-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : editing ? '✓ Save Changes' : '✓ Create Expense'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Expense Detail Drawer ── */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">{label}</p>
      <p className="text-sm text-[var(--text-main)] mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

function ExpenseDrawer({ expenseId, onClose, onChanged }: { expenseId: string; onClose: () => void; onChanged: () => void }) {
  const [exp, setExp]         = useState<Expense | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [editing, setEditing] = useState(false);

  const fetchOne = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/finance/expenses/${expenseId}`, { cache: 'no-store' });
    if (res.ok) setExp(await res.json());
    else setError(res.status === 404 ? 'Expense not found' : 'Could not load expense');
  }, [expenseId]);

  useEffect(() => { fetchOne(); }, [fetchOne]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const res = await fetch(`/api/finance/expenses/${expenseId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    setBusy(false);
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? 'Action failed');
    await fetchOne();
    onChanged();
  };

  const reject = () => {
    const reason = prompt('Reason for rejection');
    if (reason === null) return;
    act('reject', { rejectedBy: 'Finance Manager', rejectionReason: reason || 'Review required' });
  };

  const remove = async () => {
    if (!exp || !confirm(`Delete expense ${exp.expense_no}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/finance/expenses/${expenseId}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? 'Delete failed');
    onChanged();
    onClose();
  };

  const card = 'bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-4';
  const trail: { label: string; who?: string | null; at?: string | null; tone: string; note?: string | null }[] = exp ? [
    { label: 'Created',   at: exp.created_at, tone: 'bg-slate-400' },
    ...(exp.submitted_at || exp.status !== 'DRAFT' ? [{ label: 'Submitted', who: exp.submitted_by, at: exp.submitted_at, tone: 'bg-blue-400' }] : []),
    ...(exp.approved_at ? [{ label: 'Approved', who: exp.approved_by, at: exp.approved_at, tone: 'bg-emerald-400' }] : []),
    ...(exp.rejected_at ? [{ label: 'Rejected', who: exp.rejected_by, at: exp.rejected_at, tone: 'bg-red-400', note: exp.rejection_reason }] : []),
    ...(exp.paid_at ? [{ label: 'Paid', at: exp.paid_at, tone: 'bg-purple-400' }] : []),
  ] : [];

  return (
    <DrawerPortal>
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-[480px] h-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-xs text-[var(--text-faint)]">Expense</p>
            <h2 className="text-lg font-bold text-[var(--text-main)] font-mono">{exp?.expense_no ?? '…'}</h2>
            {exp && (
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[exp.status] ?? ''}`}>
                {exp.status}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl leading-none">×</button>
        </div>

        {error ? (
          <p className="p-5 text-sm text-red-400">{error}</p>
        ) : !exp ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-xl bg-[var(--bg-surface-hover)] animate-pulse" />)}
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className={card}>
              <p className="text-sm text-[var(--text-main)] font-medium">{CAT_ICONS[exp.category]} {exp.description}</p>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <Field label="Amount" value={fmtAED(exp.amount)} />
                <Field label="VAT" value={fmtAED(exp.vat_amount ?? 0)} />
                <div>
                  <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">Total</p>
                  <p className="text-sm text-emerald-400 font-bold mt-0.5">{fmtAED(exp.total_amount)}</p>
                </div>
              </div>
            </div>

            <div className={`${card} grid grid-cols-2 gap-4`}>
              <Field label="Category" value={exp.category.replace(/_/g, ' ')} />
              <Field label="Sub-category" value={exp.sub_category} />
              <Field label="Expense date" value={fmtDate(exp.expense_date)} />
              <Field label="Payment method" value={exp.payment_method ? PAY_LABELS[exp.payment_method] ?? exp.payment_method : null} />
              <Field label="Cost centre" value={exp.cost_centre} />
              <Field label="Reference no." value={exp.reference_no} />
              <Field label="Vehicle" value={exp.vehicle_id} />
              <Field label="Driver" value={exp.driver_id} />
              <Field label="Receipt" value={exp.receipt_url
                ? <a href={exp.receipt_url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">View receipt ↗</a>
                : null} />
              <Field label="Currency" value={exp.currency} />
            </div>

            {exp.notes && (
              <div className={card}>
                <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">Notes</p>
                <p className="text-sm text-[var(--text-muted)] mt-1 whitespace-pre-wrap">{exp.notes}</p>
              </div>
            )}

            <div className={card}>
              <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide mb-3">Approval trail</p>
              <ol className="space-y-3">
                {trail.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${t.tone}`} />
                    <div>
                      <p className="text-sm text-[var(--text-main)]">{t.label}{t.who ? ` by ${t.who}` : ''}</p>
                      <p className="text-xs text-[var(--text-faint)]">{fmtDateTime(t.at)}</p>
                      {t.note && <p className="text-xs text-red-300 mt-0.5">Reason: {t.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-2">
              {EDITABLE.includes(exp.status) && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setEditing(true)} disabled={busy}
                    className="py-2.5 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50">
                    ✎ Edit
                  </button>
                  <button onClick={() => act('submit', { submittedBy: exp.submitted_by || 'Finance' })} disabled={busy}
                    className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">
                    {exp.status === 'REJECTED' ? 'Resubmit' : 'Submit for approval'}
                  </button>
                </div>
              )}
              {exp.status === 'SUBMITTED' && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => act('approve', { approvedBy: 'Finance Manager' })} disabled={busy}
                    className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                    ✓ Approve
                  </button>
                  <button onClick={reject} disabled={busy}
                    className="py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm disabled:opacity-50">
                    ✕ Reject
                  </button>
                </div>
              )}
              {exp.status === 'APPROVED' && (
                <button onClick={() => act('mark_paid')} disabled={busy}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold disabled:opacity-50">
                  💸 Mark as Paid
                </button>
              )}
              {EDITABLE.includes(exp.status) && (
                <button onClick={remove} disabled={busy}
                  className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm disabled:opacity-50">
                  🗑 Delete Expense
                </button>
              )}
              {!EDITABLE.includes(exp.status) && (
                <p className="text-xs text-[var(--text-faint)] text-center">
                  {exp.status} expenses are locked. Only DRAFT or REJECTED expenses can be edited or deleted.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {editing && exp && (
        <div onClick={e => e.stopPropagation()}>
          <ExpenseFormModal expense={exp} onClose={() => setEditing(false)} onSaved={() => { fetchOne(); onChanged(); }} />
        </div>
      )}
    </div>
    </DrawerPortal>
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
  const [openId, setOpenId]     = useState<string | null>(null);

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
    const res = await fetch(`/api/finance/expenses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act, ...extra }),
    });
    setActioning(null);
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? 'Action failed');
    load();
  };

  const summOf = (s: string) => summary.find(x => x.status === s);
  const totalApproved = parseFloat(summOf('APPROVED')?.total ?? '0') + parseFloat(summOf('PAID')?.total ?? '0');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Expense Management</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">Operational expenses with approval workflow</p>
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
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-sm border border-[var(--border-subtle)]">
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
            <div key={s} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-3">
              <p className="text-xs text-[var(--text-faint)]">{s}</p>
              <p className={`text-xl font-bold mt-0.5 ${STATUS_STYLE[s]?.split(' ')[1] ?? 'text-[var(--text-main)]'}`}>{d?.count ?? 0}</p>
              <p className="text-xs text-[var(--text-faint)]">{fmtAED(d?.total ?? '0')}</p>
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
        <div className="flex bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-1 gap-1 flex-wrap">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setTab(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-emerald-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
              {s} {s !== 'ALL' && `(${summOf(s)?.count ?? 0})`}
            </button>
          ))}
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
          <option value="">All Categories</option>
          {CATS.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {c}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-64 bg-[var(--bg-surface)]/60 rounded-2xl animate-pulse" />
      ) : expenses.length === 0 ? (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <p className="text-[var(--text-muted)]">No expenses found</p>
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase tracking-wider">
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
                <tr key={e.id} onClick={() => setOpenId(e.id)}
                  className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-surface)]/40 transition-colors cursor-pointer">
                  <td className="px-5 py-3 text-[var(--text-main)] font-mono text-xs font-medium">{e.expense_no}</td>
                  <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{CAT_ICONS[e.category]} {e.category.replace('_',' ')}</td>
                  <td className="px-5 py-3 text-[var(--text-muted)] text-xs max-w-xs truncate">{e.description}</td>
                  <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{e.cost_centre ?? '—'}</td>
                  <td className="px-5 py-3 text-right font-medium text-[var(--text-main)] text-xs">{fmtAED(e.total_amount)}</td>
                  <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{fmtDate(e.expense_date)}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[e.status] ?? ''}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right" onClick={ev => ev.stopPropagation()}>
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
                          <button onClick={() => {
                            const reason = prompt('Reason for rejection');
                            if (reason !== null) action(e.id, 'reject', { rejectedBy: 'Finance Manager', rejectionReason: reason || 'Review required' });
                          }}
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
      {showAdd && <ExpenseFormModal onClose={() => setShowAdd(false)} onSaved={load} />}
      {openId && <ExpenseDrawer expenseId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
