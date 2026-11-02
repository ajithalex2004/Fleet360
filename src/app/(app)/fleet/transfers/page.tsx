'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeftRight,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Car,
  MapPin,
  User,
  Gauge,
  Fuel,
  Tag,
  ExternalLink,
  RotateCcw,
  MoreVertical,
} from 'lucide-react';
import { VehicleRef } from '@/components/ui/EntityRef';

interface Transfer {
  id: string;
  transferNo: string;
  vehicleId: string;
  vehicleCode?: string;
  make?: string;
  model?: string;
  licensePlate?: string;
  fromBranchId?: string;
  fromBranchName: string;
  toBranchId?: string;
  toBranchName: string;
  transferDate: string;
  requestedBy: string;
  requestedById?: string;
  approvedBy: string;
  approvedById?: string;
  mileageAtTransfer: number;
  fuelLevelAtTransfer: number | string;
  reason: string;
  reasonId?: string;
  reasonType?: string;
  notes: string;
  status: string;
  createdAt?: string;
}

interface VehicleOption {
  id: string;
  vehicleCode?: string;
  licensePlate?: string;
  make?: string;
  model?: string;
  year?: number | string;
  branchId?: string;
  branchName?: string;
  currentLocation?: string;
  odometerReading?: number | string;
  currentMileage?: number | string;
  fuelLevel?: number | string;
  lifecycleStage?: string;
  status?: string;
}

interface BranchOption {
  id: string;
  name: string;
  emirate?: string;
}

interface EmployeeOption {
  id: string;
  employeeId: string;
  name: string;
  position?: string;
  department?: string;
  label: string;
}

interface NuiReasonOption {
  id: string;
  code: string;
  name: string;
  reasonType: string;
  label: string;
}

const EMPTY_FORM = {
  vehicleId: '',
  fromBranchId: '',
  fromBranchName: '',
  toBranchId: '',
  toBranchName: '',
  transferDate: new Date().toISOString().split('T')[0],
  requestedBy: '',
  requestedById: '',
  approvedBy: '',
  approvedById: '',
  mileageAtTransfer: 0,
  fuelLevelAtTransfer: 100,
  reason: '',
  reasonId: '',
  reasonType: 'TRANSFER',
  customReason: '',
  notes: '',
};

