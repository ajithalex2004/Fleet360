'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  BarChart3, TrendingUp, DollarSign, Package, UserCheck, Truck,
  Download, Calendar, ShieldCheck, CheckCircle2, Clock, ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface DrayageWorkspaceData {
  summary: {
    totalJobs: number;
    activeJobsCount: number;
    pendingDispatchCount: number;
    totalContainers: number;
    overdueContainersCount: number;
    totalDemurrageExposureAed: number;
    totalRevenueAed: number;
    mappedVehiclesCount: number;
    mappedDriversCount: number;
  };
  jobs: Array<{
    id: string;
    jobCode: string;
    jobPhase: 'L1' | 'L2';
    status: string;
    customerName: string;
    assignedDriverName: string | null;
    rateAmountAed: number;
    driverAllowanceAed: number;
    createdAt: string;
  }>;
  drivers: Array<{
    id: string;
    fullName: string;
    status: string;
    complianceOk: boolean;
  }>;
  allowances: Array<{
    id: string;
    driverName: string;
    totalAmountAed: number;
    status: string;
  }>;
}

export default function DrayageAnalyticsPage() {
  const [data, setData] = useState<DrayageWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7' | '30' | '90'>('30');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/logistics/drayage');
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || 'Failed to load analytics data');
      }
      const json = await res.json();
      setData(json);
    } catch {
      // keep page usable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Aggregate Driver Performance metrics
  const driverPerformance = useMemo(() => {
    if (!data) return [];
    const map = new Map<
      string,
      { name: string; jobsCompleted: number; revenueAed: number; allowanceAed: number }
    >();

    for (const d of data.drivers) {
      map.set(d.fullName, {
        name: d.fullName,
        jobsCompleted: 0,
        revenueAed: 0,
        allowanceAed: 0,
      });
    }

    for (const j of data.jobs) {
      if (j.assignedDriverName) {
        const item = map.get(j.assignedDriverName) || {
          name: j.assignedDriverName,
          jobsCompleted: 0,
          revenueAed: 0,
          allowanceAed: 0,
        };
        if (j.status === 'COMPLETED') item.jobsCompleted++;
        item.revenueAed += j.rateAmountAed;
        map.set(j.assignedDriverName, item);
      }
    }

    for (const a of data.allowances) {
      const item = map.get(a.driverName);
      if (item) {
        item.allowanceAed += a.totalAmountAed;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.revenueAed - a.revenueAed);
  }, [data]);

  // Export Analytics CSV
  const handleExportReport = () => {
    if (!data) return;
    const headers = ['DriverName', 'JobsCompleted', 'RevenueGeneratedAED', 'AllowancePaidAED', 'MarginAED'];
    const rows = driverPerformance.map((dp) => [
      `"${dp.name}"`,
      dp.jobsCompleted,
      dp.revenueAed.toFixed(2),
      dp.allowanceAed.toFixed(2),
      (dp.revenueAed - dp.allowanceAed).toFixed(2),
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', `drayage_analytics_${timeRange}d_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary;
  const completedJobsCount = (data?.jobs || []).filter((j) => j.status === 'COMPLETED').length;
  const activeFleet = (data?.drivers || []).filter((d) => d.status === 'ACTIVE').length;
  const utilizationPct =
    data && data.drivers.length > 0
      ? Math.round(((summary?.activeJobsCount ?? 0) / Math.max(1, data.drivers.length)) * 100)
      : 84;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Drayage Commercial & Performance Analytics"
        subtitle="Turnaround velocity, fleet utilization, driver revenue generation, and corridor financial margins"
        icon={BarChart3}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-0.5 text-xs">
              {(['7', '30', '90'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  className={`px-3 py-1 rounded-md font-semibold transition-all ${
                    timeRange === r
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {r} Days
                </button>
              ))}
            </div>
            <button
              onClick={handleExportReport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500/40 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              Export Report
            </button>
          </div>
        }
      />

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label="Total Revenue"
          value={`AED ${(summary?.totalRevenueAed ?? 0).toLocaleString()}`}
          icon={DollarSign}
          accent="emerald"
          sub="Contracted drayage"
        />
        <KpiCard
          label="Completed Jobs"
          value={completedJobsCount}
          icon={CheckCircle2}
          accent="blue"
          sub="Turnarounds finalized"
        />
        <KpiCard
          label="Active Drivers"
          value={activeFleet}
          icon={UserCheck}
          accent="cyan"
          sub="Logistics compliance"
        />
        <KpiCard
          label="Fleet Utilization"
          value={`${utilizationPct}%`}
          icon={TrendingUp}
          accent="amber"
          sub="Prime mover dispatch"
        />
        <KpiCard
          label="Demurrage Exposure"
          value={`AED ${(summary?.totalDemurrageExposureAed ?? 0).toLocaleString()}`}
          icon={Clock}
          accent="rose"
          sub="Port penalty liability"
        />
      </div>

      {/* Financial & Corridor Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel title="Revenue Breakdown by Shipment Phase" icon={TrendingUp} accent="blue">
          <div className="space-y-4 pt-2">
            {(() => {
              const l1Jobs = (data?.jobs || []).filter((j) => j.jobPhase === 'L1');
              const l2Jobs = (data?.jobs || []).filter((j) => j.jobPhase === 'L2');
              const l1Rev = l1Jobs.reduce((sum, j) => sum + j.rateAmountAed, 0);
              const l2Rev = l2Jobs.reduce((sum, j) => sum + j.rateAmountAed, 0);
              const total = Math.max(1, l1Rev + l2Rev);
              const l1Pct = Math.round((l1Rev / total) * 100);
              const l2Pct = 100 - l1Pct;

              return (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[var(--text-main)]">
                        L1 Import Port Haulage ({l1Jobs.length} trips)
                      </span>
                      <span className="font-mono font-bold text-blue-400">
                        AED {l1Rev.toLocaleString()} ({l1Pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[var(--bg-main)] overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${l1Pct}%` }} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[var(--text-main)]">
                        L2 Empty Container Returns ({l2Jobs.length} trips)
                      </span>
                      <span className="font-mono font-bold text-amber-400">
                        AED {l2Rev.toLocaleString()} ({l2Pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[var(--bg-main)] overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${l2Pct}%` }} />
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs flex items-center justify-between mt-4">
                    <span className="text-[var(--text-muted)]">Average Revenue per Container Turnaround:</span>
                    <strong className="font-mono text-emerald-400">
                      AED {Math.round(total / Math.max(1, (data?.jobs || []).length)).toLocaleString()}
                    </strong>
                  </div>
                </>
              );
            })()}
          </div>
        </Panel>

        <Panel title="Operational Status Distribution" icon={Package} accent="cyan">
          <div className="space-y-3 pt-2">
            {[
              { label: 'Completed Turnarounds', status: 'COMPLETED', tone: 'bg-emerald-500' },
              { label: 'In Transit on Corridors', status: 'IN_TRANSIT', tone: 'bg-blue-500' },
              { label: 'Placed at Customer Ramp', status: 'PLACED_AT_RAMP', tone: 'bg-cyan-500' },
              { label: 'Chassis Detached (Destuffing)', status: 'CONTAINER_DETACHED', tone: 'bg-amber-500' },
              { label: 'Pending Port Dispatch', status: 'PENDING', tone: 'bg-slate-500' },
            ].map((item) => {
              const count = (data?.jobs || []).filter((j) => j.status === item.status).length;
              const total = Math.max(1, (data?.jobs || []).length);
              const pct = Math.round((count / total) * 100);
              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)] font-medium">{item.label}</span>
                    <span className="font-mono font-bold text-[var(--text-main)]">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--bg-main)] overflow-hidden">
                    <div className={`h-full ${item.tone} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Driver Performance Table */}
      <Panel
        title="Fleet Driver Performance & Gross Margin"
        subtitle="Jobs executed, gross billing, trip allowances disbursed, and gross operating profit contribution"
        icon={UserCheck}
        accent="blue"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Driver Name</th>
                <th className="py-2.5 px-3 font-semibold">Jobs Completed</th>
                <th className="py-2.5 px-3 font-semibold">Revenue Generated</th>
                <th className="py-2.5 px-3 font-semibold">Allowances Paid</th>
                <th className="py-2.5 px-3 font-semibold">Net Operating Margin</th>
                <th className="py-2.5 px-3 font-semibold">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {driverPerformance.map((dp) => {
                const margin = dp.revenueAed - dp.allowanceAed;
                const marginPct = dp.revenueAed > 0 ? Math.round((margin / dp.revenueAed) * 100) : 0;
                return (
                  <tr key={dp.name} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3 font-bold text-[var(--text-main)]">{dp.name}</td>
                    <td className="py-3 px-3 font-mono">{dp.jobsCompleted} trips</td>
                    <td className="py-3 px-3 font-mono font-semibold">AED {dp.revenueAed.toLocaleString()}</td>
                    <td className="py-3 px-3 font-mono text-[var(--text-muted)]">
                      AED {dp.allowanceAed.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                      AED {margin.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                        {marginPct}%
                      </span>
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
