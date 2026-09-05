'use client';

import React, { useState, useEffect } from 'react';

interface RevenueTrendData {
  month: string;
  totalRevenue: number;
  rentalRevenue: number;
  leasingRevenue: number;
  otherRevenue: number;
  totalCosts: number;
  netProfit: number;
  margin: number;
}

interface SummaryData {
  totalRevenue: number;
  rentalRevenue: number;
  leasingRevenue: number;
  otherRevenue: number;
  totalCosts: number;
  netProfit: number;
  marginPercent: number;
}

export default function RevenueAnalysisPage() {
  const [period, setPeriod] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [trendData, setTrendData] = useState<RevenueTrendData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [period]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/reports/revenue?period=${period}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setTrendData(data.trendData || []);
      }
    } catch (error) {
      console.error('Error fetching revenue data:', error);
    } finally {
      setLoading(false);
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Revenue Analysis</h1>
          <p className="text-xs text-[var(--text-muted)]">Track income trends and profitability metrics</p>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex gap-2">
        {(['monthly', 'quarterly', 'yearly'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:border-blue-500/30'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Total Revenue</p>
            <p className="text-3xl font-bold text-emerald-400">AED {summary.totalRevenue.toLocaleString()}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Total Costs</p>
            <p className="text-3xl font-bold text-rose-400">AED {summary.totalCosts.toLocaleString()}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Net Profit</p>
            <p className="text-3xl font-bold text-blue-400">AED {summary.netProfit.toLocaleString()}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Profit Margin</p>
            <p className="text-3xl font-bold text-indigo-400">{summary.marginPercent.toFixed(1)}%</p>
          </div>
        </div>
      )}

      {/* Revenue Breakdown */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Rental Revenue</p>
            <p className="text-2xl font-bold text-[var(--text-main)]">AED {summary.rentalRevenue.toLocaleString()}</p>
            <p className="text-[var(--text-faint)] text-xs mt-2">
              {((summary.rentalRevenue / summary.totalRevenue) * 100).toFixed(1)}% of total
            </p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Leasing Revenue</p>
            <p className="text-2xl font-bold text-[var(--text-main)]">AED {summary.leasingRevenue.toLocaleString()}</p>
            <p className="text-[var(--text-faint)] text-xs mt-2">
              {((summary.leasingRevenue / summary.totalRevenue) * 100).toFixed(1)}% of total
            </p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Other Revenue</p>
            <p className="text-2xl font-bold text-[var(--text-main)]">AED {summary.otherRevenue.toLocaleString()}</p>
            <p className="text-[var(--text-faint)] text-xs mt-2">
              {((summary.otherRevenue / summary.totalRevenue) * 100).toFixed(1)}% of total
            </p>
          </div>
        </div>
      )}

      {/* Trend Table */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Revenue Trend</h2>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)]">
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Period</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Total Revenue</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Rental</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Leasing</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Other</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Total Costs</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Net Profit</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {trendData.length > 0 ? (
                trendData.map((row, idx) => (
                  <tr key={idx} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{row.month}</td>
                    <td className="px-6 py-4 text-sm text-emerald-400 font-medium">AED {row.totalRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">AED {row.rentalRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">AED {row.leasingRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">AED {row.otherRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-rose-400">AED {row.totalCosts.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-blue-400 font-medium">AED {row.netProfit.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-indigo-400 font-medium">{row.margin.toFixed(1)}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-[var(--text-muted)]">
                    No revenue data available
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
