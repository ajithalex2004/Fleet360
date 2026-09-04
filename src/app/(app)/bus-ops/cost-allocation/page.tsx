'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign,
  PieChart,
  Users,
  TrendingUp,
  Download,
  FileSpreadsheet,
  Settings2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Building2,
  ArrowUpRight,
  Calculator,
  Sliders,
  Send,
} from 'lucide-react';
import type { CostAllocationSummary, DepartmentUsage, RateConfig } from '@/lib/bus-ops/cost-allocation';

function fmtAed(num: number | null | undefined): string {
  if (num == null) return 'AED 0.00';
  return `AED ${num.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CostAllocationPage() {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(currentDate.getMonth() + 1);

  const [data, setData] = useState<CostAllocationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Rate config modal & values
  const [showRateModal, setShowRateModal] = useState(false);
  const [baseFee, setBaseFee] = useState<number>(500);
  const [scanFee, setScanFee] = useState<number>(4.50);
  const [kmFee, setKmFee] = useState<number>(0.25);

  // GL Post modal & state
  const [showGlModal, setShowGlModal] = useState(false);
  const [postingGl, setPostingGl] = useState(false);
  const [glSuccessMessage, setGlSuccessMessage] = useState<string | null>(null);

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(selectedYear),
        month: String(selectedMonth),
        baseFee: String(baseFee),
        scanFee: String(scanFee),
        kmFee: String(kmFee),
      });
      const res = await fetch(`/api/bus-ops/cost-allocation?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json: CostAllocationSummary = await res.json();
      setData(json);
    } catch (err) {
      console.error('Failed to fetch cost allocation data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch cost allocation summary');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedYear, selectedMonth, baseFee, scanFee, kmFee]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePostGlBatch = async () => {
    setPostingGl(true);
    setGlSuccessMessage(null);
    try {
      const res = await fetch('/api/bus-ops/cost-allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonth,
          rateConfig: {
            baseFeePerDept: baseFee,
            scanFeePerBoarding: scanFee,
            kmFeePerPaxKm: kmFee,
          },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to post journal entry');
      }

      const json = await res.json();
      setGlSuccessMessage(json.message);
      setTimeout(() => {
        setShowGlModal(false);
        setGlSuccessMessage(null);
      }, 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to post GL recharge batch');
    } finally {
      setPostingGl(false);
    }
  };

  const handleExportCsv = () => {
    if (!data?.departments || data.departments.length === 0) return;

    const headers = [
      'Department Name',
      'Cost Center Code',
      'Registered Staff',
      'Active Riders',
      'Total Boardings',
      'Pax-Km (Distance)',
      'Pax-Km Share %',
      'Pro-Rata Operating Cost (AED)',
      'Base Fee (AED)',
      'Scan Usage Fee (AED)',
      'Distance Fee (AED)',
      'Total Internal Recharge (AED)',
    ];

    const rows = data.departments.map(d => [
      `"${d.departmentName}"`,
      d.costCenterCode,
      d.registeredEmployees,
      d.activeRiders,
      d.totalBoardings,
      d.paxKm,
      `${d.paxKmSharePercent}%`,
      d.allocatedOperatingCost.toFixed(2),
      d.rechargeBaseFee.toFixed(2),
      d.rechargeScanFee.toFixed(2),
      d.rechargeKmFee.toFixed(2),
      d.totalRechargeAmount.toFixed(2),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Staff_Transport_Recharge_Matrix_${data.period}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredDepts = useMemo(() => {
    if (!data?.departments) return [];
    if (!searchQuery.trim()) return data.departments;
    const q = searchQuery.toLowerCase();
    return data.departments.filter(
      d => d.departmentName.toLowerCase().includes(q) || d.costCenterCode.toLowerCase().includes(q)
    );
  }, [data?.departments, searchQuery]);

  const totalRechargeSum = useMemo(() => {
    if (!data?.departments) return 0;
    return data.departments.reduce((sum, d) => sum + d.totalRechargeAmount, 0);
  }, [data?.departments]);

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Finance & Ledger Bridge
            </span>
            <span className="text-xs text-[var(--text-muted)]">GL Account: 5145 Debit / 4500 Credit</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mt-1">Departmental Cost Allocation & Recharge Matrix</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Pax-Km usage pro-rata splits, cost center chargebacks, and internal General Ledger recharge postings.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-3">
          {/* Period selector */}
          <div className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)]">
            <span className="text-[var(--text-muted)]">Period:</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-[var(--text-main)] border-none outline-none cursor-pointer font-medium"
            >
              {[
                { m: 1, name: 'Jan' }, { m: 2, name: 'Feb' }, { m: 3, name: 'Mar' },
                { m: 4, name: 'Apr' }, { m: 5, name: 'May' }, { m: 6, name: 'Jun' },
                { m: 7, name: 'Jul' }, { m: 8, name: 'Aug' }, { m: 9, name: 'Sep' },
                { m: 10, name: 'Oct' }, { m: 11, name: 'Nov' }, { m: 12, name: 'Dec' },
              ].map(({ m, name }) => (
                <option key={m} value={m} className="bg-[var(--bg-surface)]">{name}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-[var(--text-main)] border-none outline-none cursor-pointer font-medium"
            >
              {[2025, 2026, 2027].map((y) => (
                <option key={y} value={y} className="bg-[var(--bg-surface)]">{y}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowRateModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-[var(--text-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg transition"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
            Rate Matrix
          </button>

          <button
            onClick={handleExportCsv}
            disabled={!data || data.departments.length === 0}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-[var(--text-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg transition disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            Export CSV
          </button>

          <button
            onClick={() => setShowGlModal(true)}
            disabled={!data || totalRechargeSum <= 0}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-[var(--text-main)] bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            Post to GL
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Fleet Operating Cost</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-[var(--text-main)]">{fmtAed(data?.totalFleetOperatingCost)}</div>
          <div className="text-[11px] text-[var(--text-faint)] mt-2 flex justify-between">
            <span>Fuel: {fmtAed(data?.totalFuelCost)}</span>
            <span>Maint: {fmtAed(data?.totalMaintenanceCost)}</span>
          </div>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Pax-Km</span>
            <TrendingUp className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-[var(--text-main)]">{data ? data.totalPaxKm.toLocaleString('en-AE') : '—'}</div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">Cumulative passenger distance</p>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Cost Per Pax-Km</span>
            <Calculator className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl font-bold text-cyan-400">{data ? `AED ${data.costPerPaxKm.toFixed(3)}` : '—'}</div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">True transport efficiency</p>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Boarding Volume</span>
            <Users className="w-4 h-4 text-violet-400" />
          </div>
          <div className="text-xl font-bold text-[var(--text-main)]">{data ? data.totalBoardings.toLocaleString('en-AE') : '—'}</div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">Avg {fmtAed(data?.costPerBoarding)} / scan</p>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Recharge Pool</span>
            <PieChart className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-400">{fmtAed(totalRechargeSum)}</div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">{data?.departments.length || 0} cost centers billed</p>
        </div>
      </div>

      {/* Visual Pax-Km Department Distribution Bar */}
      {data && data.departments.length > 0 && (
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-[var(--text-main)]">Departmental Pax-Km Share Distribution</span>
            <span className="text-[var(--text-muted)]">{data.totalPaxKm.toLocaleString('en-AE')} Total Pax-Km</span>
          </div>

          <div className="w-full h-3 bg-[var(--bg-surface)] rounded-full overflow-hidden flex">
            {data.departments.map((d, i) => {
              if (d.paxKmSharePercent <= 0) return null;
              const colors = ['#10b981', '#6366f1', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6'];
              const color = colors[i % colors.length];
              return (
                <div
                  key={d.departmentName}
                  style={{ width: `${d.paxKmSharePercent}%`, backgroundColor: color }}
                  title={`${d.departmentName}: ${d.paxKmSharePercent}% (${d.paxKm} km)`}
                  className="h-full transition-all hover:opacity-80"
                />
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            {data.departments.slice(0, 6).map((d, i) => {
              const colors = ['#10b981', '#6366f1', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6'];
              const color = colors[i % colors.length];
              return (
                <div key={d.departmentName} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[var(--text-main)] font-medium">{d.departmentName}:</span>
                  <span>{d.paxKmSharePercent}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recharge Matrix Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-main)]">Department Recharge Matrix — {data?.period}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Calculated chargebacks per department based on Base Fee + Scan Volume + Distance Traveled.
            </p>
          </div>

          <input
            type="text"
            placeholder="Filter cost center / department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-indigo-500 w-full sm:w-64"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-muted)]">
            <thead className="bg-[var(--bg-surface)]/90 text-[var(--text-muted)] font-semibold border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-3 px-4">Department & Cost Center</th>
                <th className="py-3 px-4 text-center">Staff Headcount</th>
                <th className="py-3 px-4 text-center">Active Riders</th>
                <th className="py-3 px-4 text-right">Total Boardings</th>
                <th className="py-3 px-4 text-right">Pax-Km Distance</th>
                <th className="py-3 px-4 text-right">Pax-Km Share</th>
                <th className="py-3 px-4 text-right">Pro-Rata Fleet Cost</th>
                <th className="py-3 px-4 text-right">Base Allocation</th>
                <th className="py-3 px-4 text-right">Scan Activity Fee</th>
                <th className="py-3 px-4 text-right font-bold text-emerald-400">Total Recharge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[var(--text-faint)]">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                    Calculating departmental cost allocations & matrix...
                  </td>
                </tr>
              ) : filteredDepts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[var(--text-faint)]">
                    No departments recorded for this billing cycle.
                  </td>
                </tr>
              ) : (
                filteredDepts.map((d) => (
                  <tr key={d.departmentName} className="hover:bg-[var(--bg-surface)]/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--text-main)]">{d.departmentName}</div>
                      <span className="text-[10px] text-indigo-400 font-mono px-1.5 py-0.2 rounded bg-indigo-950/40 border border-indigo-500/20">
                        {d.costCenterCode}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center font-medium text-[var(--text-muted)]">
                      {d.registeredEmployees}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span className="font-medium text-[var(--text-main)]">{d.activeRiders}</span>
                    </td>

                    <td className="py-3 px-4 text-right font-mono text-[var(--text-main)]">
                      {d.totalBoardings.toLocaleString('en-AE')}
                    </td>

                    <td className="py-3 px-4 text-right font-mono text-[var(--text-muted)]">
                      {d.paxKm.toLocaleString('en-AE')} km
                    </td>

                    <td className="py-3 px-4 text-right font-semibold text-[var(--text-main)]">
                      {d.paxKmSharePercent}%
                    </td>

                    <td className="py-3 px-4 text-right font-mono text-[var(--text-muted)]">
                      {fmtAed(d.allocatedOperatingCost)}
                    </td>

                    <td className="py-3 px-4 text-right font-mono text-[var(--text-muted)]">
                      {fmtAed(d.rechargeBaseFee)}
                    </td>

                    <td className="py-3 px-4 text-right font-mono text-[var(--text-muted)]">
                      {fmtAed(d.rechargeScanFee + d.rechargeKmFee)}
                    </td>

                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 text-sm">
                      {fmtAed(d.totalRechargeAmount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {data && data.departments.length > 0 && (
              <tfoot className="bg-[var(--bg-surface)] font-semibold text-[var(--text-main)] border-t-2 border-[var(--border-subtle)]">
                <tr>
                  <td className="py-3.5 px-4">TOTALS ({data.departments.length} Cost Centers)</td>
                  <td className="py-3.5 px-4 text-center">{data.departments.reduce((s, d) => s + d.registeredEmployees, 0)}</td>
                  <td className="py-3.5 px-4 text-center">{data.departments.reduce((s, d) => s + d.activeRiders, 0)}</td>
                  <td className="py-3.5 px-4 text-right font-mono">{data.totalBoardings.toLocaleString('en-AE')}</td>
                  <td className="py-3.5 px-4 text-right font-mono">{data.totalPaxKm.toLocaleString('en-AE')} km</td>
                  <td className="py-3.5 px-4 text-right">100.0%</td>
                  <td className="py-3.5 px-4 text-right font-mono">{fmtAed(data.totalFleetOperatingCost)}</td>
                  <td className="py-3.5 px-4 text-right font-mono">{fmtAed(data.departments.reduce((s, d) => s + d.rechargeBaseFee, 0))}</td>
                  <td className="py-3.5 px-4 text-right font-mono">{fmtAed(data.departments.reduce((s, d) => s + d.rechargeScanFee + d.rechargeKmFee, 0))}</td>
                  <td className="py-3.5 px-4 text-right font-mono text-emerald-400 text-base">{fmtAed(totalRechargeSum)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Rate Configurator Modal */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                  Rate Matrix Engine
                </span>
                <h3 className="text-lg font-bold text-[var(--text-main)] mt-1">Configure Unit Chargeback Rates</h3>
              </div>
              <button onClick={() => setShowRateModal(false)} className="text-[var(--text-faint)] hover:text-[var(--text-muted)] text-lg leading-none">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--text-muted)] font-medium mb-1">
                  Fixed Base Fee Per Active Department (AED / month):
                </label>
                <input
                  type="number"
                  value={baseFee}
                  onChange={(e) => setBaseFee(Number(e.target.value))}
                  className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-2 text-[var(--text-main)] focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[var(--text-muted)] font-medium mb-1">
                  Rate Per Boarding Scan (AED / scan):
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={scanFee}
                  onChange={(e) => setScanFee(Number(e.target.value))}
                  className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-2 text-[var(--text-main)] focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[var(--text-muted)] font-medium mb-1">
                  Distance Surcharge Per Pax-Km (AED / km):
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={kmFee}
                  onChange={(e) => setKmFee(Number(e.target.value))}
                  className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-2 text-[var(--text-main)] focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => {
                  setBaseFee(500);
                  setScanFee(4.50);
                  setKmFee(0.25);
                }}
                className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                Reset Defaults
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRateModal(false);
                  fetchData();
                }}
                className="px-4 py-2 text-xs font-semibold text-[var(--text-main)] bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow transition"
              >
                Apply Rates
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post to GL Modal */}
      {showGlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  General Ledger Posting
                </span>
                <h3 className="text-lg font-bold text-[var(--text-main)] mt-1">Post Recharge Journal Entry</h3>
              </div>
              <button onClick={() => setShowGlModal(false)} className="text-[var(--text-faint)] hover:text-[var(--text-muted)] text-lg leading-none">
                ✕
              </button>
            </div>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              This will create a draft internal journal batch in the Finance module for period <strong>{data?.period}</strong>:
            </p>

            <div className="bg-[var(--bg-canvas)] p-3 rounded-xl border border-[var(--border-subtle)] text-xs space-y-1.5 font-mono">
              <div className="flex justify-between text-emerald-400">
                <span>Debit (5145 - Dept Transport Expense):</span>
                <span>{fmtAed(totalRechargeSum)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-muted)]">
                <span>Credit (4500 - Bus Ops Recovery):</span>
                <span>{fmtAed(totalRechargeSum)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
                <span>Cost Centers Billed:</span>
                <span>{data?.departments.length || 0} Departments</span>
              </div>
            </div>

            {glSuccessMessage && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{glSuccessMessage}</span>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowGlModal(false)}
                disabled={postingGl}
                className="px-4 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePostGlBatch}
                disabled={postingGl || Boolean(glSuccessMessage)}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[var(--text-main)] bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow transition disabled:opacity-50"
              >
                <Send className={`w-3.5 h-3.5 ${postingGl ? 'animate-spin' : ''}`} />
                {postingGl ? 'Posting Entry...' : 'Confirm & Post to GL'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
