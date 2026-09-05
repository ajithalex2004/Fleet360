'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Leaf,
  Calendar,
  Download,
  RefreshCw,
  TrendingDown,
  Building2,
  Users,
  Compass,
  Award,
  Sparkles,
  Car,
  Bus,
} from 'lucide-react';
import type { DepartmentalCarbonSummary } from '@/lib/bus-ops/esg-carbon-engine';

export default function EsgCarbonDashboard() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<DepartmentalCarbonSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReport = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch(`/api/bus-ops/esg/carbon-report?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load ESG carbon report', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportCsv = () => {
    if (!data?.departments?.length) return;

    const headers = [
      'Department',
      'Passengers Transported',
      'Total Passenger-KM',
      'Allocated Fleet CO2 (kg)',
      'Carbon Intensity (g/p-km)',
      'Baseline Private Car CO2 (kg)',
      'Net Carbon Saved (kg)',
      'Savings %',
    ];

    const rows = data.departments.map((d) => [
      d.department,
      d.totalPassengers,
      d.totalPassengerKm,
      d.allocatedCo2Kg,
      d.carbonIntensityGPerPkm,
      d.baselinePrivateCarCo2Kg,
      d.carbonSavedKg,
      `${d.savingsPercentage}%`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ESG_Carbon_Report_${period}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              🌱 Scope-3 GHG Accounting
            </span>
            <span className="text-xs text-[var(--text-muted)]">DEFRA & GHG Protocol Standards</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mt-1">Departmental ESG Carbon Attribution</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Prorated corporate emissions, passenger-km carbon intensity, and avoided commuter footprints.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-muted)]">
            <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent text-[var(--text-main)] focus:outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={() => fetchReport(true)}
            disabled={refreshing || loading}
            className="p-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] text-[var(--text-muted)] transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          <button
            onClick={handleExportCsv}
            disabled={!data?.departments?.length}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[var(--text-main)] text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export ESG Statement (CSV)
          </button>
        </div>
      </div>

      {/* Hero Carbon Summary & Green Commute Score */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Green Commute Score</span>
            <Award className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-4xl font-extrabold text-[var(--text-main)]">
              {data?.greenCommuteScore ?? '—'}
              <span className="text-lg text-emerald-400 font-normal"> / 100</span>
            </div>
            <p className="text-[11px] text-emerald-300/80 mt-1">
              {data ? `${data.overallSavingsPercentage}% lower emissions than private cars` : 'Calculating score...'}
            </p>
          </div>
          <div className="w-full bg-[var(--bg-surface)] h-2 rounded-full overflow-hidden">
            <div
              className="bg-emerald-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, data?.greenCommuteScore ?? 0)}%` }}
            />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Net Carbon Avoided</span>
            <TrendingDown className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {data ? `${data.totalCarbonSavedKg.toLocaleString()} kg` : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
            <span>GHG Scope-3 savings vs private driving</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Actual Fleet Emissions</span>
            <Bus className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-[var(--text-main)]">
            {data ? `${data.totalFleetCo2Kg.toLocaleString()} kg` : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Total Scope-1 / Scope-3 bus fleet footprint
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Carbon Intensity</span>
            <Compass className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-300">
            {data ? `${data.fleetCarbonIntensityGPerPkm} g` : '—'}
            <span className="text-xs text-[var(--text-muted)] font-normal"> / p-km</span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            vs 171 g/p-km private car commuter baseline
          </div>
        </div>
      </div>

      {/* Departmental Allocation Matrix Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="font-semibold text-sm text-[var(--text-main)]">Departmental Scope-3 Recharges & Savings Matrix</h2>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Period: <span className="font-semibold text-emerald-400">{period}</span>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-[var(--text-muted)] text-xs animate-pulse">
              Aggregating vehicle telemetry, route passenger manifests, and calculating GHG emissions...
            </div>
          ) : !data?.departments?.length ? (
            <div className="p-12 text-center text-[var(--text-faint)] text-xs">
              No completed trips recorded for period {period}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--bg-surface)]/90 text-[var(--text-muted)] border-b border-[var(--border-subtle)] uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-3">Department</th>
                    <th className="p-3">Commuters</th>
                    <th className="p-3">Passenger-KM</th>
                    <th className="p-3">Allocated CO₂</th>
                    <th className="p-3">Intensity (g/p-km)</th>
                    <th className="p-3">Private Car Baseline</th>
                    <th className="p-3 text-emerald-400">Net CO₂ Saved</th>
                    <th className="p-3 text-right">Savings %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.departments.map((dept) => (
                    <tr key={dept.department} className="hover:bg-[var(--bg-surface)]/30 transition-colors">
                      <td className="p-3 font-semibold text-[var(--text-main)] flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        {dept.department}
                      </td>
                      <td className="p-3 text-[var(--text-muted)]">{dept.totalPassengers}</td>
                      <td className="p-3 text-[var(--text-muted)]">{dept.totalPassengerKm.toLocaleString()} km</td>
                      <td className="p-3 text-[var(--text-main)] font-medium">{dept.allocatedCo2Kg.toLocaleString()} kg</td>
                      <td className="p-3 text-amber-300">{dept.carbonIntensityGPerPkm} g</td>
                      <td className="p-3 text-[var(--text-muted)]">{dept.baselinePrivateCarCo2Kg.toLocaleString()} kg</td>
                      <td className="p-3 text-emerald-400 font-bold">
                        -{dept.carbonSavedKg.toLocaleString()} kg
                      </td>
                      <td className="p-3 text-right">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {dept.savingsPercentage}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
