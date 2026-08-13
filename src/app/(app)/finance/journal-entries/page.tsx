'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface JeLine { lineNumber: number; accountCode: string; accountName: string; description: string; debitAmount: string; creditAmount: string; costCentre?: string; }
interface JournalEntry {
  id: string; je_number: string; entry_date: string; narration: string; reference: string | null;
  source_type: string; status: string; total_debit: string; total_credit: string;
  is_balanced: boolean; prepared_by: string | null; approved_by: string | null;
  posted_by: string | null; approved_at: string | null; posted_at: string | null;
  reversed_je_id: string | null; reversal_je_id: string | null;
  lines: JeLine[] | null; created_at: string;
}

interface CoaAccount { account_code: string; account_name: string; account_type: string; is_header: boolean; }

const fmtAED  = (n: string | number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s: string | null)  => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const STATUSES = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED', 'VOID'];
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-slate-500/20 text-slate-300 border-slate-500/30',
  SUBMITTED: 'bg-blue-500/20  text-blue-300  border-blue-500/30',
  APPROVED:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  POSTED:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  REVERSED:  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  VOID:      'bg-red-500/20   text-red-400   border-red-500/30',
  REVERSAL:  'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

interface LineForm { accountCode: string; description: string; debitAmount: string; creditAmount: string; costCentre: string; }
const blankLine = (): LineForm => ({ accountCode: '', description: '', debitAmount: '', creditAmount: '', costCentre: '' });

