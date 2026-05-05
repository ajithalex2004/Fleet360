'use client';
import React, { useState, useEffect, useCallback } from 'react';

const DOMAINS = ['FLEET', 'AMBULANCE', 'SCHOOL_BUS', 'RAC', 'LOGISTICS', 'FIELD_SERVICE', 'GENERAL', 'ALL'];

interface Category {
  id: string;
  name: string;
  domain?: string;
  parent_id?: string;
  parent_name?: string;
  icon?: string;
  color?: string;
  description?: string;
  is_active?: boolean;
}

const EMPTY_FORM = {
  name: '', domain: 'GENERAL', parent_id: '', icon: '📦', color: '#6366f1', description: '',
};

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/categories?tenantId=default');
      const d = await r.json();
      setCategories(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load categories'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditCat(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (c: Category) => {
    setEditCat(c);
    setForm({ name: c.name, domain: c.domain ?? 'GENERAL', parent_id: c.parent_id ?? '', icon: c.icon ?? '📦', color: c.color ?? '#6366f1', description: c.description ?? '' });
    setShowModal(true);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const body = { ...form, tenantId: 'default' };
      let res;
      if (editCat) {
        res = await fetch(`/api/assets/categories`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editCat.id, ...body }) });
      } else {
        res = await fetch('/api/assets/categories?tenantId=default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      if (!res.ok) throw new Error();
      showToast(editCat ? 'Category updated!' : 'Category created!');
      setShowModal(false);
      load();
    } catch { showToast('Error saving category'); }
    setSubmitting(false);
  };

  // Build hierarchy: top-level first, then children indented
  const sorted = [...categories].sort((a, b) => {
    if (!a.parent_id && b.parent_id) return -1;
    if (a.parent_id && !b.parent_id) return 1;
    return a.name.localeCompare(b.name);
  });

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Categories</h1><p className="text-slate-400 text-sm">Asset category hierarchy</p></div>
        <button onClick={openAdd} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">+ Add Category</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 border-b border-white/8">
            <tr className="text-slate-400 text-xs uppercase">
              {['Name', 'Domain', 'Icon', 'Description', 'Active', 'Actions'].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sorted.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                <div className="text-4xl mb-2">🏷️</div><p>No categories yet. Add one to get started.</p>
              </td></tr>
            ) : sorted.map(c => (
              <tr key={c.id} className="hover:bg-white/3 transition-colors">
                <td className="px-4 py-3">
                  <span className={c.parent_id ? 'pl-6 text-slate-300' : 'text-white font-medium'}>
                    {c.parent_id && <span className="text-slate-600 mr-2">└</span>}
                    {c.name}
                  </span>
                  {c.parent_name && <span className="ml-2 text-xs text-slate-500">({c.parent_name})</span>}
                </td>
                <td className="px-4 py-3 text-slate-400">{c.domain ?? '—'}</td>
                <td className="px-4 py-3 text-xl">{c.icon ?? '📦'}</td>
                <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{c.description ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${c.is_active !== false ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(c)} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-white/8">
              <h2 className="text-white font-semibold">{editCat ? 'Edit Category' : 'New Category'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name*</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Domain</label>
                <select value={form.domain} onChange={e => setForm(p => ({ ...p, domain: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  {DOMAINS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Parent Category</label>
                <select value={form.parent_id} onChange={e => setForm(p => ({ ...p, parent_id: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">— None (top level) —</option>
                  {categories.filter(c => !c.parent_id && c.id !== editCat?.id).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Icon (emoji)</label>
                  <input value={form.icon} onChange={e => setForm(p => ({ ...p, icon: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Color</label>
                  <input type="color" value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} className="w-full h-10 bg-slate-800 border border-white/10 rounded-lg px-2" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/8">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={submit} disabled={submitting || !form.name} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                {submitting ? 'Saving...' : editCat ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
