'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface DispatchItem {
  asset_id: string;
  asset_name: string;
  asset_no?: string;
  quantity: number;
  qty_dispatched?: number;
  qty_accepted?: number;
  qty_consumed?: number;
  qty_returned?: number;
}

interface Dispatch {
  id: string;
  dispatch_no: string;
  technician_name: string;
  technician_phone?: string;
  from_warehouse?: string;
  work_order_no?: string;
  status: string;
  dispatched_at?: string;
  items: DispatchItem[];
}

interface AssetOption {
  id: string;
  name: string;
  asset_no: string;
  current_stock: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-strong)]',
  DISPATCHED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACCEPTED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-green-500/20 text-green-400 border-green-500/30',
  CANCELLED: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const STATUSES = ['All', 'PENDING', 'DISPATCHED', 'ACCEPTED', 'COMPLETED', 'CANCELLED'];

export default function FieldDispatchPage() {
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Dispatch | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [techFilter, setTechFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const [form, setForm] = useState({
    technician_name: '', technician_phone: '', from_warehouse: '', work_order_no: '',
    items: [{ asset_id: '', asset_name: '', quantity: 1 }] as { asset_id: string; asset_name: string; quantity: number }[],
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dr, ar] = await Promise.all([
        fetch('/api/assets/dispatch?tenantId=default'),
        fetch('/api/assets/registry?tenantId=default'),
      ]);
      const [dd, ad] = await Promise.all([dr.json(), ar.json()]);
      setDispatches(Array.isArray(dd) ? dd : dd.data ?? []);
      setAssets(Array.isArray(ad) ? ad : ad.data ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = dispatches.filter(d => {
    if (statusFilter !== 'All' && d.status !== statusFilter) return false;
    if (techFilter && !d.technician_name.toLowerCase().includes(techFilter.toLowerCase())) return false;
    return true;
  });

  const addItem = () => setForm(p => ({ ...p, items: [...p.items, { asset_id: '', asset_name: '', quantity: 1 }] }));
  const removeItem = (i: number) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }));
  const setItem = (i: number, key: string, value: string | number) => setForm(p => ({
    ...p,
    items: p.items.map((it, idx) => idx === i ? { ...it, [key]: value } : it),
  }));

  const submitCreate = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/assets/dispatch?tenantId=default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, tenantId: 'default' }),
      });
      if (!res.ok) throw new Error();
      showToast('Dispatch created!');
      setShowCreate(false);
      setForm({ technician_name: '', technician_phone: '', from_warehouse: '', work_order_no: '', items: [{ asset_id: '', asset_name: '', quantity: 1 }] });
      load();
    } catch { showToast('Failed to create dispatch'); }
    setSubmitting(false);
  };

  const updateStatus = async (id: string, status: string, extra: Record<string, unknown> = {}) => {
    setSubmitting(true);
    try {
      await fetch(`/api/assets/dispatch/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra, tenantId: 'default' }),
      });
      showToast('Status updated!');
      load();
      if (selected?.id === id) setSelected(null);
    } catch { showToast('Update failed'); }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-[var(--bg-surface)] rounded w-48 animate-pulse" />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-[var(--bg-surface)] rounded-xl animate-pulse" />)}</div>
        <div className="h-96 bg-[var(--bg-surface)] rounded-xl animate-pulse" />
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-[var(--text-main)]">Field Dispatch</h1><p className="text-[var(--text-muted)] text-sm">Manage asset dispatches to field technicians</p></div>
        <button onClick={() => { setShowCreate(true); setSelected(null); }} className="bg-yellow-400 hover:bg-yellow-300 text-white font-semibold px-4 py-2 rounded-lg text-sm">+ New Dispatch</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Dispatch List */}
        <div className="space-y-4">
          <div className="flex gap-3">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] flex-1">
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <input value={techFilter} onChange={e => setTechFilter(e.target.value)} placeholder="Filter by technician..." className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] flex-1 placeholder-[var(--text-faint)]" />
          </div>

          {filtered.length === 0 ? (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-10 text-center text-[var(--text-faint)]">
              <div className="text-4xl mb-2">🚚</div><p>No dispatches found.</p>
            </div>
          ) : filtered.map(d => (
            <button key={d.id} onClick={() => { setSelected(d); setShowCreate(false); }}
              className={`w-full text-left bg-[var(--bg-surface)] border rounded-xl p-4 transition-all ${selected?.id === d.id ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-yellow-300 font-mono text-xs">{d.dispatch_no}</p>
                  <p className="text-[var(--text-main)] font-semibold text-sm">{d.technician_name}</p>
                </div>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[d.status]}`}>{d.status}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <span>📦 {d.items?.length ?? 0} item(s)</span>
                {d.work_order_no && <span>WO: {d.work_order_no}</span>}
                {d.dispatched_at && <span>{new Date(d.dispatched_at).toLocaleDateString()}</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Right: Create / Detail */}
        <div>
          {showCreate && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
              <h2 className="text-[var(--text-main)] font-semibold">New Dispatch</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Technician Name*', key: 'technician_name' },
                  { label: 'Phone', key: 'technician_phone' },
                  { label: 'From Warehouse', key: 'from_warehouse' },
                  { label: 'Work Order No', key: 'work_order_no' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">{f.label}</label>
                    <input value={(form as unknown as Record<string, string>)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]" />
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[var(--text-muted)] font-medium">Items</label>
                  <button onClick={addItem} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add Item</button>
                </div>
                <div className="space-y-2">
                  {form.items.map((item, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <div className="flex-1">
                        <select value={item.asset_id} onChange={e => {
                          const a = assets.find(x => x.id === e.target.value);
                          setItem(i, 'asset_id', e.target.value);
                          setItem(i, 'asset_name', a?.name ?? '');
                        }} className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-main)]">
                          <option value="">— Select Asset —</option>
                          {assets.map(a => <option key={a.id} value={a.id}>{a.name} ({a.asset_no})</option>)}
                        </select>
                      </div>
                      <div className="w-20">
                        <input type="number" min={1} value={item.quantity} onChange={e => setItem(i, 'quantity', parseInt(e.target.value) || 1)} className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-main)] text-center" />
                      </div>
                      {form.items.length > 1 && (
                        <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-300 text-sm mt-1">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
                <button onClick={submitCreate} disabled={submitting || !form.technician_name} className="bg-yellow-400 hover:bg-yellow-300 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                  {submitting ? 'Creating...' : 'Create Dispatch'}
                </button>
              </div>
            </div>
          )}

          {selected && !showCreate && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-yellow-300 font-mono text-xs">{selected.dispatch_no}</p>
                  <h2 className="text-[var(--text-main)] font-semibold text-lg">{selected.technician_name}</h2>
                  {selected.technician_phone && <p className="text-[var(--text-muted)] text-sm">{selected.technician_phone}</p>}
                </div>
                <span className={`inline-block px-3 py-1 rounded-full text-xs border ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {selected.from_warehouse && <div><span className="text-[var(--text-muted)]">Warehouse: </span><span className="text-[var(--text-main)]">{selected.from_warehouse}</span></div>}
                {selected.work_order_no && <div><span className="text-[var(--text-muted)]">Work Order: </span><span className="text-[var(--text-main)]">{selected.work_order_no}</span></div>}
                {selected.dispatched_at && <div><span className="text-[var(--text-muted)]">Dispatched: </span><span className="text-[var(--text-main)]">{new Date(selected.dispatched_at).toLocaleString()}</span></div>}
              </div>

              {/* Items Table */}
              <div>
                <h3 className="text-[var(--text-main)] font-medium text-sm mb-2">Items</h3>
                <table className="w-full text-xs">
                  <thead className="border-b border-[var(--border-subtle)]">
                    <tr className="text-[var(--text-muted)]">
                      <th className="text-left pb-2">Asset</th>
                      <th className="text-right pb-2">Disp.</th>
                      <th className="text-right pb-2">Acc.</th>
                      <th className="text-right pb-2">Used</th>
                      <th className="text-right pb-2">Ret.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(selected.items ?? []).map((it, i) => (
                      <tr key={i} className="text-[var(--text-muted)]">
                        <td className="py-2">{it.asset_name}</td>
                        <td className="py-2 text-right">{it.qty_dispatched ?? it.quantity}</td>
                        <td className="py-2 text-right">{it.qty_accepted ?? '—'}</td>
                        <td className="py-2 text-right">{it.qty_consumed ?? '—'}</td>
                        <td className="py-2 text-right">{it.qty_returned ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-subtle)]">
                {selected.status === 'DISPATCHED' && (
                  <button onClick={() => updateStatus(selected.id, 'ACCEPTED')} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">✓ Mark Accepted</button>
                )}
                {selected.status === 'ACCEPTED' && (
                  <button onClick={() => updateStatus(selected.id, 'COMPLETED')} disabled={submitting} className="bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">✓ Mark Consumed / Completed</button>
                )}
                {selected.status === 'PENDING' && (
                  <button onClick={() => updateStatus(selected.id, 'DISPATCHED')} disabled={submitting} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">🚚 Mark Dispatched</button>
                )}
                {selected.status !== 'CANCELLED' && selected.status !== 'COMPLETED' && (
                  <button onClick={() => updateStatus(selected.id, 'CANCELLED')} disabled={submitting} className="bg-red-700/40 hover:bg-red-700/60 text-red-300 px-3 py-2 rounded-lg text-sm disabled:opacity-50">✕ Cancel</button>
                )}
              </div>
            </div>
          )}

          {!selected && !showCreate && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-12 text-center text-[var(--text-faint)]">
              <div className="text-4xl mb-2">🚚</div>
              <p>Select a dispatch or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
