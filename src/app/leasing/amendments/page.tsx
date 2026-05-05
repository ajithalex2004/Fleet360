'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, ChevronRight, Search, Filter, X, Check, AlertTriangle, ArrowRight } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Amendment {
  id: string;
  amendmentNo: string;
  contractId: string | null;
  contractNo: string | null;
  lesseeName: string;
  vehicleNo: string | null;
  vehicleName: string | null;
  amendmentType: string;
  description: string;
  originalValue: string | null;
  newValue: string | null;
  financialImpact: number;
  vatAmount: number;
  totalImpact: number;
  effectiveDate: string | null;
  status: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  implementedAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface Summary {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  totalFinancialImpact: number;
  approvedThisMonth: number;
  pendingApproval: number;
}

interface ApiResponse {
  data: Amendment[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: Summary;
}

interface FormState {
  contractNo: string;
  lesseeName: string;
  vehicleNo: string;
  vehicleName: string;
  amendmentType: string;
  description: string;
  originalValue: string;
  newValue: string;
  financialImpact: string;
  effectiveDate: string;
  submittedBy: string;
  notes: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AMENDMENT_TYPES = [
  { value: 'MILEAGE_UPGRADE',     label: 'Mileage Upgrade' },
  { value: 'VEHICLE_SWAP',        label: 'Vehicle Swap' },
  { value: 'TERM_EXTENSION',      label: 'Term Extension' },
  { value: 'RATE_CHANGE',         label: 'Rate Change' },
  { value: 'ADDITIONAL_SERVICE',  label: 'Additional Service' },
  { value: 'OTHER',               label: 'Other' },
];

const STATUS_TABS = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IMPLEMENTED'];

const EMPTY_FORM: FormState = {
  contractNo: '', lesseeName: '', vehicleNo: '', vehicleName: '',
  amendmentType: '', description: '', originalValue: '', newValue: '',
  financialImpact: '0', effectiveDate: '', submittedBy: '', notes: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function typeBadgeClass(type: string) {
  switch (type) {
    case 'MILEAGE_UPGRADE':    return 'bg-blue-900/40 text-blue-300 border border-blue-700/50';
    case 'VEHICLE_SWAP':       return 'bg-violet-900/40 text-violet-300 border border-violet-700/50';
    case 'TERM_EXTENSION':     return 'bg-teal-900/40 text-teal-300 border border-teal-700/50';
    case 'RATE_CHANGE':        return 'bg-amber-900/40 text-amber-300 border border-amber-700/50';
    case 'ADDITIONAL_SERVICE': return 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50';
    default:                   return 'bg-slate-700/40 text-slate-300 border border-slate-600/50';
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'DRAFT':       return 'bg-slate-700/50 text-slate-300 border border-slate-600';
    case 'SUBMITTED':   return 'bg-amber-900/40 text-amber-300 border border-amber-700';
    case 'APPROVED':    return 'bg-emerald-900/40 text-emerald-300 border border-emerald-700';
    case 'REJECTED':    return 'bg-red-900/40 text-red-300 border border-red-700';
    case 'IMPLEMENTED': return 'bg-purple-900/40 text-purple-300 border border-purple-700';
    default:            return 'bg-slate-700/50 text-slate-300 border border-slate-600';
  }
}

function typeLabel(type: string) {
  return AMENDMENT_TYPES.find(t => t.value === type)?.label ?? type;
}

function fmt(amount: number) {
  return amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div className="bg-slate-800/60 border border-white/10 rounded-xl p-5">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Input helpers ───────────────────────────────────────────────────────────

const inputClass = 'w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none text-sm';
const labelClass = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AmendmentsPage() {
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [summary, setSummary] = useState<Summary>({
    byStatus: {}, byType: {}, totalFinancialImpact: 0, approvedThisMonth: 0, pendingApproval: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  const [activeStatus, setActiveStatus] = useState('ALL');
  const [activeType, setActiveType]   = useState('');
  const [search, setSearch]           = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [showModal, setShowModal]         = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTarget, setRejectTarget]   = useState<Amendment | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [approveTarget, setApproveTarget] = useState<Amendment | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approvedBy, setApprovedBy]       = useState('');

  const [form, setForm]   = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Computed VAT and total
  const impact    = parseFloat(form.financialImpact) || 0;
  const vatAmount = impact > 0 ? parseFloat((impact * 0.05).toFixed(2)) : 0;
  const totalImpact = parseFloat((impact + vatAmount).toFixed(2));

  const fetchAmendments = useCallback(async (pg = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (activeStatus !== 'ALL') params.set('status', activeStatus);
      if (activeType)             params.set('amendment_type', activeType);
      if (search)                 params.set('search', search);
      params.set('page', String(pg));
      params.set('limit', '20');

      const res = await fetch(`/api/leasing/amendments?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json: ApiResponse = await res.json();
      setAmendments(json.data);
      setSummary(json.summary);
      setPagination(json.pagination);
    } catch {
      setError('Failed to load amendments');
    } finally {
      setLoading(false);
    }
  }, [activeStatus, activeType, search]);

  useEffect(() => { fetchAmendments(1); }, [fetchAmendments]);

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/leasing/amendments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractNo:      form.contractNo || undefined,
          lesseeName:      form.lesseeName,
          vehicleNo:       form.vehicleNo  || undefined,
          vehicleName:     form.vehicleName || undefined,
          amendmentType:   form.amendmentType,
          description:     form.description,
          originalValue:   form.originalValue || undefined,
          newValue:        form.newValue      || undefined,
          financialImpact: parseFloat(form.financialImpact) || 0,
          effectiveDate:   form.effectiveDate || undefined,
          submittedBy:     form.submittedBy   || undefined,
          notes:           form.notes         || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Create failed');
      }
      setShowModal(false);
      setForm(EMPTY_FORM);
      fetchAmendments(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create amendment');
    } finally {
      setSaving(false);
    }
  }

  async function handleWorkflow(id: string, action: string, extra: Record<string, string> = {}) {
    try {
      const res = await fetch(`/api/leasing/amendments?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Update failed');
      }
      fetchAmendments(pagination.page);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
    }
  }

  function openReject(amendment: Amendment) {
    setRejectTarget(amendment);
    setRejectionReason('');
    setShowRejectModal(true);
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectionReason.trim()) return;
    await handleWorkflow(rejectTarget.id, 'REJECT', { rejectionReason });
    setShowRejectModal(false);
    setRejectTarget(null);
  }

  function openApprove(amendment: Amendment) {
    setApproveTarget(amendment);
    setApprovedBy('');
    setShowApproveModal(true);
  }

  async function confirmApprove() {
    if (!approveTarget) return;
    await handleWorkflow(approveTarget.id, 'APPROVE', { approvedBy: approvedBy || 'Management' });
    setShowApproveModal(false);
    setApproveTarget(null);
  }

  const pipelineStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'IMPLEMENTED'];

  return (
    <div className="space-y-6">

      {/* ─── Header ─── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Contract Amendments</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Track and manage all contract modifications with full approval audit trail
          </p>
        </div>
        <button
          onClick={() => { setShowModal(true); setError(''); setForm(EMPTY_FORM); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-violet-900/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          New Amendment
        </button>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Amendments"
          value={pagination.total}
          sub="All time"
          accent="text-white"
        />
        <KpiCard
          label="Pending Approval"
          value={summary.pendingApproval}
          sub="Submitted, awaiting review"
          accent="text-amber-400"
        />
        <KpiCard
          label="Approved This Month"
          value={summary.approvedThisMonth}
          sub="Current month"
          accent="text-emerald-400"
        />
        <KpiCard
          label="Financial Impact"
          value={`AED ${fmt(summary.totalFinancialImpact)}`}
          sub="Total positive adjustments"
          accent="text-violet-400"
        />
      </div>

      {/* ─── Status Pipeline Banner ─── */}
      <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Amendment Pipeline</p>
        <div className="flex items-center gap-1 flex-wrap">
          {pipelineStatuses.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-2 bg-slate-700/60 rounded-lg px-3 py-2 min-w-[100px]">
                <span className={`text-xs font-bold ${statusBadgeClass(s).split(' ').filter(c => c.startsWith('text')).join(' ')}`}>
                  {s}
                </span>
                <span className="text-lg font-bold text-white ml-auto">
                  {summary.byStatus[s] ?? 0}
                </span>
              </div>
              {i < pipelineStatuses.length - 1 && (
                <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
              )}
            </React.Fragment>
          ))}
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 min-w-[100px] ml-2">
            <span className="text-xs font-bold text-red-400">REJECTED</span>
            <span className="text-lg font-bold text-white ml-auto">{summary.byStatus['REJECTED'] ?? 0}</span>
          </div>
        </div>
      </div>

