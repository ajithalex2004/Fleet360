'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Asset {
  id: string;
  asset_no: string;
  name: string;
  domain: string;
  category_name?: string;
  current_stock: number;
  reorder_threshold: number;
  reorder_quantity?: number;
  stock_status: string;
  unit_cost_aed: number;
  total_value_aed: number;
}

const STATUS_COLORS: Record<string, string> = {
  IN_STOCK: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  LOW_STOCK: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  OUT_OF_STOCK: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const DOMAINS = ['ALL', 'FLEET', 'AMBULANCE', 'SCHOOL_BUS', 'RAC', 'LOGISTICS', 'FIELD_SERVICE', 'GENERAL'];
const TX_TYPES = ['INBOUND', 'OUTBOUND', 'ADJUSTMENT'];

function StockBar({ current, threshold }: { current: number; threshold: number }) {
  const pct = threshold > 0 ? Math.min(100, Math.round((current / threshold) * 100)) : 0;
  const color = pct <= 0 ? 'bg-red-500' : pct < 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400">{current}/{threshold}</span>
    </div>
  );
}

export default function StockLevelsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [domainFilter, setDomainFilter] = useState('ALL');
  const [catFilter, setCatFilter] = useState('');
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjAsset, setAdjAsset] = useState<Asset | null>(null);
  const [adjForm, setAdjForm] = useState({ type: 'INBOUND', quantity: 0, reference_no: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/registry?tenantId=default');
      const d = await r.json();
      setAssets(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load stock data'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = assets.filter(a => {
    if (domainFilter !== 'ALL' && a.domain !== domainFilter) return false;
    if (catFilter && a.category_name !== catFilter) return false;
    return true;
  });

  const totalValue = filtered.reduce((s, a) => s + (a.total_value_aed ?? 0), 0);
  const needsReorder = filtered.filter(a => a.stock_status !== 'IN_STOCK').length;

  const domainBreakdown = DOMAINS.filter(d => d !== 'ALL').map(d => {
    const items = filtered.filter(a => a.domain === d);
    return { domain: d, count: items.length, value: items.reduce((s, a) => s + (a.total_value_aed ?? 0), 0) };
  }).filter(d => d.count > 0);

  const cats = [...new Set(assets.map(a => a.category_name).filter(Boolean))];

  const openAdj = (a: Asset) => {
    setAdjAsset(a);
    setAdjForm({ type: 'INBOUND', quantity: 0, reference_no: '', notes: '' });
    setShowAdjModal(true);
  };

  const submitAdj = async () => {
    if (!adjAsset) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/assets/transactions?tenantId=default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: adjAsset.id, ...adjForm, tenantId: 'default' }),
      });
      if (!res.ok) throw new Error();
      showToast('Stock adjusted!');
      setShowAdjModal(false); load();
    } catch { showToast('Adjustment failed'); }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />)}
      </div>
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      <div>
        <h1 className="text-2xl font-bold text-white">Stock Levels & Valuation</h1>
        <p className="text-slate-400 text-sm">Live inventory with reorder monitoring</p>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-white/8 border-l-4 border-l-blue-500 rounded-xl p-5">
          <p className="text-slate-400 text-xs uppercase font-medium">Total SKUs</p>
          <p className="text-2xl font-bold text-white mt-1">{filtered.length.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900 border border-white/8 border-l-4 border-l-yellow-400 rounded-xl p-5">
          <p className="text-slate-400 text-xs uppercase font-medium">Total Value AED</p>
          <p className="text-2xl font-bold text-yellow-300 mt-1">{totalValue.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900 border border-white/8 border-l-4 border-l-red-500 rounded-xl p-5">
          <p className="text-slate-400 text-xs uppercase font-medium">Needs Reorder</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{needsReorder}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={domainFilter} onChange={e => setDomainFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          {DOMAINS.map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          <option value="">All Categories</option>
          {cats.map(c => <option key={c as string}>{c}</option>)}
        </select>
      </div>

      {/* Live Valuation Engine */}
      <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-4">Live Valuation by Domain</h2>
        <table className="w-full text-sm">
          <thead className="border-b border-white/8">
            <tr className="text-slate-400 text-xs uppercase">
              <th className="text-left pb-2">Domain</th>
              <th className="text-right pb-2">Items</th>
              <th className="text-right pb-2">Total Value AED</th>
              <th className="text-right pb-2">% of Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {domainBreakdown.length === 0
              ? <tr><td colSpan={4} className="py-4 text-center text-slate-500">No data</td></tr>
              : domainBreakdown.map(d => (
                <tr key={d.domain} className="text-slate-300">
                  <td className="py-2 font-medium">{d.domain}</td>
                  <td className="py-2 text-right">{d.count}</td>
                  <td className="py-2 text-right text-yellow-300">{d.value.toLocaleString()}</td>
                  <td className="py-2 text-right text-slate-400">{totalValue > 0 ? ((d.value / totalValue) * 100).toFixed(1) : '0'}%</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Stock Table */}
      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['Asset No', 'Name', 'Domain', 'Category', 'Stock', 'Reorder Point', 'Reorder Qty', 'Status', 'Unit Cost', 'Total Value', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                  <div className="text-4xl mb-2">📊</div><p>No stock records found.</p>
                </td></tr>
              ) : filtered.map(a => (
                <tr key={a.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 text-yellow-300 font-mono text-xs">{a.asset_no}</td>
                  <td className="px-4 py-3 text-white font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-slate-400">{a.domain}</td>
                  <td className="px-4 py-3 text-slate-400">{a.category_name ?? '—'}</td>
                  <td className="px-4 py-3"><StockBar current={a.current_stock} threshold={a.reorder_threshold} /></td>
                  <td className="px-4 py-3 text-slate-400">{a.reorder_threshold}</td>
                  <td className="px-4 py-3 text-slate-400">{a.reorder_quantity ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[a.stock_status] ?? 'bg-slate-700 text-slate-400'}`}>
                      {a.stock_status?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{a.unit_cost_aed?.toFixed(2)}</td>
                  <td className="px-4 py-3 text-yellow-300 font-medium">{(a.total_value_aed ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openAdj(a)} className="text-xs bg-blue-700/40 hover:bg-blue-700/60 text-blue-300 px-2 py-1 rounded">Adjust</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdjModal && adjAsset && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-white/8">
              <div>
                <h2 className="text-white font-semibold">Adjust Stock</h2>
                <p className="text-slate-400 text-xs mt-0.5">{adjAsset.name} (current: {adjAsset.current_stock})</p>
              </div>
              <button onClick={() => setShowAdjModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Transaction Type</label>
                <select value={adjForm.type} onChange={e => setAdjForm(p => ({ ...p, type: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  {TX_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Quantity</label>
                <input type="number" value={adjForm.quantity} onChange={e => setAdjForm(p => ({ ...p, quantity: parseFloat(e.target.value) || 0 }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Reference No</label>
                <input value={adjForm.reference_no} onChange={e => setAdjForm(p => ({ ...p, reference_no: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea value={adjForm.notes} onChange={e => setAdjForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/8">
              <button onClick={() => setShowAdjModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={submitAdj} disabled={submitting || adjForm.quantity === 0} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                {submitting ? 'Saving...' : 'Apply Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
