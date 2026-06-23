'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface ReturnItem {
  asset_id: string;
  asset_name: string;
  asset_no?: string;
  quantity: number;
  condition: string;
  reason?: string;
  restore_to_stock?: boolean;
}

interface ReturnRequest {
  id: string;
  return_no: string;
  technician_name: string;
  technician_phone?: string;
  status: string;
  requested_at?: string;
  items: ReturnItem[];
  notes?: string;
}

interface AssetOption {
  id: string;
  name: string;
  asset_no: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  UNDER_REVIEW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  APPROVED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  RESTORED: 'bg-green-500/20 text-green-400 border-green-500/30',
};

const CONDITIONS = ['GOOD', 'DAMAGED', 'EXPIRED'];
const STATUSES = ['All', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESTORED'];

export default function ReturnRequestsPage() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReturnRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const [form, setForm] = useState({
    technician_name: '', technician_phone: '', notes: '',
    items: [{ asset_id: '', asset_name: '', quantity: 1, condition: 'GOOD', reason: '' }] as ReturnItem[],
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rr, ar] = await Promise.all([
        fetch('/api/assets/returns?tenantId=default'),
        fetch('/api/assets/registry?tenantId=default'),
      ]);
      const [rd, ad] = await Promise.all([rr.json(), ar.json()]);
      setReturns(Array.isArray(rd) ? rd : rd.data ?? []);
      setAssets(Array.isArray(ad) ? ad : ad.data ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = returns.filter(r => statusFilter === 'All' || r.status === statusFilter);

  const addItem = () => setForm(p => ({ ...p, items: [...p.items, { asset_id: '', asset_name: '', quantity: 1, condition: 'GOOD', reason: '' }] }));
  const removeItem = (i: number) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }));

  const setItem = <K extends keyof ReturnItem>(i: number, key: K, value: ReturnItem[K]) => setForm(p => ({
    ...p,
    items: p.items.map((it, idx) => idx === i ? { ...it, [key]: value } : it),
  }));

  const submitCreate = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/assets/returns?tenantId=default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, tenantId: 'default' }),
      });
      if (!res.ok) throw new Error();
      showToast('Return request created!');
      setShowCreate(false);
      setForm({ technician_name: '', technician_phone: '', notes: '', items: [{ asset_id: '', asset_name: '', quantity: 1, condition: 'GOOD', reason: '' }] });
      load();
    } catch { showToast('Failed to create return request'); }
    setSubmitting(false);
  };

  const updateStatus = async (id: string, status: string) => {
    setSubmitting(true);
    try {
      await fetch(`/api/assets/returns/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, tenantId: 'default' }),
      });
      showToast('Status updated!'); load();
      setSelected(null);
    } catch { showToast('Update failed'); }
    setSubmitting(false);
  };

  const restoreStock = async (id: string) => {
    setSubmitting(true);
    try {
      // Only good condition items, restore_to_stock = true
      await fetch(`/api/assets/returns/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESTORED', restore_to_stock: true, tenantId: 'default' }),
      });
      showToast('Items restored to stock!'); load(); setSelected(null);
    } catch { showToast('Restore failed'); }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-slate-800 rounded-xl animate-pulse" />)}</div>
        <div className="h-96 bg-slate-800 rounded-xl animate-pulse" />
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Return Requests</h1><p className="text-slate-400 text-sm">Reverse logistics and stock restoration</p></div>
        <button onClick={() => { setShowCreate(true); setSelected(null); }} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">+ New Return</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Return List */}
        <div className="space-y-4">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>

          {filtered.length === 0 ? (
            <div className="bg-slate-900 border border-white/8 rounded-xl p-10 text-center text-slate-500">
              <div className="text-4xl mb-2">↩️</div><p>No return requests found.</p>
            </div>
          ) : filtered.map(r => (
            <button key={r.id} onClick={() => { setSelected(r); setShowCreate(false); }}
              className={`w-full text-left bg-slate-900 border rounded-xl p-4 transition-all ${selected?.id === r.id ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-white/8 hover:border-white/20'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-yellow-300 font-mono text-xs">{r.return_no}</p>
                  <p className="text-white font-semibold text-sm">{r.technician_name}</p>
                </div>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[r.status]}`}>{r.status.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>📦 {r.items?.length ?? 0} item(s)</span>
                {r.requested_at && <span>{new Date(r.requested_at).toLocaleDateString()}</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Right: Create / Detail */}
        <div>
          {showCreate && (
            <div className="bg-slate-900 border border-white/8 rounded-xl p-5 space-y-4">
              <h2 className="text-white font-semibold">New Return Request</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Technician Name*', key: 'technician_name' },
                  { label: 'Phone', key: 'technician_phone' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-slate-400 mb-1">{f.label}</label>
                    <input value={(form as unknown as Record<string, string>)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400 font-medium">Return Items</label>
                  <button onClick={addItem} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add Item</button>
                </div>
                <div className="space-y-3">
                  {form.items.map((item, i) => (
                    <div key={i} className="bg-slate-800/50 rounded-xl p-3 space-y-2">
                      <div className="flex gap-2 items-start">
                        <div className="flex-1">
                          <select value={item.asset_id} onChange={e => {
                            const a = assets.find(x => x.id === e.target.value);
                            setItem(i, 'asset_id', e.target.value);
                            setItem(i, 'asset_name', a?.name ?? '');
                          }} className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white">
                            <option value="">— Select Asset —</option>
                            {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </div>
                        <div className="w-16">
                          <input type="number" min={1} value={item.quantity} onChange={e => setItem(i, 'quantity', parseInt(e.target.value) || 1)} className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white text-center" placeholder="Qty" />
                        </div>
                        {form.items.length > 1 && (
                          <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-300 text-sm">✕</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Condition</label>
                          <select value={item.condition} onChange={e => setItem(i, 'condition', e.target.value)} className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white">
                            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Reason</label>
                          <input value={item.reason ?? ''} onChange={e => setItem(i, 'reason', e.target.value)} className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" placeholder="Optional" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
                <button onClick={submitCreate} disabled={submitting || !form.technician_name} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                  {submitting ? 'Creating...' : 'Submit Return'}
                </button>
              </div>
            </div>
          )}

          {selected && !showCreate && (
            <div className="bg-slate-900 border border-white/8 rounded-xl p-5 space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-yellow-300 font-mono text-xs">{selected.return_no}</p>
                  <h2 className="text-white font-semibold text-lg">{selected.technician_name}</h2>
                  {selected.technician_phone && <p className="text-slate-400 text-sm">{selected.technician_phone}</p>}
                </div>
                <span className={`inline-block px-3 py-1 rounded-full text-xs border ${STATUS_COLORS[selected.status]}`}>{selected.status.replace('_', ' ')}</span>
              </div>

              {selected.requested_at && (
                <p className="text-slate-400 text-xs">Requested: {new Date(selected.requested_at).toLocaleString()}</p>
              )}

              {/* Items Table */}
              <div>
                <h3 className="text-white font-medium text-sm mb-2">Items to Return</h3>
                <table className="w-full text-xs">
                  <thead className="border-b border-white/8">
                    <tr className="text-slate-400">
                      <th className="text-left pb-2">Asset</th>
                      <th className="text-right pb-2">Qty</th>
                      <th className="text-center pb-2">Condition</th>
                      <th className="text-left pb-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(selected.items ?? []).map((it, i) => (
                      <tr key={i} className="text-slate-300">
                        <td className="py-2">{it.asset_name}</td>
                        <td className="py-2 text-right">{it.quantity}</td>
                        <td className="py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${it.condition === 'GOOD' ? 'text-emerald-400' : it.condition === 'DAMAGED' ? 'text-red-400' : 'text-amber-400'}`}>
                            {it.condition}
                          </span>
                        </td>
                        <td className="py-2 text-slate-400">{it.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.notes && (
                <div className="bg-slate-800/50 rounded-xl p-3 text-xs text-slate-400 italic">{selected.notes}</div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-white/8">
                {selected.status === 'PENDING' && (
                  <button onClick={() => updateStatus(selected.id, 'UNDER_REVIEW')} disabled={submitting} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">📋 Start Review</button>
                )}
                {selected.status === 'UNDER_REVIEW' && (
                  <>
                    <button onClick={() => updateStatus(selected.id, 'APPROVED')} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">✓ Approve</button>
                    <button onClick={() => updateStatus(selected.id, 'REJECTED')} disabled={submitting} className="bg-red-700/40 hover:bg-red-700/60 text-red-300 px-3 py-2 rounded-lg text-sm disabled:opacity-50">✕ Reject</button>
                  </>
                )}
                {selected.status === 'APPROVED' && (
                  <div>
                    {selected.items.some(it => it.condition !== 'GOOD') && (
                      <p className="text-amber-400 text-xs mb-2">⚠️ Only GOOD condition items will be restored to stock.</p>
                    )}
                    {selected.items.every(it => it.condition !== 'GOOD') ? (
                      <p className="text-red-400 text-xs">No items in GOOD condition to restore.</p>
                    ) : (
                      <button onClick={() => restoreStock(selected.id)} disabled={submitting} className="bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">🏪 Restore to Stock</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {!selected && !showCreate && (
            <div className="bg-slate-900 border border-white/8 rounded-xl p-12 text-center text-slate-500">
              <div className="text-4xl mb-2">↩️</div>
              <p>Select a return request or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
