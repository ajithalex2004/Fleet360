'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { KpiCard, StatGrid, type PageAccent } from '@/components/ui/page-theme';

interface DebitNote {
  id: string;
  dn_number: string;
  original_payable_id: string | null;
  original_payable_no: string | null;
  original_invoice_id: string | null;
  original_invoice_no: string | null;
  vendor_name: string;
  vendor_email: string | null;
  module: string | null;
  reason_code: string;
  reason_detail: string | null;
  subtotal: string | number;
  vat_amount: string | number;
  total_amount: string | number;
  applied_amount: string | number;
  currency: string;
  issue_date: string;
  status: string;
  approved_by?: string | null;
  issued_by: string | null;
  notes: string | null;
  created_at: string;
}

interface InvoiceOption {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email?: string | null;
  module?: string | null;
  total_amount: string | number;
  paid_amount?: string | number;
  payment_status: string;
}

interface PayableOption {
  id: string;
  payable_number?: string;
  invoice_number?: string;
  vendor_name?: string;
  supplier_name?: string;
  module?: string | null;
  total_amount: string | number;
  paid_amount?: string | number;
  payment_status?: string;
  status?: string;
}

const fmtAED  = (n: string | number) => `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const STATUSES = ['ALL', 'DRAFT', 'ISSUED', 'APPLIED', 'VOIDED'];
const REASONS  = [
  'UNDERCHARGE',
  'ADDITIONAL_CHARGES',
  'DAMAGE_RECOVERY',
  'LATE_PAYMENT_FEE',
  'VENDOR_OVERCHARGE',
  'SHORT_DELIVERY',
  'RATE_ADJUSTMENT',
  'OTHER',
];
const MODULES = ['LEASING', 'RENTAL', 'LOGISTICS', 'BUS_OPERATIONS', 'MAINTENANCE', 'GENERAL'];
const STATUS_STYLE: Record<string, string> = {
  DRAFT:   'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  ISSUED:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  APPLIED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  VOIDED:  'bg-red-500/20 text-red-400 border-red-500/30',
};

async function downloadPeppol383(id: string) {
  const res = await fetch(`/api/finance/invoices/${encodeURIComponent(id)}/peppol-xml?format=xml`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    alert(body.error ?? 'Could not generate Peppol 383 Debit Note XML');
    return;
  }
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `${id}-debit-note-383.xml`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── Create Modal ── */
function CreateModal({
  invoices,
  payables,
  onClose,
  onSaved,
}: {
  invoices: InvoiceOption[];
  payables: PayableOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sourceType, setSourceType] = useState<'AR' | 'AP'>('AR');
  const [form, setForm] = useState({
    vendorName: '',
    vendorEmail: '',
    module: 'LEASING',
    reasonCode: 'ADDITIONAL_CHARGES',
    reasonDetail: '',
    originalInvoiceId: '',
    originalInvoiceNo: '',
    originalPayableId: '',
    originalPayableNo: '',
    subtotal: '',
    vatAmount: '0',
    issueDate: new Date().toISOString().slice(0, 10),
    issuedBy: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (k === 'subtotal') {
      const sub = parseFloat(val || '0');
      const vat = Math.round(sub * 0.05 * 100) / 100;
      setForm(f => ({ ...f, subtotal: val, vatAmount: String(vat) }));
    } else {
      setForm(f => ({ ...f, [k]: val }));
    }
  };

  const handleInvoiceSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) {
      setForm(f => ({ ...f, originalInvoiceId: '' }));
      return;
    }
    const inv = invoices.find(i => i.id === id);
    if (inv) {
      setForm(f => ({
        ...f,
        originalInvoiceId: inv.id,
        originalInvoiceNo: inv.invoice_number,
        originalPayableId: '',
        originalPayableNo: '',
        vendorName: inv.client_name || f.vendorName,
        vendorEmail: inv.client_email || f.vendorEmail,
        module: inv.module || f.module,
      }));
    }
  };

  const handlePayableSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) {
      setForm(f => ({ ...f, originalPayableId: '' }));
      return;
    }
    const pay = payables.find(p => p.id === id);
    if (pay) {
      const refNo = pay.payable_number || pay.invoice_number || pay.id.slice(0, 8);
      const vName = pay.vendor_name || pay.supplier_name || '';
      setForm(f => ({
        ...f,
        originalPayableId: pay.id,
        originalPayableNo: refNo,
        originalInvoiceId: '',
        originalInvoiceNo: '',
        vendorName: vName || f.vendorName,
        module: pay.module || f.module,
      }));
    }
  };

  const total = (parseFloat(form.subtotal || '0') + parseFloat(form.vatAmount || '0')).toFixed(2);

  const save = async () => {
    if (!form.vendorName || !form.reasonCode || !form.subtotal) {
      alert('Please fill in Counterparty Name, Reason Code, and Subtotal.');
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      originalInvoiceId: sourceType === 'AR' ? (form.originalInvoiceId || form.originalInvoiceNo || 'MANUAL-AR') : null,
      originalInvoiceNo: sourceType === 'AR' ? (form.originalInvoiceNo || null) : null,
      originalPayableId: sourceType === 'AP' ? (form.originalPayableId || form.originalPayableNo || 'MANUAL-AP') : null,
      originalPayableNo: sourceType === 'AP' ? (form.originalPayableNo || null) : null,
      subtotal: parseFloat(form.subtotal),
      vatAmount: parseFloat(form.vatAmount || '0'),
    };
    const res = await fetch('/api/finance/debit-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      onSaved();
      onClose();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? 'Failed to create debit note');
    }
  };

  const inp = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-amber-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-main)]">New Debit Note (UBL 383)</h2>
            <p className="text-xs text-[var(--text-muted)]">Raise against a Customer Invoice (AR) or Vendor Payable (AP)</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          {/* Source Type Toggle */}
          <div className="grid grid-cols-2 gap-2 bg-[var(--bg-canvas)]/60 p-1 rounded-xl border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setSourceType('AR')}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                sourceType === 'AR' ? 'bg-amber-500 text-black' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              📈 AR-Side (Customer Invoice)
            </button>
            <button
              type="button"
              onClick={() => setSourceType('AP')}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                sourceType === 'AP' ? 'bg-amber-500 text-black' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              📥 AP-Side (Vendor Payable)
            </button>
          </div>

          {sourceType === 'AR' ? (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Select Original Invoice</label>
              <select value={form.originalInvoiceId} onChange={handleInvoiceSelect} className={inp}>
                <option value="">— Select customer invoice or enter reference below —</option>
                {invoices.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} · {inv.client_name} ({fmtAED(inv.total_amount)}) [{inv.payment_status}]
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Select Original Payable</label>
              <select value={form.originalPayableId} onChange={handlePayableSelect} className={inp}>
                <option value="">— Select vendor payable or enter reference below —</option>
                {payables.map(p => {
                  const ref = p.payable_number || p.invoice_number || p.id.slice(0, 8);
                  const vName = p.vendor_name || p.supplier_name || 'Vendor';
                  return (
                    <option key={p.id} value={p.id}>
                      {ref} · {vName} ({fmtAED(p.total_amount)})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                {sourceType === 'AR' ? 'Customer Name *' : 'Vendor Name *'}
              </label>
              <input value={form.vendorName} onChange={s('vendorName')} placeholder="Counterparty name" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Module</label>
              <select value={form.module} onChange={s('module')} className={inp}>
                {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                {sourceType === 'AR' ? 'Original Invoice No.' : 'Original Payable No.'}
              </label>
              {sourceType === 'AR' ? (
                <input value={form.originalInvoiceNo} onChange={s('originalInvoiceNo')} placeholder="INV-202601-0001" className={inp} />
              ) : (
                <input value={form.originalPayableNo} onChange={s('originalPayableNo')} placeholder="BILL-2026-001" className={inp} />
              )}
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Issue Date</label>
              <input type="date" value={form.issueDate} onChange={s('issueDate')} className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Reason Code *</label>
              <select value={form.reasonCode} onChange={s('reasonCode')} className={inp}>
                {REASONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Issued By</label>
              <input value={form.issuedBy} onChange={s('issuedBy')} placeholder="Finance Officer" className={inp} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Reason Detail</label>
            <input value={form.reasonDetail} onChange={s('reasonDetail')} placeholder="Describe the debit adjustment…" className={inp} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Subtotal (AED) *</label>
              <input type="number" value={form.subtotal} onChange={s('subtotal')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">VAT (5%)</label>
              <input type="number" value={form.vatAmount} onChange={s('vatAmount')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Total DN Value</label>
              <div className="w-full bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-amber-400 font-semibold">
                AED {total}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
            <textarea value={form.notes} onChange={s('notes')} rows={2}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] resize-none focus:outline-none focus:border-amber-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : '✓ Create Debit Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Apply Modal ── */
function ApplyModal({
  dn,
  invoices,
  payables,
  onClose,
  onSaved,
}: {
  dn: DebitNote;
  invoices: InvoiceOption[];
  payables: PayableOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isAp = Boolean(dn.original_payable_id && !dn.original_invoice_id);
  const remaining = Math.max(0, Number(dn.total_amount ?? 0) - Number(dn.applied_amount ?? 0));
  const [targetInvoiceId, setTargetInvoiceId] = useState(dn.original_invoice_id ?? '');
  const [targetPayableId, setTargetPayableId] = useState(dn.original_payable_id ?? '');
  const [applyAmount, setApplyAmount]         = useState(String(remaining || dn.total_amount));
  const [saving, setSaving]                   = useState(false);

  const submit = async () => {
    setSaving(true);
    const res = await fetch(`/api/finance/debit-notes/${dn.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'apply',
        applyAmount: parseFloat(applyAmount || String(remaining)),
        appliedToInvoiceId: !isAp ? (targetInvoiceId || undefined) : undefined,
        appliedToPayableId: isAp ? (targetPayableId || undefined) : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved();
      onClose();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? 'Failed to apply debit note');
    }
  };

  const inp = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">Apply Debit Note {dn.dn_number}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-[var(--bg-surface)]/60 rounded-xl p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-muted)]">Counterparty: <span className="text-[var(--text-main)] font-semibold">{dn.vendor_name}</span></p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Remaining Unapplied: <span className="text-amber-400 font-bold">{fmtAED(remaining)}</span></p>
          </div>
          {!isAp ? (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Apply to Customer Invoice</label>
              <select value={targetInvoiceId} onChange={e => setTargetInvoiceId(e.target.value)} className={inp}>
                <option value="">— Select invoice —</option>
                {invoices.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} · {inv.client_name} ({fmtAED(inv.total_amount)}) [{inv.payment_status}]
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Apply to Vendor Payable</label>
              <select value={targetPayableId} onChange={e => setTargetPayableId(e.target.value)} className={inp}>
                <option value="">— Select payable —</option>
                {payables.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.payable_number || p.invoice_number || p.id.slice(0, 8)} · {p.vendor_name || p.supplier_name} ({fmtAED(p.total_amount)})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Amount to Apply (AED)</label>
            <input type="number" value={applyAmount} onChange={e => setApplyAmount(e.target.value)} className={inp} />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Applying…' : '✓ Apply Debit Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function DebitNotesPage() {
  const [dns, setDns]               = useState<DebitNote[]>([]);
  const [invoices, setInvoices]     = useState<InvoiceOption[]>([]);
  const [payables, setPayables]     = useState<PayableOption[]>([]);
  const [counts, setCounts]         = useState<{ status: string; count: string; total: string }[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('ALL');
  const [showCreate, setCreate]     = useState(false);
  const [applyingDn, setApplyingDn] = useState<DebitNote | null>(null);
  const [actioning, setAct]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('status', tab);
    const [res, invRes, payRes] = await Promise.all([
      fetch(`/api/finance/debit-notes?${params}`, { cache: 'no-store' }),
      fetch('/api/finance/invoices?limit=100', { cache: 'no-store' }),
      fetch('/api/finance/payables?limit=100', { cache: 'no-store' }),
    ]);
    if (res.ok) {
      const d = await res.json();
      setDns(d.data ?? []);
      setCounts(d.counts ?? []);
    }
    if (invRes.ok) {
      const invData = await invRes.json();
      setInvoices(invData.data ?? invData.invoices ?? []);
    }
    if (payRes.ok) {
      const payData = await payRes.json();
      setPayables(payData.data ?? payData.payables ?? []);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, body: Record<string, unknown>) => {
    setAct(id);
    const res = await fetch(`/api/finance/debit-notes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? 'Action failed');
    }
    setAct(null);
    load();
  };

  const countOf = (s: string) => counts.find(c => c.status === s);
  const totalDraft = parseFloat(countOf('DRAFT')?.total ?? '0');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Debit Notes</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            AR customer debit adjustments &amp; AP vendor claims · UAE Peppol PINT-AE (UBL 2.1 Code 383)
          </p>
        </div>
        <button onClick={() => setCreate(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-sm">
          + New Debit Note
        </button>
      </div>

      {/* KPI Cards */}
      <StatGrid cols={4}>
        {STATUSES.filter(s => s !== 'ALL').map((s, idx) => {
          const d = countOf(s);
          const accents: PageAccent[] = ['slate', 'amber', 'emerald', 'rose'];
          return (
            <KpiCard
              key={s}
              label={s}
              value={d?.count ?? 0}
              sub={fmtAED(d?.total ?? '0')}
              accent={accents[idx % accents.length]}
            />
          );
        })}
      </StatGrid>

      {/* Pending Issuance Banner */}
      {parseInt(countOf('DRAFT')?.count ?? '0') > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-lg">📝</span>
          <p className="text-sm text-amber-300">
            <span className="font-semibold">{countOf('DRAFT')?.count} draft debit note{parseInt(countOf('DRAFT')?.count ?? '0') > 1 ? 's' : ''}</span> pending approval &amp; issuance — {fmtAED(totalDraft)}
          </p>
          <button onClick={() => setTab('DRAFT')} className="ml-auto text-xs px-3 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30">Review →</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-1 gap-1 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-amber-500 text-black font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
            {s} {s !== 'ALL' && `(${countOf(s)?.count ?? 0})`}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-64 bg-[var(--bg-surface)]/60 rounded-2xl animate-pulse" />
      ) : dns.length === 0 ? (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-[var(--text-muted)]">No debit notes found</p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Create a debit note to adjust customer receivables or vendor payables</p>
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">DN #</th>
                <th className="text-left px-5 py-3">Counterparty</th>
                <th className="text-left px-5 py-3">Source Ref</th>
                <th className="text-left px-5 py-3">Reason</th>
                <th className="text-right px-5 py-3">Total Amount</th>
                <th className="text-right px-5 py-3">Applied</th>
                <th className="text-left px-5 py-3">Issue Date</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dns.map(dn => {
                const isAp = Boolean(dn.original_payable_id && !dn.original_invoice_id);
                const refLabel = dn.original_invoice_no || dn.original_payable_no || '—';
                return (
                  <tr key={dn.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-surface)]/40 transition-colors">
                    <td className="px-5 py-3 text-[var(--text-main)] font-mono text-xs font-medium">{dn.dn_number}</td>
                    <td className="px-5 py-3">
                      <p className="text-[var(--text-main)] text-xs font-medium">{dn.vendor_name}</p>
                      <p className="text-[var(--text-faint)] text-xs">
                        {isAp ? 'AP Vendor' : 'AR Customer'}{dn.module ? ` · ${dn.module}` : ''}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs font-mono">{refLabel}</td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs">
                      <p>{dn.reason_code.replace(/_/g, ' ')}</p>
                      {dn.approved_by && <p className="text-[10px] text-emerald-400">✓ Approved by {dn.approved_by}</p>}
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-amber-400 text-xs">{fmtAED(dn.total_amount)}</td>
                    <td className="px-5 py-3 text-right text-emerald-400 text-xs">{fmtAED(dn.applied_amount)}</td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{fmtDate(dn.issue_date)}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[dn.status] ?? ''}`}>
                        {dn.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1 flex-wrap">
                        {dn.status === 'DRAFT' && (
                          <>
                            {!dn.approved_by && (
                              <button
                                onClick={() => doAction(dn.id, { approvedBy: 'Finance Manager' })}
                                disabled={actioning === dn.id}
                                className="text-xs px-2 py-1 rounded-lg bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 disabled:opacity-50"
                              >
                                ✓ Approve
                              </button>
                            )}
                            <button
                              onClick={() => doAction(dn.id, { action: 'issue', issuedBy: 'Finance Manager' })}
                              disabled={actioning === dn.id}
                              className="text-xs px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                            >
                              {actioning === dn.id ? '…' : '📤 Issue'}
                            </button>
                            <button
                              onClick={() => doAction(dn.id, { action: 'void' })}
                              disabled={actioning === dn.id}
                              className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                            >
                              Void
                            </button>
                          </>
                        )}
                        {dn.status === 'ISSUED' && (
                          <>
                            <button
                              onClick={() => setApplyingDn(dn)}
                              disabled={actioning === dn.id}
                              className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50"
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => doAction(dn.id, { action: 'void' })}
                              disabled={actioning === dn.id}
                              className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                            >
                              Void
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => downloadPeppol383(dn.id)}
                          title="Download UAE Peppol UBL 2.1 (383 Debit Note) XML"
                          className="text-xs px-2 py-1 rounded-lg bg-violet-500/20 text-violet-300 hover:bg-violet-500/30"
                        >
                          📜 383 XML
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateModal
          invoices={invoices}
          payables={payables}
          onClose={() => setCreate(false)}
          onSaved={load}
        />
      )}
      {applyingDn && (
        <ApplyModal
          dn={applyingDn}
          invoices={invoices}
          payables={payables}
          onClose={() => setApplyingDn(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
