'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface WorkOrder {
  id: string;
  woNumber: string;
  vehicleId: string;
  woType: string;
  status: string;
  priority: string;
  garageName: string;
  garageContact: string;
  scheduledDate: string;
  startDate: string;
  endDate: string;
  odometerAtEntry: number;
  authorizedPoAmount: number;
  actualCost: number;
  variance: number;
  varianceAlert: boolean;
  description: string;
  findings: string;
  actionsTaken: string;
  requestedBy: string;
  approvedBy: string;
  notes: string;
}

const EMPTY_FORM: Omit<WorkOrder, 'id' | 'woNumber' | 'variance' | 'varianceAlert'> = {
  vehicleId: '',
  woType: 'PREVENTIVE',
  status: 'DRAFT',
  priority: 'MEDIUM',
  garageName: '',
  garageContact: '',
  scheduledDate: '',
  startDate: '',
  endDate: '',
  odometerAtEntry: 0,
  authorizedPoAmount: 0,
  actualCost: 0,
  description: '',
  findings: '',
  actionsTaken: '',
  requestedBy: '',
  approvedBy: '',
  notes: '',
};

const badge = (text: string, color: string) => (
  <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${color}`}>{text}</span>
);

const statusColor: Record<string, string> = {
  DRAFT: 'bg-slate-700 text-slate-300',
  OPEN: 'bg-blue-500/20 text-blue-400',
  IN_PROGRESS: 'bg-amber-500/20 text-amber-400',
  COMPLETED: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-red-500/20 text-red-400',
};

const priorityColor: Record<string, string> = {
  HIGH: 'bg-red-500/20 text-red-400',
  MEDIUM: 'bg-amber-500/20 text-amber-400',
  LOW: 'bg-green-500/20 text-green-400',
};

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchWorkOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('woType', typeFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const res = await fetch(`/api/fleet/work-orders?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch work orders');
      const data = await res.json();
      setWorkOrders(data.data ?? data.items ?? (Array.isArray(data) ? data : []));
      setTotalPages(data.totalPages ?? Math.ceil((data.total ?? 1) / 20));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, page]);

  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  const openCreate = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (wo: WorkOrder) => {
    setEditingId(wo.id);
    setFormData({
      vehicleId: wo.vehicleId,
      woType: wo.woType,
      status: wo.status,
      priority: wo.priority,
      garageName: wo.garageName,
      garageContact: wo.garageContact,
      scheduledDate: wo.scheduledDate ?? '',
      startDate: wo.startDate ?? '',
      endDate: wo.endDate ?? '',
      odometerAtEntry: wo.odometerAtEntry,
      authorizedPoAmount: wo.authorizedPoAmount,
      actualCost: wo.actualCost,
      description: wo.description,
      findings: wo.findings,
      actionsTaken: wo.actionsTaken,
      requestedBy: wo.requestedBy,
      approvedBy: wo.approvedBy,
      notes: wo.notes,
    });
    setFormError('');
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this work order?')) return;
    try {
      const res = await fetch(`/api/fleet/work-orders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      fetchWorkOrders();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.vehicleId.trim()) { setFormError('Vehicle ID is required'); return; }
    setSaving(true);
    try {
      const variance = (formData.actualCost ?? 0) - (formData.authorizedPoAmount ?? 0);
      const payload = { ...formData, variance, varianceAlert: variance > 0 };
      let res: Response;
      if (editingId) {
        res = await fetch(`/api/fleet/work-orders/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/fleet/work-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Save failed');
      }
      setShowModal(false);
      fetchWorkOrders();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const computedVariance = (formData.actualCost ?? 0) - (formData.authorizedPoAmount ?? 0);

  const inputCls = 'bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none w-full';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fleet Work Orders</h1>
          <p className="text-slate-400 text-sm mt-1">Manage maintenance and repair work orders</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
        >
          + New Work Order
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
          placeholder="Search WO number, vehicle, garage..."
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
          <option>DRAFT</option>
          <option>OPEN</option>
          <option>IN_PROGRESS</option>
          <option>COMPLETED</option>
          <option>CANCELLED</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All Types</option>
          <option>PREVENTIVE</option>
          <option>CORRECTIVE</option>
          <option>ACCIDENT</option>
          <option>INSPECTION</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">WO Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Garage</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Scheduled Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Auth. PO (AED)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Actual Cost (AED)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Variance</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">Loading work orders...</td>
                </tr>
              ) : workOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">No work orders found</td>
                </tr>
              ) : (
                workOrders.map(wo => {
                  const v = wo.variance ?? (wo.actualCost - wo.authorizedPoAmount);
                  const varianceBadge = v > 0
                    ? badge('OVER', 'bg-red-500/20 text-red-400')
                    : v === 0
                    ? badge('OK', 'bg-green-500/20 text-green-400')
                    : badge('UNDER', 'bg-amber-500/20 text-amber-400');
                  return (
                    <tr key={wo.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 font-mono text-orange-400 font-medium">{wo.woNumber}</td>
                      <td className="px-4 py-3 text-white">{wo.vehicleId}</td>
                      <td className="px-4 py-3 text-slate-300">{wo.woType}</td>
                      <td className="px-4 py-3">{badge(wo.status, statusColor[wo.status] ?? 'bg-slate-700 text-slate-300')}</td>
                      <td className="px-4 py-3">{badge(wo.priority, priorityColor[wo.priority] ?? 'bg-slate-700 text-slate-300')}</td>
                      <td className="px-4 py-3 text-slate-300">{wo.garageName}</td>
                      <td className="px-4 py-3 text-slate-300">{wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{wo.authorizedPoAmount?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{wo.actualCost?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">{varianceBadge}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEdit(wo)}
                            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-white transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(wo.id)}
                            className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs text-red-400 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? 'Edit Work Order' : 'New Work Order'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-6">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {formError}
                </div>
              )}

              {/* Vehicle & Type */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Work Order Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Vehicle ID *</label>
                    <input
                      type="text"
                      value={formData.vehicleId}
                      onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. VH-001"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>WO Type</label>
                    <select
                      value={formData.woType}
                      onChange={e => setFormData(f => ({ ...f, woType: e.target.value }))}
                      className={inputCls}
                    >
                      <option>PREVENTIVE</option>
                      <option>CORRECTIVE</option>
                      <option>ACCIDENT</option>
                      <option>INSPECTION</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Status</label>
                    <select
                      value={formData.status}
                      onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                      className={inputCls}
                    >
                      <option>DRAFT</option>
                      <option>OPEN</option>
                      <option>IN_PROGRESS</option>
                      <option>COMPLETED</option>
                      <option>CANCELLED</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Priority</label>
                    <select
                      value={formData.priority}
                      onChange={e => setFormData(f => ({ ...f, priority: e.target.value }))}
                      className={inputCls}
                    >
                      <option>HIGH</option>
                      <option>MEDIUM</option>
                      <option>LOW</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Garage */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Garage Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Garage Name</label>
                    <input
                      type="text"
                      value={formData.garageName}
                      onChange={e => setFormData(f => ({ ...f, garageName: e.target.value }))}
                      className={inputCls}
                      placeholder="Garage name"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Garage Contact</label>
                    <input
                      type="text"
                      value={formData.garageContact}
                      onChange={e => setFormData(f => ({ ...f, garageContact: e.target.value }))}
                      className={inputCls}
                      placeholder="Phone or email"
                    />
                  </div>
                </div>
              </div>

              {/* Dates */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Dates & Odometer</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Scheduled Date</label>
                    <input
                      type="date"
                      value={formData.scheduledDate}
                      onChange={e => setFormData(f => ({ ...f, scheduledDate: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Start Date</label>
                    <input
                      type="date"
                      value={formData.startDate}
                      onChange={e => setFormData(f => ({ ...f, startDate: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>End Date</label>
                    <input
                      type="date"
                      value={formData.endDate}
                      onChange={e => setFormData(f => ({ ...f, endDate: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Odometer at Entry (km)</label>
                    <input
                      type="number"
                      value={formData.odometerAtEntry}
                      onChange={e => setFormData(f => ({ ...f, odometerAtEntry: Number(e.target.value) }))}
                      className={inputCls}
                      min={0}
                    />
                  </div>
                </div>
              </div>

              {/* Costs */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Financial</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Authorized PO Amount (AED)</label>
                    <input
                      type="number"
                      value={formData.authorizedPoAmount}
                      onChange={e => setFormData(f => ({ ...f, authorizedPoAmount: Number(e.target.value) }))}
                      className={inputCls}
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Actual Cost (AED)</label>
                    <input
                      type="number"
                      value={formData.actualCost}
                      onChange={e => setFormData(f => ({ ...f, actualCost: Number(e.target.value) }))}
                      className={inputCls}
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Variance (AED)</label>
                    <div className={`${inputCls} ${computedVariance > 0 ? 'text-red-400' : computedVariance < 0 ? 'text-amber-400' : 'text-green-400'} cursor-not-allowed opacity-70`}>
                      {computedVariance >= 0 ? '+' : ''}{computedVariance.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* People */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Authorization</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Requested By</label>
                    <input
                      type="text"
                      value={formData.requestedBy}
                      onChange={e => setFormData(f => ({ ...f, requestedBy: e.target.value }))}
                      className={inputCls}
                      placeholder="Name"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Approved By</label>
                    <input
                      type="text"
                      value={formData.approvedBy}
                      onChange={e => setFormData(f => ({ ...f, approvedBy: e.target.value }))}
                      className={inputCls}
                      placeholder="Name"
                    />
                  </div>
                </div>
              </div>

              {/* Descriptions */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Details</p>
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Description</label>
                    <textarea
                      value={formData.description}
                      onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                      className={`${inputCls} resize-none h-20`}
                      placeholder="Describe the work required..."
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Findings</label>
                    <textarea
                      value={formData.findings}
                      onChange={e => setFormData(f => ({ ...f, findings: e.target.value }))}
                      className={`${inputCls} resize-none h-20`}
                      placeholder="Findings from inspection..."
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Actions Taken</label>
                    <textarea
                      value={formData.actionsTaken}
                      onChange={e => setFormData(f => ({ ...f, actionsTaken: e.target.value }))}
                      className={`${inputCls} resize-none h-20`}
                      placeholder="Actions performed..."
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                      className={`${inputCls} resize-none h-16`}
                      placeholder="Additional notes..."
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
              >
                {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
