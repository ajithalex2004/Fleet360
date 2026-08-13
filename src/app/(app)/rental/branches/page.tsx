'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Branch {
  id: string;
  branchCode: string;
  branchName: string;
  emirate: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  managerName: string | null;
  operatingHours: string;
  vehicleCapacity: number;
  status: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  active: number;
  emiratesCovered: number;
  totalCapacity: number;
}

const EMIRATES = [
  { key: 'DUBAI',          label: 'Dubai',            flag: '🏙️' },
  { key: 'ABU_DHABI',      label: 'Abu Dhabi',        flag: '🏛️' },
  { key: 'SHARJAH',        label: 'Sharjah',          flag: '🕌' },
  { key: 'AJMAN',          label: 'Ajman',            flag: '⛵' },
  { key: 'RAS_AL_KHAIMAH', label: 'Ras Al Khaimah',   flag: '⛰️' },
  { key: 'FUJAIRAH',       label: 'Fujairah',         flag: '🌊' },
  { key: 'UMM_AL_QUWAIN',  label: 'Umm Al Quwain',   flag: '🌿' },
];

const EMIRATE_MAP = Object.fromEntries(EMIRATES.map(e => [e.key, e]));

const emptyForm = {
  branchName: '', emirate: 'DUBAI', address: '', phone: '', email: '',
  managerName: '', operatingHours: '8:00 AM - 8:00 PM',
  vehicleCapacity: '0', notes: '',
};

