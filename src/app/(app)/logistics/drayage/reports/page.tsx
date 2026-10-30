'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Download,
  RefreshCw,
  Search,
  DollarSign,
  Package,
  Clock,
  UserCheck,
} from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
} from '@/lib/logistics/drayage-client-cache';

type ReportType =
  | 'DEMURRAGE_AUDIT'
  | 'CONTAINER_TURNAROUND'
  | 'DRIVER_SETTLEMENT'
  | 'CORRIDOR_PROFITABILITY';

interface DrayageWorkspaceData {
  containers: Array<{
    id: string;
    containerNumber: string;
    size: string;
    containerType: string;
    customerName: string;
    terminalName: string;
    dischargeDate: string;
    demurrage: {
      status: string;
      freeDaysAllowed: number;
      daysInPort: number;
      freeDaysRemaining: number;
      overdueDays: number;
      accruedPenaltyAed: number;
    };
  }>;
  jobs: Array<{
    id: string;
    jobCode: string;
    jobPhase: string;
    customerName: string;
    terminalName: string;
    warehouseName: string;
    containerNumber: string;
    rateAmountAed: number;
    driverAllowanceAed: number;
    status: string;
    createdAt: string;
  }>;
  allowances: Array<{
    id: string;
    driverName: string;
    jobCode: string;
    containerNumber: string;
    routeSummary: string;
    totalAmountAed: number;
    status: string;
    createdAt: string;
  }>;
}

