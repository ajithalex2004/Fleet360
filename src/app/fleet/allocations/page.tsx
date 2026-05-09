'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Allocation {
  id: string;
  vehicleId: string;
  allocatedToType: string;
  allocatedToId: string;
  allocatedToName: string;
  allocationDate: string;
  expectedReturnDate: string;
  actualReturnDate: string;
  purpose: string;
  authorizedBy: string;
  mileageAtAllocation: number;
  mileageAtReturn: number;
  status: string;
  notes: string;
}

const EMPTY_FORM: Omit<Allocation, 'id' | 'actualReturnDate' | 'mileageAtReturn' | 'status'> = {
  vehicleId: '',
  allocatedToType: 'DEPARTMENT',
  allocatedToId: '',
  allocatedToName: '',
  allocationDate: '',
  expectedReturnDate: '',
  purpose: '',
  authorizedBy: '',
  mileageAtAllocation: 0,
  notes: '',
};

const EMPTY_RETURN = {
  actualReturnDate: '',
  mileageAtReturn: 0,
};

const badge = (text: string, color: string) => (
  <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${color}`}>{text}</span>
);

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-amber-500/20 text-amber-400',
  RETURNED: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-slate-700 text-slate-300',
};

export default function AllocationsPage() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState({ totalActive: 0, returnsToday: 0, overdue: 0, available: 0 });

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Return modal
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnData, setReturnData] = useState({ ...EMPTY_RETURN });
  const [returnError, setReturnError] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);

  const now = new Date();

  const fetchAllocations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const res = await fetch(`/api/fleet/allocations?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch allocations');
      const data = await res.json();
      const items: Allocation[] = data.data ?? data.items ?? (Array.isArray(data) ? data : []);
      setAllocations(items);
      setTotalPages(data.totalPages ?? 1);

      // Compute stats
      const active = items.filter(a => a.status === 'ACTIVE');
      const today = now.toISOString().slice(0, 10);
      const returnsToday = active.filter(a => a.expectedReturnDate?.slice(0, 10) === today).length;
      const overdue = active.filter(a => a.expectedReturnDate && new Date(a.expectedReturnDate) < now).length;
      setStats({
        totalActive: active.length,
        returnsToday,
        overdue,
        available: data.availableVehicles ?? 0,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    fetchAllocations();
  }, [fetchAllocations]);

  const openCreate = () => {
    setFormData({ ...EMPTY_FORM });
    setFormError('');
    setShowCreateModal(true);
  };

  const openReturn = (alloc: Allocation) => {
    setReturningId(alloc.id);
    setReturnData({ ...EMPTY_RETURN });
    setReturnError('');
    setShowReturnModal(true);
  };

  const handleSaveAllocation = async () => {
    setFormError('');
    if (!formData.vehicleId.trim()) { setFormError('Vehicle ID is required'); return; }
    if (!formData.allocationDate) { setFormError('Allocation date is required'); return; }
    if (!formData.allocatedToName.trim()) { setFormError('Allocated To Name is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/fleet/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, status: 'ACTIVE' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Save failed');
      }
      setShowCreateModal(false);
      fetchAllocations();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReturn = async () => {
    setReturnError('');
    if (!returnData.actualReturnDate) { setReturnError('Return date is required'); return; }
    setReturnSaving(true);
    try {
      const res = await fetch(`/api/fleet/allocations/${returningId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...returnData, status: 'RETURNED' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Return failed');
      }
      setShowReturnModal(false);
      fetchAllocations();
    } catch (err: unknown) {
      setReturnError(err instanceof Error ? err.message : 'Return failed');
    } finally {
      setReturnSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this allocation?')) return;
    try {
      const res = await fetch(`/api/fleet/allocations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (!res.ok) throw new Error('Cancel failed');
      fetchAllocations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  const isOverdue = (alloc: Allocation) =>
    alloc.status === 'ACTIVE' && alloc.expectedReturnDate && new Date(alloc.expectedReturnDate) < now;

  const inputCls = 'bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none w-full';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fleet Allocations</h1>
          <p className="text-slate-400 text-sm mt-1">Manage vehicle assignments and returns</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
        >
          + New Allocation
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800/40 border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">Total Active</p>
          <p className="text-2xl font-bold text-amber-400">{stats.totalActive}</p>
        </div>
        <div className="bg-slate-800/40 border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">Expected Returns Today</p>
          <p className="text-2xl font-bold text-blue-400">{stats.returnsToday}</p>
        </div>
        <div className="bg-slate-800/40 border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">Overdue</p>
          <p className="text-2xl font-bold text-red-400">{stats.overdue}</p>
        </div>
        <div className="bg-slate-800/40 border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">Available Vehicles</p>
          <p className="text-2xl font-bold text-green-400">{stats.available}</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-4">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search vehicle, name, purpose..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none flex-1 min-w-[200px] placeholder-slate-500"
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option>ACTIVE</option>
          <option>RETURNED</option>
          <option>CANCELLED</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Allocated To</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Purpose</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Allocation Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Expected Return</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Actual Return</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Mileage (Alloc)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Mileage (Return)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-slate-500">Loading allocations...</td>
                </tr>
              ) : allocations.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-slate-500">No allocations found</td>
                </tr>
              ) : (
                allocations.map(alloc => (
                  <tr
                    key={alloc.id}
                    className={`transition-colors ${isOverdue(alloc) ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-white/5'}`}
                  >
                    <td className="px-4 py-3 text-orange-400 font-medium">{alloc.vehicleId}</td>
                    <td className="px-4 py-3">
                      <div className="text-white text-sm">{alloc.allocatedToName}</div>
                      <div className="text-slate-500 text-xs">{alloc.allocatedToType}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300 max-w-xs truncate" title={alloc.purpose}>{alloc.purpose || '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{alloc.allocationDate ? new Date(alloc.allocationDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={isOverdue(alloc) ? 'text-red-400 font-medium' : 'text-slate-300'}>
                        {alloc.expectedReturnDate ? new Date(alloc.expectedReturnDate).toLocaleDateString() : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{alloc.actualReturnDate ? new Date(alloc.actualReturnDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{alloc.mileageAtAllocation?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{alloc.mileageAtReturn ? alloc.mileageAtReturn.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-center">{badge(alloc.status, statusColor[alloc.status] ?? 'bg-slate-700 text-slate-300')}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {alloc.status === 'ACTIVE' && (
                          <>
                            <button
                              onClick={() => openReturn(alloc)}
                              className="px-3 py-1 bg-green-500/20 hover:bg-green-500/30 rounded-lg text-xs text-green-400 transition-colors"
                            >
                              Return
                            </button>
                            <button
                              onClick={() => handleCancel(alloc.id)}
                              className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs text-red-400 transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {alloc.status !== 'ACTIVE' && (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-xs text-white transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-xs text-white transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">New Allocation</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-5 space-y-6">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {formError}
                </div>
              )}

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Vehicle & Assignee</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Vehicle ID *</label>
                    <input type="text" value={formData.vehicleId} onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))} className={inputCls} placeholder="e.g. VH-001" />
                  </div>
                  <div>
                    <label className={labelCls}>Allocated To Type</label>
                    <select value={formData.allocatedToType} onChange={e => setFormData(f => ({ ...f, allocatedToType: e.target.value }))} className={inputCls}>
                      <option>DEPARTMENT</option>
                      <option>EMPLOYEE</option>
                      <option>PROJECT</option>
                      <option>BRANCH</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Allocated To ID</label>
                    <input type="text" value={formData.allocatedToId} onChange={e => setFormData(f => ({ ...f, allocatedToId: e.target.value }))} className={inputCls} placeholder="ID or code" />
                  </div>
                  <div>
                    <label className={labelCls}>Allocated To Name *</label>
                    <input type="text" value={formData.allocatedToName} onChange={e => setFormData(f => ({ ...f, allocatedToName: e.target.value }))} className={inputCls} placeholder="Full name or department name" />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Dates</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Allocation Date *</label>
                    <input type="date" value={formData.allocationDate} onChange={e => setFormData(f => ({ ...f, allocationDate: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Expected Return Date</label>
                    <input type="date" value={formData.expectedReturnDate} onChange={e => setFormData(f => ({ ...f, expectedReturnDate: e.target.value }))} className={inputCls} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Purpose</label>
                    <input type="text" value={formData.purpose} onChange={e => setFormData(f => ({ ...f, purpose: e.target.value }))} className={inputCls} placeholder="Reason for allocation" />
                  </div>
                  <div>
                    <label className={labelCls}>Authorized By</label>
                    <input type="text" value={formData.authorizedBy} onChange={e => setFormData(f => ({ ...f, authorizedBy: e.target.value }))} className={inputCls} placeholder="Manager name" />
                  </div>
                  <div>
                    <label className={labelCls}>Mileage at Allocation (km)</label>
                    <input type="number" value={formData.mileageAtAllocation} onChange={e => setFormData(f => ({ ...f, mileageAtAllocation: Number(e.target.value) }))} className={inputCls} min={0} />
                  </div>
                </div>
                <div className="mt-4">
                  <label className={labelCls}>Notes</label>
                  <textarea value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} className={`${inputCls} resize-none h-16`} placeholder="Additional notes..." />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={handleSaveAllocation} disabled={saving} className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all">
                {saving ? 'Creating...' : 'Create Allocation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">Process Vehicle Return</h2>
              <button onClick={() => setShowReturnModal(false)} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {returnError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {returnError}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Return Details</p>
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Actual Return Date *</label>
                    <input type="date" value={returnData.actualReturnDate} onChange={e => setReturnData(d => ({ ...d, actualReturnDate: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Mileage at Return (km)</label>
                    <input type="number" value={returnData.mileageAtReturn} onChange={e => setReturnData(d => ({ ...d, mileageAtReturn: Number(e.target.value) }))} className={inputCls} min={0} />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={() => setShowReturnModal(false)} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={handleReturn} disabled={returnSaving} className="px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all">
                {returnSaving ? 'Processing...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
