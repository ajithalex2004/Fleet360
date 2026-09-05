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
          <span key={i} className={i < Math.round(rating) ? 'text-yellow-400 text-sm' : 'text-[var(--text-faint)] text-sm'}>
            ★
          </span>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-[var(--border-strong)] border-t-cyan-500 rounded-full"></div>
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
        <h1 className="text-2xl font-bold text-[var(--text-main)]">Driver Performance</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">Monitor driver metrics and KPIs</p>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 overflow-hidden">
        {filteredRecords.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">⭐</div>
            <p className="text-[var(--text-muted)]">No performance records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-surface-hover)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Period</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-[var(--text-muted)]">On-Time %</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-[var(--text-muted)]">Incidents</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Rating</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-[var(--text-muted)]">Fuel Efficiency</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-[var(--text-muted)]">Trips</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-[var(--text-muted)]">KM</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-[var(--text-muted)]">Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{record.driver}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{record.period}</td>
                    <td className="px-6 py-4 text-sm text-center text-[var(--text-muted)]">{record.onTimePercentage}%</td>
                    <td className="px-6 py-4 text-sm text-center">
                      <span className={record.incidents === 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {record.incidents}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">{getRatingStars(record.customerRating)}</td>
                    <td className="px-6 py-4 text-sm text-center text-[var(--text-muted)]">{record.fuelEfficiency.toFixed(2)} km/l</td>
                    <td className="px-6 py-4 text-sm text-center text-[var(--text-muted)]">{record.totalTrips}</td>
                    <td className="px-6 py-4 text-sm text-center text-[var(--text-muted)]">{record.totalKM.toLocaleString()}</td>
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
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-emerald-400">Excellent (80+)</h3>
            <span className="text-3xl">✓</span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">High performance with excellent metrics across all KPIs. Keep up the great work!</p>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-amber-400">Good (60-79)</h3>
            <span className="text-3xl">→</span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Solid performance with room for improvement. Focus on identified areas to increase score.</p>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-red-400">Needs Improvement (&lt;60)</h3>
            <span className="text-3xl">!</span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Performance below expectations. Coaching recommended to address weak areas.</p>
        </div>
      </div>
    </div>
  );
}
