'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface MedicalAsset {
  id: string;
  asset_no: string;
  name: string;
  asset_type?: string;
  category?: string;
  is_restricted?: boolean;
  controlled_substance_level?: number;
  batch_number?: string;
  lot_number?: string;
  manufacture_date?: string;
  expiry_date?: string;
  quantity: number;
  unit?: string;
  unit_cost_aed?: number;
  storage_requirement?: string;
  storage_location?: string;
  domain?: string;
  assigned_vehicle_id?: string;
  current_seal_no?: string;
  last_sealed_by?: string;
  last_sealed_at?: string;
  variance?: number;
  status?: string;
  seal_logs?: SealLog[];
}

interface SealLog {
  id: string;
  action: string;
  seal_no?: string;
  performed_by: string;
  performed_at: string;
  notes?: string;
}

function daysDiff(dateStr?: string) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

const TABS = ['Details', 'Seal & Audit', 'Seal Log'];
const DOMAINS = ['AMBULANCE', 'FLEET', 'SCHOOL_BUS', 'FIELD_SERVICE', 'GENERAL'];
const CONDITIONS_SEAL = ['SEALED', 'UNSEALED'];

const EMPTY_FORM: Partial<MedicalAsset> = {
  name: '', asset_type: '', category: '', is_restricted: false, controlled_substance_level: 0,
  batch_number: '', lot_number: '', manufacture_date: '', expiry_date: '', quantity: 0, unit: 'PCS',
  unit_cost_aed: 0, storage_requirement: '', storage_location: '', domain: 'AMBULANCE', assigned_vehicle_id: '',
};

