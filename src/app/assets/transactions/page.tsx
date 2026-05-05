'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Transaction {
  id: string;
  created_at: string;
  asset_name?: string;
  asset_no?: string;
  transaction_type: string;
  quantity_before: number;
  quantity_change: number;
  quantity_after: number;
  reference_no?: string;
  value_aed?: number;
  performed_by?: string;
  domain?: string;
}

const TYPE_BADGES: Record<string, string> = {
  INBOUND: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  OUTBOUND: 'bg-red-500/20 text-red-400 border-red-500/30',
  ADJUSTMENT_UP: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ADJUSTMENT_DOWN: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  DISPATCH: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  RETURN: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  CONSUMED: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  WRITE_OFF: 'bg-slate-600 text-slate-400 border-slate-500',
};

const TX_TYPES = ['All', 'INBOUND', 'OUTBOUND', 'ADJUSTMENT_UP', 'ADJUSTMENT_DOWN', 'DISPATCH', 'RETURN', 'CONSUMED', 'WRITE_OFF'];
const DOMAINS = ['All', 'FLEET', 'AMBULANCE', 'SCHOOL_BUS', 'RAC', 'LOGISTICS', 'FIELD_SERVICE', 'GENERAL'];

export default function TransactionLedgerPage() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [domainFilter, setDomainFilter] = useState('All');
  const [refSearch, setRefSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/transactions?tenantId=default');
      const d = await r.json();
      setTxns(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load transactions'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = txns.filter(t => {
    if (typeFilter !== 'All' && t.transaction_type !== typeFilter) return false;
    if (domainFilter !== 'All' && t.domain !== domainFilter) return false;
    if (refSearch && !t.reference_no?.toLowerCase().includes(refSearch.toLowerCase())) return false;
    if (dateFrom && new Date(t.created_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(t.created_at) > new Date(dateTo + 'T23:59:59')) return false;
    return true;
  });

  const runningTotal = filtered.reduce((s, t) => s + (t.value_aed ?? 0), 0);

  const exportCSV = () => {
    const header = ['Date', 'Asset', 'Type', 'Qty Before', 'Change', 'Qty After', 'Reference', 'Value AED', 'By'];
    const rows = filtered.map(t => [
      new Date(t.created_at).toISOString(),
      t.asset_name ?? '', t.transaction_type,
      t.quantity_before, t.quantity_change, t.quantity_after,
      t.reference_no ?? '', t.value_aed ?? '', t.performed_by ?? '',
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'transactions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 bg-slate-800 rounded animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Transaction Ledger</h1><p className="text-slate-400 text-sm">Full audit trail of all stock movements</p></div>
        <button onClick={exportCSV} className="flex items-center gap-2 bg-slate-800 border border-white/10 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-sm">⬇ Export CSV</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          {TX_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={domainFilter} onChange={e => setDomainFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          {DOMAINS.map(d => <option key={d}>{d}</option>)}
        </select>
        <input value={refSearch} onChange={e => setRefSearch(e.target.value)} placeholder="Search reference no..." className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-48 placeholder-slate-500" />
      </div>

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['#', 'Date', 'Asset', 'Type', 'Qty Before', 'Change', 'Qty After', 'Reference', 'Value AED', 'By'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                  <div className="text-4xl mb-2">📋</div><p>No transactions found matching your filters.</p>
                </td></tr>
              ) : filtered.map((t, idx) => (
                <tr key={t.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 text-slate-500 text-xs">{idx + 1}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{new Date(t.created_at).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="px-4 py-3">
                    <div className="text-white text-xs font-medium">{t.asset_name ?? '—'}</div>
                    {t.asset_no && <div className="text-slate-500 text-xs font-mono">{t.asset_no}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${TYPE_BADGES[t.transaction_type] ?? 'bg-slate-700 text-slate-400'}`}>
                      {t.transaction_type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{t.quantity_before}</td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${t.quantity_change > 0 ? 'text-emerald-400' : t.quantity_change < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                      {t.quantity_change > 0 ? '+' : ''}{t.quantity_change}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 font-medium">{t.quantity_after}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{t.reference_no ?? '—'}</td>
                  <td className="px-4 py-3 text-yellow-300">{t.value_aed ? t.value_aed.toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{t.performed_by ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-white/8 flex items-center justify-between">
          <span className="text-slate-500 text-sm">{filtered.length} transactions shown</span>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm">Running Total Value:</span>
            <span className="text-yellow-300 font-bold">AED {runningTotal.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
