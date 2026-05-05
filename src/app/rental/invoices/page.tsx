'use client';
import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Invoice {
  id: string;
  invoiceNo: string;
  agreementId: string;
  customerId: string;
  customerName?: string;
  agreementNo?: string;
  invoiceType: string;
  invoiceDate: string;
  dueDate: string;
  periodFrom?: string;
  periodTo?: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: string;
  notes?: string;
  createdAt: string;
}

interface LineItem {
  id: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitLabel: string;
  taxable: boolean;
  amount: number;
}

interface Payment {
  id: string;
  receiptNo: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  referenceNo?: string;
  notes?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number, c = 'AED') =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: c, minimumFractionDigits: 2 }).format(n ?? 0);

const dateStr = (d?: string) => d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_COLORS: Record<string, string> = {
  DRAFT:           'bg-slate-600/50 text-slate-300',
  SENT:            'bg-blue-500/20 text-blue-300',
  PARTIALLY_PAID:  'bg-amber-500/20 text-amber-300',
  PAID:            'bg-emerald-500/20 text-emerald-300',
  OVERDUE:         'bg-red-500/20 text-red-300',
  VOID:            'bg-slate-700/50 text-slate-500',
  CANCELLED:       'bg-slate-700/50 text-slate-500',
};

const TYPE_COLORS: Record<string, string> = {
  STANDARD:     'bg-blue-500/15 text-blue-300',
  PRE_BILLING:  'bg-purple-500/15 text-purple-300',
  MONTHLY:      'bg-teal-500/15 text-teal-300',
  COMBINATION:  'bg-indigo-500/15 text-indigo-300',
  CREDIT_NOTE:  'bg-amber-500/15 text-amber-300',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RentalInvoicesPage() {
  const [invoices, setInvoices]       = useState<Invoice[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]   = useState('');
  const [overdue, setOverdue]         = useState(false);

  // Detail drawer
  const [selected, setSelected]       = useState<Invoice | null>(null);
  const [detail, setDetail]           = useState<{ lineItems: LineItem[]; payments: Payment[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Payment modal
  const [payModal, setPayModal]       = useState(false);
  const [payForm, setPayForm]         = useState({ amount: '', paymentMethod: 'CASH', referenceNo: '', notes: '' });
  const [payLoading, setPayLoading]   = useState(false);
  const [payError, setPayError]       = useState('');

  // Void modal
  const [voidModal, setVoidModal]     = useState(false);
  const [voidReason, setVoidReason]   = useState('');
  const [voidLoading, setVoidLoading] = useState(false);

  const limit = 20;

  // ── Fetch list ───────────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterStatus) sp.set('status', filterStatus);
      if (filterType)   sp.set('invoiceType', filterType);
      if (overdue)      sp.set('overdue', 'true');
      const res  = await fetch('/api/rental/invoices?' + sp.toString());
      const json = await res.json();
      setInvoices(json.data ?? []);
      setTotal(json.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterType, overdue]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // ── Fetch detail ─────────────────────────────────────────────────────────
  const openDetail = async (inv: Invoice) => {
    setSelected(inv);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res  = await fetch('/api/rental/invoices/' + inv.id);
      const json = await res.json();
      setDetail({ lineItems: json.lineItems ?? [], payments: json.payments ?? [] });
      setSelected(json); // updated with fresh data
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Record payment ───────────────────────────────────────────────────────
  const recordPayment = async () => {
    if (!selected) return;
    if (!payForm.amount || Number(payForm.amount) <= 0) { setPayError('Enter a valid amount'); return; }
    setPayLoading(true); setPayError('');
    try {
      const res  = await fetch('/api/rental/invoices/' + selected.id + '/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(payForm.amount), paymentMethod: payForm.paymentMethod, referenceNo: payForm.referenceNo, notes: payForm.notes }),
      });
      const json = await res.json();
      if (!res.ok) { setPayError(json.error ?? 'Payment failed'); return; }
      setPayModal(false);
      setPayForm({ amount: '', paymentMethod: 'CASH', referenceNo: '', notes: '' });
      openDetail(json.invoice); // refresh
      fetchInvoices();
    } finally {
      setPayLoading(false);
    }
  };

  // ── Void invoice ─────────────────────────────────────────────────────────
  const voidInvoice = async () => {
    if (!selected || !voidReason.trim()) return;
    setVoidLoading(true);
    try {
      const res  = await fetch('/api/rental/invoices/' + selected.id + '/void', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? 'Void failed'); return; }
      setVoidModal(false);
      setVoidReason('');
      openDetail(json.invoice);
      fetchInvoices();
    } finally {
      setVoidLoading(false);
    }
  };

  // ── Send invoice ─────────────────────────────────────────────────────────
  const sendInvoice = async () => {
    if (!selected) return;
    const res  = await fetch('/api/rental/invoices/' + selected.id + '/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'EMAIL' }),
    });
    const json = await res.json();
    if (res.ok) { openDetail(json.invoice); fetchInvoices(); }
  };

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = {
    draft:    invoices.filter(i => i.status === 'DRAFT').length,
    sent:     invoices.filter(i => i.status === 'SENT').length,
    overdue:  invoices.filter(i => i.status === 'OVERDUE').length,
    totalDue: invoices.reduce((s, i) => s + Number(i.balanceDue ?? 0), 0),
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full gap-6">
      {/* LEFT: List */}
      <div className={`flex flex-col space-y-5 transition-all ${selected ? 'w-3/5' : 'w-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Rental Invoices</h1>
            <p className="text-slate-400 text-sm mt-0.5">All customer billing records</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Draft', value: stats.draft, color: 'border-slate-500' },
            { label: 'Sent', value: stats.sent, color: 'border-blue-500' },
            { label: 'Overdue', value: stats.overdue, color: 'border-red-500' },
            { label: 'Total Balance Due', value: fmt(stats.totalDue), color: 'border-emerald-500', big: true },
          ].map(s => (
            <div key={s.label} className={`bg-slate-800/60 border-l-4 ${s.color} rounded-lg p-3`}>
              <p className="text-xs text-slate-400">{s.label}</p>
              <p className={`font-bold mt-0.5 ${s.big ? 'text-base text-emerald-300' : 'text-xl text-white'}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm">
            <option value="">All Statuses</option>
            {['DRAFT','SENT','PARTIALLY_PAID','PAID','OVERDUE','VOID','CANCELLED'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm">
            <option value="">All Types</option>
            {['STANDARD','PRE_BILLING','MONTHLY','COMBINATION','CREDIT_NOTE'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={overdue} onChange={e => { setOverdue(e.target.checked); setPage(1); }}
              className="accent-red-500" />
            Overdue only
          </label>
          <span className="ml-auto text-slate-400 text-sm self-center">{total} invoice{total !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        <div className="bg-slate-800/60 border border-white/10 rounded-xl overflow-hidden flex-1">
          {loading ? (
            <div className="p-12 text-center text-slate-400">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-slate-400 text-lg">No invoices found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-slate-400">
                  <th className="px-4 py-3 text-left">Invoice #</th>
                  <th className="px-4 py-3 text-left">Agreement</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Due</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr
                    key={inv.id}
                    onClick={() => openDetail(inv)}
                    className={`border-b border-white/5 hover:bg-white/5 cursor-pointer transition ${selected?.id === inv.id ? 'bg-blue-500/10' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-blue-300 font-medium text-xs">{inv.invoiceNo}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{inv.agreementNo ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[inv.invoiceType] ?? 'bg-slate-700 text-slate-400'}`}>
                        {inv.invoiceType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{dateStr(inv.invoiceDate)}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={new Date(inv.dueDate) < new Date() && !['PAID','VOID'].includes(inv.status) ? 'text-red-400' : 'text-slate-300'}>
                        {dateStr(inv.dueDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-white text-xs">{fmt(inv.totalAmount, inv.currency)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      <span className={Number(inv.balanceDue) > 0 ? 'text-amber-300' : 'text-emerald-400'}>
                        {fmt(Number(inv.balanceDue ?? 0), inv.currency)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? 'bg-slate-700 text-slate-400'}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 text-sm">
              ← Prev
            </button>
            <span className="text-slate-400 text-sm">Page {page} of {Math.ceil(total / limit)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total}
              className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 text-sm">
              Next →
            </button>
          </div>
        )}
      </div>

      {/* RIGHT: Detail Drawer */}
      {selected && (
        <div className="w-2/5 flex flex-col space-y-4 bg-slate-800/80 border border-white/10 rounded-2xl p-5 overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400">Invoice</p>
              <p className="text-lg font-bold text-white font-mono">{selected.invoiceNo}</p>
              {selected.agreementNo && <p className="text-xs text-slate-400 mt-0.5">Agreement: {selected.agreementNo}</p>}
            </div>
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          {/* Status + type chips */}
          <div className="flex gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[selected.status] ?? 'bg-slate-700 text-slate-400'}`}>
              {selected.status}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${TYPE_COLORS[selected.invoiceType] ?? 'bg-slate-700 text-slate-400'}`}>
              {selected.invoiceType}
            </span>
          </div>

          {/* Key dates */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">Invoice Date</p>
              <p className="text-white">{dateStr(selected.invoiceDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Due Date</p>
              <p className={new Date(selected.dueDate) < new Date() && !['PAID','VOID'].includes(selected.status) ? 'text-red-400 font-semibold' : 'text-white'}>
                {dateStr(selected.dueDate)}
              </p>
            </div>
            {selected.periodFrom && (
              <>
                <div>
                  <p className="text-xs text-slate-400">Period From</p>
                  <p className="text-white">{dateStr(selected.periodFrom)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Period To</p>
                  <p className="text-white">{dateStr(selected.periodTo)}</p>
                </div>
              </>
            )}
          </div>

          {/* Financial summary */}
          <div className="bg-slate-700/40 rounded-xl p-4 space-y-2 text-sm">
            {[
              { label: 'Subtotal', value: fmt(selected.subtotal, selected.currency) },
              { label: `Discount`, value: selected.discountAmount ? '-' + fmt(selected.discountAmount, selected.currency) : null },
              { label: `VAT (${selected.taxRate}%)`, value: fmt(selected.taxAmount, selected.currency) },
            ].filter(r => r.value).map(r => (
              <div key={r.label} className="flex justify-between text-slate-300">
                <span>{r.label}</span><span>{r.value}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold text-white border-t border-white/10 pt-2 mt-2">
              <span>Total</span><span>{fmt(selected.totalAmount, selected.currency)}</span>
            </div>
            <div className="flex justify-between text-emerald-300">
              <span>Paid</span><span>{fmt(Number(selected.paidAmount ?? 0), selected.currency)}</span>
            </div>
            <div className={`flex justify-between font-bold ${Number(selected.balanceDue) > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
              <span>Balance Due</span><span>{fmt(Number(selected.balanceDue ?? 0), selected.currency)}</span>
            </div>
          </div>

          {/* Actions */}
          {!['PAID','VOID','CANCELLED'].includes(selected.status) && (
            <div className="flex gap-2 flex-wrap">
              {Number(selected.balanceDue) > 0 && (
                <button onClick={() => { setPayModal(true); setPayError(''); }}
                  className="flex-1 px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 text-xs font-medium">
                  💳 Record Payment
                </button>
              )}
              {selected.status === 'DRAFT' && (
                <button onClick={sendInvoice}
                  className="flex-1 px-3 py-2 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30 text-xs font-medium">
                  📧 Send Invoice
                </button>
              )}
              {!['PAID'].includes(selected.status) && (
                <button onClick={() => { setVoidModal(true); setVoidReason(''); }}
                  className="px-3 py-2 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 text-xs font-medium">
                  Void
                </button>
              )}
            </div>
          )}

          {/* Line Items */}
          {detailLoading ? (
            <div className="text-slate-400 text-sm text-center py-4">Loading details…</div>
          ) : detail && (
            <>
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Line Items</h3>
                <div className="space-y-1">
                  {detail.lineItems.map((li, i) => (
                    <div key={li.id ?? i} className="flex justify-between items-start text-xs py-1.5 border-b border-white/5">
                      <div className="flex-1 pr-4">
                        <p className="text-slate-200">{li.description}</p>
                        <p className="text-slate-500">{li.quantity} × {fmt(li.unitPrice, selected.currency)} / {li.unitLabel}</p>
                      </div>
                      <span className={`font-mono font-medium ${li.amount < 0 ? 'text-amber-300' : 'text-white'}`}>
                        {fmt(li.amount, selected.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payments */}
              {detail.payments.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Payment History</h3>
                  <div className="space-y-2">
                    {detail.payments.map((p, i) => (
                      <div key={p.id ?? i} className="flex justify-between items-center text-xs bg-emerald-500/10 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-emerald-300 font-medium">{p.receiptNo}</p>
                          <p className="text-slate-400">{dateStr(p.paymentDate)} · {p.paymentMethod}</p>
                          {p.referenceNo && <p className="text-slate-500">Ref: {p.referenceNo}</p>}
                        </div>
                        <span className="text-emerald-300 font-bold font-mono">{fmt(p.amount, selected.currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {selected.notes && (
            <div className="bg-slate-700/30 rounded-lg p-3 text-xs text-slate-300">
              <p className="text-slate-500 mb-1 font-semibold uppercase tracking-wider text-[10px]">Notes</p>
              {selected.notes}
            </div>
          )}
        </div>
      )}

      {/* Payment Modal */}
      {payModal && selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h2 className="text-base font-bold text-white">Record Payment</h2>
              <button onClick={() => setPayModal(false)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              {payError && <p className="text-red-400 text-sm">{payError}</p>}
              <div>
                <p className="text-xs text-slate-400 mb-1">Invoice Balance Due</p>
                <p className="text-lg font-bold text-amber-300">{fmt(Number(selected.balanceDue ?? 0), selected.currency)}</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Amount *</label>
                <input type="number" step="0.01" value={payForm.amount} placeholder="0.00"
                  onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Payment Method</label>
                <select value={payForm.paymentMethod}
                  onChange={e => setPayForm(p => ({ ...p, paymentMethod: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                  {['CASH','CREDIT_CARD','DEBIT_CARD','BANK_TRANSFER','CHEQUE','ONLINE','CORPORATE_ACCOUNT'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Reference / Receipt No.</label>
                <input type="text" value={payForm.referenceNo} placeholder="Bank ref, cheque no., etc."
                  onChange={e => setPayForm(p => ({ ...p, referenceNo: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea value={payForm.notes} rows={2}
                  onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm resize-none" />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/10">
              <button onClick={() => setPayModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm">Cancel</button>
              <button onClick={recordPayment} disabled={payLoading}
                className="px-6 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium disabled:opacity-50">
                {payLoading ? 'Saving…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Modal */}
      {voidModal && selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h2 className="text-base font-bold text-white">Void Invoice {selected.invoiceNo}</h2>
              <button onClick={() => setVoidModal(false)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-300">This action cannot be undone. A credit note will be automatically created if any payments were recorded.</p>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Reason for Voiding *</label>
                <textarea value={voidReason} rows={3}
                  onChange={e => setVoidReason(e.target.value)}
                  placeholder="e.g. Duplicate invoice, customer request, data entry error…"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm resize-none" />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/10">
              <button onClick={() => setVoidModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm">Cancel</button>
              <button onClick={voidInvoice} disabled={voidLoading || !voidReason.trim()}
                className="px-6 py-2 rounded-lg bg-red-500 text-white text-sm font-medium disabled:opacity-50">
                {voidLoading ? 'Voiding…' : 'Void Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
