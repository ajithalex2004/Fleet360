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
          <h1 className="text-4xl font-bold text-white mb-2">Revenue Analysis</h1>
          <p className="text-slate-400">Track income trends and profitability metrics</p>
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
                : 'bg-slate-800/50 text-slate-300 border border-white/10 hover:border-blue-500/30'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Total Revenue</p>
            <p className="text-3xl font-bold text-emerald-400">AED {summary.totalRevenue.toLocaleString()}</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Total Costs</p>
            <p className="text-3xl font-bold text-rose-400">AED {summary.totalCosts.toLocaleString()}</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Net Profit</p>
            <p className="text-3xl font-bold text-blue-400">AED {summary.netProfit.toLocaleString()}</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Profit Margin</p>
            <p className="text-3xl font-bold text-indigo-400">{summary.marginPercent.toFixed(1)}%</p>
          </div>
        </div>
      )}

      {/* Revenue Breakdown */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Rental Revenue</p>
            <p className="text-2xl font-bold text-white">AED {summary.rentalRevenue.toLocaleString()}</p>
            <p className="text-slate-500 text-xs mt-2">
              {((summary.rentalRevenue / summary.totalRevenue) * 100).toFixed(1)}% of total
            </p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Leasing Revenue</p>
            <p className="text-2xl font-bold text-white">AED {summary.leasingRevenue.toLocaleString()}</p>
            <p className="text-slate-500 text-xs mt-2">
              {((summary.leasingRevenue / summary.totalRevenue) * 100).toFixed(1)}% of total
            </p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Other Revenue</p>
            <p className="text-2xl font-bold text-white">AED {summary.otherRevenue.toLocaleString()}</p>
            <p className="text-slate-500 text-xs mt-2">
              {((summary.otherRevenue / summary.totalRevenue) * 100).toFixed(1)}% of total
            </p>
          </div>
        </div>
      )}

      {/* Trend Table */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white">Revenue Trend</h2>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800/50 border-b border-white/5">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Period</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Total Revenue</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Rental</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Leasing</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Other</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Total Costs</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Net Profit</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {trendData.length > 0 ? (
                trendData.map((row, idx) => (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-6 py-4 text-sm text-white font-medium">{row.month}</td>
                    <td className="px-6 py-4 text-sm text-emerald-400 font-medium">AED {row.totalRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-white">AED {row.rentalRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-white">AED {row.leasingRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-white">AED {row.otherRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-rose-400">AED {row.totalCosts.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-blue-400 font-medium">AED {row.netProfit.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-indigo-400 font-medium">{row.margin.toFixed(1)}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-200">
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
