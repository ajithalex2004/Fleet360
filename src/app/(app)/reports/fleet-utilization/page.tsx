'use client';

import React, { useState, useEffect } from 'react';

interface VehicleUtilization {
  id: string;
  vehicle: string;
  plate: string;
  makeModel: string;
  activeDays: number;
  idleDays: number;
  maintenanceDays: number;
  utilizationPercent: number;
  totalKM: number;
  revenue: number;
}

interface SummaryData {
  averageUtilization: number;
  bestPerformingVehicle: string;
  worstPerformingVehicle: string;
  totalKMDriven: number;
}

export default function FleetUtilizationPage() {
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [vehicles, setVehicles] = useState<VehicleUtilization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateFrom) params.append('from', dateFrom);
      if (dateTo) params.append('to', dateTo);

      const res = await fetch(`/api/reports/fleet-utilization?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setVehicles(data.vehicles || []);
      }
    } catch (error) {
      console.error('Error fetching fleet utilization:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUtilizationColor = (percent: number) => {
    if (percent > 80) return 'text-emerald-400 bg-emerald-500/10';
    if (percent > 60) return 'text-amber-400 bg-amber-500/10';
    return 'text-rose-400 bg-rose-500/10';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Fleet Utilization Report</h1>
        <p className="text-xs text-[var(--text-muted)]">Analyze vehicle usage and performance metrics</p>
      </div>

      {/* Date Filter */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
        <h2 className="text-lg font-bold text-[var(--text-main)] mb-4">Filter by Date Range</h2>
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={fetchData}
            className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2 text-sm font-medium text-white hover:opacity-90 transition-all"
          >
            Apply Filter
          </button>
          <button
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              fetchData();
            }}
            className="rounded-lg bg-[var(--bg-surface-hover)] px-6 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-elevated)] transition-all"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Average Utilization</p>
            <p className="text-3xl font-bold text-blue-400">{summary.averageUtilization.toFixed(1)}%</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Best Performing</p>
            <p className="text-xl font-bold text-emerald-400 truncate">{summary.bestPerformingVehicle}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Worst Performing</p>
            <p className="text-xl font-bold text-rose-400 truncate">{summary.worstPerformingVehicle}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Total KM Driven</p>
            <p className="text-3xl font-bold text-indigo-400">{summary.totalKMDriven.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Fleet Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">Fleet Details</h2>
          <button className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all">
            Export to Excel
          </button>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)]">
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Vehicle (Plate)</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Make/Model</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Active Days</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Idle Days</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Maint. Days</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Utilization %</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Total KM</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.length > 0 ? (
                vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">
                      {vehicle.vehicle} <span className="text-[var(--text-muted)] text-xs">({vehicle.plate})</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicle.makeModel}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicle.activeDays}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicle.idleDays}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicle.maintenanceDays}</td>
                    <td className={`px-6 py-4 text-sm font-bold rounded-lg ${getUtilizationColor(vehicle.utilizationPercent)}`}>
                      {vehicle.utilizationPercent.toFixed(1)}%
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicle.totalKM.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-emerald-400 font-medium">
                      AED {vehicle.revenue.toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-[var(--text-muted)]">
                    No vehicle data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
