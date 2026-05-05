'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Transfer {
  id: string;
  transferNumber: string;
  vehicleId: string;
  fromBranchName: string;
  toBranchName: string;
  transferDate: string;
  requestedBy: string;
  approvedBy: string;
  mileageAtTransfer: number;
  fuelLevelAtTransfer: number;
  reason: string;
  notes: string;
  status: string;
}

const EMPTY_FORM: Omit<Transfer, 'id' | 'transferNumber' | 'status'> = {
  vehicleId: '',
  fromBranchName: '',
  toBranchName: '',
  transferDate: '',
  requestedBy: '',
  approvedBy: '',
  mileageAtTransfer: 0,
  fuelLevelAtTransfer: 0,
  reason: '',
  notes: '',
};

const badge = (text: string, color: string) => (
  <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${color}`}>{text}</span>
);

const statusColor: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  APPROVED: 'bg-blue-500/20 text-blue-400',
  COMPLETED: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-slate-700 text-slate-300',
};

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const res = await fetch(`/api/fleet/transfers?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch transfers');
      const data = await res.json();
      setTransfers(data.data ?? data.items ?? (Array.isArray(data) ? data : []));
      setTotalPages(data.totalPages ?? 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const openCreate = () => {
    setFormData({ ...EMPTY_FORM });
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.vehicleId.trim()) { setFormError('Vehicle ID is required'); return; }
    if (!formData.toBranchName.trim()) { setFormError('Destination branch is required'); return; }
    if (!formData.transferDate) { setFormError('Transfer date is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/fleet/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, status: 'PENDING' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Save failed');
      }
      setShowModal(false);
      fetchTransfers();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/fleet/transfers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Status update failed');
      fetchTransfers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const inputCls = 'bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none w-full';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fleet Transfers</h1>
          <p className="text-slate-400 text-sm mt-1">Manage inter-branch vehicle transfers</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
        >
          + New Transfer
        </button>
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
          placeholder="Search transfer number, vehicle, branch..."
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
          <option>PENDING</option>
          <option>APPROVED</option>
          <option>COMPLETED</option>
          <option>CANCELLED</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Transfer No.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">From Branch</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">To Branch</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Transfer Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Requested By</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Approved By</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Mileage (km)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Fuel (%)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">Loading transfers...</td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">No transfers found</td>
                </tr>
              ) : (
                transfers.map(tr => (
                  <tr key={tr.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-mono text-orange-400 font-medium">{tr.transferNumber}</td>
                    <td className="px-4 py-3 text-white">{tr.vehicleId}</td>
                    <td className="px-4 py-3 text-slate-300">{tr.fromBranchName || '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{tr.toBranchName}</td>
                    <td className="px-4 py-3 text-slate-300">{tr.transferDate ? new Date(tr.transferDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{tr.requestedBy || '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{tr.approvedBy || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{tr.mileageAtTransfer?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{tr.fuelLevelAtTransfer != null ? `${tr.fuelLevelAtTransfer}%` : '—'}</td>
                    <td className="px-4 py-3 text-center">{badge(tr.status, statusColor[tr.status] ?? 'bg-slate-700 text-slate-300')}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {tr.status === 'PENDING' && (
                          <button
                            onClick={() => handleStatusChange(tr.id, 'APPROVED')}
                            disabled={actionLoading === tr.id}
                            className="px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg text-xs text-blue-400 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === tr.id ? '...' : 'Approve'}
                          </button>
                        )}
                        {tr.status === 'APPROVED' && (
                          <button
                            onClick={() => handleStatusChange(tr.id, 'COMPLETED')}
                            disabled={actionLoading === tr.id}
                            className="px-3 py-1 bg-green-500/20 hover:bg-green-500/30 rounded-lg text-xs text-green-400 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === tr.id ? '...' : 'Complete'}
                          </button>
                        )}
                        {(tr.status === 'PENDING' || tr.status === 'APPROVED') && (
                          <button
                            onClick={() => handleStatusChange(tr.id, 'CANCELLED')}
                            disabled={actionLoading === tr.id}
                            className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs text-red-400 transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                        {(tr.status === 'COMPLETED' || tr.status === 'CANCELLED') && (
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
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">New Transfer</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-5 space-y-6">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {formError}
                </div>
              )}

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Transfer Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Vehicle ID *</label>
                    <input type="text" value={formData.vehicleId} onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))} className={inputCls} placeholder="e.g. VH-001" />
                  </div>
                  <div>
                    <label className={labelCls}>Transfer Date *</label>
                    <input type="date" value={formData.transferDate} onChange={e => setFormData(f => ({ ...f, transferDate: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>From Branch</label>
                    <input type="text" value={formData.fromBranchName} onChange={e => setFormData(f => ({ ...f, fromBranchName: e.target.value }))} className={inputCls} placeholder="Origin branch name" />
                  </div>
                  <div>
                    <label className={labelCls}>To Branch *</label>
                    <input type="text" value={formData.toBranchName} onChange={e => setFormData(f => ({ ...f, toBranchName: e.target.value }))} className={inputCls} placeholder="Destination branch name" />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Personnel</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Requested By</label>
                    <input type="text" value={formData.requestedBy} onChange={e => setFormData(f => ({ ...f, requestedBy: e.target.value }))} className={inputCls} placeholder="Name" />
                  </div>
                  <div>
                    <label className={labelCls}>Approved By</label>
                    <input type="text" value={formData.approvedBy} onChange={e => setFormData(f => ({ ...f, approvedBy: e.target.value }))} className={inputCls} placeholder="Name" />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Vehicle Condition</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Mileage at Transfer (km)</label>
                    <input type="number" value={formData.mileageAtTransfer} onChange={e => setFormData(f => ({ ...f, mileageAtTransfer: Number(e.target.value) }))} className={inputCls} min={0} />
                  </div>
                  <div>
                    <label className={labelCls}>Fuel Level at Transfer (%)</label>
                    <input type="number" value={formData.fuelLevelAtTransfer} onChange={e => setFormData(f => ({ ...f, fuelLevelAtTransfer: Number(e.target.value) }))} className={inputCls} min={0} max={100} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Additional Info</p>
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Reason</label>
                    <input type="text" value={formData.reason} onChange={e => setFormData(f => ({ ...f, reason: e.target.value }))} className={inputCls} placeholder="Reason for transfer" />
                  </div>
                  <div>
                    <label className={labelCls}>Notes</label>
                    <textarea value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} className={`${inputCls} resize-none h-16`} placeholder="Additional notes..." />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all">
                {saving ? 'Creating...' : 'Create Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
