'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

interface BankAccount { id: string; bank_name: string; account_name: string; account_number: string; iban: string | null; currency: string; current_balance: string; is_default: boolean; is_active: boolean; last_reconciled_at: string | null; }
interface Statement { id: string; bank_account_id: string; statement_date: string; period_start: string; period_end: string; opening_balance: string; closing_balance: string; total_lines: string; matched_lines: string; unmatched_lines: string; imported_by: string | null; created_at: string; }
interface StatementLine { id: string; txn_date: string; description: string; reference: string | null; debit: string | null; credit: string | null; balance: string | null; match_status: string; matched_payment_id: string | null; notes: string | null; }

const fmtAED  = (n: string | number | null) => n ? `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 })}` : '—';
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const MATCH_STYLE: Record<string, string> = {
  UNMATCHED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  MATCHED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  EXCLUDED:  'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

/* ── Add Bank Account Modal ── */
function AddBankModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ bankName: '', accountName: '', accountNumber: '', iban: '', currency: 'AED', branchName: '', swiftCode: '', isDefault: false, currentBalance: '' });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.bankName || !form.accountName || !form.accountNumber) return;
    setSaving(true);
    const res = await fetch('/api/finance/bank-accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, currentBalance: parseFloat(form.currentBalance || '0') }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else alert('Failed to add bank account');
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Add Bank Account</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-slate-400 mb-1">Bank Name *</label><input value={form.bankName} onChange={s('bankName')} placeholder="Emirates NBD" className={inp} /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Account Name *</label><input value={form.accountName} onChange={s('accountName')} placeholder="Company Name LLC" className={inp} /></div>
          </div>
          <div><label className="block text-xs text-slate-400 mb-1">Account Number *</label><input value={form.accountNumber} onChange={s('accountNumber')} placeholder="1234567890" className={inp} /></div>
          <div><label className="block text-xs text-slate-400 mb-1">IBAN</label><input value={form.iban} onChange={s('iban')} placeholder="AE070331234567890123456" className={inp} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-slate-400 mb-1">Currency</label><select value={form.currency} onChange={s('currency')} className={inp}><option>AED</option><option>USD</option></select></div>
            <div><label className="block text-xs text-slate-400 mb-1">Opening Balance</label><input type="number" value={form.currentBalance} onChange={s('currentBalance')} placeholder="0.00" className={inp} /></div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} className="w-4 h-4 rounded accent-emerald-500" />
            <span className="text-sm text-slate-300">Set as default account</span>
          </label>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : '+ Add Account'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── CSV Import Modal ── */
