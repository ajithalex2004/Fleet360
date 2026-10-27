'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Anchor, Package, Truck, Clock, AlertTriangle, CheckCircle2, Plus, RefreshCw,
  MapPin, ShieldCheck, ArrowRight, Layers, UserCheck, Wallet, DollarSign,
  TrendingUp, BarChart3, AlertCircle, Calendar, Eye, Sliders,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface DrayageWorkspaceData {
  summary: {
    totalJobs: number;
    activeJobsCount: number;
    pendingDispatchCount: number;
    detachedWaitingL2Count: number;
    totalContainers: number;
    overdueContainersCount: number;
    warningContainersCount: number;
    safeContainersCount: number;
    totalDemurrageExposureAed: number;
    totalRevenueAed: number;
    mappedVehiclesCount: number;
    mappedDriversCount: number;
    availableTrailersCount: number;
    totalTrailersCount: number;
    unacknowledgedAlertsCount?: number;
  };
  containers: Array<{
    id: string;
    containerNumber: string;
    size: string;
    containerType: string;
    shipmentType: string;
    status: string;
    customerName: string;
    terminalName: string;
    warehouseName: string;
    dischargeDate: string;
    doExpiryDate: string | null;
    demurrage: {
      status: 'SAFE' | 'WARNING' | 'CRITICAL_OVERDUE' | 'RETURNED';
      freeDaysAllowed: number;
      daysInPort: number;
      freeDaysRemaining: number;
      overdueDays: number;
      tierLabel: string;
      dailyRateAed: number;
      accruedPenaltyAed: number;
    };
  }>;
  jobs: Array<{
    id: string;
    jobCode: string;
    jobPhase: 'L1' | 'L2';
    shipmentType: string;
    status: string;
    priority: string;
    customerName: string;
    warehouseName: string;
    terminalName: string;
    containerNumber: string;
    containerSize: string;
    tokenNumber: string | null;
    assignedVehiclePlate: string | null;
    assignedDriverName: string | null;
    rateAmountAed: number;
    l2Activated: boolean;
    trailerDetached: boolean;
    createdAt: string;
  }>;
  vehicles: Array<{
    id: string;
    plateNumber: string;
    status: string;
    activeJobCode: string | null;
  }>;
  drivers: Array<{
    id: string;
    fullName: string;
    status: string;
    activeJobCode: string | null;
  }>;
}

import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