      {/* ─── Filters ─── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Status tabs */}
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1 flex-wrap">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => setActiveStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeStatus === s
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {s}
              {s !== 'ALL' && summary.byStatus[s] ? (
                <span className="ml-1.5 text-[10px] opacity-70">({summary.byStatus[s]})</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-1">
          {/* Type filter */}
          <select
            value={activeType}
            onChange={e => setActiveType(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-800/60 border border-white/10 text-sm text-slate-300 focus:outline-none focus:border-violet-500"
          >
            <option value="">All Types</option>
            {AMENDMENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {/* Search */}
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search by contract, lessee, amendment no…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setSearch(searchInput)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-800/60 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
            <button
              onClick={() => setSearch(searchInput)}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
            >
              Search
            </button>
            {search && (
              <button
                onClick={() => { setSearch(''); setSearchInput(''); }}
                className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="bg-slate-800/50 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading amendments…</div>
        ) : amendments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Filter className="w-8 h-8 text-slate-600" />
            <p className="text-slate-400 text-sm">No amendments found</p>
            <p className="text-slate-600 text-xs">Try changing filters or create a new amendment</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-slate-900/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Amendment No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Contract No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Lessee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Change</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Impact (AED)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Effective</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Submitted By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {amendments.map(a => (
                  <tr key={a.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-violet-300 text-xs font-medium">{a.amendmentNo}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{a.contractNo ?? '—'}</td>
                    <td className="px-4 py-3 text-white font-medium text-xs">{a.lesseeName}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      <div>{a.vehicleNo ?? '—'}</div>
                      {a.vehicleName && <div className="text-slate-500 text-[10px]">{a.vehicleName}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${typeBadgeClass(a.amendmentType)}`}>
                        {typeLabel(a.amendmentType)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs max-w-[180px]">
                      <span className="truncate block" title={a.description}>{a.description}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {a.originalValue || a.newValue ? (
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="text-slate-400">{a.originalValue ?? '—'}</span>
                          <ArrowRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
                          <span className="text-white">{a.newValue ?? '—'}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold text-xs ${a.financialImpact > 0 ? 'text-emerald-400' : a.financialImpact < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {a.financialImpact !== 0 ? `${a.financialImpact > 0 ? '+' : ''}AED ${fmt(a.financialImpact)}` : 'No impact'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300 whitespace-nowrap">{fmtDate(a.effectiveDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadgeClass(a.status)}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{a.submittedBy ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.status === 'DRAFT' && (
                          <button
                            onClick={() => handleWorkflow(a.id, 'SUBMIT')}
                            className="px-2 py-1 rounded-lg bg-amber-600/20 border border-amber-600/40 text-amber-300 text-[10px] font-semibold hover:bg-amber-600/30 transition-colors whitespace-nowrap"
                          >
                            Submit
                          </button>
                        )}
                        {a.status === 'SUBMITTED' && (
                          <>
                            <button
                              onClick={() => openApprove(a)}
                              className="px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 text-[10px] font-semibold hover:bg-emerald-600/30 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => openReject(a)}
                              className="px-2 py-1 rounded-lg bg-red-600/20 border border-red-600/40 text-red-300 text-[10px] font-semibold hover:bg-red-600/30 transition-colors"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {a.status === 'APPROVED' && (
                          <button
                            onClick={() => handleWorkflow(a.id, 'IMPLEMENT')}
                            className="px-2 py-1 rounded-lg bg-purple-600/20 border border-purple-600/40 text-purple-300 text-[10px] font-semibold hover:bg-purple-600/30 transition-colors whitespace-nowrap"
                          >
                            Implement
                          </button>
                        )}
                        {['REJECTED', 'IMPLEMENTED'].includes(a.status) && (
                          <span className="text-slate-600 text-[10px]">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
            <span className="text-xs text-slate-500">
              Page {pagination.page} of {pagination.totalPages} — {pagination.total} amendments
            </span>
            <div className="flex gap-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => fetchAmendments(pagination.page - 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchAmendments(pagination.page + 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── New Amendment Modal ─── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">New Contract Amendment</h2>
                <p className="text-xs text-slate-400">Auto-generates LAM-YYYYMM-XXXX</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-5">
              {error && (
                <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Contract No</label>
                  <input name="contractNo" value={form.contractNo} onChange={handleFormChange}
                    placeholder="e.g. LC-2024-001" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Lessee Name <span className="text-red-400">*</span></label>
                  <input name="lesseeName" value={form.lesseeName} onChange={handleFormChange}
                    placeholder="Full name or company" className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass}>Vehicle No</label>
                  <input name="vehicleNo" value={form.vehicleNo} onChange={handleFormChange}
                    placeholder="e.g. Dubai A 12345" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Vehicle Name</label>
                  <input name="vehicleName" value={form.vehicleName} onChange={handleFormChange}
                    placeholder="e.g. Toyota Camry 2023" className={inputClass} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Amendment Type <span className="text-red-400">*</span></label>
                  <select name="amendmentType" value={form.amendmentType} onChange={handleFormChange}
                    className={inputClass} required>
                    <option value="">Select type…</option>
                    {AMENDMENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Effective Date</label>
                  <input type="date" name="effectiveDate" value={form.effectiveDate} onChange={handleFormChange}
                    className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Description <span className="text-red-400">*</span></label>
                <textarea name="description" value={form.description} onChange={handleFormChange}
                  placeholder="Detailed description of the amendment…" rows={3}
                  className={`${inputClass} resize-none`} required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Original Value</label>
                  <input name="originalValue" value={form.originalValue} onChange={handleFormChange}
                    placeholder="e.g. 24 months, 60,000 km, AED 2,500/mo" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>New Value</label>
                  <input name="newValue" value={form.newValue} onChange={handleFormChange}
                    placeholder="e.g. 36 months, 80,000 km, AED 2,800/mo" className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Financial Impact (AED)</label>
                <input type="number" name="financialImpact" value={form.financialImpact} onChange={handleFormChange}
                  step="0.01" placeholder="0.00" className={inputClass} />
                <p className="text-xs text-slate-500 mt-1">Enter 0 for administrative changes with no financial impact. Can be negative for reductions.</p>
              </div>

              {/* Live VAT / Total */}
              <div className="bg-slate-800/60 border border-white/10 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Financial Summary</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Financial Impact</span>
                  <span className="text-white font-medium">AED {fmt(impact)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">VAT (5%)</span>
                  <span className="text-amber-400 font-medium">AED {fmt(vatAmount)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-white/10 pt-2">
                  <span className="text-white font-semibold">Total Impact</span>
                  <span className="text-emerald-400 font-bold">AED {fmt(totalImpact)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Submitted By</label>
                  <input name="submittedBy" value={form.submittedBy} onChange={handleFormChange}
                    placeholder="Staff name" className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Notes</label>
                <textarea name="notes" value={form.notes} onChange={handleFormChange}
                  placeholder="Additional notes or context…" rows={2}
                  className={`${inputClass} resize-none`} />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-violet-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  {saving ? 'Creating…' : 'Create Amendment'}
                </button>
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Approve Modal ─── */}
      {showApproveModal && approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-600/40 flex items-center justify-center">
                <Check className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Approve Amendment</h3>
                <p className="text-xs text-slate-400">{approveTarget.amendmentNo}</p>
              </div>
            </div>
            <p className="text-sm text-slate-300">
              Approving: <span className="text-white font-medium">{approveTarget.description}</span>
            </p>
            {approveTarget.financialImpact > 0 && (
              <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-4 py-3 text-sm text-emerald-300">
                Total financial impact: <span className="font-bold">AED {fmt(approveTarget.totalImpact)}</span> (incl. VAT)
              </div>
            )}
            <div>
              <label className={labelClass}>Approved By</label>
              <input value={approvedBy} onChange={e => setApprovedBy(e.target.value)}
                placeholder="Your name / approver name" className={inputClass} />
            </div>
            <div className="flex gap-3">
              <button onClick={confirmApprove}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors">
                Confirm Approval
              </button>
              <button onClick={() => { setShowApproveModal(false); setApproveTarget(null); }}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reject Modal ─── */}
      {showRejectModal && rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-600/40 flex items-center justify-center">
                <X className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Reject Amendment</h3>
                <p className="text-xs text-slate-400">{rejectTarget.amendmentNo}</p>
              </div>
            </div>
            <p className="text-sm text-slate-300">
              Rejecting: <span className="text-white font-medium">{rejectTarget.description}</span>
            </p>
            <div>
              <label className={labelClass}>Rejection Reason <span className="text-red-400">*</span></label>
              <textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Provide a clear reason for rejection…"
                rows={4}
                className={`${inputClass} resize-none`}
                required
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={confirmReject}
                disabled={!rejectionReason.trim()}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Confirm Rejection
              </button>
              <button onClick={() => { setShowRejectModal(false); setRejectTarget(null); }}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
