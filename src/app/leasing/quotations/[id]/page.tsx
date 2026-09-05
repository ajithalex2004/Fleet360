'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Printer,
  Check,
  FileText,
  Download,
  X,
  CheckCircle,
} from 'lucide-react';

interface Vehicle {
  id?: string;
  vehicleType: string;
  make: string | null;
  model: string | null;
  year: number | null;
  quantity: number | null;
  monthlyRate: number | string | null;
}

interface ApprovalStep {
  id: string;
  stepName: string;
  stepOrder: number;
  status: string;
  approverName: string | null;
  comments: string | null;
  actionAt: string | null;
}

interface LeaseQuotation {
  id: string;
  quotationNumber: string | null;
  lesseeId: string | null;
  lessee?: { name: string } | null;
  leaseType: string | null;
  durationMonths: number | null;
  startDate: string | null;
  endDate: string | null;
  currency: string | null;
  status: string;
  validUntil: string | null;
  vehicles: Vehicle[];
  baseMonthlyRate: number | string | null;
  interestRate: number | string | null;
  markupPct: number | string | null;
  accessoriesCost: number | string | null;
  servicesCost: number | string | null;
  insuranceCost: number | string | null;
  maintenanceCost: number | string | null;
  driverCost: number | string | null;
  totalMonthlyRate: number | string | null;
  totalContractValue: number | string | null;
  securityDeposit: number | string | null;
  mileageCap: number | null;
  insuranceIncluded: boolean | null;
  maintenanceIncluded: boolean | null;
  driverIncluded: boolean | null;
  notes: string | null;
  createdAt: string;
  history: ApprovalStep[];
}

// Mirrors the status-map the real approve endpoint advances through
// (src/app/api/leasing/quotations/[id]/approve/route.ts). REJECTED/CANCELLED
// are terminal and deliberately not part of the linear timeline.
const STATUS_PIPELINE = [
  'NEW',
  'PENDING_APPROVAL',
  'DRAFT_APPROVED',
  'SENT_TO_CUSTOMER',
  'CUSTOMER_APPROVED',
  'PENDING_CREDIT_APPROVAL',
  'CREDIT_APPROVED',
  'PO_PREPARATION',
  'PO_PREPARED',
  'DELIVERY_IN_PROGRESS',
  'DELIVERED',
];

// The approve endpoint auto-advances one step per call and sends the
// customer email itself once it reaches SENT_TO_CUSTOMER — there's no
// separate "send to customer" operation to wire up.
const CAN_APPROVE_STATUSES = ['NEW', 'PENDING_APPROVAL', 'DRAFT_APPROVED'];

// Matches ALLOWED_CONVERT_STATUSES in
// src/app/api/leasing/quotations/[id]/convert/route.ts
const CAN_CONVERT_STATUSES = [
  'CUSTOMER_APPROVED',
  'PENDING_CREDIT_APPROVAL',
  'CREDIT_APPROVED',
  'PO_PREPARATION',
  'PO_PREPARED',
  'DELIVERY_IN_PROGRESS',
  'DELIVERED',
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-AE');
}

function num(v: number | string | null | undefined) {
  return Number(v ?? 0);
}