export default function DrayageDashboardPage() {
  const cached = getCachedDrayageData();
  const [data, setData] = useState<DrayageWorkspaceData | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [triggeringL2Id, setTriggeringL2Id] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<DrayageWorkspaceData['jobs'][0] | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()) setLoading(true);
      const json = await fetchDrayageWorkspaceCached({ forceFresh });
      setData(json);
    } catch (err) {
      if (!getCachedDrayageData()) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleActivateL2 = async (jobId: string) => {
    try {
      setTriggeringL2Id(jobId);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate_l2', l1JobId: jobId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to trigger L2 empty return');
      showToast('success', `L2 Empty Return job ${result.l2JobCode} generated successfully!`);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error activating L2');
    } finally {
      setTriggeringL2Id(null);
    }
  };

  const summary = data?.summary;
  const activeFleetCount = (data?.vehicles || []).filter((v) => v.status === 'ON_DRAYAGE_TRIP').length;
  const idleFleetCount = (data?.vehicles || []).length - activeFleetCount;

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg transition-all text-xs font-semibold ${
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
        title="Port & Container Drayage"
        subtitle="Operational command center: ocean demurrage clocks, FCL haulage, L2 empty returns & live master sync"
        icon={Anchor}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              href="/logistics/drayage/create-jobs"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Jobs
            </Link>
          </div>
        }
      />

      {/* Top Operational KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Active Containers"
          value={summary?.totalContainers ?? 0}
          icon={Package}
          accent="blue"
          sub="Under management"
        />
        <KpiCard
          label="Free Time < 48h"
          value={summary?.warningContainersCount ?? 0}
          icon={Clock}
          accent="amber"
          sub="Approaching demurrage"
        />
        <KpiCard
          label="In Demurrage"
          value={summary?.overdueContainersCount ?? 0}
          icon={AlertTriangle}
          accent="rose"
          sub="Accruing port fines"
        />
        <KpiCard
          label="Accrued Demurrage"
          value={`AED ${(summary?.totalDemurrageExposureAed ?? 0).toLocaleString()}`}
          icon={DollarSign}
          accent="rose"
          sub="Exposure to date"
        />
        <KpiCard
          label="Total Drayage Jobs"
          value={summary?.totalJobs ?? 0}
          icon={Layers}
          accent="cyan"
          sub={`${summary?.activeJobsCount ?? 0} Active / ${summary?.pendingDispatchCount ?? 0} Pending`}
        />
        <KpiCard
          label="Drayage Revenue"
          value={`AED ${(summary?.totalRevenueAed ?? 0).toLocaleString()}`}
          icon={TrendingUp}
          accent="emerald"
          sub="Contracted billings"
        />
      </div>

      {/* Main Grid: Demurrage Clock & Fleet Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ocean Demurrage & Free-Days Clock Panel */}
        <div className="lg:col-span-2">
          <Panel
            title="Demurrage & Port Free-Days"
            subtitle="Tiered penalisation tracking (Dry 5d, Reefer 3d) based on discharge timestamp"
            icon={Clock}
            accent="amber"
            actions={
              <Link
                href="/logistics/drayage/demurrage-config"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 text-xs font-semibold transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
                Configure Free-Days & Tiers
              </Link>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Container</th>
                    <th className="py-2.5 px-3 font-semibold">Port Terminal</th>
                    <th className="py-2.5 px-3 font-semibold">Discharged</th>
                    <th className="py-2.5 px-3 font-semibold">Free Clock</th>
                    <th className="py-2.5 px-3 font-semibold">Accrued Fine</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                  {data?.containers.slice(0, 5).map((c) => {
                    const isOverdue = c.demurrage.status === 'CRITICAL_OVERDUE';
                    const isWarning = c.demurrage.status === 'WARNING';
                    return (
                      <tr key={c.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-[var(--text-main)] font-mono">{c.containerNumber}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {c.size} · {c.containerType}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium truncate max-w-[150px]">{c.terminalName}</div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[150px]">
                            {c.warehouseName}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-[var(--text-muted)]">
                          {new Date(c.dischargeDate).toLocaleDateString()}
                          <div className="text-[10px]">Day {c.demurrage.daysInPort} in port</div>
                        </td>
                        <td className="py-3 px-3">
                          {isOverdue ? (
                            <div className="text-rose-400 font-bold">
                              {c.demurrage.overdueDays}d Overdue
                              <div className="text-[10px] text-[var(--text-muted)] font-normal">{c.demurrage.tierLabel}</div>
                            </div>
                          ) : (
                            <div className="text-emerald-400 font-semibold">
                              {c.demurrage.freeDaysRemaining}d Remaining
                              <div className="text-[10px] text-[var(--text-muted)] font-normal">of {c.demurrage.freeDaysAllowed}d free</div>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold">
                          {c.demurrage.accruedPenaltyAed > 0 ? (
                            <span className="text-rose-400">AED {c.demurrage.accruedPenaltyAed.toLocaleString()}</span>
                          ) : (
                            <span className="text-[var(--text-muted)]">AED 0</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {isOverdue ? (
                            <StatusPill status="critical" label="Overdue" />
                          ) : isWarning ? (
                            <StatusPill status="warning" label="Expiring" />
                          ) : (
                            <StatusPill status="approved" label="Safe" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>Showing high-risk containers</span>
              <Link
                href="/logistics/drayage/containers"
                className="inline-flex items-center gap-1 font-semibold text-blue-400 hover:text-blue-300 transition-colors"
              >
                View all {summary?.totalContainers ?? 0} containers <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </Panel>
        </div>

        {/* Live Fleet & Corridor Status Panel */}
        <div className="space-y-6">
          <Panel title="Live Drayage Fleet" subtitle="Prime movers & drivers" icon={Truck} accent="blue">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400">
                    <Truck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-main)]">On Active Trips</div>
                    <div className="text-[10px] text-[var(--text-muted)]">En route or at terminal/ramp</div>
                  </div>
                </div>
                <div className="text-base font-bold text-emerald-400 font-mono">{activeFleetCount}</div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center text-cyan-400">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-main)]">Available Prime Movers</div>
                    <div className="text-[10px] text-[var(--text-muted)]">Ready for token dispatch</div>
                  </div>
                </div>
                <div className="text-base font-bold text-cyan-400 font-mono">{idleFleetCount}</div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-400">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-main)]">Available Chassis</div>
                    <div className="text-[10px] text-[var(--text-muted)]">Skeletal & flatbed trailers</div>
                  </div>
                </div>
                <div className="text-base font-bold text-amber-400 font-mono">
                  {summary?.availableTrailersCount ?? 0}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
              <Link
                href="/logistics/drayage/assignment"
                className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600/15 border border-blue-500/30 text-xs font-semibold text-blue-400 hover:bg-blue-600/25 transition-colors"
              >
                Go to Job Assignment <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>

      {/* Recent Jobs Table */}
      <Panel
        title="Recent Drayage Jobs & Turnaround Workflow"
        subtitle="Track L1 import delivery and trigger L2 empty returns upon ramp/yard completion"
        icon={Package}
        accent="blue"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Job Code & Phase</th>
                <th className="py-2.5 px-3 font-semibold">Customer & Route</th>
                <th className="py-2.5 px-3 font-semibold">Container</th>
                <th className="py-2.5 px-3 font-semibold">Assigned Assets</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold">Rate</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {data?.jobs.slice(0, 8).map((j) => {
                const canTriggerL2 = j.jobPhase === 'L1' && (j.trailerDetached || j.status === 'CONTAINER_DETACHED' || j.status === 'PLACED_AT_RAMP') && !j.l2Activated;
                return (
                  <tr key={j.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-bold font-mono text-[var(--text-main)] flex items-center gap-1.5">
                        <span>{j.jobCode}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            j.jobPhase === 'L2' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {j.jobPhase}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">{new Date(j.createdAt).toLocaleDateString()}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-[var(--text-main)] truncate max-w-[160px]">{j.customerName}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]">
                        {j.terminalName} → {j.warehouseName}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold">{j.containerNumber}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{j.containerSize}</div>
                    </td>
                    <td className="py-3 px-3">
                      {j.assignedVehiclePlate ? (
                        <div>
                          <div className="font-medium">{j.assignedVehiclePlate}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{j.assignedDriverName || 'Driver assigned'}</div>
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)] italic">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <StatusPill status={j.status.toLowerCase()} label={j.status} />
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold">AED {j.rateAmountAed.toLocaleString()}</td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {canTriggerL2 && (
                          <button
                            onClick={() => handleActivateL2(j.id)}
                            disabled={triggeringL2Id === j.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 text-[11px] font-semibold transition-colors"
                          >
                            <RefreshCw className={`w-3 h-3 ${triggeringL2Id === j.id ? 'animate-spin' : ''}`} />
                            Trigger L2 Empty Return
                          </button>
                        )}
                        <Link
                          href="/logistics/drayage/tracking"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-[11px] font-medium transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          Track
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Showing latest jobs</span>
          <Link
            href="/logistics/drayage/history"
            className="inline-flex items-center gap-1 font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            Open Job History & Invoicing <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </Panel>
    </div>
  );
}
