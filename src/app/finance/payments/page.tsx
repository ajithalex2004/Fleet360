'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';

type Allocation = {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  amount: string | number;
  status: string;
  method: string;
  allocationDate: string;
  reversalReason?: string | null;
};

type CashReceipt = {
  id: string;
  receipt_no: string;
  voucher_no: string;
  customer_name: string;
  customer_email?: string | null;
  amount: number;
  allocated_amount: number;
  unapplied_amount: number;
  currency: string;
  receipt_date: string;
  payment_method: string;
  reference?: string | null;
  source: string;
  status: string;
  notes?: string | null;
  allocations: Allocation[];
};

type OpenInvoice = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email?: string | null;
  total_amount: number;
  paid_amount: number;
  outstanding: number;
  currency?: string | null;
  due_date?: string | null;
  payment_status?: string | null;
};

type BankCredit = {
  id: string;
  txn_date: string;
  description: string;
  reference?: string | null;
  credit: string | number;
};

type CashAllocationPayload = {
  receipts: CashReceipt[];
  openInvoices: OpenInvoice[];
  bankCredits: BankCredit[];
  summary: {
    totalReceipts: number;
    totalAmount: number;
    allocatedAmount: number;
    unappliedAmount: number;
  };
};

const PAY_METHODS = ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'ONLINE', 'CARD'];
const STATUS_STYLE: Record<string, string> = {
  UNAPPLIED: 'border-amber-300 bg-amber-100 text-slate-900',
  PARTIAL_ALLOCATED: 'border-blue-300 bg-blue-100 text-slate-900',
  ALLOCATED: 'border-emerald-300 bg-emerald-100 text-slate-900',
  REVERSED: 'border-rose-300 bg-rose-100 text-slate-900',
};