export default function QuotationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const quotationId = params?.id as string;

  const [quotation, setQuotation] = useState<LeaseQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approverName, setApproverName] = useState('');
  const [approverComment, setApproverComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchQuotation = useCallback(async () => {
    const res = await fetch(`/api/leasing/quotations/${quotationId}`);
    if (!res.ok) {
      setNotFound(true);
      setQuotation(null);
      return;
    }
    const data = await res.json();
    setQuotation(data);
    setNotFound(false);
  }, [quotationId]);

  useEffect(() => {
    if (!quotationId) return;
    setLoading(true);
    fetchQuotation().finally(() => setLoading(false));
  }, [quotationId, fetchQuotation]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      NEW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      PENDING_APPROVAL: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
      DRAFT_APPROVED: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
      SENT_TO_CUSTOMER: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      CUSTOMER_APPROVED: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      PENDING_CREDIT_APPROVAL: 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30',
      CREDIT_APPROVED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      PO_PREPARATION: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      PO_PREPARED: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      DELIVERY_IN_PROGRESS: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      DELIVERED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
      CANCELLED: 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30',
    };
    return colors[status] || colors.NEW;
  };

  const isStepCompleted = (step: string) => {
    const currentIndex = STATUS_PIPELINE.indexOf(quotation?.status as string);
    const stepIndex = STATUS_PIPELINE.indexOf(step);
    return currentIndex >= 0 && stepIndex < currentIndex;
  };

  const isStepCurrent = (step: string) => quotation?.status === step;

  const handleApproveInternally = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approverName.trim()) {
      setActionError('Enter an approver name first');
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      const res = await fetch(`/api/leasing/quotations/${quotationId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE',
          approverName,
          comments: approverComment || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record approval');
      }
      await fetchQuotation();
      setShowApproveModal(false);
      setApproverName('');
      setApproverComment('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record approval');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConvertToContract = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      const res = await fetch(`/api/leasing/quotations/${quotationId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to convert quotation');
      }
      const result = await res.json();
      router.push(`/leasing/contracts-v2/${result.contract.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to convert quotation');
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0c1a3e] p-8 flex items-center justify-center">
        <div className="text-[var(--text-muted)]">Loading quotation...</div>
      </div>
    );
  }

  if (notFound || !quotation) {
    return (
      <div className="min-h-screen bg-[#0c1a3e] p-8 flex items-center justify-center">
        <div className="text-[var(--text-muted)]">Quotation not found.</div>
      </div>
    );
  }

  const base = num(quotation.baseMonthlyRate);
  const interestAmount = base * (num(quotation.interestRate) / 100);
  const markupAmount = base * (num(quotation.markupPct) / 100);
  const accessoriesCost = num(quotation.accessoriesCost);
  const servicesCost = num(quotation.servicesCost);
  const insuranceCost = num(quotation.insuranceCost);
  const maintenanceCost = num(quotation.maintenanceCost);
  const driverCost = num(quotation.driverCost);
  const totalMonthlyRate = num(quotation.totalMonthlyRate);
  const totalContractValue = num(quotation.totalContractValue);
  const securityDeposit = num(quotation.securityDeposit);
  const lesseeName = quotation.lessee?.name ?? quotation.lesseeId ?? '—';

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] p-8 print:bg-white">
      <div className="mx-auto max-w-7xl">
        {/* Top Bar */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="text-[var(--text-muted)] hover:text-[var(--text-main)] print:hidden"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-main)] print:text-black">
                {quotation.quotationNumber ?? '(unnumbered)'}
              </h1>
              <p className="text-[var(--text-muted)] print:text-[var(--text-faint)] text-sm">
                Quotation dated {fmtDate(quotation.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(
                quotation.status
              )}`}
            >
              {quotation.status.replace(/_/g, ' ')}
            </span>
            <a
              href={`/api/leasing/quotations/${quotation.id}/pdf?lang=en&download=1`}
              className="rounded-xl bg-emerald-700/80 border border-emerald-500/30 px-4 py-2 text-sm font-medium text-[var(--text-main)] hover:bg-emerald-600 flex items-center gap-2"
              title="Download bilingual PDF (English layout)"
            >
              <Download className="h-4 w-4" />
              PDF (EN)
            </a>
            <a
              href={`/api/leasing/quotations/${quotation.id}/pdf?lang=ar&download=1`}
              className="rounded-xl bg-emerald-700/80 border border-emerald-500/30 px-4 py-2 text-sm font-medium text-[var(--text-main)] hover:bg-emerald-600 flex items-center gap-2"
              title="Download bilingual PDF (Arabic layout)"
            >
              <Download className="h-4 w-4" />
              PDF (AR)
            </a>
            <button
              onClick={() => window.print()}
              className="rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8 print:grid-cols-2">
          {/* Left Column */}
          <div className="col-span-2 space-y-6">
            {/* Quotation Header Card */}
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 print:border-gray-300 print:bg-white">
              <h2 className="text-lg font-semibold text-[var(--text-main)] print:text-black mb-4">
                Quotation Details
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Quotation Number
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {quotation.quotationNumber ?? '(unnumbered)'}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Issued Date
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {fmtDate(quotation.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Valid Until
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {fmtDate(quotation.validUntil)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Lessee Name
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {lesseeName}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Lease Type
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {quotation.leaseType ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Duration
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {quotation.durationMonths ?? '—'} months
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Currency
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {quotation.currency ?? 'AED'}
                  </p>
                </div>
              </div>
            </div>

            {/* Vehicle Summary Table */}
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl overflow-hidden print:border-gray-300 print:bg-white">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-[var(--text-main)] print:text-black mb-4">
                  Vehicle Summary
                </h2>
              </div>
              <table className="w-full">
                <thead className="bg-[var(--bg-surface)]/50 print:bg-gray-100">
                  <tr className="border-b border-[var(--border-subtle)] print:border-gray-300">
                    <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] print:text-black">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] print:text-black">
                      Make
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] print:text-black">
                      Model
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] print:text-black">
                      Year
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] print:text-black">
                      Qty
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] print:text-black">
                      Monthly Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quotation.vehicles.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-sm text-[var(--text-faint)] print:text-[var(--text-faint)]">
                        No vehicles on this quotation.
                      </td>
                    </tr>
                  )}
                  {quotation.vehicles.map((vehicle, index) => (
                    <tr
                      key={vehicle.id ?? index}
                      className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] print:border-gray-300"
                    >
                      <td className="px-6 py-4 text-sm text-[var(--text-main)] print:text-black">
                        {vehicle.vehicleType}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-main)] print:text-black">
                        {vehicle.make ?? '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-main)] print:text-black">
                        {vehicle.model ?? '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-main)] print:text-black">
                        {vehicle.year ?? '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-main)] print:text-black">
                        {vehicle.quantity ?? 1}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-main)] print:text-black font-medium">
                        {(num(vehicle.monthlyRate) * (vehicle.quantity ?? 1)).toLocaleString('en-AE')}{' '}
                        {quotation.currency ?? 'AED'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cost Breakdown Card */}
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 print:border-gray-300 print:bg-white">
              <h2 className="text-lg font-semibold text-[var(--text-main)] print:text-black mb-4">
                Cost Breakdown
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                    Base Monthly Rate
                  </span>
                  <span className="text-[var(--text-main)] print:text-black font-medium">
                    {base.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                  </span>
                </div>
                {interestAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                      Interest ({num(quotation.interestRate)}%)
                    </span>
                    <span className="text-[var(--text-main)] print:text-black">
                      {interestAmount.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                    </span>
                  </div>
                )}
                {markupAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                      Markup ({num(quotation.markupPct)}%)
                    </span>
                    <span className="text-[var(--text-main)] print:text-black">
                      {markupAmount.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                    </span>
                  </div>
                )}
                {accessoriesCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                      Accessories
                    </span>
                    <span className="text-[var(--text-main)] print:text-black">
                      {accessoriesCost.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                    </span>
                  </div>
                )}
                {servicesCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                      Services
                    </span>
                    <span className="text-[var(--text-main)] print:text-black">
                      {servicesCost.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                    </span>
                  </div>
                )}
                {quotation.insuranceIncluded && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                      Insurance
                    </span>
                    <span className="text-[var(--text-main)] print:text-black">
                      {insuranceCost.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                    </span>
                  </div>
                )}
                {quotation.maintenanceIncluded && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                      Maintenance
                    </span>
                    <span className="text-[var(--text-main)] print:text-black">
                      {maintenanceCost.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                    </span>
                  </div>
                )}
                {quotation.driverIncluded && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)] print:text-[var(--text-faint)]">
                      Driver
                    </span>
                    <span className="text-[var(--text-main)] print:text-black">
                      {driverCost.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                    </span>
                  </div>
                )}
                <div className="border-t border-[var(--border-subtle)] print:border-gray-300 pt-3 mt-3 flex justify-between font-semibold">
                  <span className="text-[var(--text-main)] print:text-black">
                    Total Monthly Rate
                  </span>
                  <span className="text-emerald-400 print:text-green-600 text-lg">
                    {totalMonthlyRate.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                  </span>
                </div>
                <div className="bg-blue-600/10 print:bg-blue-50 border border-blue-500/30 print:border-blue-300 rounded-lg p-3 flex justify-between items-center">
                  <span className="text-[var(--text-main)] print:text-black font-semibold">
                    Total Contract Value
                  </span>
                  <span className="text-blue-400 print:text-blue-600 text-2xl font-bold">
                    {totalContractValue.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                  </span>
                </div>
              </div>
            </div>

            {/* Contract Terms Card */}
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 print:border-gray-300 print:bg-white">
              <h2 className="text-lg font-semibold text-[var(--text-main)] print:text-black mb-4">
                Contract Terms
              </h2>
              <div className="space-y-4">
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)] text-sm mb-1">
                    Mileage Cap
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {(quotation.mileageCap ?? 0).toLocaleString('en-AE')} km
                  </p>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-[var(--text-muted)] print:text-[var(--text-faint)] text-sm mb-2">
                      Insurance Included
                    </p>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 print:bg-green-100 print:text-green-700 print:border-green-300">
                      {quotation.insuranceIncluded ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)] print:text-[var(--text-faint)] text-sm mb-2">
                      Maintenance Included
                    </p>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 print:bg-green-100 print:text-green-700 print:border-green-300">
                      {quotation.maintenanceIncluded ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)] print:text-[var(--text-faint)] text-sm mb-2">
                      Driver Included
                    </p>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 print:bg-red-100 print:text-red-700 print:border-red-300">
                      {quotation.driverIncluded ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] print:text-[var(--text-faint)] text-sm mb-1">
                    Security Deposit
                  </p>
                  <p className="text-[var(--text-main)] print:text-black font-medium">
                    {securityDeposit.toLocaleString('en-AE')} {quotation.currency ?? 'AED'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6 print:hidden">
            {/* Status Timeline */}
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-[var(--text-main)] mb-4">
                Status Timeline
              </h2>
              <div className="space-y-4">
                {STATUS_PIPELINE.map((status, index) => {
                  const isCompleted = isStepCompleted(status);
                  const isCurrent = isStepCurrent(status);

                  return (
                    <div key={status} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center font-medium text-sm ${
                            isCompleted
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : isCurrent
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-[var(--bg-surface-hover)]/50 text-[var(--text-muted)] border border-[var(--border-strong)]/50'
                          }`}
                        >
                          {isCompleted ? (
                            <CheckCircle className="h-5 w-5" />
                          ) : (
                            index + 1
                          )}
                        </div>
                        {index < STATUS_PIPELINE.length - 1 && (
                          <div
                            className={`w-0.5 h-8 mt-2 ${
                              isCompleted
                                ? 'bg-emerald-500/30'
                                : 'bg-[var(--bg-surface-hover)]/50'
                            }`}
                          />
                        )}
                      </div>
                      <div className="flex-1 pt-1">
                        <p
                          className={`text-sm font-medium ${
                            isCompleted || isCurrent
                              ? 'text-[var(--text-main)]'
                              : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {status.replace(/_/g, ' ')}
                        </p>
                        {isCompleted && (
                          <p className="text-xs text-emerald-400 mt-1">
                            Completed
                          </p>
                        )}
                        {isCurrent && (
                          <p className="text-xs text-blue-400 mt-1">Current</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Approval Steps */}
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-[var(--text-main)] mb-4">
                Approval Steps
              </h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {quotation.history.length === 0 && (
                  <p className="text-xs text-[var(--text-faint)]">
                    No approval steps recorded yet.
                  </p>
                )}
                {quotation.history.map((step) => (
                  <div
                    key={step.id}
                    className="bg-[var(--bg-surface-hover)]/30 border border-[var(--border-subtle)] rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-[var(--text-main)]">
                        {step.stepName}
                      </p>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          step.status === 'APPROVED'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : step.status === 'REJECTED'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {step.status}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mb-1">
                      {step.approverName ?? 'Unassigned'}
                    </p>
                    {step.comments && (
                      <p className="text-xs text-[var(--text-faint)]">{step.comments}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            {CAN_APPROVE_STATUSES.includes(quotation.status) && (
              <button
                onClick={() => setShowApproveModal(true)}
                className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 flex items-center justify-center gap-2"
              >
                <Check className="h-4 w-4" />
                Approve Internally
              </button>
            )}
            {CAN_CONVERT_STATUSES.includes(quotation.status) && (
              <button
                onClick={handleConvertToContract}
                disabled={actionLoading}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                {actionLoading ? 'Converting...' : 'Convert to Contract'}
              </button>
            )}
            {actionError && !showApproveModal && (
              <p className="text-xs text-red-400">{actionError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Approve Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--text-main)]">Approve Internally</h2>
              <button
                onClick={() => setShowApproveModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleApproveInternally} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">
                  Approver Name *
                </label>
                <input
                  type="text"
                  required
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">
                  Comments
                </label>
                <textarea
                  value={approverComment}
                  onChange={(e) => setApproverComment(e.target.value)}
                  rows={3}
                  className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                  placeholder="Add your comments..."
                />
              </div>

              {actionError && (
                <p className="text-xs text-red-400">{actionError}</p>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {actionLoading ? 'Approving...' : 'Approve'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowApproveModal(false)}
                  className="flex-1 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            background: white;
            color: black;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:text-black {
            color: black !important;
          }
          .print\\:text-[var(--text-faint)] {
            color: #4b5563 !important;
          }
          .print\\:border-gray-300 {
            border-color: #d1d5db !important;
          }
          .print\\:bg-white {
            background-color: white !important;
          }
          .print\\:bg-gray-100 {
            background-color: #f3f4f6 !important;
          }
          .print\\:grid-cols-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .print\\:bg-blue-50 {
            background-color: #eff6ff !important;
          }
          .print\\:bg-blue-100 {
            background-color: #dbeafe !important;
          }
          .print\\:text-blue-600 {
            color: #2563eb !important;
          }
          .print\\:border-blue-300 {
            border-color: #93c5fd !important;
          }
          .print\\:bg-green-100 {
            background-color: #dcfce7 !important;
          }
          .print\\:text-green-700 {
            color: #15803d !important;
          }
          .print\\:border-green-300 {
            border-color: #86efac !important;
          }
          .print\\:bg-red-100 {
            background-color: #fee2e2 !important;
          }
          .print\\:text-red-700 {
            color: #b91c1c !important;
          }
          .print\\:border-red-300 {
            border-color: #fca5a5 !important;
          }
        }
      `}</style>
    </div>
  );
}