export default function MedicalAssetsPage() {
  const [items, setItems] = useState<MedicalAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<MedicalAsset | null>(null);
  const [form, setForm] = useState<Partial<MedicalAsset>>({ ...EMPTY_FORM });
  const [tab, setTab] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [sealInput, setSealInput] = useState('');
  const [stockCount, setStockCount] = useState({ date: '', qty: 0 });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/medical?tenantId=default');
      const d = await r.json();
      setItems(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load medical assets'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditItem(null); setForm({ ...EMPTY_FORM }); setTab(0); setShowModal(true); };
  const openEdit = (m: MedicalAsset) => { setEditItem(m); setForm({ ...m }); setTab(0); setShowModal(true); };

  const submit = async () => {
    setSubmitting(true);
    try {
      let res;
      if (editItem) {
        res = await fetch(`/api/assets/medical/${editItem.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, tenantId: 'default' }) });
      } else {
        res = await fetch('/api/assets/medical?tenantId=default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, tenantId: 'default' }) });
      }
      if (!res.ok) throw new Error();
      showToast(editItem ? 'Medical asset updated!' : 'Medical asset created!');
      setShowModal(false); load();
    } catch { showToast('Error saving'); }
    setSubmitting(false);
  };

  const sealAction = async (action: 'seal' | 'unseal' | 'verify') => {
    if (!editItem) return;
    setSubmitting(true);
    try {
      await fetch(`/api/assets/medical/${editItem.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seal_action: action, seal_no: sealInput, tenantId: 'default' }),
      });
      showToast(`${action} successful!`); load();
    } catch { showToast('Action failed'); }
    setSubmitting(false);
  };

  const submitStockCount = async () => {
    if (!editItem) return;
    setSubmitting(true);
    try {
      await fetch(`/api/assets/medical/${editItem.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_count: stockCount, tenantId: 'default' }),
      });
      showToast('Stock count recorded!'); load();
    } catch { showToast('Failed to record count'); }
    setSubmitting(false);
  };

  const F = (key: keyof MedicalAsset, label: string, type = 'text') => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={(form[key] as string | number) ?? ''}
        onChange={e => setForm(p => ({ ...p, [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
        className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
      />
    </div>
  );

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Medical Assets</h1><p className="text-slate-400 text-sm">Controlled substance and medical supply tracking</p></div>
        <button onClick={openAdd} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">+ Add Medical Asset</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['Asset No', 'Name', 'Type', 'Batch', 'Expiry', 'Qty', 'Unit', 'Seal', 'Storage', 'Domain', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-3 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                  <div className="text-4xl mb-2">🏥</div><p>No medical assets registered yet.</p>
                </td></tr>
              ) : items.map(m => {
                const d = daysDiff(m.expiry_date);
                const expired = d !== null && d < 0;
                const expiring = d !== null && d >= 0 && d <= 30;
                return (
                  <tr key={m.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-3 py-3 text-yellow-300 font-mono text-xs">{m.asset_no}</td>
                    <td className="px-3 py-3 text-white font-medium">
                      {m.is_restricted && <span className="text-red-400 mr-1">🔒</span>}
                      {m.name}
                    </td>
                    <td className="px-3 py-3 text-slate-400">{m.asset_type ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-400 font-mono text-xs">{m.batch_number ?? '—'}</td>
                    <td className="px-3 py-3">
                      {expired
                        ? <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full text-xs">EXPIRED</span>
                        : expiring
                        ? <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full text-xs">EXPIRING {d}d</span>
                        : <span className="text-slate-400 text-xs">{m.expiry_date ? new Date(m.expiry_date).toLocaleDateString() : '—'}</span>}
                    </td>
                    <td className="px-3 py-3 text-slate-300 font-medium">{m.quantity}</td>
                    <td className="px-3 py-3 text-slate-400">{m.unit ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-400 font-mono text-xs">{m.current_seal_no ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-400">{m.storage_location ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-400">{m.domain ?? '—'}</td>
                    <td className="px-3 py-3">
                      {m.variance !== 0 && m.variance !== undefined && (
                        <span className="text-amber-400 text-xs mr-1">⚠️</span>
                      )}
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${m.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                        {m.status ?? 'ACTIVE'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => openEdit(m)} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded">Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-white/8 flex-shrink-0">
              <h2 className="text-white font-semibold">{editItem ? 'Edit Medical Asset' : 'Add Medical Asset'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex border-b border-white/8 flex-shrink-0">
              {TABS.map((t, i) => (
                <button key={t} onClick={() => setTab(i)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === i ? 'border-yellow-400 text-yellow-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{t}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {tab === 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {F('name', 'Name*')} {F('asset_type', 'Asset Type')}
                  {F('category', 'Category')}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Restricted</label>
                    <label className="flex items-center gap-2 mt-2">
                      <input type="checkbox" checked={form.is_restricted ?? false} onChange={e => setForm(p => ({ ...p, is_restricted: e.target.checked }))} />
                      <span className="text-sm text-slate-300">Is Restricted / Controlled</span>
                    </label>
                  </div>
                  {F('controlled_substance_level', 'Substance Level', 'number')}
                  {F('batch_number', 'Batch Number')} {F('lot_number', 'Lot Number')}
                  {F('manufacture_date', 'Manufacture Date', 'date')} {F('expiry_date', 'Expiry Date', 'date')}
                  {F('quantity', 'Quantity', 'number')} {F('unit', 'Unit')}
                  {F('unit_cost_aed', 'Unit Cost AED', 'number')} {F('storage_requirement', 'Storage Requirement')}
                  {F('storage_location', 'Storage Location')}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Domain</label>
                    <select value={form.domain ?? 'AMBULANCE'} onChange={e => setForm(p => ({ ...p, domain: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                      {DOMAINS.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  {F('assigned_vehicle_id', 'Assigned Vehicle ID')}
                </div>
              )}
              {tab === 1 && editItem && (
                <div className="space-y-6">
                  <div className="bg-slate-800/50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-400">Current Seal</span><span className="text-white font-mono">{editItem.current_seal_no ?? 'None'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Last Sealed By</span><span className="text-slate-300">{editItem.last_sealed_by ?? '—'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Last Sealed At</span><span className="text-slate-300">{editItem.last_sealed_at ? new Date(editItem.last_sealed_at).toLocaleString() : '—'}</span></div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Seal Number (for Seal action)</label>
                    <input value={sealInput} onChange={e => setSealInput(e.target.value)} placeholder="e.g. SEAL-001" className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mb-3" />
                    <div className="flex gap-2">
                      <button onClick={() => sealAction('seal')} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm">🔒 Seal</button>
                      <button onClick={() => sealAction('unseal')} className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-sm">🔓 Unseal</button>
                      <button onClick={() => sealAction('verify')} className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm">✓ Verify</button>
                    </div>
                  </div>
                  <div className="border-t border-white/8 pt-4">
                    <h3 className="text-white font-medium mb-3 text-sm">Stock Count</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Count Date</label>
                        <input type="date" value={stockCount.date} onChange={e => setStockCount(p => ({ ...p, date: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Actual Quantity</label>
                        <input type="number" value={stockCount.qty} onChange={e => setStockCount(p => ({ ...p, qty: parseFloat(e.target.value) || 0 }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                      </div>
                    </div>
                    {stockCount.qty !== editItem.quantity && stockCount.qty !== 0 && (
                      <p className="mt-2 text-sm text-amber-400">⚠️ Variance: {stockCount.qty - editItem.quantity} units (expected {editItem.quantity})</p>
                    )}
                    <button onClick={submitStockCount} disabled={submitting} className="mt-3 bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50">Record Count</button>
                  </div>
                </div>
              )}
              {tab === 1 && !editItem && (
                <p className="text-slate-500 text-sm">Save the asset first to manage seals and stock counts.</p>
              )}
              {tab === 2 && editItem && (
                <div className="space-y-3">
                  {(!editItem.seal_logs || editItem.seal_logs.length === 0) ? (
                    <div className="text-center text-slate-500 py-8">
                      <div className="text-4xl mb-2">🔒</div><p>No seal log entries yet.</p>
                    </div>
                  ) : editItem.seal_logs.map((l, i) => (
                    <div key={l.id ?? i} className="flex gap-3 items-start">
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs flex-shrink-0">{l.action === 'SEAL' ? '🔒' : l.action === 'UNSEAL' ? '🔓' : '✓'}</div>
                      <div className="flex-1 bg-slate-800/50 rounded-xl p-3 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white font-medium">{l.action}</span>
                          <span className="text-slate-500 text-xs">{new Date(l.performed_at).toLocaleString()}</span>
                        </div>
                        <p className="text-slate-400">By: {l.performed_by}</p>
                        {l.seal_no && <p className="text-slate-400">Seal: <span className="font-mono text-slate-300">{l.seal_no}</span></p>}
                        {l.notes && <p className="text-slate-400 mt-1">{l.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tab === 2 && !editItem && <p className="text-slate-500 text-sm">Save the asset first to see seal logs.</p>}
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/8 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              {tab === 0 && (
                <button onClick={submit} disabled={submitting} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                  {submitting ? 'Saving...' : editItem ? 'Update' : 'Create'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
