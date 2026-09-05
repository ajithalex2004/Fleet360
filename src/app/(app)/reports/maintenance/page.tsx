'use client';

import React, { useState, useEffect } from 'react';

interface MaintenanceCost {
  id: string;
  vehicle: string;
  date: string;
  category: string;
  cost: number;
  description: string;
  status: 'completed' | 'pending' | 'scheduled';
}

interface SummaryData {
  totalCost: number;
  averagePerVehicle: number;
  highestCostVehicle: string;
  costByCategory: { category: string; cost: number }[];
}

export default function MaintenanceCostPage() {
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [costs, setCosts] = useState<MaintenanceCost[]>([]);
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

      const res = await fetch(`/api/reports/maintenance?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setCosts(data.costs || []);
      }
    } catch (error) {
      console.error('Error fetching maintenance costs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    if (status === 'completed') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (status === 'pending') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
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
        <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Maintenance Cost Report</h1>
        <p className="text-xs text-[var(--text-muted)]">Track service and repair expenses</p>
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
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Total Cost</p>
            <p className="text-3xl font-bold text-rose-400">AED {summary.totalCost.toLocaleString()}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Average per Vehicle</p>
            <p className="text-3xl font-bold text-amber-400">AED {summary.averagePerVehicle.toLocaleString()}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Highest Cost Vehicle</p>
            <p className="text-xl font-bold text-[var(--text-main)] truncate">{summary.highestCostVehicle}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Records</p>
            <p className="text-3xl font-bold text-indigo-400">{costs.length}</p>
          </div>
        </div>
      )}

      {/* Cost by Category */}
      {summary && summary.costByCategory.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">Cost by Category</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.costByCategory.map((item, idx) => (
              <div key={idx} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
                <p className="text-[var(--text-muted)] text-xs font-medium mb-1">{item.category}</p>
                <p className="text-2xl font-bold text-[var(--text-main)]">AED {item.cost.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Maintenance Records Table */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Maintenance Records</h2>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)]">
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Vehicle</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Date</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Category</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Cost</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Description</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {costs.length > 0 ? (
                costs.map((cost) => (
                  <tr key={cost.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{cost.vehicle}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">
                      {new Date(cost.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">{cost.category}</td>
                    <td className="px-6 py-4 text-sm text-rose-400 font-medium">AED {cost.cost.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)] max-w-xs truncate">{cost.description}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(cost.status)}`}>
                        {cost.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-[var(--text-muted)]">
                    No maintenance records found
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
