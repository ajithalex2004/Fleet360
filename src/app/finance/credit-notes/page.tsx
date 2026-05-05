'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface CreditNote {
  id: string; cn_number: string; original_invoice_id: string | null;
  original_invoice_no: string | null; client_name: string; client_email: string | null;
  module: string | null; reason_code: string; reason_detail: string | null;
  subtotal: string; vat_amount: string; total_amount: string; currency: string;
  issue_date: string; status: string; applied_amount: string;
  refunded_at: string | null; refund_method: string | null;
  issued_by: string | null; notes: string | null; created_at: string;
}

const fmtAED  = (n: string | number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const STATUSES = ['ALL', 'DRAFT', 'ISSUED', 'APPLIED', 'REFUNDED', 'VOIDED'];
const REASONS  = ['BILLING_ERROR', 'SERVICE_FAILURE', 'OVERPAYMENT', 'CONTRACT_CANCELLATION', 'RATE_ADJUSTMENT', 'OTHER'];
const MODULES  = ['RAC', 'LEASING', 'LOGISTICS', 'STAFF', 'SCHOOL', 'GENERAL'];
const STATUS_STYLE: Record<string, string> = {
  DRAFT:    'bg-slate-500/20 text-slate-300  border-slate-500/30',
  ISSUED:   'bg-blue-500/20  text-blue-300   border-blue-500/30',
  APPLIED:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  REFUNDED: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  VOIDED:   'bg-red-500/20   text-red-400    border-red-500/30',
};

/* ── Create Modal ── */
function CreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    clientName: '', clientEmail: '', module: 'GENERAL', reasonCode: 'BILLING_ERROR',
    reasonDetail: '', originalInvoiceNo: '', originalInvoiceId: '',
    subtotal: '', vatAmount: '0', issueDate: new Date().toISOString().slice(0,10),
    issuedBy: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const total = (parseFloat(form.subtotal || '0') + parseFloat(form.vatAmount || '0')).toFixed(2);

  const save = async () => {
    if (!form.clientName || !form.reasonCode || !form.subtotal) return;
    setSaving(true);
    const res = await fetch('/api/finance/credit-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, subtotal: parseFloat(form.subtotal), vatAmount: parseFloat(form.vatAmount || '0') }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else alert('Failed to create credit note');
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">New Credit Note</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Client Name *</label>
              <input value={form.clientName} onChange={s('clientName')} placeholder="Client name" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Module</label>
              <select value={form.module} onChange={s('module')} className={inp}>
                {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Original Invoice No.</label>
              <input value={form.originalInvoiceNo} onChange={s('originalInvoiceNo')} placeholder="INV-202401-0001" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Issue Date</label>
              <input type="date" value={form.issueDate} onChange={s('issueDate')} className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reason Code *</label>
              <select value={form.reasonCode} onChange={s('reasonCode')} className={inp}>
                {REASONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Issued By</label>
              <input value={form.issuedBy} onChange={s('issuedBy')} placeholder="Your name" className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reason Detail</label>
            <input value={form.reasonDetail} onChange={s('reasonDetail')} placeholder="Describe the reason…" className={inp} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Subtotal *</label>
              <input type="number" value={form.subtotal} onChange={s('subtotal')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">VAT Amount</label>
              <input type="number" value={form.vatAmount} onChange={s('vatAmount')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Total CN Value</label>
              <div className="w-full bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-blue-400 font-semibold">
                AED {total}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={s('notes')} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : '✓ Create Credit Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function CreditNotesPage() {
  const [cns, setCns]           = useState<CreditNote[]>([]);
  const [counts, setCounts]     = useState<{status: string; count: string; total: string}[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('ALL');
  const [showCreate, setCreate] = useState(false);
  const [actioning, setAct]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('status', tab);
    const res = await fetch(`/api/finance/credit-notes?${params}`, { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); setCns(d.data ?? []); setCounts(d.counts ?? []); }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: string, extra = {}) => {
    setAct(id);
    await fetch(`/api/finance/credit-notes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    setAct(null); load();
  };

  const countOf = (s: string) => counts.find(c => c.status === s);
  const totalDraft   = parseFloat(countOf('DRAFT')?.total   ?? '0');
  const totalIssued  = parseFloat(countOf('ISSUED')?.total  ?? '0');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Credit Notes</h1>
          <p className="text-slate-400 text-sm mt-0.5">Issue, apply, and track credit adjustments</p>
        </div>
        <button onClick={() => setCreate(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm">
          + New Credit Note
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUSES.filter(s => s !== 'ALL').map(s => {
          const d = countOf(s);
          return (
            <div key={s} className="bg-slate-900/60 border border-white/10 rounded-xl p-3">
              <p className="text-xs text-slate-500">{s}</p>
              <p className="text-xl font-bold text-white mt-0.5">{d?.count ?? 0}</p>
              <p className="text-xs text-slate-500">{fmtAED(d?.total ?? '0')}</p>
            </div>
          );
        })}
      </div>

      {/* Pending Issuance Banner */}
      {parseInt(countOf('DRAFT')?.count ?? '0') > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-blue-400 text-lg">📝</span>
          <p className="text-sm text-blue-300">
            <span className="font-semibold">{countOf('DRAFT')?.count} draft credit note{parseInt(countOf('DRAFT')?.count ?? '0') > 1 ? 's' : ''}</span> pending issuance — {fmtAED(totalDraft)}
          </p>
          <button onClick={() => setTab('DRAFT')} className="ml-auto text-xs px-3 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">Review →</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {s} {s !== 'ALL' && `(${countOf(s)?.count ?? 0})`}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />
      ) : cns.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-slate-400">No credit notes found</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">CN #</th>
                <th className="text-left px-5 py-3">Client</th>
                <th className="text-left px-5 py-3">Invoice</th>
                <th className="text-left px-5 py-3">Reason</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Issue Date</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cns.map(cn => (
                <tr key={cn.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3 text-white font-mono text-xs font-medium">{cn.cn_number}</td>
                  <td className="px-5 py-3">
                    <p className="text-white text-xs font-medium">{cn.client_name}</p>
                    {cn.module && <p className="text-slate-500 text-xs">{cn.module}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-300 text-xs">{cn.original_invoice_no ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">{cn.reason_code.replace(/_/g, ' ')}</td>
                  <td className="px-5 py-3 text-right font-bold text-blue-400 text-xs">{fmtAED(cn.total_amount)}</td>
                  <td className="px-5 py-3 text-slate-300 text-xs">{fmtDate(cn.issue_date)}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[cn.status] ?? ''}`}>
                      {cn.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {cn.status === 'DRAFT' && (
                        <button onClick={() => doAction(cn.id, 'issue', { issuedBy: 'Finance' })}
                          disabled={actioning === cn.id}
                          className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50">
                          {actioning === cn.id ? '…' : '📤 Issue'}
                        </button>
                      )}
                      {cn.status === 'ISSUED' && (
                        <>
                          <button onClick={() => doAction(cn.id, 'apply', { appliedAmount: cn.total_amount })}
                            disabled={actioning === cn.id}
                            className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50">
                            Apply
                          </button>
                          <button onClick={() => doAction(cn.id, 'refund', { refundMethod: 'Bank Transfer' })}
                            disabled={actioning === cn.id}
                            className="text-xs px-2 py-1 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50">
                            Refund
                          </button>
                          <button onClick={() => doAction(cn.id, 'void')}
                            disabled={actioning === cn.id}
                            className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50">
                            Void
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showCreate && <CreateModal onClose={() => setCreate(false)} onSaved={load} />}
    </div>
  );
}
