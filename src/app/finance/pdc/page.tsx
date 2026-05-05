'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface PdcCheque {
  id: string; cheque_number: string; bank_name: string; account_name: string | null;
  cheque_date: string; amount: string; currency: string; direction: string;
  client_name: string | null; client_ref: string | null; status: string;
  deposited_at: string | null; cleared_at: string | null; bounced_at: string | null;
  bounce_reason: string | null; linked_invoice_id: string | null; notes: string | null;
  created_at: string;
}

interface Counts { status: string; count: string; total: string }

const fmtAED    = (n: string | number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate   = (s: string) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const STATUSES  = ['ALL', 'HELD', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED', 'RETURNED'];
const STATUS_STYLE: Record<string, string> = {
  HELD:      'bg-amber-500/20 text-amber-300 border-amber-500/30',
  DEPOSITED: 'bg-blue-500/20  text-blue-300  border-blue-500/30',
  CLEARED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  BOUNCED:   'bg-red-500/20   text-red-400   border-red-500/30',
  CANCELLED: 'bg-slate-500/20 text-slate-400  border-slate-500/30',
  RETURNED:  'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

/* ── Add Cheque Modal ── */
function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    chequeNumber: '', bankName: '', accountName: '', chequeDate: new Date().toISOString().slice(0,10),
    amount: '', direction: 'INCOMING', clientName: '', clientRef: '', linkedInvoiceId: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.chequeNumber || !form.bankName || !form.amount || !form.chequeDate) return;
    setSaving(true);
    const res = await fetch('/api/finance/pdc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else alert('Failed to save cheque');
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Register Cheque</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Direction</label>
              <select value={form.direction} onChange={s('direction')} className={inp}>
                <option value="INCOMING">📥 Incoming (from client)</option>
                <option value="OUTGOING">📤 Outgoing (to supplier)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cheque Date *</label>
              <input type="date" value={form.chequeDate} onChange={s('chequeDate')} className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cheque Number *</label>
              <input value={form.chequeNumber} onChange={s('chequeNumber')} placeholder="123456" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Amount (AED) *</label>
              <input type="number" value={form.amount} onChange={s('amount')} placeholder="5000.00" className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Bank Name *</label>
              <input value={form.bankName} onChange={s('bankName')} placeholder="Emirates NBD" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Account Name</label>
              <input value={form.accountName} onChange={s('accountName')} placeholder="Account holder" className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Client / Payee Name</label>
              <input value={form.clientName} onChange={s('clientName')} placeholder="Client name" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reference (Invoice / Contract)</label>
              <input value={form.clientRef} onChange={s('clientRef')} placeholder="INV-202401-0001" className={inp} />
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
            {saving ? 'Saving…' : '✓ Register Cheque'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Action Modal ── */
function ActionModal({ cheque, onClose, onSaved }: { cheque: PdcCheque; onClose: () => void; onSaved: () => void }) {
  const [action, setAction]   = useState('');
  const [reason, setReason]   = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);

  const NEXT_ACTIONS: Record<string, {label: string; action: string; color: string}[]> = {
    HELD:      [{ label: '📬 Mark Deposited', action: 'deposit', color: 'bg-blue-600' }, { label: '❌ Cancel', action: 'cancel', color: 'bg-slate-600' }],
    DEPOSITED: [{ label: '✅ Mark Cleared',   action: 'clear',   color: 'bg-emerald-600' }, { label: '🔴 Mark Bounced', action: 'bounce', color: 'bg-red-600' }],
    BOUNCED:   [{ label: '↩ Return Cheque',   action: 'return',  color: 'bg-orange-600' }],
  };
  const actions = NEXT_ACTIONS[cheque.status] ?? [];

  const exec = async () => {
    if (!action) return;
    setSaving(true);
    await fetch(`/api/finance/pdc/${cheque.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, bounceReason: reason, notes }),
    });
    setSaving(false);
    onSaved(); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Update Cheque #{cheque.cheque_number}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-800/60 rounded-xl p-4 space-y-1">
            <p className="text-sm text-white font-medium">{cheque.client_name ?? 'N/A'} — {fmtAED(cheque.amount)}</p>
            <p className="text-xs text-slate-400">Due: {fmtDate(cheque.cheque_date)} · {cheque.bank_name}</p>
          </div>
          {actions.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No further actions available for {cheque.status} status</p>
          ) : (
            <>
              <div className="space-y-2">
                <label className="block text-xs text-slate-400">Select Action</label>
                <div className="flex flex-col gap-2">
                  {actions.map(a => (
                    <button key={a.action} onClick={() => setAction(a.action)}
                      className={`w-full py-2 rounded-xl text-sm font-medium text-white transition-all ${action === a.action ? a.color + ' ring-2 ring-white/20' : 'bg-slate-700 hover:bg-slate-600'}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              {action === 'bounce' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Bounce Reason</label>
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Insufficient funds"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500" />
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-emerald-500" />
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          {actions.length > 0 && (
            <button onClick={exec} disabled={!action || saving}
              className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
              {saving ? 'Updating…' : 'Confirm'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function PdcPage() {
  const [cheques, setCheques]     = useState<PdcCheque[]>([]);
  const [counts, setCounts]       = useState<Counts[]>([]);
  const [maturingSoon, setMaturingSoon] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState('ALL');
  const [direction, setDirection] = useState('ALL');
  const [showAdd, setShowAdd]     = useState(false);
  const [selected, setSelected]   = useState<PdcCheque | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL')       params.set('status', tab);
    if (direction !== 'ALL') params.set('direction', direction);
    const res = await fetch(`/api/finance/pdc?${params}`, { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setCheques(d.data ?? []);
      setCounts(d.counts ?? []);
      setMaturingSoon(d.maturingSoon ?? 0);
    }
    setLoading(false);
  }, [tab, direction]);

  useEffect(() => { load(); }, [load]);

  const countOf = (s: string) => counts.find(c => c.status === s);
  const totalOf = (statuses: string[]) => statuses.reduce((sum, s) => {
    const c = countOf(s); return sum + parseFloat(c?.total ?? '0');
  }, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">PDC Register</h1>
          <p className="text-slate-400 text-sm mt-0.5">Post-Dated Cheque management — UAE compliance</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm">
          + Register Cheque
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Held (Pending)',  stat: countOf('HELD'),     color: 'text-amber-400',   icon: '📋' },
          { label: 'Deposited',       stat: countOf('DEPOSITED'), color: 'text-blue-400',    icon: '🏦' },
          { label: 'Cleared',         stat: countOf('CLEARED'),  color: 'text-emerald-400', icon: '✅' },
          { label: 'Bounced',         stat: countOf('BOUNCED'),  color: 'text-red-400',     icon: '🔴' },
        ].map(k => (
          <div key={k.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">{k.icon} {k.label}</p>
            <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.stat?.count ?? 0}</p>
            <p className="text-xs text-slate-500 mt-0.5">{fmtAED(k.stat?.total ?? '0')}</p>
          </div>
        ))}
      </div>

      {/* Maturity Alert */}
      {maturingSoon > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-lg">⏰</span>
          <p className="text-sm text-amber-300 font-medium">
            {maturingSoon} cheque{maturingSoon > 1 ? 's' : ''} maturing within 7 days — review and deposit promptly.
          </p>
        </div>
      )}

      {/* Portfolio Summary */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Total Portfolio Value (Held + Deposited)</p>
          <p className="text-xl font-bold text-white mt-0.5">{fmtAED(totalOf(['HELD', 'DEPOSITED']))}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Total Cleared (This Year)</p>
          <p className="text-xl font-bold text-emerald-400 mt-0.5">{fmtAED(totalOf(['CLEARED']))}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setTab(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {s}
            </button>
          ))}
        </div>
        <select value={direction} onChange={e => setDirection(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
          <option value="ALL">Both Directions</option>
          <option value="INCOMING">📥 Incoming</option>
          <option value="OUTGOING">📤 Outgoing</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />
      ) : cheques.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">🏦</div>
          <p className="text-slate-400">No cheques found</p>
          <p className="text-slate-600 text-xs mt-1">Register cheques received from clients or issued to suppliers</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Cheque #</th>
                <th className="text-left px-5 py-3">Bank</th>
                <th className="text-left px-5 py-3">Direction</th>
                <th className="text-left px-5 py-3">Client / Payee</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Cheque Date</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map(c => {
                const isPastDue = new Date(c.cheque_date) < new Date() && c.status === 'HELD';
                return (
                  <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-white font-mono text-xs font-medium">{c.cheque_number}</p>
                      {c.client_ref && <p className="text-slate-500 text-xs">{c.client_ref}</p>}
                    </td>
                    <td className="px-5 py-3 text-slate-300 text-xs">{c.bank_name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium ${c.direction === 'INCOMING' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {c.direction === 'INCOMING' ? '📥 In' : '📤 Out'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-300 text-xs">{c.client_name ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-medium text-white text-xs">{fmtAED(c.amount)}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className={isPastDue ? 'text-red-400 font-medium' : 'text-slate-300'}>
                        {fmtDate(c.cheque_date)}{isPastDue && ' ⚠️'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[c.status] ?? 'text-slate-400'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {['HELD', 'DEPOSITED', 'BOUNCED'].includes(c.status) && (
                        <button onClick={() => setSelected(c)}
                          className="text-xs px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                          Update →
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={load} />}
      {selected && <ActionModal cheque={selected} onClose={() => setSelected(null)} onSaved={load} />}
    </div>
  );
}