const fmtAED = (n: number | string | null | undefined) =>
  `AED ${Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-AE') : '-');

function ReceiptModal({
  openInvoices,
  bankCredit,
  onClose,
  onSaved,
}: {
  openInvoices: OpenInvoice[];
  bankCredit?: BankCredit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    amount: bankCredit ? Number(bankCredit.credit) : 0,
    receiptDate: bankCredit?.txn_date ?? new Date().toISOString().split('T')[0],
    paymentMethod: 'BANK_TRANSFER',
    reference: bankCredit?.reference ?? '',
    notes: bankCredit ? `Bank credit: ${bankCredit.description}` : '',
    autoAllocate: false,
    autoAllocateBy: 'DUE_DATE',
  });
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const customerInvoices = useMemo(() => {
    const customer = form.customerName.trim().toLowerCase();
    return openInvoices.filter((invoice) =>
      !customer || invoice.client_name.toLowerCase().includes(customer),
    );
  }, [form.customerName, openInvoices]);

  const allocationTotal = useMemo(
    () => Object.values(allocations).reduce((sum, value) => sum + Number(value || 0), 0),
    [allocations],
  );
  const unapplied = Math.max(0, Number(form.amount || 0) - allocationTotal);

  const setAllocation = (invoice: OpenInvoice, value: number) => {
    const amount = Math.max(0, Math.min(Number(value || 0), invoice.outstanding));
    setAllocations((current) => ({ ...current, [invoice.id]: amount }));
    if (!form.customerName) {
      setForm((current) => ({
        ...current,
        customerName: invoice.client_name,
        customerEmail: invoice.client_email ?? '',
      }));
    }
  };

  const submit = async () => {
    if (!form.amount || Number(form.amount) <= 0) return;
    setSaving(true);
    try {
      const body = {
        action: bankCredit ? 'bank_credit_receipt' : 'create_receipt',
        ...form,
        amount: Number(form.amount),
        autoAllocateBy: form.autoAllocateBy,
        bankStatementLineId: bankCredit?.id,
        allocations: Object.entries(allocations)
          .filter(([, amount]) => Number(amount) > 0)
          .map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) })),
      };
      const res = await fetch('/api/finance/cash-allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save receipt');
      }
      onSaved();
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save receipt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-white/10">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">
              {bankCredit ? 'Create Receipt from Bank Credit' : 'New Cash Receipt'}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Allocate one receipt across multiple invoices, or leave the balance unapplied as advance cash.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-2xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">x</button>
        </div>

        <div className="grid gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-900/70">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Customer</label>
              <input
                value={form.customerName}
                onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))}
                placeholder="Customer / lessee name"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Email</label>
              <input
                value={form.customerEmail}
                onChange={(event) => setForm((current) => ({ ...current, customerEmail: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Amount</label>
                <input
                  type="number"
                  value={form.amount}
                  min={0}
                  step="0.01"
                  onChange={(event) => setForm((current) => ({ ...current, amount: Number(event.target.value) }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Date</label>
                <input
                  type="date"
                  value={form.receiptDate}
                  onChange={(event) => setForm((current) => ({ ...current, receiptDate: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Method</label>
                <select
                  value={form.paymentMethod}
                  onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                >
                  {PAY_METHODS.map((method) => <option key={method}>{method}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Reference</label>
                <input
                  value={form.reference}
                  onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Notes</label>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm font-semibold text-slate-900 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100">
              <input
                type="checkbox"
                checked={form.autoAllocate}
                onChange={(event) => setForm((current) => ({ ...current, autoAllocate: event.target.checked }))}
              />
              Auto-allocate by due date
            </label>
            <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-slate-950">
              <div className="flex justify-between"><span className="text-slate-600 dark:text-slate-400">Allocated</span><b>{fmtAED(allocationTotal)}</b></div>
              <div className="mt-1 flex justify-between"><span className="text-slate-600 dark:text-slate-400">Unapplied / advance</span><b className="text-amber-700 dark:text-amber-300">{fmtAED(unapplied)}</b></div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950">
            <div className="border-b border-slate-200 p-4 dark:border-white/10">
              <h3 className="font-bold text-slate-950 dark:text-white">Open Invoices</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">Enter allocation amounts manually, or switch on auto-allocation.</p>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3 text-left">Invoice</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Due</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3 text-right">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {customerInvoices.map((invoice) => (
                    <tr key={invoice.id} className="border-t border-slate-200 dark:border-white/10">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-950 dark:text-white">{invoice.invoice_number}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{invoice.client_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(invoice.due_date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-950 dark:text-white">{fmtAED(invoice.outstanding)}</td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          disabled={form.autoAllocate}
                          value={allocations[invoice.id] ?? ''}
                          max={invoice.outstanding}
                          min={0}
                          step="0.01"
                          placeholder="0.00"
                          onChange={(event) => setAllocation(invoice, Number(event.target.value))}
                          className="w-32 rounded-xl border border-slate-300 bg-white px-3 py-2 text-right text-sm text-slate-950 outline-none focus:border-blue-500 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                        />
                      </td>
                    </tr>
                  ))}
                  {customerInvoices.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No open invoices for this customer filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 p-5 dark:border-white/10">
          <button onClick={onClose} className="rounded-xl border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !form.amount}
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Generate Receipt Voucher'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FinancePaymentsPage() {
  const [data, setData] = useState<CashAllocationPayload>({
    receipts: [],
    openInvoices: [],
    bankCredits: [],
    summary: { totalReceipts: 0, totalAmount: 0, allocatedAmount: 0, unappliedAmount: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [bankCredit, setBankCredit] = useState<BankCredit | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/cash-allocation?includeOpenInvoices=true&includeBankCredits=true&limit=100', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load cash allocation data');
      setData(await res.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load cash allocation data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredReceipts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.receipts;
    return data.receipts.filter((receipt) =>
      receipt.customer_name.toLowerCase().includes(q)
      || receipt.receipt_no.toLowerCase().includes(q)
      || receipt.voucher_no.toLowerCase().includes(q)
      || String(receipt.reference ?? '').toLowerCase().includes(q),
    );
  }, [data.receipts, query]);

  const reverseAllocation = async (allocation: Allocation) => {
    const reason = window.prompt(`Reason for reversing ${allocation.invoiceNo}?`);
    if (!reason) return;
    const res = await fetch(`/api/finance/cash-allocation/${allocation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reverse_allocation', reason }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage(res.ok ? 'Allocation reversed and audited.' : body.error ?? 'Failed to reverse allocation');
    await load();
  };

  const writeOffInvoice = async (invoice: OpenInvoice) => {
    const reason = window.prompt(`Reason for writing off ${invoice.invoice_number}?`);
    if (!reason) return;
    const res = await fetch(`/api/finance/cash-allocation/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write_off_invoice', reason }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage(res.ok ? 'Write-off recorded with audit/workflow trace.' : body.error ?? 'Failed to write off invoice');
    await load();
  };

  const openBankReceipt = (credit: BankCredit) => {
    setBankCredit(credit);
    setShowReceiptModal(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Cash Allocation Workbench</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Receipts, multi-invoice allocation, unapplied cash, bank-credit matching, reversals, and write-offs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => downloadXLSX(`Cash-Allocation-${new Date().toISOString().split('T')[0]}.xls`, filteredReceipts.map((receipt) => ({
              Receipt: receipt.receipt_no,
              Voucher: receipt.voucher_no,
              Customer: receipt.customer_name,
              Amount: receipt.amount,
              Allocated: receipt.allocated_amount,
              Unapplied: receipt.unapplied_amount,
              Status: receipt.status,
              Date: receipt.receipt_date,
            })))}
            className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-200"
          >
            Export
          </button>
          <button
            onClick={() => { setBankCredit(null); setShowReceiptModal(true); }}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
          >
            + New Receipt
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100">
          {message}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {[
          ['Receipts', data.summary.totalReceipts, 'from-blue-500 to-indigo-600'],
          ['Collected', fmtAED(data.summary.totalAmount), 'from-emerald-500 to-teal-600'],
          ['Allocated', fmtAED(data.summary.allocatedAmount), 'from-violet-500 to-purple-600'],
          ['Unapplied Cash', fmtAED(data.summary.unappliedAmount), 'from-amber-400 to-orange-500'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className={`h-[120px] w-[180px] rounded-2xl bg-gradient-to-br ${color} p-4 text-slate-950 shadow-xl shadow-slate-900/10`}>
            <p className="text-xs font-bold uppercase tracking-widest">{label}</p>
            <p className="mt-8 text-lg font-black">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/10">
            <h2 className="font-bold text-slate-950 dark:text-white">Receipt Vouchers</h2>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search receipt, voucher, customer..."
              className="w-full max-w-sm rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
            />
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading cash allocation...</div>
          ) : filteredReceipts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">No receipt vouchers found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3 text-left">Receipt / Voucher</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Allocated</th>
                    <th className="px-4 py-3 text-right">Unapplied</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Allocations</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceipts.map((receipt) => (
                    <tr key={receipt.id} className="border-t border-slate-200 align-top dark:border-white/10">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-bold text-slate-950 dark:text-white">{receipt.receipt_no}</p>
                        <p className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400">{receipt.voucher_no}</p>
                        <p className="mt-1 text-xs text-slate-500">{fmtDate(receipt.receipt_date)}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{receipt.customer_name}</td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">{receipt.payment_method.replace('_', ' ')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-950 dark:text-white">{fmtAED(receipt.amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-300">{fmtAED(receipt.allocated_amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-700 dark:text-amber-300">{fmtAED(receipt.unapplied_amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-1 text-xs font-bold ${STATUS_STYLE[receipt.status] ?? STATUS_STYLE.UNAPPLIED}`}>
                          {receipt.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="min-w-[260px] px-4 py-3">
                        <div className="space-y-2">
                          {receipt.allocations.map((allocation) => (
                            <div key={allocation.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-slate-900">
                              <div>
                                <p className="font-mono text-xs font-semibold text-slate-950 dark:text-white">{allocation.invoiceNo}</p>
                                <p className="text-xs text-slate-600 dark:text-slate-400">{fmtAED(allocation.amount)} - {allocation.status}</p>
                              </div>
                              {allocation.status === 'ACTIVE' && (
                                <button
                                  onClick={() => reverseAllocation(allocation)}
                                  className="rounded-lg border border-rose-300 bg-rose-100 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-rose-200"
                                >
                                  Reverse
                                </button>
                              )}
                            </div>
                          ))}
                          {receipt.allocations.length === 0 && <span className="text-xs text-slate-500">No invoice allocation yet</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950">
            <div className="border-b border-slate-200 p-4 dark:border-white/10">
              <h2 className="font-bold text-slate-950 dark:text-white">Unmatched Bank Credits</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Create a receipt voucher directly from bank statement credits.</p>
            </div>
            <div className="max-h-80 overflow-y-auto p-3">
              {data.bankCredits.map((credit) => (
                <div key={credit.id} className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-950 dark:text-white">{fmtAED(credit.credit)}</p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{fmtDate(credit.txn_date)} - {credit.reference ?? 'No reference'}</p>
                      <p className="mt-1 text-xs text-slate-500">{credit.description}</p>
                    </div>
                    <button
                      onClick={() => openBankReceipt(credit)}
                      className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-emerald-200"
                    >
                      Receipt
                    </button>
                  </div>
                </div>
              ))}
              {data.bankCredits.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No unmatched bank credits.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950">
            <div className="border-b border-slate-200 p-4 dark:border-white/10">
              <h2 className="font-bold text-slate-950 dark:text-white">Open Receivables</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Write-offs create a credit note and audit/workflow trace.</p>
            </div>
            <div className="max-h-96 overflow-y-auto p-3">
              {data.openInvoices.slice(0, 20).map((invoice) => (
                <div key={invoice.id} className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs font-bold text-slate-950 dark:text-white">{invoice.invoice_number}</p>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{invoice.client_name}</p>
                      <p className="mt-1 text-xs text-slate-500">Due {fmtDate(invoice.due_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{fmtAED(invoice.outstanding)}</p>
                      <button
                        onClick={() => writeOffInvoice(invoice)}
                        className="mt-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-amber-200"
                      >
                        Write off
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {data.openInvoices.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No open receivables.</p>}
            </div>
          </div>
        </div>
      </div>

      {showReceiptModal && (
        <ReceiptModal
          openInvoices={data.openInvoices}
          bankCredit={bankCredit}
          onClose={() => { setShowReceiptModal(false); setBankCredit(null); }}
          onSaved={load}
        />
      )}
    </div>
  );
}