const statusBadge = (status: string) => {
  switch (status) {
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
          <Clock className="w-3 h-3" /> Pending
        </span>
      );
    case 'APPROVED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20">
          <CheckCircle2 className="w-3 h-3" /> Approved
        </span>
      );
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" /> Completed
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/15 text-slate-400 border border-slate-500/20">
          <XCircle className="w-3 h-3" /> Cancelled
        </span>
      );
    default:
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
          {status}
        </span>
      );
  }
};

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-transfer-actions]')) {
        setActiveActionMenuId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Master options
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [reasons, setReasons] = useState<NuiReasonOption[]>([]);
  const [, setLoadingOptions] = useState(false);

  // Modal & Form
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isCustomReason, setIsCustomReason] = useState(false);

  // Fetch transfers
  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '25');
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

  // Fetch dropdown options
  const fetchOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const [optRes, vehRes] = await Promise.all([
        fetch('/api/fleet/transfers/options'),
        fetch('/api/fleet/vehicles?limit=100'),
      ]);

      if (optRes.ok) {
        const optData = await optRes.json();
        if (optData.branches) setBranches(optData.branches);
        if (optData.employees) setEmployees(optData.employees);
        if (optData.reasons) setReasons(optData.reasons);
      }

      if (vehRes.ok) {
        const vehData = await vehRes.json();
        const vList = vehData.data ?? vehData.items ?? (Array.isArray(vehData) ? vehData : []);
        setVehicles(vList);
      }
    } catch (err) {
      console.warn('Error fetching transfer options:', err);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  // Selected vehicle in form
  const selectedVehicleObj = useMemo(() => {
    if (!formData.vehicleId) return null;
    return vehicles.find((v) => String(v.id) === String(formData.vehicleId)) || null;
  }, [formData.vehicleId, vehicles]);

  // Open modal
  const openCreate = () => {
    const today = new Date().toISOString().split('T')[0];
    const defaultEmp = employees[0];
    const defaultReason = reasons[0];

    setFormData({
      ...EMPTY_FORM,
      transferDate: today,
      requestedBy: defaultEmp ? defaultEmp.name : '',
      requestedById: defaultEmp ? defaultEmp.employeeId : '',
      approvedBy: employees[1] ? employees[1].name : (defaultEmp ? defaultEmp.name : ''),
      approvedById: employees[1] ? employees[1].employeeId : (defaultEmp ? defaultEmp.employeeId : ''),
      reason: defaultReason ? defaultReason.name : '',
      reasonId: defaultReason ? defaultReason.id : '',
      reasonType: defaultReason ? defaultReason.reasonType : 'TRANSFER',
      customReason: '',
    });
    setIsCustomReason(false);
    setFormError('');
    setShowModal(true);
  };

  // Handle vehicle dropdown change and auto-populate
  const handleVehicleChange = (vId: string) => {
    const veh = vehicles.find((v) => String(v.id) === String(vId));
    if (!veh) {
      setFormData((f) => ({ ...f, vehicleId: vId }));
      return;
    }

    const currentBranchName =
      veh.branchName ||
      veh.currentLocation ||
      (branches.length > 0 ? branches[0].name : 'Dubai Head Office (Al Quoz Hub)');
    const currentBranch = branches.find((b) => b.name === currentBranchName);
    const currentBranchId = veh.branchId || currentBranch?.id || 'BR-DXB-01';

    // Auto default target to a different branch if possible
    const otherBranch = branches.find((b) => b.id !== currentBranchId && b.name !== currentBranchName);
    const toBranchName = otherBranch ? otherBranch.name : (branches[1]?.name || '');
    const toBranchId = otherBranch ? otherBranch.id : (branches[1]?.id || '');

    const mileage = Number(veh.odometerReading || veh.currentMileage || 0);
    const fuel = veh.fuelLevel != null ? Number(veh.fuelLevel) : 100;

    setFormData((f) => ({
      ...f,
      vehicleId: veh.id,
      fromBranchName: currentBranchName,
      fromBranchId: currentBranchId,
      toBranchName: f.toBranchName && f.toBranchName !== currentBranchName ? f.toBranchName : toBranchName,
      toBranchId: f.toBranchId && f.toBranchId !== currentBranchId ? f.toBranchId : toBranchId,
      mileageAtTransfer: mileage,
      fuelLevelAtTransfer: fuel,
    }));
  };

  // Handle personnel changes
  const handleRequesterChange = (empId: string) => {
    const emp = employees.find((e) => e.employeeId === empId || e.id === empId);
    setFormData((f) => ({
      ...f,
      requestedById: emp ? emp.employeeId : empId,
      requestedBy: emp ? emp.name : empId,
    }));
  };

  const handleApproverChange = (empId: string) => {
    const emp = employees.find((e) => e.employeeId === empId || e.id === empId);
    setFormData((f) => ({
      ...f,
      approvedById: emp ? emp.employeeId : empId,
      approvedBy: emp ? emp.name : empId,
    }));
  };

  // Handle reason dropdown change
  const handleReasonChange = (val: string) => {
    if (val === '__CUSTOM__') {
      setIsCustomReason(true);
      setFormData((f) => ({
        ...f,
        reasonId: '',
        reason: f.customReason || 'Custom Transfer Reason',
      }));
      return;
    }

    setIsCustomReason(false);
    const found = reasons.find((r) => r.id === val || r.code === val);
    if (found) {
      setFormData((f) => ({
        ...f,
        reasonId: found.id,
        reason: found.name,
        reasonType: found.reasonType,
      }));
    } else {
      setFormData((f) => ({ ...f, reason: val }));
    }
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.vehicleId) {
      setFormError('Please select a Vehicle from the dropdown');
      return;
    }
    if (!formData.toBranchName) {
      setFormError('Destination branch is required');
      return;
    }
    if (formData.fromBranchName && formData.fromBranchName === formData.toBranchName) {
      setFormError('Origin branch and Destination branch cannot be the same');
      return;
    }
    if (!formData.transferDate) {
      setFormError('Transfer date is required');
      return;
    }

    const finalReason = isCustomReason ? formData.customReason : formData.reason;
    if (!finalReason) {
      setFormError('Please select or enter a Reason for the transfer');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        vehicleId: formData.vehicleId,
        fromBranchId: formData.fromBranchId,
        fromBranchName: formData.fromBranchName,
        toBranchId: formData.toBranchId,
        toBranchName: formData.toBranchName,
        transferDate: formData.transferDate,
        requestedBy: formData.requestedBy,
        requestedById: formData.requestedById,
        approvedBy: formData.approvedBy,
        approvedById: formData.approvedById,
        mileageAtTransfer: formData.mileageAtTransfer,
        fuelLevelAtTransfer: `${formData.fuelLevelAtTransfer}%`,
        reason: finalReason,
        reasonId: formData.reasonId,
        reasonType: formData.reasonType,
        notes: formData.notes,
        status: 'PENDING',
      };

      const res = await fetch('/api/fleet/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Save failed');
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
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Status update failed');
      }
      fetchTransfers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const inputCls =
    'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none w-full transition-colors';
  const labelCls = 'block text-xs font-medium text-[var(--text-muted)] mb-1.5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-main)]">Fleet Transfers</h1>
              <p className="text-[var(--text-muted)] text-xs mt-0.5">
                Manage inter-branch relocations, dispatch approvals, and automated odometer sync
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-xs font-semibold transition-all shadow-lg shadow-orange-500/20"
          >
            <Plus className="w-4 h-4" /> New Transfer
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between shadow-sm">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by transfer #, plate, make/model, or branch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-4 py-2 text-sm text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
            />
          </div>

          <div className="w-40">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending Approval</option>
              <option value="APPROVED">Approved (En Route)</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        <button
          onClick={fetchTransfers}
          className="px-3 py-2 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors border border-[var(--border-subtle)]"
          title="Refresh Transfers"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] uppercase tracking-wider font-semibold text-[11px]">
                <th className="py-3 px-4">Transfer #</th>
                <th className="py-3 px-4">Vehicle</th>
                <th className="py-3 px-4">From Branch</th>
                <th className="py-3 px-4">To Branch</th>
                <th className="py-3 px-4">Transfer Date</th>
                <th className="py-3 px-4">Requested By</th>
                <th className="py-3 px-4">Approved By</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4 text-right">Odometer</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-[var(--text-faint)]">
                    Loading transfers...
                  </td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-[var(--text-faint)]">
                    No vehicle transfers recorded yet
                  </td>
                </tr>
              ) : (
                transfers.map((tr) => (
                  <tr key={tr.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3 font-mono text-orange-400 font-bold whitespace-nowrap">
                      {tr.transferNo || tr.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-semibold text-[var(--text-main)]">
                          {tr.licensePlate || (tr.vehicleCode ? `Code ${tr.vehicleCode}` : <VehicleRef id={tr.vehicleId} />)}
                        </span>
                        {(tr.make || tr.model) && (
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {tr.make} {tr.model}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] font-medium">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-[var(--text-faint)]" />
                        <span>{tr.fromBranchName || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-main)] font-semibold">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-orange-400" />
                        <span>{tr.toBranchName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                      {tr.transferDate ? new Date(tr.transferDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      <div className="flex flex-col">
                        <span className="font-medium text-[var(--text-main)]">{tr.requestedBy || '—'}</span>
                        {tr.requestedById && (
                          <span className="text-[10px] text-orange-400/80 font-mono">
                            {tr.requestedById}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      <div className="flex flex-col">
                        <span className="font-medium text-[var(--text-main)]">{tr.approvedBy || '—'}</span>
                        {tr.approvedById && (
                          <span className="text-[10px] text-blue-400/80 font-mono">
                            {tr.approvedById}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-[var(--border-subtle)] line-clamp-1 max-w-[160px]">
                        {tr.reason || 'Branch Relocation'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)] font-mono whitespace-nowrap">
                      {tr.mileageAtTransfer != null ? `${Number(tr.mileageAtTransfer).toLocaleString()} km` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">{statusBadge(tr.status)}</td>
                    {/* Actions Column (3-Dot Menu) */}
                    <td className="px-4 py-3 text-center whitespace-nowrap relative" data-transfer-actions>
                      <div className="inline-block text-left relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveActionMenuId(prev => prev === tr.id ? null : tr.id);
                          }}
                          className={`p-2 rounded-xl border transition flex items-center justify-center ${
                            activeActionMenuId === tr.id
                              ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/50 shadow-md ring-2 ring-cyan-500/20'
                              : 'bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border-[var(--border-subtle)]'
                          }`}
                          title="Transfer Actions"
                          aria-label="Transfer Actions"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {activeActionMenuId === tr.id && (
                          <div
                            className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 shadow-2xl shadow-slate-900/25 z-50 py-1.5 text-left divide-y divide-slate-200 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80">
                              <div className="text-[11px] uppercase font-black tracking-wider text-cyan-700 dark:text-cyan-400">
                                {tr.transferNo}
                              </div>
                              <div className="text-xs font-bold text-slate-950 dark:text-slate-200 truncate mt-0.5">
                                {tr.make} {tr.model} {tr.licensePlate ? `(${tr.licensePlate})` : ''}
                              </div>
                            </div>

                            <div className="py-1">
                              {tr.status === 'PENDING' && (
                                <button
                                  onClick={() => {
                                    setActiveActionMenuId(null);
                                    handleStatusChange(tr.id, 'APPROVED');
                                  }}
                                  disabled={actionLoading === tr.id}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-blue-800 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                >
                                  <span className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-400">
                                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>Approve Transfer</span>
                                </button>
                              )}

                              {tr.status === 'APPROVED' && (
                                <button
                                  onClick={() => {
                                    setActiveActionMenuId(null);
                                    handleStatusChange(tr.id, 'COMPLETED');
                                  }}
                                  disabled={actionLoading === tr.id}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                >
                                  <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>Complete Transfer</span>
                                </button>
                              )}

                              <a
                                href={`/fleet/vehicles?search=${encodeURIComponent(tr.licensePlate || tr.vehicleCode || '')}`}
                                className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                onClick={() => setActiveActionMenuId(null)}
                              >
                                <span className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400">
                                  <ExternalLink className="w-4 h-4 shrink-0" />
                                </span>
                                <span>Inspect Vehicle in Fleet</span>
                              </a>
                            </div>

                            {(tr.status === 'PENDING' || tr.status === 'APPROVED') && (
                              <div className="py-1">
                                <button
                                  onClick={() => {
                                    setActiveActionMenuId(null);
                                    handleStatusChange(tr.id, 'CANCELLED');
                                  }}
                                  disabled={actionLoading === tr.id}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                >
                                  <span className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400">
                                    <XCircle className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>Cancel Transfer</span>
                                </button>
                              </div>
                            )}
                          </div>
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <span className="text-xs text-[var(--text-faint)]">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-xs text-[var(--text-main)] transition-colors border border-[var(--border-subtle)]"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-xs text-[var(--text-main)] transition-colors border border-[var(--border-subtle)]"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Transfer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400">
                  <ArrowLeftRight className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--text-main)]">New Vehicle Transfer</h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Relocate a vehicle between branches with automatic branch & odometer update
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Vehicle Selection with Autopopulate */}
              <div className="bg-[var(--bg-surface-hover)]/40 border border-[var(--border-subtle)] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Car className="w-4 h-4" /> Select Fleet Vehicle *
                  </label>
                  {selectedVehicleObj && (
                    <span className="text-[11px] text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                      Auto-Populated Details
                    </span>
                  )}
                </div>

                <select
                  value={formData.vehicleId}
                  onChange={(e) => handleVehicleChange(e.target.value)}
                  className={inputCls}
                >
                  <option value="">-- Choose a Vehicle (Plate / Code / Model) --</option>
                  {vehicles.map((v) => {
                    const plate = v.licensePlate || 'NO PLATE';
                    const code = v.vehicleCode ? `(${v.vehicleCode})` : '';
                    const desc = [v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
                    const loc = v.branchName || v.currentLocation || 'Unassigned';
                    return (
                      <option key={v.id} value={v.id}>
                        {plate} — {desc} {code} [Current: {loc}]
                      </option>
                    );
                  })}
                </select>

                {/* Selected vehicle summary card */}
                {selectedVehicleObj && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--border-subtle)] text-[11px]">
                    <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                      <span className="text-[var(--text-faint)] block text-[10px]">Plate / Model</span>
                      <span className="font-semibold text-[var(--text-main)] truncate block">
                        {selectedVehicleObj.licensePlate || selectedVehicleObj.vehicleCode}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                      <span className="text-[var(--text-faint)] block text-[10px]">Current Branch</span>
                      <span className="font-semibold text-blue-400 truncate block">
                        {selectedVehicleObj.branchName || selectedVehicleObj.currentLocation || 'Dubai Head Office'}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                      <span className="text-[var(--text-faint)] block text-[10px]">Odometer</span>
                      <span className="font-semibold text-emerald-400 block font-mono">
                        {Number(selectedVehicleObj.odometerReading || selectedVehicleObj.currentMileage || 0).toLocaleString()} km
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                      <span className="text-[var(--text-faint)] block text-[10px]">Fuel Level</span>
                      <span className="font-semibold text-amber-400 block">
                        {selectedVehicleObj.fuelLevel != null ? `${selectedVehicleObj.fuelLevel}%` : '100%'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Branch Routing */}
              <div>
                <p className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Transfer Route & Date
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>From Branch (Origin)</label>
                    <select
                      value={formData.fromBranchName}
                      onChange={(e) => {
                        const bName = e.target.value;
                        const br = branches.find((b) => b.name === bName);
                        setFormData((f) => ({
                          ...f,
                          fromBranchName: bName,
                          fromBranchId: br ? br.id : f.fromBranchId,
                        }));
                      }}
                      className={inputCls}
                    >
                      <option value="">-- Origin Branch --</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.name}>
                          {b.name} ({b.emirate || 'UAE'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>To Branch (Destination) *</label>
                    <select
                      value={formData.toBranchName}
                      onChange={(e) => {
                        const bName = e.target.value;
                        const br = branches.find((b) => b.name === bName);
                        setFormData((f) => ({
                          ...f,
                          toBranchName: bName,
                          toBranchId: br ? br.id : f.toBranchId,
                        }));
                      }}
                      className={inputCls}
                    >
                      <option value="">-- Choose Destination --</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.name}>
                          {b.name} ({b.emirate || 'UAE'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>Transfer Date *</label>
                    <input
                      type="date"
                      value={formData.transferDate}
                      onChange={(e) => setFormData((f) => ({ ...f, transferDate: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {/* Personnel (Requested By & Approved By with Employee ID) */}
              <div>
                <p className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Operations Personnel
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Requested By (Employee) *</label>
                    <select
                      value={formData.requestedById}
                      onChange={(e) => handleRequesterChange(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">-- Select Requesting Employee --</option>
                      {employees.map((emp) => (
                        <option key={emp.employeeId} value={emp.employeeId}>
                          {emp.label}
                        </option>
                      ))}
                    </select>
                    {formData.requestedById && (
                      <p className="text-[10px] text-[var(--text-faint)] mt-1 font-mono">
                        Selected: {formData.requestedBy} ({formData.requestedById})
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={labelCls}>Approved By (Employee) *</label>
                    <select
                      value={formData.approvedById}
                      onChange={(e) => handleApproverChange(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">-- Select Approving Authority --</option>
                      {employees.map((emp) => (
                        <option key={emp.employeeId} value={emp.employeeId}>
                          {emp.label}
                        </option>
                      ))}
                    </select>
                    {formData.approvedById && (
                      <p className="text-[10px] text-[var(--text-faint)] mt-1 font-mono">
                        Selected: {formData.approvedBy} ({formData.approvedById})
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Transfer Reason */}
              <div>
                <label className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <Tag className="w-3.5 h-3.5" /> Transfer Reason *
                </label>

                <div className="space-y-2">
                  <select
                    value={isCustomReason ? '__CUSTOM__' : formData.reasonId || formData.reason}
                    onChange={(e) => handleReasonChange(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">-- Choose Transfer Reason --</option>
                    {reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                    <option value="__CUSTOM__">+ Other / Custom Reason...</option>
                  </select>

                  {isCustomReason && (
                    <input
                      type="text"
                      placeholder="Type custom transfer justification..."
                      value={formData.customReason}
                      onChange={(e) =>
                        setFormData((f) => ({
                          ...f,
                          customReason: e.target.value,
                          reason: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  )}
                </div>
              </div>

              {/* Vehicle Condition at Dispatch */}
              <div>
                <p className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5" /> Dispatch Condition Telemetry
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Mileage at Transfer (km)</label>
                    <div className="relative">
                      <Gauge className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        value={formData.mileageAtTransfer}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, mileageAtTransfer: Number(e.target.value) }))
                        }
                        className={`${inputCls} pl-10 font-mono`}
                        min={0}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Fuel Level at Transfer (%)</label>
                    <div className="relative">
                      <Fuel className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        value={formData.fuelLevelAtTransfer}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, fuelLevelAtTransfer: Number(e.target.value) }))
                        }
                        className={`${inputCls} pl-10 font-mono`}
                        min={0}
                        max={100}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={labelCls}>Operational & Driver Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                  className={`${inputCls} resize-none h-16`}
                  placeholder="Driver handover instructions, toll tag notes, or return schedule..."
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
                className="px-6 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-orange-500/20"
              >
                {saving ? 'Creating...' : 'Create Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
