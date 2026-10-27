'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Tag,
  DollarSign,
  Edit2,
  Trash2,
  RotateCcw,
  Sparkles,
  Shield,
  Layers,
} from 'lucide-react';

export interface NuiReason {
  id: string;
  code: string;
  name: string;
  reasonType: string;
  description?: string;
  impactLevel: string;
  isBillable: boolean;
  isActive: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

const REASON_TYPES = [
  { key: 'ALL_TYPES', label: 'All Types', desc: 'All registered operational reasons' },
  { key: 'TRANSFER', label: 'Transfer', desc: 'Branch relocation & fleet rebalancing' },
  { key: 'MAINTENANCE', label: 'Maintenance', desc: 'Scheduled service & mechanical repairs' },
  { key: 'ALLOCATION', label: 'Allocation', desc: 'Department & project assignment' },
  { key: 'ACCIDENT', label: 'Accident', desc: 'Damage surveys & insurance claims' },
  { key: 'LEGAL', label: 'Legal & RTA', desc: 'Registration renewal & impounds' },
  { key: 'IDLE', label: 'Idle / Standby', desc: 'Off-peak surplus & spare capacity' },
  { key: 'DECOMMISSION', label: 'Decommission', desc: 'Retirement & salvage auction' },
];

const IMPACT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  LOW: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  MEDIUM: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  HIGH: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  CRITICAL: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
};

const TYPE_COLORS: Record<string, string> = {
  TRANSFER: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  MAINTENANCE: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  ALLOCATION: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  ACCIDENT: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  LEGAL: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  IDLE: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  DECOMMISSION: 'bg-red-500/10 text-red-400 border-red-500/20',
  ALL: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
};

const EMPTY_FORM = {
  code: '',
  name: '',
  reasonType: 'TRANSFER',
  description: '',
  impactLevel: 'MEDIUM',
  isBillable: false,
  isActive: true,
  notes: '',
};

