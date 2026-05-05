'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface ScheduledReport {
  id: string;
  name: string;
  frequency: string;
  lastRun: string;
  nextRun: string;
}

interface ReportCategory {
  id: string;
  name: string;
  description: string;
  href: string;
  icon: string;
}

export default function ReportsDashboard() {
  const [scheduledReports, setScheduledReports] = useState<ScheduledReport[]>([]);
  const [stats, setStats] = useState({ generated: 0, analyzed: 0, scheduled: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/reports/dashboard');
        if (res.ok) {
          const data = await res.json();
          setScheduledReports(data.scheduledReports || []);
          setStats(data.stats || { generated: 0, analyzed: 0, scheduled: 0 });
        }
      } catch (error) {
        console.error('Error fetching reports data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const reportCategories: ReportCategory[] = [
    {
      id: 1,
      name: 'Fleet Utilization',
      description: 'Vehicle usage and efficiency metrics',
      href: '/reports/fleet-utilization',
      icon: '🚗',
    },
    {
      id: 2,
      name: 'Revenue Analysis',
      description: 'Income trends and performance',
      href: '/reports/revenue',
      icon: '💰',
    },
    {
      id: 3,
      name: 'Maintenance Cost',
      description: 'Service and repair expenses',
      href: '/reports/maintenance',
      icon: '🔧',
    },
    {
      id: 4,
      name: 'Driver Performance',
      description: 'Driver metrics and ratings',
      href: '/reports/driver-performance',
      icon: '👨‍✈️',
    },
    {
      id: 5,
      name: 'Custom Report',
      description: 'Create custom analytics',
      href: '#',
      icon: '📋',
    },
    {
      id: 6,
      name: 'Export Data',
      description: 'Download reports and data',
      href: '#',
      icon: '📥',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Reports & Analytics</h1>
        <p className="text-slate-400">Generate and track business intelligence reports</p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <p className="text-slate-400 text-sm font-medium mb-2">Reports Generated</p>
          <p className="text-3xl font-bold text-blue-400">{stats.generated}</p>
          <p className="text-slate-500 text-xs mt-2">This month</p>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <p className="text-slate-400 text-sm font-medium mb-2">Data Records Analyzed</p>
          <p className="text-3xl font-bold text-indigo-400">{stats.analyzed.toLocaleString()}</p>
          <p className="text-slate-500 text-xs mt-2">Total records</p>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <p className="text-slate-400 text-sm font-medium mb-2">Scheduled Reports</p>
          <p className="text-3xl font-bold text-violet-400">{stats.scheduled}</p>
          <p className="text-slate-500 text-xs mt-2">Active schedules</p>
        </div>
      </div>

      {/* Report Categories */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white">Available Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reportCategories.map((category) => (
            <Link key={category.id} href={category.href}>
              <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 hover:border-blue-500/50 hover:bg-slate-800/70 transition-all cursor-pointer h-full">
                <p className="text-4xl mb-3">{category.icon}</p>
                <h3 className="text-white font-semibold mb-1">{category.name}</h3>
                <p className="text-slate-400 text-sm mb-4">{category.description}</p>
                <button className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90 transition-all">
                  Generate
                </button>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Scheduled Reports */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white">Scheduled Reports</h2>
        {scheduledReports.length > 0 ? (
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800/50 border-b border-white/5">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Report Name</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Frequency</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Last Run</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Next Run</th>
                </tr>
              </thead>
              <tbody>
                {scheduledReports.map((report) => (
                  <tr key={report.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-6 py-4 text-sm text-white font-medium">{report.name}</td>
                    <td className="px-6 py-4 text-sm text-white">{report.frequency}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {new Date(report.lastRun).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {new Date(report.nextRun).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-8 text-center">
            <p className="text-slate-400">No scheduled reports. Set up automated reports to stay informed.</p>
          </div>
        )}
      </div>
    </div>
  );
}
