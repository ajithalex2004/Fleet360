'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const DOMAINS = ['ALL', 'FLEET', 'AMBULANCE', 'SCHOOL_BUS', 'RAC', 'LOGISTICS', 'FIELD_SERVICE', 'GENERAL'];
const STATUSES = ['All', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'];

interface Asset {
  id: string;
  asset_no: string;
  name: string;
  category_id: string;
  category_name?: string;
  domain: string;
  oem_part_number?: string;
  unit_of_measure?: string;
  current_stock: number;
  reorder_threshold: number;
  reorder_quantity?: number;
  stock_status: string;
  unit_cost_aed: number;
  total_value_aed: number;
  warehouse_location?: string;
  bin_location?: string;
  is_serialized?: boolean;
  is_restricted?: boolean;
  requires_calibration?: boolean;
  is_ble_tracked?: boolean;
  manufacturer?: string;
  model?: string;
  asset_type?: string;
  notes?: string;
}

interface Category { id: string; name: string; domain?: string; }

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    IN_STOCK: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    LOW_STOCK: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    OUT_OF_STOCK: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return map[status] ?? 'bg-slate-700 text-slate-400 border-slate-600';
};

function StockBar({ current, threshold }: { current: number; threshold: number }) {
  const pct = threshold > 0 ? Math.min(100, Math.round((current / threshold) * 100)) : 0;
  const color = pct <= 0 ? 'bg-red-500' : pct < 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500">{current}</span>
    </div>
  );
}

const EMPTY_FORM = {
  name: '', asset_no: '', domain: 'GENERAL', asset_type: '', category_id: '',
  oem_part_number: '', manufacturer: '', model: '', unit_of_measure: 'PCS',
  reorder_threshold: 5, reorder_quantity: 10, current_stock: 0, unit_cost_aed: 0,
  warehouse_location: '', bin_location: '', is_serialized: false, is_restricted: false,
  requires_calibration: false, is_ble_tracked: false, notes: '',
};

