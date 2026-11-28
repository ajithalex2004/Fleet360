'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { VehicleRef } from '@/components/ui/EntityRef';

import { FormAlert, FormField, FormFooter, FormSection, PrimaryButton, SecondaryButton, SelectInput, TextAreaInput, TextInput } from '@/components/ui/form-kit';
import { FormModal } from '@/components/ui/form-modal';
interface InsurancePolicy {
  id: string;
  vehicleId: string;
  policyNumber: string;
  insurer: string;
  policyType: string;
  startDate: string;
  endDate: string;
  premiumAmount: number;
  coverageAmount: number;
  deductible: number;
  renewalReminderDays: number;
  documentUrl: string;
  notes: string;
  status: string;
}

const EMPTY_FORM: Omit<InsurancePolicy, 'id' | 'status'> = {
  vehicleId: '',
  policyNumber: '',
  insurer: '',
  policyType: 'COMPREHENSIVE',
  startDate: '',
  endDate: '',
  premiumAmount: 0,
  coverageAmount: 0,
  deductible: 0,
  renewalReminderDays: 30,
  documentUrl: '',
  notes: '',
};

const badge = (text: string, color: string) => (
  <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${color}`}>{text}</span>
);

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-500/20 text-green-400',
  EXPIRED: 'bg-red-500/20 text-red-400',
  CANCELLED: 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]',
};

const POLICY_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY', 'TPL', 'ENHANCED'];

function daysUntilExpiry(endDate: string): number {
  if (!endDate) return Infinity;
  const end = new Date(endDate);
  const now = new Date();
  return Math.floor((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function InsurancePage() {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expiringSoonCount, setExpiringSoonCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('policyType', typeFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const res = await fetch(`/api/fleet/insurance?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch insurance policies');
      const data = await res.json();
      const items: InsurancePolicy[] = data.data ?? data.items ?? (Array.isArray(data) ? data : []);
      setPolicies(items);
      setTotalPages(data.totalPages ?? 1);
      const expiring = items.filter(p => {
        const days = daysUntilExpiry(p.endDate);
        return p.status === 'ACTIVE' && days >= 0 && days < 30;
      }).length;
      setExpiringSoonCount(expiring);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, page]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const openCreate = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (policy: InsurancePolicy) => {
    setEditingId(policy.id);
    setFormData({
      vehicleId: policy.vehicleId,
      policyNumber: policy.policyNumber,
      insurer: policy.insurer,
      policyType: policy.policyType,
      startDate: policy.startDate ?? '',
      endDate: policy.endDate ?? '',
      premiumAmount: policy.premiumAmount,
      coverageAmount: policy.coverageAmount,
      deductible: policy.deductible,
      renewalReminderDays: policy.renewalReminderDays ?? 30,
      documentUrl: policy.documentUrl ?? '',
      notes: policy.notes ?? '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this insurance policy?')) return;
    try {
      const res = await fetch(`/api/fleet/insurance/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      fetchPolicies();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.vehicleId.trim()) { setFormError('Vehicle ID is required'); return; }
    if (!formData.policyNumber.trim()) { setFormError('Policy number is required'); return; }
    if (!formData.endDate) { setFormError('End date is required'); return; }
    setSaving(true);
    try {
      let res: Response;
      const payload = { ...formData };
      if (editingId) {
        res = await fetch(`/api/fleet/insurance/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/fleet/insurance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, status: 'ACTIVE' }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Save failed');
      }
      setShowModal(false);
      fetchPolicies();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const getDaysUntilExpiryDisplay = (endDate: string, status: string) => {
    if (!endDate) return <span className="text-[var(--text-faint)]">—</span>;
    const days = daysUntilExpiry(endDate);
    if (days < 0 || status === 'EXPIRED') {
      return <span className="text-red-400 font-medium text-xs">{Math.abs(days)}d ago</span>;
    }
    if (days < 30) {
      return <span className="text-amber-400 font-medium text-xs">{days}d</span>;
    }
    return <span className="text-green-400 text-xs">{days}d</span>;
  };

  const inputCls = 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none w-full';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Fleet Insurance Policies</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">Manage vehicle insurance coverage and renewals</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
        >
          + Add Policy
        </button>
      </div>

      {/* Expiry Warning Banner */}
      {expiringSoonCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 px-4 py-3 rounded-xl text-sm mb-4 flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            <strong>{expiringSoonCount} {expiringSoonCount === 1 ? 'policy' : 'policies'}</strong> expiring within the next 30 days. Please review and arrange renewals.
          </span>
        </div>
      )}

      {/* Error */}
      {error && <FormAlert>{error}</FormAlert>}

      {/* Filter Bar */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search vehicle, policy number, insurer..."
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
          <option>ACTIVE</option>
          <option>EXPIRED</option>
          <option>CANCELLED</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All Policy Types</option>
          {POLICY_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-surface)]/60 border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Vehicle ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Policy Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Insurer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Policy Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Start Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">End Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Premium (AED)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Coverage (AED)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Deductible (AED)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Days Until Expiry</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-[var(--text-faint)]">Loading insurance policies...</td>
                </tr>
              ) : policies.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-[var(--text-faint)]">No insurance policies found</td>
                </tr>
              ) : (
                policies.map(policy => (
                  <tr key={policy.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-orange-400 font-medium"><VehicleRef id={policy.vehicleId} /></td>
                    <td className="px-4 py-3 font-mono text-[var(--text-muted)] text-xs">{policy.policyNumber}</td>
                    <td className="px-4 py-3 text-[var(--text-main)]">{policy.insurer}</td>
                    <td className="px-4 py-3">{badge(policy.policyType, 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]')}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{policy.startDate ? new Date(policy.startDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{policy.endDate ? new Date(policy.endDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{policy.premiumAmount?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{policy.coverageAmount?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{policy.deductible?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{badge(policy.status, statusColor[policy.status] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]')}</td>
                    <td className="px-4 py-3 text-center">{getDaysUntilExpiryDisplay(policy.endDate, policy.status)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(policy)}
                          className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] rounded-lg text-xs text-[var(--text-main)] transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(policy.id)}
                          className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs text-red-400 transition-colors"
                        >
                          Delete
                        </button>
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

      {/* Create / Edit Modal */}
      {showModal && (
        <FormModal
          onClose={() => setShowModal(false)}
          title={editingId ? 'Edit Insurance Policy' : 'Add Insurance Policy'}
          size="lg"
        >
          <div className="space-y-5">
            {formError && <FormAlert>{formError}</FormAlert>}

            <FormSection title="Policy Details" columns={2}>
              <FormField label="Vehicle ID" required>
                <TextInput type="text" value={formData.vehicleId} onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))} placeholder="e.g. VH-001" />
              </FormField>
              <FormField label="Policy Number" required>
                <TextInput type="text" value={formData.policyNumber} onChange={e => setFormData(f => ({ ...f, policyNumber: e.target.value }))} placeholder="Policy number" />
              </FormField>
              <FormField label="Insurer">
                <TextInput type="text" value={formData.insurer} onChange={e => setFormData(f => ({ ...f, insurer: e.target.value }))} placeholder="Insurance company name" />
              </FormField>
              <FormField label="Policy Type">
                <SelectInput value={formData.policyType} onChange={e => setFormData(f => ({ ...f, policyType: e.target.value }))}>
                  {POLICY_TYPES.map(t => <option key={t}>{t}</option>)}
                </SelectInput>
              </FormField>
            </FormSection>

            <FormSection title="Coverage Period" columns={2}>
              <FormField label="Start Date">
                <TextInput type="date" value={formData.startDate} onChange={e => setFormData(f => ({ ...f, startDate: e.target.value }))} />
              </FormField>
              <FormField label="End Date" required>
                <TextInput type="date" value={formData.endDate} onChange={e => setFormData(f => ({ ...f, endDate: e.target.value }))} />
              </FormField>
              <FormField label="Renewal Reminder (days before expiry)">
                <TextInput type="number" value={formData.renewalReminderDays} onChange={e => setFormData(f => ({ ...f, renewalReminderDays: Number(e.target.value) }))} min={1} max={365} />
              </FormField>
            </FormSection>

            <FormSection title="Financial" columns={3}>
              <FormField label="Premium Amount (AED)">
                <TextInput type="number" value={formData.premiumAmount} onChange={e => setFormData(f => ({ ...f, premiumAmount: Number(e.target.value) }))} min={0} step={0.01} />
              </FormField>
              <FormField label="Coverage Amount (AED)">
                <TextInput type="number" value={formData.coverageAmount} onChange={e => setFormData(f => ({ ...f, coverageAmount: Number(e.target.value) }))} min={0} step={0.01} />
              </FormField>
              <FormField label="Deductible (AED)">
                <TextInput type="number" value={formData.deductible} onChange={e => setFormData(f => ({ ...f, deductible: Number(e.target.value) }))} min={0} step={0.01} />
              </FormField>
            </FormSection>

            <FormSection title="Additional Info" columns={1}>
              <FormField label="Document URL">
                <TextInput type="url" value={formData.documentUrl} onChange={e => setFormData(f => ({ ...f, documentUrl: e.target.value }))} placeholder="https://..." />
              </FormField>
              <FormField label="Notes">
                <TextAreaInput value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} className={`${inputCls} resize-none h-16`} placeholder="Additional notes..." />
              </FormField>
            </FormSection>
          </div>
          <FormFooter secondary={<SecondaryButton onClick={() => setShowModal(false)}>Cancel</SecondaryButton>}>
            <PrimaryButton onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Policy' : 'Add Policy'}</PrimaryButton>
          </FormFooter>
        </FormModal>
      )}
    </div>
  );
}
