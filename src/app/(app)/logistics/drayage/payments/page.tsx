'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet,
  DollarSign,
  CheckCircle2,
  Clock,
  Check,
  RefreshCw,
  Search,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface DrayageDriverAllowance {
  id: string;
  jobId: string;
  jobCode: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string | null;
  containerNumber: string;
  tripPhase: 'L1' | 'L2';
  routeSummary: string;
  allowanceAmountAed: number;
  portGateFeeAed: number;
  overnightHaltAed: number;
  totalAmountAed: number;
  status: 'PENDING' | 'APPROVED' | 'PAID';
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export default function DrayagePaymentsPage() {
  const [, setLoading] = useState(true);
  const [allowances, setAllowances] = useState<DrayageDriverAllowance[]>([]);
  const [statusTab, setStatusTab] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'PAID'>('PENDING');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/logistics/drayage');
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || 'Failed to load allowance records');
      }
      const data = await res.json();
      setAllowances(data.allowances || []);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to fetch payments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate missing payments
  const handleCalculatePayments = async () => {
    try {
      setCalculating(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'calculate_payments' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Calculation failed');
      showToast('success', `Calculated ${data.createdCount} new trip allowances from assigned jobs!`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error calculating payments');
    } finally {
      setCalculating(false);
    }
  };

  // Single update status
  const handleUpdateStatus = async (allowanceId: string, newStatus: 'APPROVED' | 'PAID') => {
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_allowance_status',
          allowanceId,
          status: newStatus,
        }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      showToast('success', `Allowance updated to ${newStatus}`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating allowance');
    }
  };

  // Bulk update status
  const handleBulkUpdate = async (newStatus: 'APPROVED' | 'PAID') => {
    if (selectedIds.length === 0) return;
    try {
      setProcessingBulk(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_update_allowances',
          allowanceIds: selectedIds,
          status: newStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk update failed');
      showToast('success', `Bulk updated ${data.updatedCount} allowances to ${newStatus}!`);
      setSelectedIds([]);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error in bulk update');
    } finally {
      setProcessingBulk(false);
    }
  };

  // Filtered
  const filteredAllowances = useMemo(() => {
    return allowances.filter((a) => {
      if (statusTab !== 'ALL' && a.status !== statusTab) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          a.driverName.toLowerCase().includes(q) ||
          a.jobCode.toLowerCase().includes(q) ||
          a.containerNumber.toLowerCase().includes(q) ||
          (a.vehiclePlate && a.vehiclePlate.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [allowances, search, statusTab]);

  // Financial sums
  const pendingTotal = allowances.filter((a) => a.status === 'PENDING').reduce((sum, a) => sum + a.totalAmountAed, 0);
  const approvedTotal = allowances.filter((a) => a.status === 'APPROVED').reduce((sum, a) => sum + a.totalAmountAed, 0);
  const paidTotal = allowances.filter((a) => a.status === 'PAID').reduce((sum, a) => sum + a.totalAmountAed, 0);

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Driver Drayage Trip Allowances & Settlements"
        subtitle="Manage per-trip allowances, DP World gate passes reimbursement, overnight detention compensation, and bulk driver payouts"
        icon={Wallet}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleCalculatePayments}
              disabled={calculating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${calculating ? 'animate-spin' : ''}`} />
              {calculating ? 'Calculating...' : 'Calculate Unbilled Trips'}
            </button>
          </div>
        }
      />

      {/* Summary Financial KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Pending Approval"
          value={`AED ${pendingTotal.toLocaleString()}`}
          icon={Clock}
          accent="amber"
          sub={`${allowances.filter((a) => a.status === 'PENDING').length} trips awaiting review`}
        />
        <KpiCard
          label="Approved for Payout"
          value={`AED ${approvedTotal.toLocaleString()}`}
          icon={CheckCircle2}
          accent="cyan"
          sub={`${allowances.filter((a) => a.status === 'APPROVED').length} trips ready for transfer`}
        />
        <KpiCard
          label="Disbursed & Paid"
          value={`AED ${paidTotal.toLocaleString()}`}
          icon={DollarSign}
          accent="emerald"
          sub={`${allowances.filter((a) => a.status === 'PAID').length} trips settled`}
        />
        <KpiCard
          label="Total All Trips"
          value={`AED ${(pendingTotal + approvedTotal + paidTotal).toLocaleString()}`}
          icon={Wallet}
          accent="blue"
          sub={`${allowances.length} total drayage dispatches`}
        />
      </div>

      {/* Main Table with Tabs & Bulk Actions */}
      <Panel
        title="Trip Allowances Ledger"
        icon={Wallet}
        accent="blue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleBulkUpdate('APPROVED')}
                  disabled={processingBulk}
                  className="px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-xs font-semibold"
                >
                  Bulk Approve ({selectedIds.length})
                </button>
                <button
                  onClick={() => handleBulkUpdate('PAID')}
                  disabled={processingBulk}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/25 text-xs font-semibold"
                >
                  Mark as Paid ({selectedIds.length})
                </button>
              </div>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search driver, job, plate..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 w-48"
              />
            </div>
          </div>
        }
      >
        {/* Sub-Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] pb-2 mb-4">
          {(['ALL', 'PENDING', 'APPROVED', 'PAID'] as const).map((tab) => {
            const count =
              tab === 'ALL'
                ? allowances.length
                : allowances.filter((a) => a.status === tab).length;
            const active = statusTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setStatusTab(tab)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/40'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <span>{tab}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.length > 0 && selectedIds.length === filteredAllowances.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(filteredAllowances.map((a) => a.id));
                      else setSelectedIds([]);
                    }}
                    className="rounded border-[var(--border-subtle)] text-blue-600"
                  />
                </th>
                <th className="py-2.5 px-3 font-semibold">Driver & Tractor</th>
                <th className="py-2.5 px-3 font-semibold">Job Reference</th>
                <th className="py-2.5 px-3 font-semibold">Trip Route</th>
                <th className="py-2.5 px-3 font-semibold">Base Allowance</th>
                <th className="py-2.5 px-3 font-semibold">Gate & Halt</th>
                <th className="py-2.5 px-3 font-semibold">Total Payout</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {filteredAllowances.map((a) => {
                const isSelected = selectedIds.includes(a.id);
                return (
                  <tr
                    key={a.id}
                    className={`hover:bg-[var(--bg-surface-hover)] transition-colors ${
                      isSelected ? 'bg-blue-600/5' : ''
                    }`}
                  >
                    <td className="py-3 px-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds((prev) => [...prev, a.id]);
                          else setSelectedIds((prev) => prev.filter((id) => id !== a.id));
                        }}
                        className="rounded border-[var(--border-subtle)] text-blue-600"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-[var(--text-main)]">{a.driverName}</div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">
                        {a.vehiclePlate || 'Tractor N/A'}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-mono font-bold flex items-center gap-1.5">
                        <span>{a.jobCode}</span>
                        <span className="text-[10px] font-normal text-[var(--text-muted)]">({a.tripPhase})</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{a.containerNumber}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="text-[11px] truncate max-w-[180px]">{a.routeSummary}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {new Date(a.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold">AED {a.allowanceAmountAed}</td>
                    <td className="py-3 px-3 font-mono text-[var(--text-muted)]">
                      AED {a.portGateFeeAed + a.overnightHaltAed}
                      <span className="text-[10px] block text-[var(--text-muted)]">Gate Pass: AED {a.portGateFeeAed}</span>
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                      AED {a.totalAmountAed}
                    </td>
                    <td className="py-3 px-3">
                      <StatusPill status={a.status.toLowerCase()} label={a.status} />
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {a.status === 'PENDING' && (
                          <button
                            onClick={() => handleUpdateStatus(a.id, 'APPROVED')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors"
                          >
                            <Check className="w-3 h-3" />
                            Approve
                          </button>
                        )}
                        {a.status === 'APPROVED' && (
                          <button
                            onClick={() => handleUpdateStatus(a.id, 'PAID')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/25 text-[11px] font-semibold transition-colors"
                          >
                            <DollarSign className="w-3 h-3" />
                            Pay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
