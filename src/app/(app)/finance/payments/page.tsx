'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';

interface PaymentRow {
  id: string;
  invoice_id?: string;
  invoice_number?: string;
  client_name?: string;
  amount: number;
  total_amount?: number;
  paid_amount?: number;
  payment_status?: string;
  currency?: string;
  payment_date: string;
  payment_method: string;
  reference?: string;
  notes?: string;
  created_at: string;
}

interface InvoiceOption {
  id: string;
  invoice_number: string;
  client_name: string;
  total_amount: number;
  paid_amount: number;
  payment_status: string;
}

const PAY_METHODS = ['BANK_TRANSFER','CASH','CHEQUE','ONLINE','CARD'];
const METHOD_ICON: Record<string, string> = {
  BANK_TRANSFER: '🏦', CASH: '💵', CHEQUE: '📄', ONLINE: '💻', CARD: '💳',
};
const STATUS_STYLE: Record<string, string> = {
  DRAFT:   'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  SENT:    'bg-blue-500/20  text-blue-300  border-blue-500/30',
  PARTIAL: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  PAID:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  OVERDUE: 'bg-red-500/20   text-red-300   border-red-500/30',
};
const fmtAED  = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';

/* ─────────────────────────── NewPaymentModal ────────────────── */
function NewPaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [invoices, setInvoices]   = useState<InvoiceOption[]>([]);
  const [selectedInv, setSelectedInv] = useState<InvoiceOption | null>(null);
  const [form, setForm] = useState({
    invoiceId: '', amount: 0, paymentDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'BANK_TRANSFER', reference: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [invSearch, setInvSearch] = useState('');

  useEffect(() => {
    fetch('/api/finance/invoices?limit=100&status=SENT', { cache: 'no-store' })
      .then(r => r.json()).then(d => {
        const all = d.data ?? [];
        // Also fetch PARTIAL and OVERDUE
        fetch('/api/finance/invoices?limit=100&status=PARTIAL', { cache: 'no-store' })
          .then(r2 => r2.json()).then(d2 => {
            fetch('/api/finance/invoices?limit=100&status=OVERDUE', { cache: 'no-store' })
              .then(r3 => r3.json()).then(d3 => {
                const combined = [...all, ...(d2.data ?? []), ...(d3.data ?? [])];
                setInvoices(combined.filter((inv: InvoiceOption) => Number(inv.total_amount) - Number(inv.paid_amount) > 0));
              });
          });
      }).catch(() => {});
  }, []);

  const filteredInvoices = invoices.filter(inv =>
    !invSearch || inv.invoice_number.includes(invSearch) || inv.client_name.toLowerCase().includes(invSearch.toLowerCase())
  );

  const selectInvoice = (inv: InvoiceOption) => {
    setSelectedInv(inv);
    const outstanding = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount));
    setForm(f => ({ ...f, invoiceId: inv.id, amount: outstanding }));
  };

  const submit = async () => {
    if (!form.amount || form.amount <= 0) return alert('Enter a valid amount');
    setSaving(true);
    const res = await fetch('/api/finance/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else alert('Failed to record payment');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">Record Payment</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Invoice Picker */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Link to Invoice (optional)</label>
            <input value={invSearch} onChange={e => setInvSearch(e.target.value)}
              placeholder="Search invoice # or client…"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] mb-2" />
            {filteredInvoices.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredInvoices.slice(0, 8).map(inv => {
                  const outstanding = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount));
                  const selected = selectedInv?.id === inv.id;
                  return (
                    <button key={inv.id} onClick={() => selectInvoice(inv)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors text-sm ${selected ? 'border-amber-500/50 bg-amber-500/10' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono text-xs text-amber-400">{inv.invoice_number}</span>
                          <span className="ml-2 text-[var(--text-muted)]">{inv.client_name}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[var(--text-main)] font-medium text-xs">{fmtAED(outstanding)}</span>
                          <span className="ml-1 text-[var(--text-faint)] text-xs">outstanding</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedInv && (
              <div className="mt-2 flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <span className="text-sm text-amber-300">✓ Linked to {selectedInv.invoice_number}</span>
                <button onClick={() => { setSelectedInv(null); setForm(f => ({ ...f, invoiceId: '' })); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs">unlink</button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-[var(--text-muted)] mb-1">Amount (AED) *</label>
              <input type="number" value={form.amount} min={0.01} step={0.01}
                onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Payment Date</label>
              <input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Method</label>
              <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]">
                {PAY_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Reference / Cheque No.</label>
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ───────────────────────────── */
export default function FinancePaymentsPage() {
  const [payments,   setPayments]   = useState<PaymentRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [totalPaid,  setTotalPaid]  = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [q,          setQ]          = useState('');
  const [page,       setPage]       = useState(1);
  const [showNew,    setShowNew]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (q) params.set('q', q);
      const res = await fetch(`/api/finance/payments?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPayments(data.data ?? []);
        setTotal(data.total ?? 0);
        setTotalPaid(data.totalPaid ?? 0);
      }
    } finally { setLoading(false); }
  }, [q, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q]);

  const totalPages = Math.ceil(total / 25);

  // Method breakdown for display
  const byMethod: Record<string, number> = {};
  for (const p of payments) {
    byMethod[p.payment_method] = (byMethod[p.payment_method] ?? 0) + Number(p.amount);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Payment Reconciliation</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">Track all payments and reconcile against invoices</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => downloadXLSX(`Payments-${new Date().toISOString().split('T')[0]}.xls`, payments.map(p => ({
            'Invoice No':    p.invoice_number ?? '', 'Client': p.client_name ?? '',
            'Amount (AED)':  Number(p.amount), 'Method': p.payment_method,
            'Date':          p.payment_date, 'Reference': p.reference ?? '',
            'Status':        p.payment_status ?? '', 'Notes': p.notes ?? '',
          })))}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-sm border border-[var(--border-subtle)]">
            ⬇ Export XLSX
          </button>
          <button onClick={() => setShowNew(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl text-sm">
            + Record Payment
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4">
          <p className="text-xs text-[var(--text-faint)]">Total Payments</p>
          <p className="text-xl font-bold mt-1 text-[var(--text-main)]">{total}</p>
        </div>
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4">
          <p className="text-xs text-[var(--text-faint)]">Total Collected</p>
          <p className="text-xl font-bold mt-1 text-emerald-400">{`AED ${Number(totalPaid).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`}</p>
        </div>
        {Object.entries(byMethod).slice(0, 2).map(([method, amount]) => (
          <div key={method} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4">
            <p className="text-xs text-[var(--text-faint)]">{METHOD_ICON[method] ?? '💰'} {method.replace('_', ' ')}</p>
            <p className="text-xl font-bold mt-1 text-[var(--text-main)]">{`AED ${Number(amount).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`}</p>
          </div>
        ))}
        {Object.entries(byMethod).length < 2 && (
          <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4">
            <p className="text-xs text-[var(--text-faint)]">This Page</p>
            <p className="text-xl font-bold mt-1 text-[var(--text-main)]">{payments.length}</p>
          </div>
        )}
      </div>

      {/* Method breakdown pills */}
      {Object.keys(byMethod).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(byMethod).map(([method, amount]) => (
            <div key={method} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-full px-3 py-1.5 flex items-center gap-2 text-xs">
              <span>{METHOD_ICON[method] ?? '💰'}</span>
              <span className="text-[var(--text-muted)]">{method.replace('_',' ')}</span>
              <span className="text-[var(--text-main)] font-medium">{fmtAED(amount)}</span>
            </div>
          ))}
        </div>
      )}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by invoice #, client, reference…"
        className="w-full bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-emerald-500/40" />

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_,i) => <div key={i} className="h-16 bg-[var(--bg-surface)]/60 rounded-xl animate-pulse" />)}</div>
      ) : payments.length === 0 ? (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-16 text-center">
          <div className="text-5xl mb-3">💳</div>
          <p className="text-[var(--text-muted)]">No payments recorded yet</p>
          <button onClick={() => setShowNew(true)} className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm">Record first payment →</button>
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Invoice / Client</th>
                <th className="text-left px-5 py-3">Method</th>
                <th className="text-left px-5 py-3">Reference</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Invoice Status</th>
                <th className="text-right px-5 py-3">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const outstanding = p.total_amount != null
                  ? Math.max(0, Number(p.total_amount) - Number(p.paid_amount))
                  : null;
                return (
                  <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-surface)]/40 transition-colors">
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{fmtDate(p.payment_date)}</td>
                    <td className="px-5 py-3">
                      {p.invoice_number
                        ? <>
                            <p className="font-mono text-xs text-amber-400">{p.invoice_number}</p>
                            <p className="text-[var(--text-muted)] text-xs">{p.client_name}</p>
                          </>
                        : <span className="text-[var(--text-faint)] text-xs italic">Unlinked payment</span>}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <span className="flex items-center gap-1 text-[var(--text-muted)]">
                        {METHOD_ICON[p.payment_method] ?? '💰'} {p.payment_method.replace('_',' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{p.reference ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-emerald-400">{fmtAED(Number(p.amount))}</td>
                    <td className="px-5 py-3">
                      {p.payment_status
                        ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[p.payment_status] ?? STATUS_STYLE.DRAFT}`}>
                            {p.payment_status}
                          </span>
                        : <span className="text-[var(--text-faint)] text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-xs">
                      {outstanding != null
                        ? outstanding > 0
                          ? <span className="text-red-400 font-medium">{fmtAED(outstanding)}</span>
                          : <span className="text-emerald-400">Fully Paid</span>
                        : <span className="text-[var(--text-faint)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] text-sm text-[var(--text-muted)] disabled:opacity-30">← Prev</button>
          <span className="px-3 py-1.5 text-sm text-[var(--text-muted)]">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] text-sm text-[var(--text-muted)] disabled:opacity-30">Next →</button>
        </div>
      )}

      {showNew && <NewPaymentModal onClose={() => setShowNew(false)} onSaved={load} />}
    </div>
  );
}
