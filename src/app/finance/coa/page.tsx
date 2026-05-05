'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface CoaAccount {
  id: string; account_code: string; account_name: string; account_type: string;
  account_subtype: string | null; parent_code: string | null; description: string | null;
  is_header: boolean; is_active: boolean; is_system: boolean; normal_balance: string;
  sort_order: number; children?: CoaAccount[];
}

const TYPE_COLORS: Record<string, string> = {
  ASSET:     'text-blue-400 bg-blue-500/10 border-blue-500/20',
  LIABILITY: 'text-red-400  bg-red-500/10  border-red-500/20',
  EQUITY:    'text-purple-400 bg-purple-500/10 border-purple-500/20',
  INCOME:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  EXPENSE:   'text-amber-400 bg-amber-500/10 border-amber-500/20',
};
const TYPE_LABELS = ['ALL', 'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

/* ── Add Account Modal ── */
function AddModal({ flatAccounts, onClose, onSaved }: { flatAccounts: CoaAccount[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    accountCode: '', accountName: '', accountType: 'EXPENSE', accountSubtype: '',
    parentCode: '', description: '', isHeader: false,
  });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.accountCode || !form.accountName || !form.accountType) return;
    setSaving(true);
    const res = await fetch('/api/finance/coa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else { const d = await res.json(); alert(d.error ?? 'Failed'); }
  };

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500';
  const parentOptions = flatAccounts.filter(a => a.account_type === form.accountType && a.is_header);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Add Account</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Account Code *</label>
              <input value={form.accountCode} onChange={s('accountCode')} placeholder="e.g. 4410" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Account Type *</label>
              <select value={form.accountType} onChange={s('accountType')} className={inp}>
                {['ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Account Name *</label>
            <input value={form.accountName} onChange={s('accountName')} placeholder="Account name" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Parent Account</label>
              <select value={form.parentCode} onChange={s('parentCode')} className={inp}>
                <option value="">— Top level —</option>
                {parentOptions.map(a => <option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Sub-type</label>
              <select value={form.accountSubtype} onChange={s('accountSubtype')} className={inp}>
                <option value="">— None —</option>
                {['CURRENT','FIXED','NON_CURRENT','REVENUE','COGS','OPEX','FINANCE','TAX','OTHER_INCOME'].map(s =>
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                )}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description</label>
            <textarea value={form.description} onChange={s('description')} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isHeader} onChange={e => setForm(f => ({ ...f, isHeader: e.target.checked }))}
              className="w-4 h-4 rounded accent-purple-500" />
            <span className="text-sm text-slate-300">Header / Group account (no direct posting)</span>
          </label>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : '+ Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Account Row (recursive tree) ── */
function AccountRow({ account, depth = 0, typeFilter }: { account: CoaAccount; depth?: number; typeFilter: string }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = account.children && account.children.length > 0;
  const typeStyle = TYPE_COLORS[account.account_type] ?? '';

  if (typeFilter !== 'ALL' && account.account_type !== typeFilter) return null;

  return (
    <>
      <tr className={`border-b border-white/5 hover:bg-slate-800/40 transition-colors ${account.is_header ? 'bg-slate-800/20' : ''}`}>
        <td className="px-4 py-2.5" style={{ paddingLeft: `${16 + depth * 20}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-white text-xs w-4">
                {expanded ? '▼' : '▶'}
              </button>
            ) : <span className="w-4" />}
            <span className={`font-mono text-xs font-bold ${account.is_header ? 'text-slate-200' : 'text-slate-400'}`}>
              {account.account_code}
            </span>
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-sm ${account.is_header ? 'font-semibold text-white' : 'text-slate-300'}`}>
            {account.account_name}
          </span>
          {account.is_system && <span className="ml-2 text-xs text-slate-500">⚙ sys</span>}
          {account.description && <p className="text-xs text-slate-500 mt-0.5 max-w-sm truncate">{account.description}</p>}
        </td>
        <td className="px-4 py-2.5">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${typeStyle}`}>
            {account.account_type}
          </span>
        </td>
        <td className="px-4 py-2.5 text-xs text-slate-400">{account.account_subtype?.replace('_', ' ') ?? '—'}</td>
        <td className="px-4 py-2.5">
          <span className={`text-xs font-medium ${account.is_header ? 'text-slate-500' : 'text-slate-300'}`}>
            {account.normal_balance}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-xs ${account.is_active ? 'text-emerald-400' : 'text-red-400'}`}>
            {account.is_active ? '● Active' : '● Inactive'}
          </span>
        </td>
      </tr>
      {hasChildren && expanded && account.children!.map(child => (
        <AccountRow key={child.account_code} account={child} depth={depth + 1} typeFilter={typeFilter} />
      ))}
    </>
  );
}

export default function CoaPage() {
  const [tree, setTree]           = useState<CoaAccount[]>([]);
  const [flat, setFlat]           = useState<CoaAccount[]>([]);
  const [loading, setLoading]     = useState(true);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [search, setSearch]       = useState('');
  const [showAdd, setShowAdd]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    const res = await fetch(`/api/finance/coa?${params}`, { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setTree(d.data ?? []);
      setFlat(d.flatData ?? []);
    }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const typeCounts = TYPE_LABELS.slice(1).map(t => ({
    type: t, count: flat.filter(a => a.account_type === t && !a.is_header).length
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Chart of Accounts</h1>
          <p className="text-slate-400 text-sm mt-0.5">Transport-specific double-entry COA — {flat.length} accounts</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm">
          + Add Account
        </button>
      </div>

      {/* Type Summary */}
      <div className="grid grid-cols-5 gap-3">
        {typeCounts.map(tc => (
          <button key={tc.type} onClick={() => setTypeFilter(typeFilter === tc.type ? 'ALL' : tc.type)}
            className={`p-4 rounded-2xl border transition-all text-left ${typeFilter === tc.type ? TYPE_COLORS[tc.type] + ' border-2' : 'bg-slate-900/60 border-white/10 hover:border-white/20'}`}>
            <p className="text-xs text-slate-400">{tc.type}</p>
            <p className="text-2xl font-bold text-white mt-1">{tc.count}</p>
            <p className="text-xs text-slate-500 mt-0.5">accounts</p>
          </button>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code or name…"
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white w-64 focus:outline-none focus:border-purple-500" />
        <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1">
          {TYPE_LABELS.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${typeFilter === t ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Accounts Tree Table */}
      {loading ? (
        <div className="h-96 bg-slate-800/60 rounded-2xl animate-pulse" />
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 w-32">Code</th>
                <th className="text-left px-4 py-3">Account Name</th>
                <th className="text-left px-4 py-3 w-32">Type</th>
                <th className="text-left px-4 py-3 w-36">Sub-type</th>
                <th className="text-left px-4 py-3 w-24">Normal Bal.</th>
                <th className="text-left px-4 py-3 w-24">Status</th>
              </tr>
            </thead>
            <tbody>
              {tree.map(root => (
                <AccountRow key={root.account_code} account={root} depth={0} typeFilter={typeFilter} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showAdd && <AddModal flatAccounts={flat} onClose={() => setShowAdd(false)} onSaved={load} />}
    </div>
  );
}