export default function AdminNuiReasonMasterPage() {
  const [reasons, setReasons] = useState<NuiReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('ALL_TYPES');
  const [impactFilter, setImpactFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingReason, setEditingReason] = useState<NuiReason | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchReasons = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('activeOnly', 'false');
      if (search) params.set('search', search);
      if (selectedType !== 'ALL_TYPES') params.set('type', selectedType);
      if (impactFilter) params.set('impact', impactFilter);

      const res = await fetch(`/api/admin/nui-reasons?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load NUI reasons from Admin API');
      const json = await res.json();
      setReasons(json.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search, selectedType, impactFilter]);

  useEffect(() => {
    fetchReasons();
  }, [fetchReasons]);

  // Client filtering for active status
  const filteredReasons = useMemo(() => {
    return reasons.filter((r) => {
      if (statusFilter === 'ACTIVE' && !r.isActive) return false;
      if (statusFilter === 'INACTIVE' && r.isActive) return false;
      return true;
    });
  }, [reasons, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = reasons.length;
    const active = reasons.filter((r) => r.isActive).length;
    const billable = reasons.filter((r) => r.isBillable).length;
    const transfer = reasons.filter((r) => r.reasonType === 'TRANSFER' || r.reasonType === 'ALL').length;
    const maintenance = reasons.filter((r) => r.reasonType === 'MAINTENANCE').length;
    const allocation = reasons.filter((r) => r.reasonType === 'ALLOCATION').length;
    return { total, active, billable, transfer, maintenance, allocation };
  }, [reasons]);

  const openCreate = () => {
    setEditingReason(null);
    setFormData({
      ...EMPTY_FORM,
      reasonType: selectedType !== 'ALL_TYPES' ? selectedType : 'TRANSFER',
    });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (r: NuiReason) => {
    setEditingReason(r);
    setFormData({
      code: r.code,
      name: r.name,
      reasonType: r.reasonType,
      description: r.description || '',
      impactLevel: r.impactLevel || 'MEDIUM',
      isBillable: r.isBillable,
      isActive: r.isActive,
      notes: r.notes || '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.code.trim()) {
      setFormError('Reason code is required (e.g. TR-REBAL)');
      return;
    }
    if (!formData.name.trim()) {
      setFormError('Reason name is required');
      return;
    }
    setSaving(true);
    try {
      if (editingReason) {
        // Update
        const res = await fetch(`/api/admin/nui-reasons/${editingReason.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to update reason');
        }
      } else {
        // Create
        const res = await fetch('/api/admin/nui-reasons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to create reason');
        }
      }
      setShowModal(false);
      fetchReasons();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (r: NuiReason) => {
    setActionLoading(r.id);
    try {
      const res = await fetch(`/api/admin/nui-reasons/${r.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !r.isActive }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      fetchReasons();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (r: NuiReason) => {
    if (!confirm(`Are you sure you want to delete reason "${r.code} - ${r.name}"?`)) return;
    setActionLoading(r.id);
    try {
      const res = await fetch(`/api/admin/nui-reasons/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      fetchReasons();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const inputCls =
    'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none w-full transition-colors';
  const labelCls = 'block text-xs font-medium text-[var(--text-muted)] mb-1.5';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/admin"
              className="text-xs text-[var(--text-muted)] hover:text-orange-400 flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Administration
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-main)]">NUI Reason Master</h1>
              <p className="text-[var(--text-muted)] text-xs mt-0.5">
                Centralized Non-Utilization & Operational reason master across Transfers, Maintenance, Allocations & Compliance
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
          >
            <Plus className="w-4 h-4" /> Add Reason
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span className="text-xs text-[var(--text-muted)] font-medium">Total Reasons</span>
          <span className="text-2xl font-bold text-[var(--text-main)] mt-1">{stats.total}</span>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Active
          </span>
          <span className="text-2xl font-bold text-emerald-400 mt-1">{stats.active}</span>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span className="text-xs text-blue-400 font-medium flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Billable
          </span>
          <span className="text-2xl font-bold text-blue-400 mt-1">{stats.billable}</span>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span className="text-xs text-indigo-400 font-medium">Transfer</span>
          <span className="text-2xl font-bold text-indigo-400 mt-1">{stats.transfer}</span>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span className="text-xs text-amber-400 font-medium">Maintenance</span>
          <span className="text-2xl font-bold text-amber-400 mt-1">{stats.maintenance}</span>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span className="text-xs text-purple-400 font-medium">Allocation</span>
          <span className="text-2xl font-bold text-purple-400 mt-1">{stats.allocation}</span>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[var(--border-subtle)] scrollbar-none">
        {REASON_TYPES.map((t) => {
          const isSelected = selectedType === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSelectedType(t.key)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                  : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
              }`}
            >
              <span>{t.label}</span>
              {t.key !== 'ALL_TYPES' && (
                <span
                  className={`px-1.5 py-0.2 rounded-md text-[10px] ${
                    isSelected ? 'bg-black/20 text-white' : 'bg-[var(--bg-surface-hover)] text-[var(--text-faint)]'
                  }`}
                >
                  {reasons.filter((r) => r.reasonType === t.key).length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between shadow-sm">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by code, title, or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-4 py-2 text-sm text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
            />
          </div>

          <div className="w-44">
            <select
              value={impactFilter}
              onChange={(e) => setImpactFilter(e.target.value)}
              className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
            >
              <option value="">All Impact Levels</option>
              <option value="LOW">Low Impact</option>
              <option value="MEDIUM">Medium Impact</option>
              <option value="HIGH">High Impact</option>
              <option value="CRITICAL">Critical Impact</option>
            </select>
          </div>

          <div className="w-36">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>

        <button
          onClick={fetchReasons}
          className="px-3 py-2 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors border border-[var(--border-subtle)]"
          title="Refresh List"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] uppercase tracking-wider font-semibold text-[11px]">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Reason Name & Description</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Impact</th>
                <th className="py-3 px-4">Billing</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-faint)]">
                    Loading NUI reasons...
                  </td>
                </tr>
              ) : filteredReasons.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-faint)]">
                    No reasons matching your search criteria
                  </td>
                </tr>
              ) : (
                filteredReasons.map((r) => {
                  const impactBadge = IMPACT_COLORS[r.impactLevel] || IMPACT_COLORS.MEDIUM;
                  const typeBadge = TYPE_COLORS[r.reasonType] || TYPE_COLORS.TRANSFER;

                  return (
                    <tr key={r.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-orange-400">
                        {r.code}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[var(--text-main)] text-sm">{r.name}</div>
                        {r.description && (
                          <div className="text-[var(--text-muted)] text-xs mt-0.5 line-clamp-1">
                            {r.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${typeBadge}`}
                        >
                          {r.reasonType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${impactBadge.bg} ${impactBadge.text} ${impactBadge.border}`}
                        >
                          {r.impactLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.isBillable ? (
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Billable
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--bg-surface-hover)] text-[var(--text-faint)] border border-[var(--border-subtle)]">
                            Non-Billable
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleActive(r)}
                          disabled={actionLoading === r.id}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                            r.isActive
                              ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                              : 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                          }`}
                          title="Click to toggle active status"
                        >
                          {r.isActive ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" /> Inactive
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEdit(r)}
                            className="p-1.5 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-orange-400 rounded-lg transition-colors"
                            title="Edit Reason"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(r)}
                            disabled={actionLoading === r.id}
                            className="p-1.5 hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 rounded-lg transition-colors"
                            title="Delete Reason"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400">
                  <Tag className="w-4 h-4" />
                </div>
                <h2 className="text-base font-semibold text-[var(--text-main)]">
                  {editingReason ? 'Edit NUI Reason' : 'New NUI Reason'}
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Reason Code *</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className={inputCls}
                    placeholder="e.g. TR-BAL-01"
                    disabled={!!editingReason}
                  />
                  <p className="text-[10px] text-[var(--text-faint)] mt-1">Unique uppercase identifier</p>
                </div>

                <div>
                  <label className={labelCls}>Reason Type *</label>
                  <select
                    value={formData.reasonType}
                    onChange={(e) => setFormData((f) => ({ ...f, reasonType: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="TRANSFER">TRANSFER (Vehicle Relocation)</option>
                    <option value="MAINTENANCE">MAINTENANCE (Workshop & Repairs)</option>
                    <option value="ALLOCATION">ALLOCATION (Department / Unit)</option>
                    <option value="ACCIDENT">ACCIDENT (Damage & Collision)</option>
                    <option value="LEGAL">LEGAL (RTA Renewal, Impound)</option>
                    <option value="IDLE">IDLE (Surplus, Standby)</option>
                    <option value="DECOMMISSION">DECOMMISSION (Salvage, Retirement)</option>
                    <option value="ALL">ALL (Universal / Multi-purpose)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Reason Name / Title *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. Branch Fleet Rebalancing"
                />
              </div>

              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData((f) => ({ ...f, description: e.target.value }))}
                  className={`${inputCls} resize-none h-20`}
                  placeholder="Detailed explanation of when this operational or non-utilization reason applies..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Impact Level</label>
                  <select
                    value={formData.impactLevel}
                    onChange={(e) => setFormData((f) => ({ ...f, impactLevel: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="LOW">LOW (Minimal disruption)</option>
                    <option value="MEDIUM">MEDIUM (Standard operational impact)</option>
                    <option value="HIGH">HIGH (Major schedule / availability impact)</option>
                    <option value="CRITICAL">CRITICAL (Fleet grounding / immediate action)</option>
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Cost Attribution / Billing</label>
                  <div className="pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isBillable}
                        onChange={(e) => setFormData((f) => ({ ...f, isBillable: e.target.checked }))}
                        className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500/30 border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                      />
                      <span className="text-xs text-[var(--text-main)] font-medium">
                        Billable to Client or Project
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>Active Status</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData((f) => ({ ...f, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500/30 border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  />
                  <span className="text-xs text-[var(--text-main)] font-medium">
                    Active & Available across all operational modules
                  </span>
                </label>
              </div>

              <div>
                <label className={labelCls}>Operational Notes (Optional)</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls}
                  placeholder="Internal notes, SOP references, or dispatch guidelines..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] rounded-xl text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-orange-500/20"
              >
                {saving ? 'Saving...' : editingReason ? 'Update Reason' : 'Create Reason'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
