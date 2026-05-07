'use client';
import React, { useState, useEffect, useCallback } from 'react';

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
  CANCELLED: 'bg-slate-700 text-slate-300',
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
    if (!endDate) return <span className="text-slate-600">—</span>;
    const days = daysUntilExpiry(endDate);
    if (days < 0 || status === 'EXPIRED') {
      return <span className="text-red-400 font-medium text-xs">{Math.abs(days)}d ago</span>;
    }
    if (days < 30) {
      return <span className="text-amber-400 font-medium text-xs">{days}d</span>;
    }
    return <span className="text-green-400 text-xs">{days}d</span>;
  };

  const inputCls = 'bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none w-full';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fleet Insurance Policies</h1>
          <p className="text-slate-400 text-sm mt-1">Manage vehicle insurance coverage and renewals</p>
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
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-4">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search vehicle, policy number, insurer..."
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
          <option>EXPIRED</option>
          <option>CANCELLED</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All Policy Types</option>
          {POLICY_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Policy Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Insurer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Policy Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Start Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">End Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Premium (AED)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Coverage (AED)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Deductible (AED)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Days Until Expiry</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-slate-500">Loading insurance policies...</td>
                </tr>
              ) : policies.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-slate-500">No insurance policies found</td>
                </tr>
              ) : (
                policies.map(policy => (
                  <tr key={policy.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-orange-400 font-medium">{policy.vehicleId}</td>
                    <td className="px-4 py-3 font-mono text-slate-300 text-xs">{policy.policyNumber}</td>
                    <td className="px-4 py-3 text-white">{policy.insurer}</td>
                    <td className="px-4 py-3">{badge(policy.policyType, 'bg-slate-700 text-slate-300')}</td>
                    <td className="px-4 py-3 text-slate-300">{policy.startDate ? new Date(policy.startDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{policy.endDate ? new Date(policy.endDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{policy.premiumAmount?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{policy.coverageAmount?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{policy.deductible?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{badge(policy.status, statusColor[policy.status] ?? 'bg-slate-700 text-slate-300')}</td>
                    <td className="px-4 py-3 text-center">{getDaysUntilExpiryDisplay(policy.endDate, policy.status)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(policy)}
                          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-white transition-colors"
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

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">{editingId ? 'Edit Insurance Policy' : 'Add Insurance Policy'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-5 space-y-6">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {formError}
                </div>
              )}

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Policy Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Vehicle ID *</label>
                    <input type="text" value={formData.vehicleId} onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))} className={inputCls} placeholder="e.g. VH-001" />
                  </div>
                  <div>
                    <label className={labelCls}>Policy Number *</label>
                    <input type="text" value={formData.policyNumber} onChange={e => setFormData(f => ({ ...f, policyNumber: e.target.value }))} className={inputCls} placeholder="Policy number" />
                  </div>
                  <div>
                    <label className={labelCls}>Insurer</label>
                    <input type="text" value={formData.insurer} onChange={e => setFormData(f => ({ ...f, insurer: e.target.value }))} className={inputCls} placeholder="Insurance company name" />
                  </div>
                  <div>
                    <label className={labelCls}>Policy Type</label>
                    <select value={formData.policyType} onChange={e => setFormData(f => ({ ...f, policyType: e.target.value }))} className={inputCls}>
                      {POLICY_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Coverage Period</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Start Date</label>
                    <input type="date" value={formData.startDate} onChange={e => setFormData(f => ({ ...f, startDate: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>End Date *</label>
                    <input type="date" value={formData.endDate} onChange={e => setFormData(f => ({ ...f, endDate: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Renewal Reminder (days before expiry)</label>
                    <input type="number" value={formData.renewalReminderDays} onChange={e => setFormData(f => ({ ...f, renewalReminderDays: Number(e.target.value) }))} className={inputCls} min={1} max={365} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Financial</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Premium Amount (AED)</label>
                    <input type="number" value={formData.premiumAmount} onChange={e => setFormData(f => ({ ...f, premiumAmount: Number(e.target.value) }))} className={inputCls} min={0} step={0.01} />
                  </div>
                  <div>
                    <label className={labelCls}>Coverage Amount (AED)</label>
                    <input type="number" value={formData.coverageAmount} onChange={e => setFormData(f => ({ ...f, coverageAmount: Number(e.target.value) }))} className={inputCls} min={0} step={0.01} />
                  </div>
                  <div>
                    <label className={labelCls}>Deductible (AED)</label>
                    <input type="number" value={formData.deductible} onChange={e => setFormData(f => ({ ...f, deductible: Number(e.target.value) }))} className={inputCls} min={0} step={0.01} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Additional Info</p>
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Document URL</label>
                    <input type="url" value={formData.documentUrl} onChange={e => setFormData(f => ({ ...f, documentUrl: e.target.value }))} className={inputCls} placeholder="https://..." />
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
                {saving ? 'Saving...' : editingId ? 'Update Policy' : 'Add Policy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
