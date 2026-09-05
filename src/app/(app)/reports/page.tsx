'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import Link from 'next/link';

interface ScheduledReport {
  id: string;
  name: string;
  frequency: string;
  lastRun: string;
  nextRun: string;
}

interface ReportCategory {
  id: number;
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
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Generate and track business intelligence reports"
        icon={BarChart3}
        accent="violet"
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Reports Generated',      value: stats.generated,               sub: 'This month',     tone: 'from-blue-500 to-indigo-600' },
          { label: 'Data Records Analyzed',  value: stats.analyzed.toLocaleString(), sub: 'Total records',  tone: 'from-cyan-500 to-blue-600' },
          { label: 'Scheduled Reports',      value: stats.scheduled,               sub: 'Active schedules',tone: 'from-violet-500 to-purple-600' },
        ].map(card => (
          <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.tone} p-6 shadow-sm`}>
            <p className="text-white/80 text-sm font-medium mb-2">{card.label}</p>
            <p className="text-3xl font-bold text-white">{card.value}</p>
            <p className="text-white/60 text-xs mt-2">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Report Categories */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Available Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reportCategories.map((category) => (
            <Link key={category.id} href={category.href}>
              <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 hover:border-blue-500/50 hover:bg-[var(--bg-surface-hover)] transition-all cursor-pointer h-full">
                <p className="text-4xl mb-3">{category.icon}</p>
                <h3 className="text-[var(--text-main)] font-semibold mb-1">{category.name}</h3>
                <p className="text-[var(--text-muted)] text-sm mb-4">{category.description}</p>
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
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Scheduled Reports</h2>
        {scheduledReports.length > 0 ? (
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)]">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Report Name</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Frequency</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Last Run</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Next Run</th>
                </tr>
              </thead>
              <tbody>
                {scheduledReports.map((report) => (
                  <tr key={report.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{report.name}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-main)]">{report.frequency}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">
                      {new Date(report.lastRun).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">
                      {new Date(report.nextRun).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8 text-center">
            <p className="text-[var(--text-muted)]">No scheduled reports. Set up automated reports to stay informed.</p>
          </div>
        )}
      </div>
    </div>
  );
}
