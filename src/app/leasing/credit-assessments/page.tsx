'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import RowActionMenu from '@/components/ui/RowActionMenu';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';

interface CreditAssessment {
  id: string;
  lesseeId: string;
  lessee: { name: string; id: string; type: string };
  assessmentDate: string;
  creditScore: number;
  riskRating: 'LOW' | 'MEDIUM' | 'HIGH';
  creditLimit: number;
  currentExposure: number;
  recommendedLimit: number;
  paymentHistory: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  annualRevenue: number;
  yearsInBusiness: number;
  assessedBy: string;
  validUntil: string;
  status: string;
  notes: string;
}

interface Lessee {
  id: string;
  name: string;
  type: string;
}

type AssessmentForm = {
  lesseeId: string;
  assessmentDate: string;
  creditScore: string;
  riskRating: 'LOW' | 'MEDIUM' | 'HIGH';
  creditLimit: string;
  annualRevenue: string;
  yearsInBusiness: string;
  paymentHistory: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  recommendedLimit: string;
  assessedBy: string;
  validUntil: string;
  status: string;
  notes: string;
};

const EMPTY_FORM: AssessmentForm = {
  lesseeId: '',
  assessmentDate: '',
  creditScore: '',
  riskRating: 'LOW',
  creditLimit: '',
  annualRevenue: '',
  yearsInBusiness: '',
  paymentHistory: 'GOOD',
  recommendedLimit: '',
  assessedBy: '',
  validUntil: '',
  status: 'ACTIVE',
  notes: '',
};

const formatCurrency = (value: number) => `${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED`;

const toDateInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const numberValue = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getRiskBadgeColor = (risk: string) => {
  switch (risk) {
    case 'LOW':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'MEDIUM':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'HIGH':
      return 'bg-rose-900/30 text-rose-200 border-rose-700';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

const getPaymentHistoryBadgeColor = (history: string) => {
  switch (history) {
    case 'EXCELLENT':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'GOOD':
      return 'bg-blue-900/30 text-blue-200 border-blue-700';
    case 'FAIR':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'POOR':
      return 'bg-red-900/30 text-red-200 border-red-700';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'UNDER_REVIEW':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'EXPIRED':
      return 'bg-rose-900/30 text-rose-200 border-rose-700';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

function getExposureState(currentExposure: number, creditLimit: number) {
  const exposure = numberValue(currentExposure);
  const limit = numberValue(creditLimit);
  if (limit <= 0) {
    return { ratio: 1, label: 'No approved limit', tone: 'rose' as const };
  }
  const ratio = exposure / limit;
  if (ratio >= 1) return { ratio: 1, label: 'Limit exceeded', tone: 'rose' as const };
  if (ratio >= 0.8) return { ratio, label: 'Near limit', tone: 'amber' as const };
  return { ratio, label: 'Within limit', tone: 'emerald' as const };
}

function normalizeAssessment(item: CreditAssessment): CreditAssessment {
  return {
    ...item,
    creditScore: numberValue(item.creditScore),
    creditLimit: numberValue(item.creditLimit),
    currentExposure: numberValue(item.currentExposure),
    recommendedLimit: numberValue(item.recommendedLimit),
    annualRevenue: numberValue(item.annualRevenue),
    yearsInBusiness: numberValue(item.yearsInBusiness),
  };
}

function toFormData(item?: CreditAssessment | null): AssessmentForm {
  if (!item) return { ...EMPTY_FORM };
  return {
    lesseeId: item.lesseeId,
    assessmentDate: toDateInput(item.assessmentDate),
    creditScore: String(numberValue(item.creditScore) || ''),
    riskRating: item.riskRating ?? 'LOW',
    creditLimit: String(numberValue(item.creditLimit) || ''),
    annualRevenue: String(numberValue(item.annualRevenue) || ''),
    yearsInBusiness: String(numberValue(item.yearsInBusiness) || ''),
    paymentHistory: item.paymentHistory ?? 'GOOD',
    recommendedLimit: String(numberValue(item.recommendedLimit) || ''),
    assessedBy: item.assessedBy ?? '',
    validUntil: toDateInput(item.validUntil),
    status: item.status ?? 'ACTIVE',
    notes: item.notes ?? '',
  };
}

export default function CreditAssessmentsPage() {
  const [assessments, setAssessments] = useState<CreditAssessment[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  const [formData, setFormData] = useState<AssessmentForm>({ ...EMPTY_FORM });
  const [selectedLesseeId, setSelectedLesseeId] = useState('');
  const [sortKey, setSortKey] = useState<'lessee' | 'assessmentDate' | 'creditScore' | 'riskRating' | 'currentExposure' | 'validUntil' | 'status'>('lessee');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState({
    lessee: '',
    assessmentDate: '',
    creditScore: '',
    riskRating: 'All',
    currentExposure: '',
    validUntil: '',
    status: 'All',
  });

  const fetchAssessments = useCallback(async (lesseeId?: string) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (lesseeId) params.set('lesseeId', lesseeId);
      const response = await fetch(`/api/leasing/credit-assessments${params.toString() ? `?${params.toString()}` : ''}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Failed to fetch assessments');
      }
      const data = await response.json();
      setAssessments(Array.isArray(data) ? data.map(normalizeAssessment) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching assessments');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLessees = useCallback(async () => {
    try {
      const response = await fetch('/api/leasing/lessees');
      if (!response.ok) throw new Error('Failed to fetch lessees');
      const data = await response.json();
      setLessees(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching lessees:', err);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lesseeId = params.get('lesseeId') ?? '';
    setSelectedLesseeId(lesseeId);
    void fetchAssessments(lesseeId || undefined);
    void fetchLessees();
  }, [fetchAssessments, fetchLessees]);

  const totalAssessed = assessments.length;
  const avgCreditScore = totalAssessed > 0
    ? Math.round(assessments.reduce((sum, a) => sum + numberValue(a.creditScore), 0) / totalAssessed)
    : 0;
  const highRiskCount = assessments.filter(a => a.riskRating === 'HIGH').length;
  const totalExposure = assessments.reduce((sum, a) => sum + numberValue(a.currentExposure), 0);
  const overLimitCount = assessments.filter(a => getExposureState(a.currentExposure, a.creditLimit).tone === 'rose').length;

  const selectedLesseeName = useMemo(
    () => lessees.find(lessee => lessee.id === selectedLesseeId)?.name ?? null,
    [lessees, selectedLesseeId],
  );

  const displayedAssessments = useMemo(() => {
    const filtered = assessments.filter((assessment) => {
      return (
        (!columnFilters.lessee || assessment.lessee.name.toLowerCase().includes(columnFilters.lessee.toLowerCase())) &&
        (!columnFilters.assessmentDate || toDateInput(assessment.assessmentDate).includes(columnFilters.assessmentDate)) &&
        (!columnFilters.creditScore || String(assessment.creditScore).includes(columnFilters.creditScore)) &&
        (columnFilters.riskRating === 'All' || assessment.riskRating === columnFilters.riskRating) &&
        (!columnFilters.currentExposure || String(assessment.currentExposure).includes(columnFilters.currentExposure)) &&
        (!columnFilters.validUntil || toDateInput(assessment.validUntil).includes(columnFilters.validUntil)) &&
        (columnFilters.status === 'All' || assessment.status === columnFilters.status)
      );
    });

    filtered.sort((left, right) => {
      const leftValue = ({
        lessee: left.lessee.name,
        assessmentDate: toDateInput(left.assessmentDate),
        creditScore: left.creditScore,
        riskRating: left.riskRating,
        currentExposure: left.currentExposure,
        validUntil: toDateInput(left.validUntil),
        status: left.status,
      })[sortKey];
      const rightValue = ({
        lessee: right.lessee.name,
        assessmentDate: toDateInput(right.assessmentDate),
        creditScore: right.creditScore,
        riskRating: right.riskRating,
        currentExposure: right.currentExposure,
        validUntil: toDateInput(right.validUntil),
        status: right.status,
      })[sortKey];
      const comparison =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [assessments, columnFilters, sortDirection, sortKey]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const openCreateModal = () => {
    setEditingAssessmentId(null);
    setFormData({
      ...EMPTY_FORM,
      lesseeId: selectedLesseeId || '',
      assessedBy: 'System User',
      assessmentDate: toDateInput(new Date().toISOString()),
    });
    setError(null);
    setSavedMsg(null);
    setShowModal(true);
  };

  const openEditModal = (assessment: CreditAssessment) => {
    setEditingAssessmentId(assessment.id);
    setFormData(toFormData(assessment));
    setError(null);
    setSavedMsg(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingAssessmentId(null);
    setFormData({ ...EMPTY_FORM });
  };

  const refreshAssessments = async () => {
    setSavedMsg(null);
    await fetchAssessments(selectedLesseeId || undefined);
  };

  const handleSaveAssessment = async () => {
    try {
      setBusyId(editingAssessmentId ?? 'new');
      setError(null);
      setSavedMsg(null);
      const payload = {
        ...formData,
        creditScore: Number.parseInt(formData.creditScore || '0', 10),
        creditLimit: Number.parseFloat(formData.creditLimit || '0'),
        annualRevenue: Number.parseFloat(formData.annualRevenue || '0'),
        yearsInBusiness: Number.parseInt(formData.yearsInBusiness || '0', 10),
        recommendedLimit: Number.parseFloat(formData.recommendedLimit || '0'),
      };
      const response = await fetch(
        editingAssessmentId ? `/api/leasing/credit-assessments/${editingAssessmentId}` : '/api/leasing/credit-assessments',
        {
          method: editingAssessmentId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `Failed to ${editingAssessmentId ? 'update' : 'create'} assessment`);
      setSavedMsg(editingAssessmentId ? 'Assessment updated.' : 'Assessment created.');
      closeModal();
      await fetchAssessments(selectedLesseeId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save assessment');
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (assessment: CreditAssessment, nextStatus: 'ACTIVE' | 'UNDER_REVIEW') => {
    try {
      setBusyId(assessment.id);
      setError(null);
      setSavedMsg(null);
      const response = await fetch(`/api/leasing/credit-assessments/${assessment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? 'Failed to update assessment status');
      setAssessments(prev => prev.map(item => item.id === assessment.id ? normalizeAssessment({ ...item, ...body, lessee: item.lessee }) : item));
      setSavedMsg(nextStatus === 'ACTIVE' ? 'Assessment activated.' : 'Assessment deactivated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update assessment status');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Credit Assessments</h1>
            <p className="mt-1 text-sm text-slate-400">
              Keep lessee credit readiness visible before approving quotations or activating contracts.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void refreshAssessments()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-100 transition hover:bg-slate-700"
            >
              <RefreshCw size={16} /> Refresh
            </button>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
            >
              <Plus size={20} /> New Assessment
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <label className="block min-w-[280px]">
            <span className="mb-1 block text-sm font-medium text-slate-300">Filter by lessee</span>
            <select
              value={selectedLesseeId}
              onChange={(event) => {
                const next = event.target.value;
                setSelectedLesseeId(next);
                void fetchAssessments(next || undefined);
              }}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
            >
              <option value="">All lessees</option>
              {lessees.map(lessee => (
                <option key={lessee.id} value={lessee.id}>{lessee.name}</option>
              ))}
            </select>
          </label>
          {selectedLesseeName && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-200">
              Focused on {selectedLesseeName}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-700 bg-rose-900/30 px-4 py-3 text-rose-200">
            {error}
          </div>
        )}
        {savedMsg && (
          <div className="mb-4 rounded-lg border border-emerald-700 bg-emerald-900/30 px-4 py-3 text-emerald-200">
            {savedMsg}
          </div>
        )}

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Total Assessed" value={String(totalAssessed)} tone="blue" />
          <SummaryCard label="Avg Credit Score" value={String(avgCreditScore)} tone="emerald" />
          <SummaryCard label="High Risk Count" value={String(highRiskCount)} tone="rose" />
          <SummaryCard label="Total Exposure" value={formatCurrency(totalExposure)} tone="amber" />
          <SummaryCard label="Over Limit" value={String(overLimitCount)} tone="violet" />
        </div>

        {loading ? (
          <div className="py-12 text-center">Loading assessments...</div>
        ) : (
          <div className="smart-data-grid-surface">
            <table className="w-full text-sm">
              <SmartDataGridHeader
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={(key) => toggleSort(key as typeof sortKey)}
                columnResizeStorageKey="leasing-credit-assessments-column-widths"
                columns={[
                  { key: 'lessee', label: 'Lessee', sortable: true, filter: <input value={columnFilters.lessee} onChange={(e) => setColumnFilters((prev) => ({ ...prev, lessee: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
                  { key: 'assessmentDate', label: 'Assessment', sortable: true, filter: <input value={columnFilters.assessmentDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, assessmentDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
                  { key: 'creditScore', label: 'Score', sortable: true, headerClassName: 'text-right', filterClassName: 'text-right', filter: <input value={columnFilters.creditScore} onChange={(e) => setColumnFilters((prev) => ({ ...prev, creditScore: e.target.value }))} placeholder="Score..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-right text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
                  { key: 'riskRating', label: 'Risk', sortable: true, filter: <select value={columnFilters.riskRating} onChange={(e) => setColumnFilters((prev) => ({ ...prev, riskRating: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"><option>All</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select> },
                  { key: 'currentExposure', label: 'Exposure vs Limit', sortable: true, filter: <input value={columnFilters.currentExposure} onChange={(e) => setColumnFilters((prev) => ({ ...prev, currentExposure: e.target.value }))} placeholder="Amount..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
                  { key: 'validUntil', label: 'Validity', sortable: true, filter: <input value={columnFilters.validUntil} onChange={(e) => setColumnFilters((prev) => ({ ...prev, validUntil: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
                  { key: 'status', label: 'Status', sortable: true, filter: <select value={columnFilters.status} onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"><option>All</option><option>ACTIVE</option><option>UNDER_REVIEW</option><option>EXPIRED</option></select> },
                ]}
                actionHeader="Actions"
              />
              <tbody>
                {displayedAssessments.map(assessment => {
                  const exposure = getExposureState(assessment.currentExposure, assessment.creditLimit);
                  return (
                    <tr key={assessment.id} className="border-b border-slate-700/80 hover:bg-slate-750">
                      <td className="px-4 py-4 align-top">
                        <div className="font-medium">{assessment.lessee.name}</div>
                        <div className="mt-1 text-xs text-slate-400">{assessment.lessee.type}</div>
                        <div className="mt-2 text-xs text-slate-500">Assessed by {assessment.assessedBy || '-'}</div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="text-sm text-slate-200">{toDateInput(assessment.assessmentDate) || '-'}</div>
                        <div className="mt-1 text-xs text-slate-400">{assessment.yearsInBusiness} years in business</div>
                        <div className="mt-2 text-xs text-slate-500">Revenue {formatCurrency(assessment.annualRevenue)}</div>
                      </td>
                      <td className="px-4 py-4 text-right align-top font-semibold">{assessment.creditScore}</td>
                      <td className="px-4 py-4 align-top">
                        <span className={`rounded border px-2 py-1 text-xs ${getRiskBadgeColor(assessment.riskRating)}`}>
                          {assessment.riskRating}
                        </span>
                        <div className="mt-2">
                          <span className={`rounded border px-2 py-1 text-xs ${getPaymentHistoryBadgeColor(assessment.paymentHistory)}`}>
                            {assessment.paymentHistory}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top min-w-[260px]">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-slate-300">{formatCurrency(assessment.currentExposure)}</span>
                          <span className="text-slate-500">of {formatCurrency(assessment.creditLimit)}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-900">
                          <div
                            className={`h-full rounded-full ${
                              exposure.tone === 'rose'
                                ? 'bg-rose-500'
                                : exposure.tone === 'amber'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(exposure.ratio * 100, 100)}%` }}
                          />
                        </div>
                        <div className={`mt-2 text-xs ${
                          exposure.tone === 'rose'
                            ? 'text-rose-300'
                            : exposure.tone === 'amber'
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                        }`}>
                          {exposure.label}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Recommended limit {formatCurrency(assessment.recommendedLimit)}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div>{toDateInput(assessment.validUntil) || '-'}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          {new Date(assessment.validUntil) < new Date() ? 'Expired' : 'Valid'}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={`rounded border px-2 py-1 text-xs ${getStatusBadgeColor(assessment.status)}`}>
                          {assessment.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex justify-end">
                          <RowActionMenu
                            actions={[
                              {
                                label: 'Edit',
                                onSelect: () => openEditModal(assessment),
                              },
                              ...(assessment.status === 'ACTIVE'
                                ? [
                                    {
                                      label: 'Deactivate',
                                      onSelect: () => void handleStatusChange(assessment, 'UNDER_REVIEW'),
                                      disabled: busyId === assessment.id,
                                      tone: 'danger' as const,
                                    },
                                  ]
                                : [
                                    {
                                      label: 'Activate',
                                      onSelect: () => void handleStatusChange(assessment, 'ACTIVE'),
                                      disabled: busyId === assessment.id,
                                    },
                                  ]),
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!displayedAssessments.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                      No credit assessments found for the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-800">
              <div className="flex items-center justify-between border-b border-slate-700 p-6">
                <h2 className="text-xl font-bold">{editingAssessmentId ? 'Edit Credit Assessment' : 'New Credit Assessment'}</h2>
                <button onClick={closeModal} className="text-slate-400 transition hover:text-slate-200">X</button>
              </div>
              <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
                <Field label="Lessee">
                  <select
                    value={formData.lesseeId}
                    onChange={e => setFormData(prev => ({ ...prev, lesseeId: e.target.value }))}
                    disabled={Boolean(editingAssessmentId)}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 disabled:opacity-60"
                  >
                    <option value="">Select lessee</option>
                    {lessees.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={formData.status}
                    onChange={e => setFormData(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                    <option value="EXPIRED">EXPIRED</option>
                  </select>
                </Field>
                <Field label="Assessment Date">
                  <input
                    type="date"
                    value={formData.assessmentDate}
                    onChange={e => setFormData(prev => ({ ...prev, assessmentDate: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Valid Until">
                  <input
                    type="date"
                    value={formData.validUntil}
                    onChange={e => setFormData(prev => ({ ...prev, validUntil: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Credit Score">
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={formData.creditScore}
                    onChange={e => setFormData(prev => ({ ...prev, creditScore: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Risk Rating">
                  <select
                    value={formData.riskRating}
                    onChange={e => setFormData(prev => ({ ...prev, riskRating: e.target.value as AssessmentForm['riskRating'] }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                  </select>
                </Field>
                <Field label="Credit Limit (AED)">
                  <input
                    type="number"
                    value={formData.creditLimit}
                    onChange={e => setFormData(prev => ({ ...prev, creditLimit: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Recommended Limit (AED)">
                  <input
                    type="number"
                    value={formData.recommendedLimit}
                    onChange={e => setFormData(prev => ({ ...prev, recommendedLimit: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Annual Revenue (AED)">
                  <input
                    type="number"
                    value={formData.annualRevenue}
                    onChange={e => setFormData(prev => ({ ...prev, annualRevenue: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Years In Business">
                  <input
                    type="number"
                    value={formData.yearsInBusiness}
                    onChange={e => setFormData(prev => ({ ...prev, yearsInBusiness: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Payment History">
                  <select
                    value={formData.paymentHistory}
                    onChange={e => setFormData(prev => ({ ...prev, paymentHistory: e.target.value as AssessmentForm['paymentHistory'] }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  >
                    <option value="EXCELLENT">EXCELLENT</option>
                    <option value="GOOD">GOOD</option>
                    <option value="FAIR">FAIR</option>
                    <option value="POOR">POOR</option>
                  </select>
                </Field>
                <Field label="Assessed By">
                  <input
                    type="text"
                    value={formData.assessedBy}
                    onChange={e => setFormData(prev => ({ ...prev, assessedBy: e.target.value }))}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
                <Field label="Notes" className="md:col-span-2">
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    className="h-24 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                  />
                </Field>
              </div>
              <div className="flex gap-3 border-t border-slate-700 p-6">
                <button onClick={closeModal} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 transition hover:bg-slate-600">
                  Cancel
                </button>
                <button
                  onClick={() => void handleSaveAssessment()}
                  disabled={busyId === (editingAssessmentId ?? 'new')}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {editingAssessmentId ? 'Save Changes' : 'Create Assessment'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'emerald' | 'rose' | 'amber' | 'violet' }) {
  const toneClass = {
    blue: 'text-blue-400',
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
    violet: 'text-violet-400',
  }[tone];
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
      <p className="mb-1 text-sm text-slate-400">{label}</p>
      <p className={`text-3xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
