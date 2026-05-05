'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface TrialBalanceRow {
  account_code: string; account_name: string; account_type: string;
  account_subtype: string | null; normal_balance: string;
  total_debit: number; total_credit: number; balance: number;
}

interface AccountStatementLine {
  id: string; entry_date: string; je_number: string; description: string;
  reference: string | null; debit_amount: number; credit_amount: number;
  running_balance: number; entry_description: string;
}

interface AccountStatementData {
  account: { account_code: string; account_name: string; account_type: string; normal_balance: string };
  openingBalance: number;
  closingBalance: number;
  transactions: AccountStatementLine[];
  period: { from: string; to: string };
}

interface CoaFlat { account_code: string; account_name: string; account_type: string; is_header: boolean; }

const TYPE_COLORS: Record<string, string> = {
  ASSET:     'text-blue-400',
  LIABILITY: 'text-red-400',
  EQUITY:    'text-purple-400',
  INCOME:    'text-emerald-400',
  EXPENSE:   'text-amber-400',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}

/* ── Trial Balance Tab ── */
function TrialBalanceTab({ asOf }: { asOf: string }) {
  const [data, setData] = useState<{ rows: TrialBalanceRow[]; isBalanced: boolean; totalDebits: number; totalCredits: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/finance/general-ledger?type=trial_balance&asOf=${asOf}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  const filtered = data?.rows.filter(r => typeFilter === 'ALL' || r.account_type === typeFilter) ?? [];

  if (loading) return <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse mt-4" />;
  if (!data) return null;

  return (
    <div className="space-y-4 mt-4">
      {/* Balance Check */}
      <div className={`flex items-center gap-3 p-4 rounded-2xl border ${data.isBalanced ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
        <span className={`text-2xl ${data.isBalanced ? 'text-emerald-400' : 'text-red-400'}`}>
          {data.isBalanced ? '✓' : '✗'}
        </span>
        <div>
          <p className={`font-bold text-sm ${data.isBalanced ? 'text-emerald-300' : 'text-red-300'}`}>
            {data.isBalanced ? 'Trial Balance is BALANCED' : 'Trial Balance is OUT OF BALANCE'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Total Debits: AED {fmt(data.totalDebits)} &nbsp;|&nbsp; Total Credits: AED {fmt(data.totalCredits)}
            {!data.isBalanced && <span className="text-red-400 ml-2">Difference: AED {fmt(Math.abs(data.totalDebits - data.totalCredits))}</span>}
          </p>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex gap-2">
        {['ALL','ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${typeFilter === t ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white bg-slate-800'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 w-28">Code</th>
              <th className="text-left px-4 py-3">Account Name</th>
              <th className="text-left px-4 py-3 w-24">Type</th>
              <th className="text-right px-4 py-3 w-36">Debit (AED)</th>
              <th className="text-right px-4 py-3 w-36">Credit (AED)</th>
              <th className="text-right px-4 py-3 w-36">Balance (AED)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.account_code} className="border-b border-white/5 hover:bg-slate-800/40">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{row.account_code}</td>
                <td className="px-4 py-2.5 text-sm text-slate-200">{row.account_name}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium ${TYPE_COLORS[row.account_type] ?? 'text-slate-400'}`}>{row.account_type}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-sm text-slate-300">
                  {row.total_debit > 0 ? fmt(row.total_debit) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-sm text-slate-300">
                  {row.total_credit > 0 ? fmt(row.total_credit) : '—'}
                </td>
                <td className={`px-4 py-2.5 text-right text-sm font-medium ${row.balance >= 0 ? 'text-white' : 'text-red-400'}`}>
                  {row.balance < 0 ? '(' : ''}{fmt(row.balance)}{row.balance < 0 ? ')' : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-white/20 bg-slate-800/40">
              <td colSpan={3} className="px-4 py-3 text-xs font-bold text-slate-300 uppercase">Totals</td>
              <td className="px-4 py-3 text-right text-sm font-bold text-white">{fmt(data.totalDebits)}</td>
              <td className="px-4 py-3 text-right text-sm font-bold text-white">{fmt(data.totalCredits)}</td>
              <td className="px-4 py-3 text-right text-sm font-bold text-white">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ── Account Statement Tab ── */
function AccountStatementTab() {
  const [accounts, setAccounts] = useState<CoaFlat[]>([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<AccountStatementData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/finance/coa').then(r => r.json()).then(d => {
      const flat = (d.flatData ?? []).filter((a: CoaFlat) => !a.is_header);
      setAccounts(flat);
      if (flat.length > 0) setSelectedCode(flat[0].account_code);
    });
  }, []);

  const load = async () => {
    if (!selectedCode) return;
    setLoading(true);
    const res = await fetch(`/api/finance/general-ledger?type=account_statement&accountCode=${selectedCode}&from=${from}&to=${to}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  };

  const inp = 'bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500';

  return (
    <div className="space-y-4 mt-4">
      {/* Filters */}
      <div className="flex items-end gap-3 bg-slate-900/60 border border-white/10 rounded-2xl p-4">
        <div className="flex-1">
          <label className="block text-xs text-slate-400 mb-1">Account</label>
          <select value={selectedCode} onChange={e => setSelectedCode(e.target.value)} className={`w-full ${inp}`}>
            {accounts.map(a => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
        </div>
        <button onClick={load} disabled={loading}
          className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
          {loading ? 'Loading…' : 'Run'}
        </button>
      </div>

      {data && (
        <>
          {/* Account header */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-white">{data.account.account_code} — {data.account.account_name}</p>
              <p className={`text-xs mt-0.5 ${TYPE_COLORS[data.account.account_type] ?? 'text-slate-400'}`}>
                {data.account.account_type} · Normal Balance: {data.account.normal_balance}
              </p>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-xs text-slate-400">Opening Balance</p>
                <p className="text-lg font-bold text-white">AED {fmt(data.openingBalance)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Closing Balance</p>
                <p className="text-lg font-bold text-emerald-400">AED {fmt(data.closingBalance)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Transactions</p>
                <p className="text-lg font-bold text-white">{data.transactions.length}</p>
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3 w-28">Date</th>
                  <th className="text-left px-4 py-3 w-36">JE Number</th>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-left px-4 py-3 w-24">Ref</th>
                  <th className="text-right px-4 py-3 w-32">Debit</th>
                  <th className="text-right px-4 py-3 w-32">Credit</th>
                  <th className="text-right px-4 py-3 w-36">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening balance row */}
                <tr className="border-b border-white/5 bg-slate-800/30">
                  <td className="px-4 py-2.5 text-xs text-slate-500">{data.period.from}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">—</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 italic">Opening Balance</td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right text-sm text-slate-300">{fmt(data.openingBalance)}</td>
                </tr>
                {data.transactions.map(tx => (
                  <tr key={tx.id} className="border-b border-white/5 hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 text-xs text-slate-400">{tx.entry_date}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-purple-400">{tx.je_number}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-300">
                      <p>{tx.description || tx.entry_description}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{tx.reference ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-blue-400">
                      {tx.debit_amount > 0 ? fmt(tx.debit_amount) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm text-red-400">
                      {tx.credit_amount > 0 ? fmt(tx.credit_amount) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium text-white">{fmt(tx.running_balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/20 bg-slate-800/40">
                  <td colSpan={4} className="px-4 py-3 text-xs font-bold text-slate-300 uppercase">Closing Balance</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-blue-400">
                    {fmt(data.transactions.reduce((s, t) => s + t.debit_amount, 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-red-400">
                    {fmt(data.transactions.reduce((s, t) => s + t.credit_amount, 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-emerald-400">
                    AED {fmt(data.closingBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {!data && !loading && (
        <div className="h-48 bg-slate-800/40 border border-white/10 rounded-2xl flex items-center justify-center">
          <p className="text-slate-500 text-sm">Select an account and click Run to view statement</p>
        </div>
      )}
    </div>
  );
}

export default function GeneralLedgerPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState<'trial_balance' | 'account_statement'>('trial_balance');
  const [asOf, setAsOf] = useState(today);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">General Ledger</h1>
          <p className="text-slate-400 text-sm mt-0.5">Trial Balance & Account Statements</p>
        </div>
        <div className="flex items-center gap-3">
          {tab === 'trial_balance' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">As of</label>
              <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
                className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500" />
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 w-fit gap-1">
        {([['trial_balance', '⚖️ Trial Balance'], ['account_statement', '📋 Account Statement']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === key ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'trial_balance' && <TrialBalanceTab asOf={asOf} />}
      {tab === 'account_statement' && <AccountStatementTab />}
    </div>
  );
}
