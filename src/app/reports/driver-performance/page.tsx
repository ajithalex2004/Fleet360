'use client';

import React, { useState, useEffect } from 'react';

interface DriverPerformance {
  id: string;
  name: string;
  totalTrips: number;
  totalKM: number;
  onTimePercent: number;
  incidents: number;
  rating: number;
  fuelEfficiency: number;
  score: number;
}

interface TopPerformer {
  name: string;
  rating: number;
  score: number;
}

export default function DriverPerformancePage() {
  const [periodType, setPeriodType] = useState<'month' | 'year'>('month');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [drivers, setDrivers] = useState<DriverPerformance[]>([]);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [periodType, selectedPeriod]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedPeriod) params.append('period', selectedPeriod);
      params.append('type', periodType);

      const res = await fetch(`/api/drivers/performance?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDrivers(data.drivers || []);
        setTopPerformers(data.topPerformers || []);
      }
    } catch (error) {
      console.error('Error fetching driver performance:', error);
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (score >= 60) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
  };

  const renderStars = (rating: number) => {
    const stars = Math.round(rating);
    return '⭐'.repeat(Math.min(stars, 5)) || 'N/A';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Driver Performance Report</h1>
        <p className="text-slate-400">Monitor driver metrics and performance scores</p>
      </div>

      {/* Period Filter */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-white mb-4">Filter by Period</h2>
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Period Type</label>
            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as 'month' | 'year')}
              className="bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Select {periodType === 'month' ? 'Month' : 'Year'}</label>
            <input
              type={periodType === 'month' ? 'month' : 'number'}
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={fetchData}
            className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2 text-sm font-medium text-white hover:opacity-90 transition-all"
          >
            Filter
          </button>
        </div>
      </div>

      {/* Top 3 Performers */}
      {topPerformers.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white">Top 3 Performers</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topPerformers.map((performer, idx) => (
              <div key={idx} className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-2xl p-6">
                <p className="text-emerald-400 text-sm font-medium mb-1">#{idx + 1} Performer</p>
                <p className="text-white font-bold text-lg mb-2">{performer.name}</p>
                <div className="space-y-2">
                  <p className="text-slate-300 text-sm">Rating: {renderStars(performer.rating)}</p>
                  <p className="text-emerald-400 font-semibold text-lg">Score: {performer.score}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drivers Table */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white">All Drivers</h2>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800/50 border-b border-white/5">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Driver Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Total Trips</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Total KM</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">On-Time %</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Incidents</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Rating</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Fuel Efficiency</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Score</th>
              </tr>
            </thead>
            <tbody>
              {drivers.length > 0 ? (
                drivers.map((driver) => (
                  <tr key={driver.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-6 py-4 text-sm text-white font-medium">{driver.name}</td>
                    <td className="px-6 py-4 text-sm text-white">{driver.totalTrips}</td>
                    <td className="px-6 py-4 text-sm text-white">{driver.totalKM.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-white">{driver.onTimePercent.toFixed(1)}%</td>
                    <td className="px-6 py-4 text-sm text-rose-400">{driver.incidents}</td>
                    <td className="px-6 py-4 text-sm text-amber-400">{renderStars(driver.rating)}</td>
                    <td className="px-6 py-4 text-sm text-white">{driver.fuelEfficiency.toFixed(2)} km/L</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold border ${getScoreColor(driver.score)}`}>
                        {driver.score}%
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-200">
                    No driver data available
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