/* ── Create JE Modal ── */
function CreateJEModal({ accounts, onClose, onSaved }: { accounts: CoaAccount[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm]   = useState({ narration: '', reference: '', entryDate: new Date().toISOString().slice(0,10), preparedBy: '', notes: '' });
  const [lines, setLines] = useState<LineForm[]>([blankLine(), blankLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError]  = useState('');

  const postAccounts = accounts.filter(a => !a.is_header);
  const totalDr = lines.reduce((s, l) => s + (parseFloat(l.debitAmount) || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (parseFloat(l.creditAmount) || 0), 0);
  const diff    = Math.round(Math.abs(totalDr - totalCr) * 100) / 100;
  const balanced = diff < 0.01;

  const updateLine = (i: number, k: keyof LineForm, v: string) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  const addLine  = () => setLines(ls => [...ls, blankLine()]);
  const remLine  = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.narration) return setError('Narration is required');
    const validLines = lines.filter(l => l.accountCode && (parseFloat(l.debitAmount) > 0 || parseFloat(l.creditAmount) > 0));
    if (validLines.length < 2) return setError('At least 2 lines with amounts are required');
    setSaving(true);
    const res = await fetch('/api/finance/journal-entries', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        lines: validLines.map(l => ({ ...l, debitAmount: parseFloat(l.debitAmount) || 0, creditAmount: parseFloat(l.creditAmount) || 0 })),
      }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else { const d = await res.json(); setError(d.error ?? 'Failed to save'); }
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">New Journal Entry</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2 text-sm text-red-400">{error}</div>}

          {/* Header */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Entry Date *</label>
              <input type="date" value={form.entryDate} onChange={e => setForm(f => ({ ...f, entryDate: e.target.value }))} className={inp} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Narration *</label>
              <input value={form.narration} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} placeholder="Describe this journal entry" className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reference</label>
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="INV-001, PO-002…" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Prepared By</label>
              <input value={form.preparedBy} onChange={e => setForm(f => ({ ...f, preparedBy: e.target.value }))} placeholder="Name" className={inp} />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Journal Lines</label>
              <button onClick={addLine} className="text-xs px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600">+ Add Line</button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-1 text-xs text-slate-500 px-2">
                <span className="col-span-3">Account</span>
                <span className="col-span-4">Description</span>
                <span className="col-span-2 text-right">Debit (AED)</span>
                <span className="col-span-2 text-right">Credit (AED)</span>
                <span className="col-span-1" />
              </div>
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-1 items-center">
                  <div className="col-span-3">
                    <select value={line.accountCode} onChange={e => updateLine(i, 'accountCode', e.target.value)}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500">
                      <option value="">— Select account —</option>
                      {postAccounts.map(a => (
                        <option key={a.account_code} value={a.account_code}>
                          {a.account_code} — {a.account_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-4">
                    <input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)}
                      placeholder="Line description…"
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" value={line.debitAmount} onChange={e => updateLine(i, 'debitAmount', e.target.value)}
                      placeholder="0.00" step="0.01"
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-right text-blue-300 focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" value={line.creditAmount} onChange={e => updateLine(i, 'creditAmount', e.target.value)}
                      placeholder="0.00" step="0.01"
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-right text-emerald-300 focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {lines.length > 2 && (
                      <button onClick={() => remLine(i)} className="text-red-400 hover:text-red-300 text-sm">×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className={`rounded-xl p-3 border flex items-center justify-between ${balanced ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
            <div className="flex gap-6 text-sm">
              <span className="text-slate-300">Debits: <strong className="text-blue-300">{fmtAED(totalDr.toFixed(2))}</strong></span>
              <span className="text-slate-300">Credits: <strong className="text-emerald-300">{fmtAED(totalCr.toFixed(2))}</strong></span>
            </div>
            <div>
              {balanced
                ? <span className="text-emerald-400 text-sm font-semibold">✓ Balanced</span>
                : <span className="text-red-400 text-sm font-semibold">⚠ Difference: {fmtAED(diff.toFixed(2))}</span>
              }
            </div>
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving || !balanced}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : '✓ Save Journal Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── JE Detail Drawer ── */
function JEDrawer({ je, onClose, onUpdate }: { je: JournalEntry; onClose: () => void; onUpdate: () => void }) {
  const [actioning, setActioning] = useState(false);
  const lines: JeLine[] = Array.isArray(je.lines) ? je.lines : [];

  const doAction = async (action: string, extra: Record<string, string> = {}) => {
    setActioning(true);
    const res = await fetch(`/api/finance/journal-entries/${je.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    setActioning(false);
    if (res.ok) { onUpdate(); onClose(); }
    else { const d = await res.json(); alert(d.error ?? 'Action failed'); }
  };

  const ACTIONS: { action: string; label: string; color: string; forStatus: string[] }[] = [
    { action: 'submit',  label: '📤 Submit for Approval', color: 'bg-blue-600',    forStatus: ['DRAFT'] },
    { action: 'approve', label: '✓ Approve',              color: 'bg-amber-600',   forStatus: ['SUBMITTED'] },
    { action: 'post',    label: '📌 Post to GL',           color: 'bg-emerald-600', forStatus: ['APPROVED','SUBMITTED'] },
    { action: 'reverse', label: '↩ Create Reversal',      color: 'bg-purple-600',  forStatus: ['POSTED'] },
    { action: 'void',    label: '🗑 Void',                 color: 'bg-red-700',     forStatus: ['DRAFT','SUBMITTED','APPROVED'] },
  ];
  const availableActions = ACTIONS.filter(a => a.forStatus.includes(je.status));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white font-mono">{je.je_number}</h2>
            <p className="text-xs text-slate-400">{fmtDate(je.entry_date)} · {je.source_type}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[je.status] ?? ''}`}>{je.status}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl ml-2">×</button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-800/60 rounded-xl p-4">
            <p className="text-sm text-white font-medium">{je.narration}</p>
            {je.reference && <p className="text-xs text-slate-400 mt-1">Ref: {je.reference}</p>}
          </div>

          {/* Lines */}
          <div className="bg-slate-900/60 border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="text-left px-4 py-2">Account</th>
                  <th className="text-left px-4 py-2">Description</th>
                  <th className="text-right px-4 py-2">Debit</th>
                  <th className="text-right px-4 py-2">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-mono text-slate-300">{l.accountCode}</span>
                      <span className="text-slate-400 ml-2">{l.accountName}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-400">{l.description}</td>
                    <td className="px-4 py-2 text-right text-blue-300 font-medium">
                      {parseFloat(String(l.debitAmount)) > 0 ? fmtAED(l.debitAmount) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-emerald-300 font-medium">
                      {parseFloat(String(l.creditAmount)) > 0 ? fmtAED(l.creditAmount) : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-white/10 bg-slate-800/30">
                  <td colSpan={2} className="px-4 py-2 text-xs text-slate-400 font-semibold uppercase">Totals</td>
                  <td className="px-4 py-2 text-right font-bold text-blue-300">{fmtAED(je.total_debit)}</td>
                  <td className="px-4 py-2 text-right font-bold text-emerald-300">{fmtAED(je.total_credit)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Actions */}
          {availableActions.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {availableActions.map(a => (
                <button key={a.action} onClick={() => doAction(a.action, { approvedBy: 'Finance Manager', postedBy: 'Finance Manager' })}
                  disabled={actioning}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold text-white ${a.color} hover:opacity-90 disabled:opacity-50`}>
                  {actioning ? '…' : a.label}
                </button>
              ))}
            </div>
          )}

          {(je.reversed_je_id || je.reversal_je_id) && (
            <div className="text-xs text-purple-400 bg-purple-500/10 rounded-xl px-4 py-2">
              {je.reversed_je_id && <p>↩ Reversal of JE ID: {je.reversed_je_id}</p>}
              {je.reversal_je_id && <p>↩ Reversed by JE ID: {je.reversal_je_id}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function JournalEntriesPage() {
  const [entries, setEntries]   = useState<JournalEntry[]>([]);
  const [counts, setCounts]     = useState<{status: string; count: string; total_debit: string}[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('ALL');
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const [showCreate, setCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('status', tab);
    const [entriesRes, accsRes] = await Promise.all([
      fetch(`/api/finance/journal-entries?${params}`, { cache: 'no-store' }),
      fetch('/api/finance/coa?flat=true', { cache: 'no-store' }),
    ]);
    if (entriesRes.ok) { const d = await entriesRes.json(); setEntries(d.data ?? []); setCounts(d.counts ?? []); }
    if (accsRes.ok)    { const d = await accsRes.json();    setAccounts(d.data ?? []); }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const countOf = (s: string) => counts.find(c => c.status === s);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Journal Entries</h1>
          <p className="text-slate-400 text-sm mt-0.5">Double-entry bookkeeping — every entry must balance</p>
        </div>
        <button onClick={() => setCreate(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm">
          + New Journal Entry
        </button>
      </div>

      {/* Status KPI Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {STATUSES.filter(s => s !== 'ALL').map(s => {
          const d = countOf(s);
          return (
            <div key={s} onClick={() => setTab(tab === s ? 'ALL' : s)}
              className={`bg-slate-900/60 border rounded-xl p-3 cursor-pointer transition-all ${tab === s ? 'border-emerald-500/50' : 'border-white/10 hover:border-white/20'}`}>
              <p className="text-xs text-slate-500">{s}</p>
              <p className="text-xl font-bold text-white mt-0.5">{d?.count ?? 0}</p>
            </div>
          );
        })}
      </div>

      {/* Approval Queue */}
      {parseInt(countOf('SUBMITTED')?.count ?? '0') > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-lg">📋</span>
          <p className="text-sm text-amber-300">
            <span className="font-semibold">{countOf('SUBMITTED')?.count} journal entries</span> awaiting approval
          </p>
          <button onClick={() => setTab('SUBMITTED')} className="ml-auto text-xs px-3 py-1 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30">
            Review →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {s} {s !== 'ALL' && `(${countOf(s)?.count ?? 0})`}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />
      ) : entries.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">📒</div>
          <p className="text-slate-400">No journal entries found</p>
          <button onClick={() => setCreate(true)} className="mt-3 text-xs text-emerald-400 hover:text-emerald-300">Create your first journal entry →</button>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">JE Number</th>
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Narration</th>
                <th className="text-left px-5 py-3">Source</th>
                <th className="text-right px-5 py-3">Total Dr / Cr</th>
                <th className="text-left px-5 py-3">Balanced</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(je => {
                const lines: JeLine[] = Array.isArray(je.lines) ? je.lines : [];
                return (
                  <tr key={je.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 text-white font-mono text-xs font-medium">{je.je_number}</td>
                    <td className="px-5 py-3 text-slate-300 text-xs">{fmtDate(je.entry_date)}</td>
                    <td className="px-5 py-3 max-w-xs">
                      <p className="text-white text-xs truncate">{je.narration}</p>
                      {je.reference && <p className="text-slate-500 text-xs">Ref: {je.reference}</p>}
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{je.source_type}</td>
                    <td className="px-5 py-3 text-right text-xs">
                      <p className="text-blue-300">{fmtAED(je.total_debit)}</p>
                      <p className="text-emerald-300">{fmtAED(je.total_credit)}</p>
                    </td>
                    <td className="px-5 py-3">
                      {je.is_balanced
                        ? <span className="text-emerald-400 text-xs font-medium">✓ Yes</span>
                        : <span className="text-red-400 text-xs font-medium">⚠ No</span>
                      }
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[je.status] ?? ''}`}>{je.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => setSelected(je)}
                        className="text-xs px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                        View →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showCreate && <CreateJEModal accounts={accounts} onClose={() => setCreate(false)} onSaved={load} />}
      {selected && <JEDrawer je={selected} onClose={() => setSelected(null)} onUpdate={load} />}
    </div>
  );
}
