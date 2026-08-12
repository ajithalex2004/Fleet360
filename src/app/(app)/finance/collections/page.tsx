'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface CollectionCase {
  id: string; case_no: string; invoice_id: string; invoice_no: string;
  client_name: string; client_email: string | null; client_phone: string | null;
  invoice_amount: string; paid_amount: string; outstanding_amount: string;
  due_date: string; days_overdue: number; status: string; dunning_stage: string | null;
  last_contact_date: string | null; promised_pay_date: string | null;
  promised_amount: string | null; assigned_to: string | null; notes: string | null;
  timeline: {date: string; action: string; by: string; note: string}[];
  created_at: string;
}

interface Aging { bucket: string; count: string; total: string; }
interface OverdueInv { id: string; invoice_number: string; client_name: string; client_email: string; total_amount: string; paid_amount: string; due_date: string; }

const fmtAED  = (n: string | number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const STATUSES  = ['ALL', 'OPEN', 'CONTACTED', 'PROMISED', 'ESCALATED', 'LEGAL', 'SETTLED', 'WRITTEN_OFF', 'CLOSED'];
const STATUS_STYLE: Record<string, string> = {
  OPEN:       'bg-amber-500/20 text-amber-300  border-amber-500/30',
  CONTACTED:  'bg-blue-500/20  text-blue-300   border-blue-500/30',
  PROMISED:   'bg-purple-500/20 text-purple-300 border-purple-500/30',
  ESCALATED:  'bg-orange-500/20 text-orange-300 border-orange-500/30',
  LEGAL:      'bg-red-500/20   text-red-400    border-red-500/30',
  SETTLED:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  WRITTEN_OFF: 'bg-slate-500/20 text-slate-400  border-slate-500/30',
  CLOSED:     'bg-slate-500/20 text-slate-500  border-slate-500/30',
};
const AGING_STYLE: Record<string, string> = {
  'CURRENT': 'text-emerald-400', '1-30': 'text-amber-400',
  '31-60': 'text-orange-400', '61-90': 'text-red-400', '90+': 'text-red-600',
};

/* ── Case Detail Drawer ── */
function CaseDrawer({ caseData, onClose, onUpdate }: { caseData: CollectionCase; onClose: () => void; onUpdate: () => void }) {
  const [action, setAction]     = useState('');
  const [note, setNote]         = useState('');
  const [promise, setPromise]   = useState({ date: '', amount: '' });
  const [saving, setSaving]     = useState(false);

  const exec = async () => {
    if (!action) return;
    setSaving(true);
    const body: Record<string, unknown> = { action, note, notes: note, by: 'Finance Manager' };
    if (action === 'promise') { body.promisedPayDate = promise.date; body.promisedAmount = parseFloat(promise.amount); }
    await fetch(`/api/finance/collections/${caseData.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setAction(''); setNote('');
    onUpdate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">{caseData.case_no}</h2>
            <p className="text-xs text-slate-400">{caseData.client_name} · {caseData.invoice_no}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Key figures */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-400">Invoice</p>
              <p className="text-sm font-bold text-white mt-0.5">{fmtAED(caseData.invoice_amount)}</p>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-400">Outstanding</p>
              <p className="text-sm font-bold text-red-400 mt-0.5">{fmtAED(caseData.outstanding_amount)}</p>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-400">Days Overdue</p>
              <p className={`text-sm font-bold mt-0.5 ${caseData.days_overdue > 60 ? 'text-red-400' : caseData.days_overdue > 30 ? 'text-orange-400' : 'text-amber-400'}`}>
                {caseData.days_overdue}d
              </p>
            </div>
          </div>

          {/* Timeline */}
          {caseData.timeline?.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium">Timeline</p>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {[...caseData.timeline].reverse().map((e, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <span className="text-slate-500 shrink-0">{e.date}</span>
                    <span className="text-amber-400 shrink-0">{e.action}</span>
                    <span className="text-slate-300">{e.note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {!['SETTLED','WRITTEN_OFF','CLOSED'].includes(caseData.status) && (
            <>
              <div>
                <p className="text-xs text-slate-400 mb-2 font-medium">Take Action</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { a: 'contact',  l: '📞 Contact', show: true },
                    { a: 'promise',  l: '🤝 Promise', show: true },
                    { a: 'escalate', l: '⬆️ Escalate', show: !['ESCALATED','LEGAL'].includes(caseData.status) },
                    { a: 'legal',    l: '⚖️ Legal',    show: true },
                    { a: 'settle',   l: '✅ Settle',   show: true },
                    { a: 'write_off', l: '🗑 Write Off', show: true },
                  ].filter(x => x.show).map(x => (
                    <button key={x.a} onClick={() => setAction(action === x.a ? '' : x.a)}
                      className={`py-2 px-3 rounded-xl text-xs font-medium transition-all text-white ${action === x.a ? 'bg-emerald-600 ring-2 ring-emerald-400/20' : 'bg-slate-700 hover:bg-slate-600'}`}>
                      {x.l}
                    </button>
                  ))}
                </div>
              </div>
              {action === 'promise' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Promised Pay Date</label>
                    <input type="date" value={promise.date} onChange={e => setPromise(p => ({ ...p, date: e.target.value }))}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Promised Amount</label>
                    <input type="number" value={promise.amount} onChange={e => setPromise(p => ({ ...p, amount: e.target.value }))} placeholder="0.00"
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500" />
                  </div>
                </div>
              )}
              {action && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Note</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Add a note…"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-emerald-500" />
                </div>
              )}
              {action && (
                <button onClick={exec} disabled={saving}
                  className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Confirm Action'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function CollectionsPage() {
  const [cases, setCases]         = useState<CollectionCase[]>([]);
  const [aging, setAging]         = useState<Aging[]>([]);
  const [overdueInvs, setOverdue] = useState<OverdueInv[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState('ALL');
  const [selected, setSelected]   = useState<CollectionCase | null>(null);
  const [creatingFor, setCreatingFor] = useState<OverdueInv | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('status', tab);
    const res = await fetch(`/api/finance/collections?${params}`, { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setCases(d.data ?? []);
      setAging(d.aging ?? []);
      setOverdue(d.overdueInvoices ?? []);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const openCase = async (inv: OverdueInv) => {
    const outstanding = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
    await fetch('/api/finance/collections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceId: inv.id, invoiceNo: inv.invoice_number, clientName: inv.client_name,
        clientEmail: inv.client_email, invoiceAmount: inv.total_amount,
        paidAmount: inv.paid_amount, dueDate: inv.due_date, outstandingAmount: outstanding,
      }),
    });
    setCreatingFor(null);
    load();
  };

  const totalOutstanding = cases
    .filter(c => !['SETTLED','WRITTEN_OFF','CLOSED'].includes(c.status))
    .reduce((sum, c) => sum + parseFloat(c.outstanding_amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Collections & Dunning</h1>
          <p className="text-slate-400 text-sm mt-0.5">AR aging, collection cases, dunning workflow</p>
        </div>
      </div>

      {/* AR Aging Buckets */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 mb-3">AR AGING ANALYSIS</h2>
        <div className="grid grid-cols-5 gap-3">
          {['CURRENT', '1-30', '31-60', '61-90', '90+'].map(bucket => {
            const d = aging.find(a => a.bucket === bucket);
            return (
              <div key={bucket} className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
                <p className="text-xs text-slate-500">{bucket === 'CURRENT' ? 'Current' : `${bucket} days`}</p>
                <p className={`text-2xl font-bold mt-1 ${AGING_STYLE[bucket]}`}>{fmtAED(d?.total ?? '0')}</p>
                <p className="text-xs text-slate-500 mt-0.5">{d?.count ?? 0} cases</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Total Outstanding Banner */}
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Total Outstanding Receivables</p>
          <p className="text-2xl font-bold text-red-400 mt-0.5">{fmtAED(totalOutstanding)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Active Collection Cases</p>
          <p className="text-2xl font-bold text-white mt-0.5">{cases.filter(c => !['SETTLED','WRITTEN_OFF','CLOSED'].includes(c.status)).length}</p>
        </div>
      </div>

      {/* New Overdue Invoices — auto-surfaced */}
      {overdueInvs.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
          <p className="text-sm font-semibold text-amber-300 mb-3">⚠️ Overdue Invoices Without Collection Cases ({overdueInvs.length})</p>
          <div className="space-y-2">
            {overdueInvs.slice(0, 5).map(inv => (
              <div key={inv.id} className="flex items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm text-white font-medium">{inv.client_name}</p>
                  <p className="text-xs text-slate-400">{inv.invoice_number} · Due: {fmtDate(inv.due_date)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-bold text-red-400">{fmtAED(parseFloat(inv.total_amount) - parseFloat(inv.paid_amount))}</p>
                  <button onClick={() => openCase(inv)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium">
                    Open Case
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {s}
          </button>
        ))}
      </div>

      {/* Cases Table */}
      {loading ? (
        <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />
      ) : cases.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-slate-400">No collection cases</p>
          <p className="text-slate-600 text-xs mt-1">Overdue invoices will surface automatically above</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Case #</th>
                <th className="text-left px-5 py-3">Client</th>
                <th className="text-left px-5 py-3">Invoice</th>
                <th className="text-right px-5 py-3">Outstanding</th>
                <th className="text-right px-5 py-3">Days Overdue</th>
                <th className="text-left px-5 py-3">Dunning Stage</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3 text-white font-mono text-xs font-medium">{c.case_no}</td>
                  <td className="px-5 py-3">
                    <p className="text-white text-xs font-medium">{c.client_name}</p>
                    {c.client_email && <p className="text-slate-500 text-xs">{c.client_email}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-300 text-xs">{c.invoice_no}</td>
                  <td className="px-5 py-3 text-right font-bold text-red-400 text-xs">{fmtAED(c.outstanding_amount)}</td>
                  <td className="px-5 py-3 text-right text-xs">
                    <span className={c.days_overdue > 60 ? 'text-red-400 font-bold' : c.days_overdue > 30 ? 'text-orange-400' : 'text-amber-400'}>
                      {c.days_overdue}d
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">{c.dunning_stage?.replace('_', ' ') ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[c.status] ?? ''}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setSelected(c)}
                      className="text-xs px-3 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30">
                      Manage →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <CaseDrawer caseData={selected} onClose={() => setSelected(null)} onUpdate={() => { load(); setSelected(null); }} />}
    </div>
  );
}