export default function BranchesPage() {
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [stats, setStats]         = useState<Stats | null>(null);
  const [viewMode, setViewMode]   = useState<'grid' | 'table'>('grid');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [saving, setSaving]       = useState(false);
  const [formData, setFormData]   = useState(emptyForm);
  const [search, setSearch]       = useState('');
  const [emirateFilter, setEmirateFilter] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (emirateFilter !== 'ALL') params.set('emirate', emirateFilter);
      if (search)                  params.set('search', search);
      const res  = await fetch(`/api/rental/branches?${params}`);
      const data = await res.json();
      setBranches(data.branches ?? []);
      setStats(data.stats ?? null);
    } catch {
      setError('Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [emirateFilter, search]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditBranch(null);
    setFormData(emptyForm);
    setShowModal(true);
  };

  const openEdit = (b: Branch) => {
    setEditBranch(b);
    setFormData({
      branchName:     b.branchName,
      emirate:        b.emirate,
      address:        b.address ?? '',
      phone:          b.phone ?? '',
      email:          b.email ?? '',
      managerName:    b.managerName ?? '',
      operatingHours: b.operatingHours,
      vehicleCapacity: String(b.vehicleCapacity),
      notes:          b.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        branchName:     formData.branchName,
        emirate:        formData.emirate,
        address:        formData.address || null,
        phone:          formData.phone || null,
        email:          formData.email || null,
        managerName:    formData.managerName || null,
        operatingHours: formData.operatingHours,
        vehicleCapacity: Number(formData.vehicleCapacity || 0),
        notes:          formData.notes || null,
      };

      let res: Response;
      if (editBranch) {
        res = await fetch('/api/rental/branches', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editBranch.id, ...payload }),
        });
      } else {
        res = await fetch('/api/rental/branches', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save');
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save branch');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (b: Branch) => {
    const newStatus = b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!confirm(`Set branch "${b.branchName}" to ${newStatus}?`)) return;
    try {
      await fetch('/api/rental/branches', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.id, status: newStatus }),
      });
      load();
    } catch {
      setError('Failed to update branch status');
    }
  };

  const inputCls = 'w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm';
  const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Branch Management</h1>
          <p className="text-slate-400">Manage RAC branches across all UAE emirates</p>
        </div>
        <button
          onClick={openNew}
          className="rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          + Add Branch
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Branches',     value: stats.total,           color: 'text-white',       icon: '🏢' },
            { label: 'Active Branches',    value: stats.active,          color: 'text-emerald-400', icon: '✅' },
            { label: 'Emirates Covered',   value: stats.emiratesCovered, color: 'text-teal-400',    icon: '🗺️' },
            { label: 'Total Capacity',     value: `${stats.totalCapacity} vehicles`, color: 'text-cyan-400', icon: '🚗', raw: true },
          ].map(({ label, value, color, icon, raw }) => (
            <div key={label} className="bg-slate-800/60 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{icon}</span>
                <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
              </div>
              <p className={`text-3xl font-bold ${color}`}>
                {raw ? value : value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Emirate Filter */}
          <select
            value={emirateFilter}
            onChange={e => setEmirateFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/10 text-sm text-white focus:border-teal-500 focus:outline-none"
          >
            <option value="ALL">All Emirates</option>
            {EMIRATES.map(em => (
              <option key={em.key} value={em.key}>{em.flag} {em.label}</option>
            ))}
          </select>

          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search branches..."
            className="px-4 py-1.5 rounded-lg bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm w-52"
          />
        </div>

        {/* View Toggle */}
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'grid' ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            ▦ Grid
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'table' ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            ≡ Table
          </button>
        </div>
      </div>

      {/* Grid View */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 animate-pulse">Loading branches...</div>
      ) : branches.length === 0 ? (
        <div className="text-center text-slate-400 py-16 bg-slate-800/50 border border-white/10 rounded-2xl">
          No branches found. Add your first branch to get started.
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {branches.map(b => {
            const em = EMIRATE_MAP[b.emirate];
            const isActive = b.status === 'ACTIVE';
            return (
              <div
                key={b.id}
                className={`bg-slate-800/60 border rounded-2xl p-6 backdrop-blur-sm transition-all hover:border-teal-500/30 ${
                  isActive ? 'border-white/10' : 'border-white/5 opacity-60'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{em?.flag ?? '🏢'}</span>
                    <div>
                      <h3 className="text-white font-semibold text-lg leading-tight">{b.branchName}</h3>
                      <span className="inline-block px-2 py-0.5 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-full text-xs font-mono mt-0.5">
                        {b.branchCode}
                      </span>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    isActive
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                  }`}>
                    {b.status}
                  </span>
                </div>

                {/* Emirate */}
                <div className="text-sm text-slate-400 mb-3">{em?.label ?? b.emirate}</div>

                {/* Details */}
                <div className="space-y-2 text-sm">
                  {b.address && (
                    <div className="flex gap-2">
                      <span className="text-slate-500 flex-shrink-0">📍</span>
                      <span className="text-slate-300">{b.address}</span>
                    </div>
                  )}
                  {b.phone && (
                    <div className="flex gap-2">
                      <span className="text-slate-500 flex-shrink-0">📞</span>
                      <span className="text-slate-300">{b.phone}</span>
                    </div>
                  )}
                  {b.managerName && (
                    <div className="flex gap-2">
                      <span className="text-slate-500 flex-shrink-0">👤</span>
                      <span className="text-slate-300">{b.managerName}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="text-slate-500 flex-shrink-0">🕐</span>
                    <span className="text-slate-300">{b.operatingHours}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 flex-shrink-0">🚗</span>
                    <span className="text-slate-300">{b.vehicleCapacity} vehicle capacity</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-5 pt-4 border-t border-white/5">
                  <button
                    onClick={() => openEdit(b)}
                    className="flex-1 text-sm py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleStatus(b)}
                    className={`flex-1 text-sm py-1.5 rounded-lg border ${
                      isActive
                        ? 'bg-slate-500/20 text-slate-400 border-slate-500/30 hover:bg-slate-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                    }`}
                  >
                    {isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Branch Code', 'Name', 'Emirate', 'Address', 'Manager', 'Phone', 'Capacity', 'Hours', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branches.map(b => {
                  const em = EMIRATE_MAP[b.emirate];
                  const isActive = b.status === 'ACTIVE';
                  return (
                    <tr key={b.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-teal-400 whitespace-nowrap">{b.branchCode}</td>
                      <td className="px-4 py-3 text-sm font-medium text-white whitespace-nowrap">{b.branchName}</td>
                      <td className="px-4 py-3 text-sm text-white whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <span>{em?.flag ?? '🏢'}</span>
                          <span>{em?.label ?? b.emirate}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300 max-w-[180px] truncate">{b.address ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{b.managerName ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{b.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-white whitespace-nowrap text-center">{b.vehicleCapacity}</td>
                      <td className="px-4 py-3 text-xs text-slate-300 whitespace-nowrap">{b.operatingHours}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${
                          isActive
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                        }`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEdit(b)}
                            className="text-xs px-2.5 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleStatus(b)}
                            className={`text-xs px-2.5 py-1 rounded border ${
                              isActive
                                ? 'bg-slate-500/20 text-slate-400 border-slate-500/30 hover:bg-slate-500/30'
                                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                            }`}
                          >
                            {isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Branch Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">
                {editBranch ? 'Edit Branch' : 'Add New Branch'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Branch Name *</label>
                  <input
                    type="text" required placeholder="e.g. Dubai Marina Branch"
                    value={formData.branchName}
                    onChange={e => setFormData(p => ({ ...p, branchName: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Emirate *</label>
                  <select
                    required value={formData.emirate}
                    onChange={e => setFormData(p => ({ ...p, emirate: e.target.value }))}
                    className={inputCls}
                  >
                    {EMIRATES.map(em => (
                      <option key={em.key} value={em.key}>{em.flag} {em.label}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className={labelCls}>Address</label>
                  <input
                    type="text" placeholder="Full branch address"
                    value={formData.address}
                    onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Phone</label>
                  <input
                    type="text" placeholder="+971 4 XXX XXXX"
                    value={formData.phone}
                    onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input
                    type="email" placeholder="branch@company.com"
                    value={formData.email}
                    onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Manager Name</label>
                  <input
                    type="text" placeholder="Branch manager full name"
                    value={formData.managerName}
                    onChange={e => setFormData(p => ({ ...p, managerName: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Operating Hours</label>
                  <input
                    type="text" placeholder="8:00 AM - 8:00 PM"
                    value={formData.operatingHours}
                    onChange={e => setFormData(p => ({ ...p, operatingHours: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Vehicle Capacity</label>
                  <input
                    type="number" min="0" placeholder="0"
                    value={formData.vehicleCapacity}
                    onChange={e => setFormData(p => ({ ...p, vehicleCapacity: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div className="col-span-1" />

                <div className="col-span-2">
                  <label className={labelCls}>Notes</label>
                  <textarea
                    rows={3} placeholder="Additional notes..."
                    value={formData.notes}
                    onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>

              <div className="flex gap-4 justify-end pt-2">
                <button
                  type="button" onClick={() => setShowModal(false)}
                  className="px-6 py-2.5 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? 'Saving...' : editBranch ? 'Update Branch' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