export default function DrayageReportsPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached);
  const [data, setData] = useState<DrayageWorkspaceData | null>(cached);
  const [activeReport, setActiveReport] = useState<ReportType>('DEMURRAGE_AUDIT');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()) setLoading(true);
      const json = await fetchDrayageWorkspaceCached({ forceFresh });
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

  // Export current report as CSV
  const handleExportCurrentReport = () => {
    if (!data) return;
    let headers: string[] = [];
    let rows: string[][] = [];
    const filename = `drayage_${activeReport.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;

    if (activeReport === 'DEMURRAGE_AUDIT') {
      headers = ['ContainerNumber', 'Customer', 'Terminal', 'Type', 'Discharged', 'DaysInPort', 'FreeDaysAllowed', 'OverdueDays', 'AccruedPenaltyAED', 'Status'];
      rows = data.containers.map((c) => [
        c.containerNumber,
        `"${c.customerName}"`,
        `"${c.terminalName}"`,
        `${c.size} ${c.containerType}`,
        new Date(c.dischargeDate).toISOString().slice(0, 10),
        String(c.demurrage.daysInPort),
        String(c.demurrage.freeDaysAllowed),
        String(c.demurrage.overdueDays),
        c.demurrage.accruedPenaltyAed.toFixed(2),
        c.demurrage.status,
      ]);
    } else if (activeReport === 'CONTAINER_TURNAROUND') {
      headers = ['JobCode', 'Phase', 'Customer', 'ContainerNumber', 'Terminal', 'Warehouse', 'RateAED', 'Status', 'Date'];
      rows = data.jobs.map((j) => [
        j.jobCode,
        j.jobPhase,
        `"${j.customerName}"`,
        j.containerNumber,
        `"${j.terminalName}"`,
        `"${j.warehouseName}"`,
        j.rateAmountAed.toFixed(2),
        j.status,
        new Date(j.createdAt).toISOString().slice(0, 10),
      ]);
    } else if (activeReport === 'DRIVER_SETTLEMENT') {
      headers = ['DriverName', 'JobCode', 'ContainerNumber', 'RouteSummary', 'TotalAllowanceAED', 'Status', 'Date'];
      rows = data.allowances.map((a) => [
        `"${a.driverName}"`,
        a.jobCode,
        a.containerNumber,
        `"${a.routeSummary}"`,
        a.totalAmountAed.toFixed(2),
        a.status,
        new Date(a.createdAt).toISOString().slice(0, 10),
      ]);
    } else if (activeReport === 'CORRIDOR_PROFITABILITY') {
      headers = ['Corridor', 'TotalTrips', 'GrossBillingAED', 'DriverCostAED', 'GrossMarginAED', 'MarginPercent'];
      const corridorMap = new Map<string, { corridor: string; trips: number; revenue: number; cost: number }>();
      for (const j of data.jobs) {
        const key = `${j.terminalName} → ${j.warehouseName}`;
        const item = corridorMap.get(key) || { corridor: key, trips: 0, revenue: 0, cost: 0 };
        item.trips++;
        item.revenue += j.rateAmountAed;
        item.cost += j.driverAllowanceAed;
        corridorMap.set(key, item);
      }
      rows = Array.from(corridorMap.values()).map((c) => {
        const margin = c.revenue - c.cost;
        const pct = c.revenue > 0 ? Math.round((margin / c.revenue) * 100) : 0;
        return [`"${c.corridor}"`, String(c.trips), c.revenue.toFixed(2), c.cost.toFixed(2), margin.toFixed(2), `${pct}%`];
      });
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Drayage Operational & Financial Reports"
        subtitle="Download official audit reports for demurrage liability, container turnaround cycles, driver compensation, and corridor lane profitability"
        icon={FileSpreadsheet}
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
            <button
              onClick={handleExportCurrentReport}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV Report
            </button>
          </div>
        }
      />

      {/* 4 Report Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          {
            id: 'DEMURRAGE_AUDIT' as ReportType,
            title: 'Demurrage Audit',
            sub: 'Free-days penalty & exposure',
            icon: Clock,
            accent: 'rose',
          },
          {
            id: 'CONTAINER_TURNAROUND' as ReportType,
            title: 'Container Turnaround',
            sub: 'L1/L2 cycle velocity',
            icon: Package,
            accent: 'blue',
          },
          {
            id: 'DRIVER_SETTLEMENT' as ReportType,
            title: 'Driver Settlements',
            sub: 'Allowances & gate fee audits',
            icon: UserCheck,
            accent: 'cyan',
          },
          {
            id: 'CORRIDOR_PROFITABILITY' as ReportType,
            title: 'Corridor Profitability',
            sub: 'Revenue vs driver allowance',
            icon: DollarSign,
            accent: 'emerald',
          },
        ].map((rep) => {
          const Icon = rep.icon;
          const active = activeReport === rep.id;
          return (
            <div
              key={rep.id}
              onClick={() => setActiveReport(rep.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                active
                  ? 'bg-blue-600/10 border-blue-500 text-[var(--text-main)] shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    active ? 'bg-blue-600 text-white' : 'bg-[var(--bg-main)] text-[var(--text-muted)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[var(--text-main)]">{rep.title}</h4>
                  <p className="text-[10px] text-[var(--text-muted)]">{rep.sub}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Report Table Preview */}
      <Panel
        title={`Live Preview: ${activeReport.replace(/_/g, ' ')}`}
        icon={FileSpreadsheet}
        accent="blue"
        actions={
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search in preview..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 w-48"
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          {activeReport === 'DEMURRAGE_AUDIT' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Container Number</th>
                  <th className="py-2.5 px-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Terminal</th>
                  <th className="py-2.5 px-3 font-semibold">Discharge Date</th>
                  <th className="py-2.5 px-3 font-semibold">Days in Port</th>
                  <th className="py-2.5 px-3 font-semibold">Overdue Days</th>
                  <th className="py-2.5 px-3 font-semibold font-mono">Fine (AED)</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                {(data?.containers || []).map((c) => (
                  <tr key={c.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3 font-mono font-bold">{c.containerNumber}</td>
                    <td className="py-3 px-3">{c.customerName}</td>
                    <td className="py-3 px-3">{c.terminalName}</td>
                    <td className="py-3 px-3">{new Date(c.dischargeDate).toLocaleDateString()}</td>
                    <td className="py-3 px-3 font-mono">{c.demurrage.daysInPort}d</td>
                    <td className="py-3 px-3 font-mono">
                      {c.demurrage.overdueDays > 0 ? (
                        <span className="text-rose-400 font-bold">{c.demurrage.overdueDays}d</span>
                      ) : (
                        <span className="text-emerald-400">0d</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold">AED {c.demurrage.accruedPenaltyAed.toLocaleString()}</td>
                    <td className="py-3 px-3">
                      <StatusPill status={c.demurrage.status.toLowerCase()} label={c.demurrage.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'CONTAINER_TURNAROUND' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Job Code</th>
                  <th className="py-2.5 px-3 font-semibold">Phase</th>
                  <th className="py-2.5 px-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Container</th>
                  <th className="py-2.5 px-3 font-semibold">Corridor</th>
                  <th className="py-2.5 px-3 font-semibold font-mono">Contract Rate</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                {(data?.jobs || []).map((j) => (
                  <tr key={j.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3 font-mono font-bold">{j.jobCode}</td>
                    <td className="py-3 px-3 font-semibold">{j.jobPhase}</td>
                    <td className="py-3 px-3">{j.customerName}</td>
                    <td className="py-3 px-3 font-mono">{j.containerNumber}</td>
                    <td className="py-3 px-3">
                      {j.terminalName} → {j.warehouseName}
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold">AED {j.rateAmountAed.toLocaleString()}</td>
                    <td className="py-3 px-3">
                      <StatusPill status={j.status.toLowerCase()} label={j.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'DRIVER_SETTLEMENT' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Driver Name</th>
                  <th className="py-2.5 px-3 font-semibold">Job Code</th>
                  <th className="py-2.5 px-3 font-semibold">Container Number</th>
                  <th className="py-2.5 px-3 font-semibold">Route Summary</th>
                  <th className="py-2.5 px-3 font-semibold font-mono">Total Payout</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                {(data?.allowances || []).map((a) => (
                  <tr key={a.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3 font-bold">{a.driverName}</td>
                    <td className="py-3 px-3 font-mono font-bold">{a.jobCode}</td>
                    <td className="py-3 px-3 font-mono">{a.containerNumber}</td>
                    <td className="py-3 px-3">{a.routeSummary}</td>
                    <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                      AED {a.totalAmountAed.toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <StatusPill status={a.status.toLowerCase()} label={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'CORRIDOR_PROFITABILITY' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Drayage Corridor</th>
                  <th className="py-2.5 px-3 font-semibold">Trips Executed</th>
                  <th className="py-2.5 px-3 font-semibold font-mono">Gross Billings</th>
                  <th className="py-2.5 px-3 font-semibold font-mono">Driver Cost</th>
                  <th className="py-2.5 px-3 font-semibold font-mono">Operating Margin</th>
                  <th className="py-2.5 px-3 font-semibold">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                {(() => {
                  const corridorMap = new Map<string, { corridor: string; trips: number; revenue: number; cost: number }>();
                  for (const j of data?.jobs || []) {
                    const key = `${j.terminalName} → ${j.warehouseName}`;
                    const item = corridorMap.get(key) || { corridor: key, trips: 0, revenue: 0, cost: 0 };
                    item.trips++;
                    item.revenue += j.rateAmountAed;
                    item.cost += j.driverAllowanceAed;
                    corridorMap.set(key, item);
                  }
                  return Array.from(corridorMap.values()).map((c) => {
                    const margin = c.revenue - c.cost;
                    const pct = c.revenue > 0 ? Math.round((margin / c.revenue) * 100) : 0;
                    return (
                      <tr key={c.corridor} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                        <td className="py-3 px-3 font-semibold text-[var(--text-main)]">{c.corridor}</td>
                        <td className="py-3 px-3 font-mono">{c.trips} trips</td>
                        <td className="py-3 px-3 font-mono font-semibold">AED {c.revenue.toLocaleString()}</td>
                        <td className="py-3 px-3 font-mono text-[var(--text-muted)]">AED {c.cost.toLocaleString()}</td>
                        <td className="py-3 px-3 font-mono font-bold text-emerald-400">AED {margin.toLocaleString()}</td>
                        <td className="py-3 px-3 font-mono">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                            {pct}%
                          </span>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </div>
  );
}
