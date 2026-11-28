'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { VehicleRef } from '@/components/ui/EntityRef';

import { FormAlert, FormField, FormFooter, FormSection, PrimaryButton, SecondaryButton, SelectInput, TextAreaInput, TextInput } from '@/components/ui/form-kit';
import { FormModal } from '@/components/ui/form-modal';
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
  DRAFT: 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]',
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

  const inputCls = 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none w-full';
  const labelCls = 'block text-xs text-[var(--text-muted)] mb-1';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Fleet Work Orders</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">Manage maintenance and repair work orders</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
        >
          + New Work Order
        </button>
      </div>

      {/* Error */}
      {error && <FormAlert>{error}</FormAlert>}

      {/* Filter Bar */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search WO number, vehicle, garage..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none flex-1 min-w-[200px] placeholder-[var(--text-faint)]"
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none"
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
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All Types</option>
          <option>PREVENTIVE</option>
          <option>CORRECTIVE</option>
          <option>ACCIDENT</option>
          <option>INSPECTION</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-surface)]/60 border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">WO Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Vehicle</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Garage</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Scheduled Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Auth. PO (AED)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actual Cost (AED)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Variance</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-[var(--text-faint)]">Loading work orders...</td>
                </tr>
              ) : workOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-[var(--text-faint)]">No work orders found</td>
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
                    <tr key={wo.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                      <td className="px-4 py-3 font-mono text-orange-400 font-medium">{wo.woNumber}</td>
                      <td className="px-4 py-3 text-[var(--text-main)]"><VehicleRef id={wo.vehicleId} /></td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{wo.woType}</td>
                      <td className="px-4 py-3">{badge(wo.status, statusColor[wo.status] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]')}</td>
                      <td className="px-4 py-3">{badge(wo.priority, priorityColor[wo.priority] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]')}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{wo.garageName}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-right text-[var(--text-muted)]">{wo.authorizedPoAmount?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-[var(--text-muted)]">{wo.actualCost?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">{varianceBadge}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEdit(wo)}
                            className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] rounded-lg text-xs text-[var(--text-main)] transition-colors"
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)]">
            <span className="text-xs text-[var(--text-faint)]">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-xs text-[var(--text-main)] transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-xs text-[var(--text-main)] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <FormModal
          onClose={() => setShowModal(false)}
          title={editingId ? 'Edit Work Order' : 'New Work Order'}
          size="xl"
        >
          {/* Modal Body */}
          <div className="px-6 py-5 space-y-6">
            {formError && <FormAlert>{formError}</FormAlert>}

            {/* Vehicle & Type */}
            <FormSection title="Work Order Details" columns={2}>
              <FormField label="Vehicle ID" required>
                <TextInput
                  type="text"
                  value={formData.vehicleId}
                  onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))}
                  placeholder="e.g. VH-001"
                />
              </FormField>
              <FormField label="WO Type">
                <SelectInput
                  value={formData.woType}
                  onChange={e => setFormData(f => ({ ...f, woType: e.target.value }))}
                >
                  <option>PREVENTIVE</option>
                  <option>CORRECTIVE</option>
                  <option>ACCIDENT</option>
                  <option>INSPECTION</option>
                </SelectInput>
              </FormField>
              <FormField label="Status">
                <SelectInput
                  value={formData.status}
                  onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                >
                  <option>DRAFT</option>
                  <option>OPEN</option>
                  <option>IN_PROGRESS</option>
                  <option>COMPLETED</option>
                  <option>CANCELLED</option>
                </SelectInput>
              </FormField>
              <FormField label="Priority">
                <SelectInput
                  value={formData.priority}
                  onChange={e => setFormData(f => ({ ...f, priority: e.target.value }))}
                >
                  <option>HIGH</option>
                  <option>MEDIUM</option>
                  <option>LOW</option>
                </SelectInput>
              </FormField>
            </FormSection>

            {/* Garage */}
            <FormSection title="Garage Information" columns={2}>
              <FormField label="Garage Name">
                <TextInput
                  type="text"
                  value={formData.garageName}
                  onChange={e => setFormData(f => ({ ...f, garageName: e.target.value }))}
                  placeholder="Garage name"
                />
              </FormField>
              <FormField label="Garage Contact">
                <TextInput
                  type="text"
                  value={formData.garageContact}
                  onChange={e => setFormData(f => ({ ...f, garageContact: e.target.value }))}
                  placeholder="Phone or email"
                />
              </FormField>
            </FormSection>

            {/* Dates */}
            <FormSection title="Dates & Odometer" columns={3}>
              <FormField label="Scheduled Date">
                <TextInput
                  type="date"
                  value={formData.scheduledDate}
                  onChange={e => setFormData(f => ({ ...f, scheduledDate: e.target.value }))}
                />
              </FormField>
              <FormField label="Start Date">
                <TextInput
                  type="date"
                  value={formData.startDate}
                  onChange={e => setFormData(f => ({ ...f, startDate: e.target.value }))}
                />
              </FormField>
              <FormField label="End Date">
                <TextInput
                  type="date"
                  value={formData.endDate}
                  onChange={e => setFormData(f => ({ ...f, endDate: e.target.value }))}
                />
              </FormField>
              <FormField label="Odometer at Entry (km)">
                <TextInput
                  type="number"
                  value={formData.odometerAtEntry}
                  onChange={e => setFormData(f => ({ ...f, odometerAtEntry: Number(e.target.value) }))}
                  min={0}
                />
              </FormField>
            </FormSection>

            {/* Costs */}
            <FormSection title="Financial" columns={3}>
              <FormField label="Authorized PO Amount (AED)">
                <TextInput
                  type="number"
                  value={formData.authorizedPoAmount}
                  onChange={e => setFormData(f => ({ ...f, authorizedPoAmount: Number(e.target.value) }))}
                  min={0}
                  step={0.01}
                />
              </FormField>
              <FormField label="Actual Cost (AED)">
                <TextInput
                  type="number"
                  value={formData.actualCost}
                  onChange={e => setFormData(f => ({ ...f, actualCost: Number(e.target.value) }))}
                  min={0}
                  step={0.01}
                />
              </FormField>
              <div>
                <label className={labelCls}>Variance (AED)</label>
                <div className={`${inputCls} ${computedVariance > 0 ? 'text-red-400' : computedVariance < 0 ? 'text-amber-400' : 'text-green-400'} cursor-not-allowed opacity-70`}>
                  {computedVariance >= 0 ? '+' : ''}{computedVariance.toFixed(2)}
                </div>
              </div>
            </FormSection>

            {/* People */}
            <FormSection title="Authorization" columns={2}>
              <FormField label="Requested By">
                <TextInput
                  type="text"
                  value={formData.requestedBy}
                  onChange={e => setFormData(f => ({ ...f, requestedBy: e.target.value }))}
                  placeholder="Name"
                />
              </FormField>
              <FormField label="Approved By">
                <TextInput
                  type="text"
                  value={formData.approvedBy}
                  onChange={e => setFormData(f => ({ ...f, approvedBy: e.target.value }))}
                  placeholder="Name"
                />
              </FormField>
            </FormSection>

            {/* Descriptions */}
            <FormSection title="Details" columns={1}>
              <FormField label="Description">
                <TextAreaInput
                  value={formData.description}
                  onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  className={`${inputCls} resize-none h-20`}
                  placeholder="Describe the work required..."
                />
              </FormField>
              <FormField label="Findings">
                <TextAreaInput
                  value={formData.findings}
                  onChange={e => setFormData(f => ({ ...f, findings: e.target.value }))}
                  className={`${inputCls} resize-none h-20`}
                  placeholder="Findings from inspection..."
                />
              </FormField>
              <FormField label="Actions Taken">
                <TextAreaInput
                  value={formData.actionsTaken}
                  onChange={e => setFormData(f => ({ ...f, actionsTaken: e.target.value }))}
                  className={`${inputCls} resize-none h-20`}
                  placeholder="Actions performed..."
                />
              </FormField>
              <FormField label="Notes">
                <TextAreaInput
                  value={formData.notes}
                  onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                  className={`${inputCls} resize-none h-16`}
                  placeholder="Additional notes..."
                />
              </FormField>
            </FormSection>
          </div>

          {/* Modal Footer */}
          <FormFooter secondary={<SecondaryButton onClick={() => setShowModal(false)}>Cancel</SecondaryButton>}>
            <PrimaryButton onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update' : 'Create'}</PrimaryButton>
          </FormFooter>
        </FormModal>
      )}
    </div>
  );
}
