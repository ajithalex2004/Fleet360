'use client';
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { downloadXLSX } from '@/lib/exportUtils';

/* ─────────────────────────── types ─────────────────────────── */
interface LineItem { description: string; qty: number; unitPrice: number }
interface Invoice {
  id: string; invoice_number: string; client_name: string; client_email?: string;
  client_phone?: string; service_type: string; module: string; description?: string;
  subtotal: number; discount_amount: number; vat_amount: number; total_amount: number;
  paid_amount: number; currency: string; issue_date: string; due_date?: string;
  payment_status: string; notes?: string; created_at: string; line_items?: LineItem[];
}
type CreatedInvoicePayload = {
  success: true;
  id: string;
  invoiceNumber: string;
  invoice?: Invoice;
};
interface Payment {
  id: string; amount: number; payment_date: string; payment_method: string;
  reference?: string; notes?: string;
}
interface InvoiceDetail extends Invoice { payments: Payment[] }

/* ─────────────────────────── constants ─────────────────────── */
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-slate-500/20 text-slate-300 border-slate-500/30',
  SENT:      'bg-blue-500/20  text-blue-300  border-blue-500/30',
  PARTIAL:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  PAID:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  OVERDUE:   'bg-red-500/20   text-red-300   border-red-500/30',
  CANCELLED: 'bg-slate-700/20 text-slate-500 border-slate-700/30',
};
const MODULES = ['GENERAL','LOGISTICS','RAC','LEASING','STAFF_TRANSPORT','SCHOOL_BUS','AMBULANCE','MAINTENANCE'];
const MODULE_LABELS: Record<string, string> = {
  GENERAL: 'General', LOGISTICS: 'Logistics', RAC: 'RAC', LEASING: 'Leasing',
  STAFF_TRANSPORT: 'Staff Transport', SCHOOL_BUS: '🏫 School Bus', AMBULANCE: 'Ambulance', MAINTENANCE: 'Maintenance',
};
const PAY_METHODS = ['BANK_TRANSFER','CASH','CHEQUE','ONLINE','CARD'];
const fmtAED = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';

