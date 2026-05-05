'use client';

import React, { useState, useEffect } from 'react';

interface PerformanceRecord {
  id: string;
  driver: string;
  period: string;
  onTimePercentage: number;
  incidents: number;
  customerRating: number;
  fuelEfficiency: number;
  totalTrips: number;
  totalKM: number;
  score: number;
}

export default function PerformanceDashboard() {
  const [records, setRecords] = useState<PerformanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  useEffect(() => {
    fetchPerformance();
  }, []);

  const fetchPerformance = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/drivers/performance');
      if (!res.ok) throw new Error('Failed to fetch performance data');
      const data = await res.json();
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  };

  const filteredRecords = records.filter((record) => {
    const matchesMonth = !filterMonth || record.period.includes(filterMonth);
    const matchesYear = !filterYear || record.period.includes(filterYear);
    return matchesMonth && matchesYear;
  });

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  };

  const getRatingStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[...Array(5)].map((_, i) => (
          <span key={i} className={i < Math.round(rating) ? 'text-yellow-400 text-sm' : 'text-slate-600 text-sm'}>
            ★
          </span>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-cyan-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-medium">Error loading performance data</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Driver Performance</h1>
        <p className="text-slate-400 mt-1">Monitor driver metrics and KPIs</p>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="">All Months</option>
          {months.map((month) => (
            <option key={month} value={month}>
              {month}
            </option>
          ))}
        </select>

        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          className="bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="">All Years</option>
          {years.map((year) => (
            <option key={year} value={year.toString()}>
              {year}
            </option>
          ))}
        </select>
      </div>

      {/* Performance Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-hidden">
        {filteredRecords.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">⭐</div>
            <p className="text-slate-400">No performance records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Period</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-400">On-Time %</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-400">Incidents</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Rating</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-400">Fuel Efficiency</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-400">Trips</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-400">KM</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-400">Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-sm text-white font-medium">{record.driver}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{record.period}</td>
                    <td className="px-6 py-4 text-sm text-center text-slate-200">{record.onTimePercentage}%</td>
                    <td className="px-6 py-4 text-sm text-center">
                      <span className={record.incidents === 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {record.incidents}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">{getRatingStars(record.customerRating)}</td>
                    <td className="px-6 py-4 text-sm text-center text-slate-200">{record.fuelEfficiency.toFixed(2)} km/l</td>
                    <td className="px-6 py-4 text-sm text-center text-slate-200">{record.totalTrips}</td>
                    <td className="px-6 py-4 text-sm text-center text-slate-200">{record.totalKM.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-center">
                      <span className={`font-bold text-lg ${getScoreColor(record.score)}`}>{record.score}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Performance Guidelines */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-emerald-400">Excellent (80+)</h3>
            <span className="text-3xl">✓</span>
          </div>
          <p className="text-sm text-slate-400">High performance with excellent metrics across all KPIs. Keep up the great work!</p>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-amber-400">Good (60-79)</h3>
            <span className="text-3xl">→</span>
          </div>
          <p className="text-sm text-slate-400">Solid performance with room for improvement. Focus on identified areas to increase score.</p>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-red-400">Needs Improvement (&lt;60)</h3>
            <span className="text-3xl">!</span>
          </div>
          <p className="text-sm text-slate-400">Performance below expectations. Coaching recommended to address weak areas.</p>
        </div>
      </div>
    </div>
  );
}