export default function AssetRegistryPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState('ALL');
  const [status, setStatus] = useState('All');
  const [catFilter, setCatFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ar, cr] = await Promise.all([
        fetch('/api/assets/registry?tenantId=default'),
        fetch('/api/assets/categories?tenantId=default'),
      ]);
      const ad = await ar.json(); const cd = await cr.json();
      setAssets(Array.isArray(ad) ? ad : ad.data ?? []);
      setCategories(Array.isArray(cd) ? cd : cd.data ?? []);
    } catch { setError('Failed to load assets'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditAsset(null);
    setForm({ ...EMPTY_FORM, asset_no: `AST-${Date.now()}` });
    setShowModal(true);
  };

  const openEdit = (a: Asset) => {
    setEditAsset(a);
    setForm({
      name: a.name, asset_no: a.asset_no, domain: a.domain, asset_type: a.asset_type ?? '',
      category_id: a.category_id ?? '', oem_part_number: a.oem_part_number ?? '',
      manufacturer: a.manufacturer ?? '', model: a.model ?? '',
      unit_of_measure: a.unit_of_measure ?? 'PCS',
      reorder_threshold: a.reorder_threshold, reorder_quantity: a.reorder_quantity ?? 10,
      current_stock: a.current_stock, unit_cost_aed: a.unit_cost_aed,
      warehouse_location: a.warehouse_location ?? '', bin_location: a.bin_location ?? '',
      is_serialized: a.is_serialized ?? false, is_restricted: a.is_restricted ?? false,
      requires_calibration: a.requires_calibration ?? false, is_ble_tracked: a.is_ble_tracked ?? false,
      notes: a.notes ?? '',
    });
    setShowModal(true);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      let res;
      if (editAsset) {
        res = await fetch(`/api/assets/registry/${editAsset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, tenantId: 'default' }),
        });
      } else {
        res = await fetch('/api/assets/registry?tenantId=default', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, tenantId: 'default' }),
        });
      }
      if (!res.ok) throw new Error('Save failed');
      showToast(editAsset ? 'Asset updated!' : 'Asset created!');
      setShowModal(false);
      load();
    } catch { showToast('Error saving asset'); }
    setSubmitting(false);
  };

  const filtered = assets.filter(a => {
    const q = search.toLowerCase();
    if (q && !a.name.toLowerCase().includes(q) && !a.asset_no.toLowerCase().includes(q)) return false;
    if (domain !== 'ALL' && a.domain !== domain) return false;
    if (status !== 'All' && a.stock_status !== status) return false;
    if (catFilter && a.category_id !== catFilter) return false;
    return true;
  });

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
        <div><h1 className="text-2xl font-bold text-white">Asset Catalog</h1><p className="text-slate-400 text-sm">Manage all assets across domains</p></div>
        <button onClick={openAdd} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition-colors">+ Add Asset</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or asset no..." className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 w-64" />
        <select value={domain} onChange={e => setDomain(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          {DOMAINS.map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['Asset No', 'Name', 'Category', 'Domain', 'OEM Part #', 'Unit', 'Stock', 'Reorder', 'Status', 'Unit Cost', 'Total Value', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                  <div className="text-4xl mb-2">📦</div>
                  <p>No assets found</p>
                </td></tr>
              ) : filtered.map(a => (
                <tr key={a.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 text-yellow-300 font-mono text-xs">{a.asset_no}</td>
                  <td className="px-4 py-3 text-white font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-slate-400">{a.category_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{a.domain}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{a.oem_part_number ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{a.unit_of_measure ?? '—'}</td>
                  <td className="px-4 py-3"><StockBar current={a.current_stock} threshold={a.reorder_threshold} /></td>
                  <td className="px-4 py-3 text-slate-400">{a.reorder_threshold}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${statusBadge(a.stock_status)}`}>{a.stock_status?.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{a.unit_cost_aed?.toFixed(2)}</td>
                  <td className="px-4 py-3 text-yellow-300 font-medium">{(a.total_value_aed ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <button onClick={() => openEdit(a)} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded">Edit</button>
                    <Link href={`/assets/timeline?asset_id=${a.id}`} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded">Timeline</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-white/8">
              <h2 className="text-white font-semibold">{editAsset ? 'Edit Asset' : 'Add New Asset'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {[
                { label: 'Asset Name*', key: 'name', type: 'text', full: true },
                { label: 'Asset No', key: 'asset_no', type: 'text' },
                { label: 'OEM Part #', key: 'oem_part_number', type: 'text' },
                { label: 'Manufacturer', key: 'manufacturer', type: 'text' },
                { label: 'Model', key: 'model', type: 'text' },
                { label: 'Asset Type', key: 'asset_type', type: 'text' },
                { label: 'Unit of Measure', key: 'unit_of_measure', type: 'text' },
                { label: 'Current Stock', key: 'current_stock', type: 'number' },
                { label: 'Reorder Threshold', key: 'reorder_threshold', type: 'number' },
                { label: 'Reorder Quantity', key: 'reorder_quantity', type: 'number' },
                { label: 'Unit Cost AED', key: 'unit_cost_aed', type: 'number' },
                { label: 'Warehouse Location', key: 'warehouse_location', type: 'text' },
                { label: 'Bin Location', key: 'bin_location', type: 'text' },
              ].map(f => (
                <div key={f.key} className={f.full ? 'col-span-2' : ''}>
                  <label className="block text-xs text-slate-400 mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={(form as Record<string, unknown>)[f.key] as string}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Domain</label>
                <select value={form.domain} onChange={e => setForm(p => ({ ...p, domain: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  {DOMAINS.filter(d => d !== 'ALL').map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Category</label>
                <select value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">— Select —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-3">
                {[
                  { label: 'Serialized', key: 'is_serialized' },
                  { label: 'Restricted', key: 'is_restricted' },
                  { label: 'Requires Calibration', key: 'requires_calibration' },
                  { label: 'BLE Tracked', key: 'is_ble_tracked' },
                ].map(cb => (
                  <label key={cb.key} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={(form as Record<string, unknown>)[cb.key] as boolean} onChange={e => setForm(p => ({ ...p, [cb.key]: e.target.checked }))} className="w-4 h-4 rounded" />
                    {cb.label}
                  </label>
                ))}
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-6 border-t border-white/8">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={submit} disabled={submitting} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                {submitting ? 'Saving...' : editAsset ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