/* ─────────────────────────── sub-components ─────────────────── */
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT}`}>
      {status}
    </span>
  );
}

function EmptyLineItem(): LineItem { return { description: '', qty: 1, unitPrice: 0 }; }

/* ─────────────────────────── CreateModal ────────────────────── */
function CreateModal({
  onClose,
  onCreated,
  defaultModule,
}: {
  onClose: () => void;
  onCreated: (created: CreatedInvoicePayload) => void;
  defaultModule?: string;
}) {
  const [form, setForm] = useState({
    clientName: '', clientEmail: '', clientPhone: '', clientAddress: '',
    serviceType: defaultModule === 'SCHOOL_BUS' ? 'TRANSPORT_EDU' : 'GENERAL',
    module: defaultModule ?? 'GENERAL', description: '',
    vatRate: defaultModule === 'SCHOOL_BUS' ? 0 : 5,
    discountAmount: 0, currency: 'AED',
    issueDate: new Date().toISOString().split('T')[0], dueDate: '', notes: '',
    // School Bus extra fields — stored in description / notes when module=SCHOOL_BUS
    sbStudentGrade: '', sbBusMode: 'TWO_WAY', sbPeriod: '',
  });
  const [lineItems, setLineItems] = useState<LineItem[]>([EmptyLineItem()]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isSchoolBus = form.module === 'SCHOOL_BUS';

  // Auto-switch VAT when module changes
  const handleModuleChange = (mod: string) => {
    setForm(f => ({
      ...f,
      module: mod,
      vatRate: mod === 'SCHOOL_BUS' ? 0 : f.vatRate === 0 ? 5 : f.vatRate,
      serviceType: mod === 'SCHOOL_BUS' ? 'TRANSPORT_EDU' : f.serviceType === 'TRANSPORT_EDU' ? 'GENERAL' : f.serviceType,
    }));
  };

  const subtotal   = lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const discounted = Math.max(0, subtotal - form.discountAmount);
  const vatAmount  = discounted * form.vatRate / 100;
  const total      = discounted + vatAmount;

  const setItem = (i: number, field: keyof LineItem, val: string | number) => {
    setLineItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: field === 'description' ? val : Number(val) } : it));
  };
  const addItem = () => setLineItems(prev => [...prev, EmptyLineItem()]);
  const removeItem = (i: number) => setLineItems(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!form.clientName) return alert('Client name is required');
    setSubmitError('');
    setSaving(true);
    // Compose school-bus-specific description enrichment
    let enrichedNotes = form.notes;
    if (isSchoolBus) {
      const sbMeta = [
        form.sbStudentGrade ? `Grade: ${form.sbStudentGrade}` : null,
        form.sbBusMode ? `Bus Mode: ${form.sbBusMode.replace('_',' ')}` : null,
        form.sbPeriod ? `Period: ${form.sbPeriod}` : null,
      ].filter(Boolean).join(' · ');
      if (sbMeta) enrichedNotes = [sbMeta, form.notes].filter(Boolean).join('\n');
    }
    const res = await fetch('/api/finance/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        notes: enrichedNotes,
        lineItems, vatRate: form.vatRate, discountAmount: form.discountAmount,
        referenceType: isSchoolBus ? 'SCHOOL_BUS_ALLOCATION' : undefined,
      }),
    });
    const payload = await res.json().catch(() => null);
    setSaving(false);
    if (res.ok && payload) {
      onCreated(payload as CreatedInvoicePayload);
      onClose();
    } else {
      setSubmitError(payload?.error ?? 'Failed to create invoice');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" data-testid="create-invoice-modal" className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">New Invoice</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Client Name *</label>
              <input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Client / Company" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Email</label>
              <input value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="client@email.com" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Phone</label>
              <input value={form.clientPhone} onChange={e => setForm(f => ({ ...f, clientPhone: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="+971 …" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Module</label>
              <select value={form.module} onChange={e => handleModuleChange(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                {MODULES.map(m => <option key={m} value={m}>{MODULE_LABELS[m] ?? m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Service Type</label>
              <input value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
            </div>

            {/* School Bus specific fields */}
            {isSchoolBus && (
              <div className="col-span-2 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">🏫</span>
                  <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">School Bus Transport — UAE EDU Zero Rate (0% VAT)</p>
                </div>
                <p className="text-xs text-slate-500">Educational transport invoices are Zero Rated (0%) under UAE VAT Law Article 45. VAT has been automatically set to 0%.</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Student Grade</label>
                    <input value={form.sbStudentGrade} onChange={e => setForm(f => ({ ...f, sbStudentGrade: e.target.value }))}
                      placeholder="e.g. Grade 5" className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Bus Mode</label>
                    <select value={form.sbBusMode} onChange={e => setForm(f => ({ ...f, sbBusMode: e.target.value }))}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white cursor-pointer">
                      <option value="TWO_WAY">Two Way</option>
                      <option value="ONE_WAY_PICKUP">Pickup Only</option>
                      <option value="ONE_WAY_DROP">Drop Only</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Billing Period</label>
                    <input value={form.sbPeriod} onChange={e => setForm(f => ({ ...f, sbPeriod: e.target.value }))}
                      placeholder="e.g. Term 1 2024-25" className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" />
                  </div>
                </div>
                <p className="text-[10px] text-slate-600">Use &quot;Client Name&quot; for the student name and &quot;Email/Phone&quot; for parent contact.</p>
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Issue Date</label>
              <input type="date" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Due Date</label>
              <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none" />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-white">Line Items</h3>
              <button onClick={addItem} className="text-xs text-amber-400 hover:text-amber-300">+ Add Item</button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs text-slate-500 px-1">
                <div className="col-span-6">Description</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-3 text-right">Unit Price</div>
                <div className="col-span-1"></div>
              </div>
              {lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={item.description} onChange={e => setItem(i, 'description', e.target.value)}
                    placeholder="Item description"
                    className="col-span-6 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
                  <input type="number" placeholder="Qty" value={item.qty} min={1} onChange={e => setItem(i, 'qty', e.target.value)}
                    className="col-span-2 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white text-right" />
                  <input type="number" placeholder="Unit Price" value={item.unitPrice} min={0} step={0.01} onChange={e => setItem(i, 'unitPrice', e.target.value)}
                    className="col-span-3 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white text-right" />
                  <button onClick={() => removeItem(i)} disabled={lineItems.length === 1}
                    className="col-span-1 text-slate-600 hover:text-red-400 text-center disabled:opacity-30">×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-slate-800/60 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span><span className="text-white">{fmtAED(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Discount</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">AED</span>
                <input type="number" value={form.discountAmount} min={0} step={0.01}
                  onChange={e => setForm(f => ({ ...f, discountAmount: Number(e.target.value) }))}
                  className="w-24 bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white text-right" />
              </div>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>VAT</span>
              <div className="flex items-center gap-2">
                <input type="number" value={form.vatRate} min={0} max={100} step={0.5}
                  onChange={e => setForm(f => ({ ...f, vatRate: Number(e.target.value) }))}
                  className="w-16 bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white text-right" />
                <span className="text-xs text-slate-500">%</span>
                <span className="text-white w-28 text-right">{fmtAED(vatAmount)}</span>
              </div>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-white/10 pt-2">
              <span className="text-white">Total</span>
              <span className="text-amber-400">{fmtAED(total)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          </div>
          {submitError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {submitError}
            </div>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── PaymentModal ───────────────────── */
function PaymentModal({ invoice, onClose, onPaid }: { invoice: Invoice; onClose: () => void; onPaid: () => void }) {
  const outstanding = Math.max(0, Number(invoice.total_amount) - Number(invoice.paid_amount));
  const [form, setForm] = useState({ amount: outstanding, paymentDate: new Date().toISOString().split('T')[0], paymentMethod: 'BANK_TRANSFER', reference: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.amount || form.amount <= 0) return alert('Enter a valid amount');
    setSaving(true);
    const res = await fetch(`/api/finance/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record_payment', ...form }),
    });
    setSaving(false);
    if (res.ok) { onPaid(); onClose(); }
    else alert('Failed to record payment');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" data-testid="record-payment-modal" className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Record Payment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-sm text-amber-300 flex justify-between">
            <span>Outstanding</span><span className="font-bold">{fmtAED(outstanding)}</span>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Amount (AED) *</label>
            <input type="number" value={form.amount} min={0.01} step={0.01} max={outstanding}
              onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Payment Date</label>
            <input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Method</label>
            <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
              {PAY_METHODS.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reference / Cheque No.</label>
            <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── InvoiceDrawer ──────────────────── */
function InvoiceDrawer({
  invoiceId,
  initialInvoice,
  onClose,
  onRefresh,
}: {
  invoiceId: string;
  initialInvoice?: Invoice | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [inv, setInv] = useState<InvoiceDetail | null>(
    initialInvoice ? { ...initialInvoice, payments: [] } : null,
  );
  const [showPay, setShowPay] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/finance/invoices/${invoiceId}`);
    if (res.ok) setInv(await res.json());
  }, [invoiceId]);

  useEffect(() => {
    setInv(initialInvoice ? { ...initialInvoice, payments: [] } : null);
  }, [invoiceId, initialInvoice]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (status: string) => {
    setUpdatingStatus(true);
    await fetch(`/api/finance/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: status }),
    });
    await load();
    onRefresh();
    setUpdatingStatus(false);
  };

  if (!inv) return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div data-testid="invoice-drawer" className="fixed inset-y-0 right-0 z-40 w-[480px] bg-slate-950 border-l border-white/10 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    </>
  );

  const outstanding = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount));
  const items: LineItem[] = Array.isArray(inv.line_items) ? inv.line_items : [];

  return (
    <>
      {showPay && <PaymentModal invoice={inv} onClose={() => setShowPay(false)} onPaid={() => { load(); onRefresh(); }} />}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div data-testid="invoice-drawer" className="fixed inset-y-0 right-0 z-40 w-[480px] bg-slate-950 border-l border-white/10 overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10 sticky top-0 bg-slate-950 z-10">
          <div>
            <p className="text-xs text-slate-500">Invoice</p>
            <h2 className="text-lg font-bold text-white">{inv.invoice_number}</h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={inv.payment_status} />
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl ml-2">×</button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-4 space-y-1.5">
            <p className="text-white font-semibold">{inv.client_name}</p>
            {inv.client_email && <p className="text-slate-400 text-sm">{inv.client_email}</p>}
            {inv.client_phone && <p className="text-slate-400 text-sm">{inv.client_phone}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {([['Module', inv.module], ['Issued', fmtDate(inv.issue_date)], ['Due', fmtDate(inv.due_date)]] as [string, string][]).map(([l, v]) => (
              <div key={l} className="bg-slate-900 border border-white/10 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500">{l}</p>
                <p className="text-sm font-medium text-white">{v}</p>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div className="bg-slate-900 border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-slate-500 text-xs">
                    <th className="text-left px-4 py-2">Description</th>
                    <th className="text-right px-4 py-2">Qty</th>
                    <th className="text-right px-4 py-2">Unit</th>
                    <th className="text-right px-4 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2 text-slate-300">{it.description}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{it.qty}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{fmtAED(it.unitPrice)}</td>
                      <td className="px-4 py-2 text-right text-white">{fmtAED(it.qty * it.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-slate-900 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-400"><span>Subtotal</span><span>{fmtAED(inv.subtotal)}</span></div>
            {Number(inv.discount_amount) > 0 && <div className="flex justify-between text-slate-400"><span>Discount</span><span>−{fmtAED(inv.discount_amount)}</span></div>}
            <div className="flex justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                VAT
                {inv.module === 'SCHOOL_BUS'
                  ? <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">0% EDU Zero</span>
                  : <span className="text-slate-500 text-xs">(5%)</span>}
              </span>
              <span>{fmtAED(inv.vat_amount)}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-white/10 pt-2">
              <span className="text-white">Total</span><span className="text-amber-400">{fmtAED(inv.total_amount)}</span>
            </div>
            <div className="flex justify-between text-slate-400"><span>Paid</span><span className="text-emerald-400">{fmtAED(inv.paid_amount)}</span></div>
            {outstanding > 0 && (
              <div className="flex justify-between font-semibold border-t border-white/10 pt-2">
                <span className="text-white">Outstanding</span><span className="text-red-400">{fmtAED(outstanding)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {outstanding > 0 && inv.payment_status !== 'CANCELLED' && (
              <button onClick={() => setShowPay(true)}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm">
                💳 Record Payment
              </button>
            )}
            {inv.payment_status === 'DRAFT' && (
              <button onClick={() => updateStatus('SENT')} disabled={updatingStatus}
                className="w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-sm disabled:opacity-50">
                📤 Mark as Sent
              </button>
            )}
            {!['PAID','CANCELLED'].includes(inv.payment_status) && (
              <button onClick={() => updateStatus('CANCELLED')} disabled={updatingStatus}
                className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm disabled:opacity-50">
                Cancel Invoice
              </button>
            )}
          </div>

          {inv.payments?.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-white mb-2">Payment History</h3>
              <div className="space-y-2">
                {inv.payments.map(p => (
                  <div key={p.id} className="bg-slate-900 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{fmtAED(p.amount)}</p>
                      <p className="text-xs text-slate-400">{p.payment_method} · {fmtDate(p.payment_date)}</p>
                      {p.reference && <p className="text-xs text-slate-500">Ref: {p.reference}</p>}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Received</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inv.notes && (
            <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">Notes</p>
              <p className="text-sm text-slate-300">{inv.notes}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Page ───────────────────────────── */
const STATUS_TABS = ['ALL','DRAFT','SENT','PARTIAL','OVERDUE','PAID','CANCELLED'];

function FinanceInvoicesInner() {
  // Read ?module= from URL — useSearchParams avoids SSR/client hydration mismatch
  const searchParams = useSearchParams();
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [counts,   setCounts]     = useState<Record<string, number>>({});
  const [total,    setTotal]      = useState(0);
  const [loading,  setLoading]    = useState(true);
  const [tab,      setTab]        = useState('ALL');
  const [q,        setQ]          = useState('');
  const [module,   setModule]     = useState('');

  // Sync module filter from URL param after hydration (avoids SSR mismatch)
  useEffect(() => {
    const m = searchParams.get('module') ?? '';
    setModule(m);
  }, [searchParams]);
  const [page,     setPage]       = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [createModule, setCreateModule] = useState<string | undefined>(undefined);
  const [drawerInvId, setDrawerInvId] = useState<string | null>(null);
  const [drawerInvoiceSeed, setDrawerInvoiceSeed] = useState<Invoice | null>(null);

  const openCreate = (mod?: string) => { setCreateModule(mod); setShowCreate(true); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (tab !== 'ALL') params.set('status', tab);
      if (q) params.set('q', q);
      if (module) params.set('module', module);
      const res = await fetch(`/api/finance/invoices?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.data ?? []);
        setTotal(data.total ?? 0);
        setCounts(data.counts ?? {});
      }
    } finally { setLoading(false); }
  }, [tab, q, page, module]);

  const applyCreatedInvoice = useCallback((created: CreatedInvoicePayload) => {
    if (!created.invoice) {
      setDrawerInvoiceSeed(null);
      setDrawerInvId(created.id);
      void load();
      return;
    }

    const seededInvoice = created.invoice as Invoice;
    setInvoices(prev => [seededInvoice, ...prev.filter(inv => inv.id !== created.id)]);
    setTotal(prev => prev + 1);
    setCounts(prev => ({
      ...prev,
      DRAFT: (prev.DRAFT ?? 0) + 1,
    }));
    setDrawerInvoiceSeed(seededInvoice);
    setDrawerInvId(created.id);
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, q, module]);

  const tabCount = (t: string) => t === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[t] ?? 0);
  const totalPages = Math.ceil(total / 25);

  const totalOutstanding = invoices.filter(i => !['PAID','CANCELLED'].includes(i.payment_status))
    .reduce((s, i) => s + Math.max(0, Number(i.total_amount) - Number(i.paid_amount)), 0);

  function handleExport() {
    const cols = ['Invoice No','Client','Module','Issue Date','Due Date','Total (AED)','Paid (AED)','VAT (AED)','Status'];
    const rows = invoices.map(i => ({
      'Invoice No':   i.invoice_number,
      'Client':       i.client_name,
      'Module':       i.module,
      'Issue Date':   i.issue_date,
      'Due Date':     i.due_date ?? '',
      'Total (AED)':  Number(i.total_amount),
      'Paid (AED)':   Number(i.paid_amount),
      'VAT (AED)':    Number(i.vat_amount),
      'Status':       i.payment_status,
    }));
    downloadXLSX(`Invoices-${new Date().toISOString().split('T')[0]}.xls`, rows, cols);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoices</h1>
          <p className="text-slate-400 text-sm mt-0.5">Create, manage, and track all invoices</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm border border-white/10">
            ⬇ Export XLSX
          </button>
          <button data-testid="create-invoice" onClick={() => openCreate(module || undefined)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-sm">
            + New
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Invoices', value: Object.values(counts).reduce((a,b)=>a+b,0), color: 'text-white' },
          { label: 'Outstanding', value: fmtAED(totalOutstanding), color: 'text-amber-400' },
          { label: 'Overdue', value: counts['OVERDUE'] ?? 0, color: 'text-red-400' },
          { label: 'Paid', value: counts['PAID'] ?? 0, color: 'text-emerald-400' },
        ].map(k => (
          <div key={k.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">{k.label}</p>
            <p className={`text-xl font-bold mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by invoice #, client…"
          className="flex-1 bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
        <select value={module} onChange={e => setModule(e.target.value)}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white">
          <option value="">All Modules</option>
          {MODULES.map(m => <option key={m} value={m}>{MODULE_LABELS[m] ?? m}</option>)}
        </select>
      </div>

      <div className="flex gap-1 flex-wrap">
        {STATUS_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            {t} {tabCount(t) > 0 && <span className="ml-1 opacity-70">({tabCount(t)})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-slate-800/60 rounded-xl animate-pulse" />)}</div>
      ) : invoices.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-3">🧾</div>
          <p className="text-slate-400">No invoices found</p>
          <button onClick={() => openCreate(module || undefined)} className="mt-3 text-amber-400 hover:text-amber-300 text-sm">Start with your first invoice →</button>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Invoice</th>
                <th className="text-left px-5 py-3">Client</th>
                <th className="text-left px-5 py-3">Module</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Total</th>
                <th className="text-right px-5 py-3">Paid</th>
                <th className="text-left px-5 py-3">Due</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const outstanding = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount));
                return (
                  <tr key={inv.id} data-testid="invoice-row" data-invoice-id={inv.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors cursor-pointer"
                    onClick={() => { setDrawerInvoiceSeed(inv); setDrawerInvId(inv.id); }}>
                    <td className="px-5 py-3">
                      <p className="font-mono text-xs text-amber-400">{inv.invoice_number}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{fmtDate(inv.issue_date)}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-white">{inv.client_name}</p>
                      {inv.client_email && <p className="text-slate-500 text-xs">{inv.client_email}</p>}
                    </td>
                    <td className="px-5 py-3">
                      {inv.module === 'SCHOOL_BUS'
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">🏫 School Bus</span>
                        : <span className="text-xs text-slate-400">{MODULE_LABELS[inv.module] ?? inv.module}</span>}
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={inv.payment_status} /></td>
                    <td className="px-5 py-3 text-right text-white font-medium">{fmtAED(inv.total_amount)}</td>
                    <td className="px-5 py-3 text-right">
                      {Number(inv.paid_amount) > 0
                        ? <span className="text-emerald-400">{fmtAED(inv.paid_amount)}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {inv.due_date
                        ? <span className={outstanding > 0 && new Date(inv.due_date) < new Date() ? 'text-red-400' : 'text-slate-400'}>{fmtDate(inv.due_date)}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setDrawerInvoiceSeed(inv); setDrawerInvId(inv.id); }} className="text-xs text-amber-400 hover:text-amber-300">View →</button>
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
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm text-slate-400 disabled:opacity-30">← Prev</button>
          <span className="px-3 py-1.5 text-sm text-slate-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm text-slate-400 disabled:opacity-30">Next →</button>
        </div>
      )}

      {/* School Bus active filter banner */}
      {module === 'SCHOOL_BUS' && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🏫</span>
            <div>
              <p className="text-sm font-semibold text-yellow-300">School Bus Transport Fees</p>
              <p className="text-xs text-slate-400">Filtered to school bus invoices · UAE EDU Zero Rate (0% VAT) · All payments tracked here</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => openCreate('SCHOOL_BUS')}
              className="text-xs bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold px-3 py-1.5 rounded-lg transition-colors">
              + New School Bus Invoice
            </button>
            <button onClick={() => setModule('')} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-white/10">
              View All
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => { setShowCreate(false); setCreateModule(undefined); }}
          onCreated={applyCreatedInvoice}
          defaultModule={createModule}
        />
      )}
      {drawerInvId && (
        <InvoiceDrawer
          invoiceId={drawerInvId}
          initialInvoice={drawerInvoiceSeed}
          onClose={() => { setDrawerInvId(null); setDrawerInvoiceSeed(null); }}
          onRefresh={load}
        />
      )}
    </div>
  );
}

export default function FinanceInvoicesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading invoices…</div>}>
      <FinanceInvoicesInner />
    </Suspense>
  );
}
