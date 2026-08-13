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
        <h1 className="text-4xl font-bold text-white mb-2">Fleet Utilization Report</h1>
        <p className="text-slate-400">Analyze vehicle usage and performance metrics</p>
      </div>

      {/* Date Filter */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-white mb-4">Filter by Date Range</h2>
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
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
            className="rounded-lg bg-slate-700 px-6 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600 transition-all"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Average Utilization</p>
            <p className="text-3xl font-bold text-blue-400">{summary.averageUtilization.toFixed(1)}%</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Best Performing</p>
            <p className="text-xl font-bold text-emerald-400 truncate">{summary.bestPerformingVehicle}</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Worst Performing</p>
            <p className="text-xl font-bold text-rose-400 truncate">{summary.worstPerformingVehicle}</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Total KM Driven</p>
            <p className="text-3xl font-bold text-indigo-400">{summary.totalKMDriven.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Fleet Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Fleet Details</h2>
          <button className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all">
            Export to Excel
          </button>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800/50 border-b border-white/5">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Vehicle (Plate)</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Make/Model</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Active Days</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Idle Days</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Maint. Days</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Utilization %</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Total KM</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.length > 0 ? (
                vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-6 py-4 text-sm text-white font-medium">
                      {vehicle.vehicle} <span className="text-slate-200 text-xs">({vehicle.plate})</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-white">{vehicle.makeModel}</td>
                    <td className="px-6 py-4 text-sm text-white">{vehicle.activeDays}</td>
                    <td className="px-6 py-4 text-sm text-white">{vehicle.idleDays}</td>
                    <td className="px-6 py-4 text-sm text-white">{vehicle.maintenanceDays}</td>
                    <td className={`px-6 py-4 text-sm font-bold rounded-lg ${getUtilizationColor(vehicle.utilizationPercent)}`}>
                      {vehicle.utilizationPercent.toFixed(1)}%
                    </td>
                    <td className="px-6 py-4 text-sm text-white">{vehicle.totalKM.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-emerald-400 font-medium">
                      AED {vehicle.revenue.toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-200">
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