function ImportModal({ bankAccountId, onClose, onSaved }: { bankAccountId: string; onClose: () => void; onSaved: () => void }) {
  const [csvText, setCsvText]   = useState('');
  const [form, setForm]         = useState({ periodStart: '', periodEnd: '', openingBalance: '', closingBalance: '' });
  const [preview, setPreview]   = useState<Record<string, string>[]>([]);
  const [saving, setSaving]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseCSV = (text: string) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(',');
      return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim().replace(/^"|"$/g, '')]));
    }).filter(r => Object.values(r).some(v => v));
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { const text = ev.target?.result as string; setCsvText(text); setPreview(parseCSV(text).slice(0, 5)); };
    reader.readAsText(file);
  };

  const mapToLines = (rows: Record<string, string>[]) => rows.map(r => ({
    txnDate:     r.date || r.txn_date || r.transaction_date || r.value_date || '',
    description: r.description || r.narration || r.particulars || r.details || '',
    reference:   r.reference || r.ref || r.cheque_no || '',
    debit:       parseFloat(r.debit || r.dr || r.withdrawal || '0') || null,
    credit:      parseFloat(r.credit || r.cr || r.deposit || '0') || null,
    balance:     parseFloat(r.balance || r.running_balance || '0') || null,
  })).filter(l => l.txnDate && l.description);

  const doImport = async () => {
    const lines = mapToLines(parseCSV(csvText));
    if (!lines.length || !form.periodStart || !form.periodEnd) return alert('Please fill all fields and upload a valid CSV');
    setSaving(true);
    const res = await fetch('/api/finance/bank-reconciliation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'import', bankAccountId, lines,
        statementDate: form.periodEnd, periodStart: form.periodStart, periodEnd: form.periodEnd,
        openingBalance: parseFloat(form.openingBalance || '0'), closingBalance: parseFloat(form.closingBalance || '0'),
        importedBy: 'Finance Manager',
      }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else alert('Import failed');
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Import Bank Statement (CSV)</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-800/60 rounded-xl p-4 border border-dashed border-white/20 text-center cursor-pointer" onClick={() => fileRef.current?.click()}>
            <input type="file" accept=".csv,.txt" ref={fileRef} onChange={onFile} className="hidden" />
            <p className="text-slate-400 text-sm">📂 Click to upload CSV file</p>
            <p className="text-xs text-slate-500 mt-1">Expected columns: Date, Description, Reference, Debit, Credit, Balance</p>
          </div>
          {preview.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs text-slate-400 mb-2">Preview (first 5 rows, {parseCSV(csvText).length} total)</p>
              <table className="w-full text-xs border-collapse">
                <thead><tr className="bg-slate-800">{Object.keys(preview[0]).slice(0, 6).map(h => <th key={h} className="px-2 py-1 text-left text-slate-400">{h}</th>)}</tr></thead>
                <tbody>{preview.map((r, i) => <tr key={i} className="border-t border-white/5">{Object.values(r).slice(0, 6).map((v, j) => <td key={j} className="px-2 py-1 text-slate-300">{String(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-slate-400 mb-1">Period Start *</label><input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} className={inp} /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Period End *</label><input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} className={inp} /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Opening Balance</label><input type="number" value={form.openingBalance} onChange={e => setForm(f => ({ ...f, openingBalance: e.target.value }))} placeholder="0.00" className={inp} /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Closing Balance</label><input type="number" value={form.closingBalance} onChange={e => setForm(f => ({ ...f, closingBalance: e.target.value }))} placeholder="0.00" className={inp} /></div>
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={doImport} disabled={saving || !csvText}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Importing…' : `📥 Import ${parseCSV(csvText).length} Lines`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function BankReconciliationPage() {
  const [accounts, setAccounts]     = useState<BankAccount[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [lines, setLines]           = useState<StatementLine[]>([]);
  const [lineStats, setLineStats]   = useState<{total: string; matched: string; unmatched: string; excluded: string} | null>(null);
  const [selectedAccount, setSelAcc] = useState<string>('');
  const [selectedStatement, setSelStmt] = useState<string>('');
  const [loading, setLoading]       = useState(true);
  const [matchFilter, setMatchFilter] = useState('ALL');
  const [showAddBank, setShowAddBank] = useState(false);
  const [showImport, setShowImport]   = useState(false);
  const [autoMatching, setAutoMatch]  = useState(false);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/finance/bank-accounts?active=true', { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); setAccounts(d.data ?? []); if (!selectedAccount && d.data?.[0]) setSelAcc(d.data[0].id); }
  }, [selectedAccount]);

  const loadStatements = useCallback(async () => {
    if (!selectedAccount) return;
    const res = await fetch(`/api/finance/bank-reconciliation?bankAccountId=${selectedAccount}`, { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); setStatements(d.data ?? []); }
  }, [selectedAccount]);

  const loadLines = useCallback(async () => {
    if (!selectedStatement) return setLines([]);
    setLoading(true);
    const filter = matchFilter !== 'ALL' ? `&matchStatus=${matchFilter}` : '';
    const res = await fetch(`/api/finance/bank-reconciliation?statementId=${selectedStatement}${filter}`, { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); setLines(d.lines ?? []); setLineStats(d.stats ?? null); }
    setLoading(false);
  }, [selectedStatement, matchFilter]);

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { loadStatements(); }, [loadStatements]);
  useEffect(() => { loadLines(); }, [loadLines]);

  const autoMatch = async () => {
    if (!selectedStatement) return;
    setAutoMatch(true);
    const res = await fetch('/api/finance/bank-reconciliation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'auto_match', statementId: selectedStatement }),
    });
    if (res.ok) { const d = await res.json(); alert(`Auto-matched ${d.autoMatched} lines`); loadLines(); }
    setAutoMatch(false);
  };

  const matchLine = async (lineId: string, action: 'match_line' | 'unmatch_line' | 'exclude_line', extra = {}) => {
    await fetch('/api/finance/bank-reconciliation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, lineId, ...extra }),
    });
    loadLines();
  };

  const selAccount = accounts.find(a => a.id === selectedAccount);
  const selStmt    = statements.find(s => s.id === selectedStatement);
  const reconPct   = lineStats ? Math.round((parseInt(lineStats.matched) / Math.max(1, parseInt(lineStats.total))) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Bank Reconciliation</h1>
          <p className="text-slate-400 text-sm mt-0.5">Import statements, auto-match, and reconcile</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddBank(true)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm">
            + Bank Account
          </button>
          {selectedAccount && (
            <button onClick={() => setShowImport(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm">
              📥 Import Statement
            </button>
          )}
        </div>
      </div>

      {/* Account Selector */}
      {accounts.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">🏦</div>
          <p className="text-slate-400">No bank accounts registered</p>
          <button onClick={() => setShowAddBank(true)} className="mt-3 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold">Add Your First Bank Account</button>
        </div>
      ) : (
        <>
          <div className="flex gap-3 flex-wrap">
            {accounts.map(acc => (
              <button key={acc.id} onClick={() => { setSelAcc(acc.id); setSelStmt(''); }}
                className={`px-4 py-3 rounded-2xl border transition-all text-left ${selectedAccount === acc.id ? 'bg-emerald-900/40 border-emerald-500/50' : 'bg-slate-900/60 border-white/10 hover:border-white/20'}`}>
                <p className="text-sm font-semibold text-white">{acc.bank_name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{acc.account_name} · {acc.account_number}</p>
                <p className="text-xs text-emerald-400 mt-1 font-medium">{fmtAED(acc.current_balance)}</p>
              </button>
            ))}
          </div>

          {/* Statements */}
          {selAccount && (
            <div>
              <h2 className="text-sm font-semibold text-slate-400 mb-3">STATEMENTS</h2>
              {statements.length === 0 ? (
                <div className="bg-slate-900/60 border border-white/10 rounded-xl p-8 text-center">
                  <p className="text-slate-400 text-sm">No statements imported for this account</p>
                  <button onClick={() => setShowImport(true)} className="mt-2 text-xs text-emerald-400 hover:text-emerald-300">Import first statement →</button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {statements.map(s => {
                    const total = parseInt(s.total_lines || '0');
                    const matched = parseInt(s.matched_lines || '0');
                    const pct = total > 0 ? Math.round(matched / total * 100) : 0;
                    return (
                      <button key={s.id} onClick={() => setSelStmt(s.id)}
                        className={`p-4 rounded-2xl border transition-all text-left ${selectedStatement === s.id ? 'bg-emerald-900/40 border-emerald-500/50' : 'bg-slate-900/60 border-white/10 hover:border-white/20'}`}>
                        <p className="text-sm font-semibold text-white">{fmtDate(s.period_start)} → {fmtDate(s.period_end)}</p>
                        <div className="mt-2 h-1.5 bg-slate-700 rounded-full"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                        <p className="text-xs text-slate-400 mt-1">{matched}/{total} matched ({pct}%)</p>
                        <p className="text-xs text-slate-500 mt-0.5">Close: {fmtAED(s.closing_balance)}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Lines */}
          {selectedStatement && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-slate-400">STATEMENT LINES</h2>
                  {lineStats && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-emerald-400">{lineStats.matched} matched</span>
                      <span className="text-amber-400">{lineStats.unmatched} unmatched</span>
                      <span className="text-slate-500">{lineStats.excluded} excluded</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-0.5 gap-0.5">
                    {['ALL', 'UNMATCHED', 'MATCHED', 'EXCLUDED'].map(f => (
                      <button key={f} onClick={() => setMatchFilter(f)}
                        className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${matchFilter === f ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                  <button onClick={autoMatch} disabled={autoMatching}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                    {autoMatching ? '⟳ Matching…' : '⚡ Auto-Match'}
                  </button>
                </div>
              </div>

              {/* Reconciliation Progress */}
              {lineStats && (
                <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-400">Reconciliation Progress</p>
                    <p className="text-xs font-bold text-white">{reconPct}%</p>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${reconPct}%` }} />
                  </div>
                </div>
              )}

              {loading ? (
                <div className="h-48 bg-slate-800/60 rounded-2xl animate-pulse" />
              ) : lines.length === 0 ? (
                <div className="bg-slate-900/60 border border-white/10 rounded-xl p-8 text-center">
                  <p className="text-slate-400 text-sm">No lines found for this filter</p>
                </div>
              ) : (
                <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                        <th className="text-left px-5 py-3">Date</th>
                        <th className="text-left px-5 py-3">Description</th>
                        <th className="text-left px-5 py-3">Reference</th>
                        <th className="text-right px-5 py-3">Debit</th>
                        <th className="text-right px-5 py-3">Credit</th>
                        <th className="text-right px-5 py-3">Balance</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-right px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(line => (
                        <tr key={line.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                          <td className="px-5 py-3 text-slate-300 text-xs">{fmtDate(line.txn_date)}</td>
                          <td className="px-5 py-3 text-xs max-w-xs truncate">
                            <span className="text-white">{line.description}</span>
                          </td>
                          <td className="px-5 py-3 text-slate-400 text-xs font-mono">{line.reference ?? '—'}</td>
                          <td className="px-5 py-3 text-right text-red-400 text-xs">{line.debit ? fmtAED(line.debit) : '—'}</td>
                          <td className="px-5 py-3 text-right text-emerald-400 text-xs">{line.credit ? fmtAED(line.credit) : '—'}</td>
                          <td className="px-5 py-3 text-right text-slate-300 text-xs">{fmtAED(line.balance)}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${MATCH_STYLE[line.match_status] ?? ''}`}>
                              {line.match_status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {line.match_status === 'UNMATCHED' && (
                              <div className="flex justify-end gap-1">
                                <button onClick={() => matchLine(line.id, 'match_line', { paymentId: 'manual', matchedBy: 'Finance' })}
                                  className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                  ✓ Match
                                </button>
                                <button onClick={() => matchLine(line.id, 'exclude_line', { reason: 'Bank charge / fee' })}
                                  className="text-xs px-2 py-1 rounded-lg bg-slate-500/20 text-slate-400 hover:bg-slate-500/30">
                                  Exclude
                                </button>
                              </div>
                            )}
                            {line.match_status === 'MATCHED' && (
                              <button onClick={() => matchLine(line.id, 'unmatch_line')}
                                className="text-xs px-2 py-1 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30">
                                Unmatch
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showAddBank && <AddBankModal onClose={() => setShowAddBank(false)} onSaved={loadAccounts} />}
      {showImport && selectedAccount && <ImportModal bankAccountId={selectedAccount} onClose={() => setShowImport(false)} onSaved={() => { loadStatements(); loadLines(); }} />}
    </div>
  );
}
