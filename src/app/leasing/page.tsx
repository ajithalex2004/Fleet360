'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface KPIs {
  activeContracts: number;
  totalContracts: number;
  monthlyRevenue: number;
  portfolioValue: number;
  overdueAmount: number;
  collectionRate: number;
  totalUnbilled: number;
  expiringPolicies: number;
  renewalsPending: number;
  remarketingPL: number;
  totalLessees: number;
  corporateLessees: number;
}

interface AnalyticsData {
  kpis: KPIs;
  charts?: any;
}

interface QuickLink {
  label: string;
  href: string;
  icon: string;
}

export default function LeasingDashboard() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/leasing/analytics');
        if (!res.ok) throw new Error('Failed to fetch analytics');
        const data = await res.json();
        setAnalyticsData(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const quickLinks: QuickLink[] = [
    { label: 'Traffic Fines', href: '/leasing/traffic-fines', icon: '|>' },
    { label: 'Fuel Management', href: '/leasing/fuel', icon: '()' },
    { label: 'Insurance', href: '/leasing/insurance', icon: 'S' },
    { label: 'Mileage Overage', href: '/leasing/mileage', icon: '#' },
    { label: 'Renewals', href: '/leasing/renewals', icon: 'R' },
    { label: 'Receivables', href: '/leasing/receivables', icon: 'M' },
    { label: 'Early Termination', href: '/leasing/early-terminations', icon: 'X' },
    { label: 'Documents', href: '/leasing/documents', icon: 'D' },
    { label: 'Remarketing', href: '/leasing/remarketing', icon: '*' },
    { label: 'Invoices', href: '/leasing/invoices', icon: 'I' },
    { label: 'Credit Assessments', href: '/leasing/credit-assessments', icon: 'C' },
    { label: 'Direct Debits', href: '/leasing/direct-debits', icon: 'E' },
    { label: 'CRM & Leads', href: '/leasing/crm', icon: 'L' },
    { label: 'Analytics', href: '/leasing/analytics', icon: 'A' },
    { label: 'Pre-Billing', href: '/leasing/pre-billing', icon: 'P' },
  ];

  const getCollectionRateColor = (rate: number) => {
    if (rate > 90) return 'text-emerald-300 bg-emerald-900 border-emerald-700';
    if (rate > 70) return 'text-amber-300 bg-amber-900 border-amber-700';
    return 'text-rose-300 bg-rose-900 border-rose-700';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading dashboard...</div>
      </div>
    );
  }

  const kpis = analyticsData?.kpis;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Leasing Dashboard</h1>
        <p className="text-gray-400">Overview of all vehicle leasing contracts and operations</p>
      </div>

      {/* Alert Strip */}
      {kpis && ((kpis.overdueAmount ?? 0) > 0 || (kpis.totalUnbilled ?? 0) > 10000 || (kpis.expiringPolicies ?? 0) > 0) && (
        <div className="bg-red-900 border border-red-700 text-red-200 p-4 rounded-lg flex items-start gap-3">
          <span className="font-bold text-lg">!</span>
          <div className="space-y-1">
            {(kpis.overdueAmount ?? 0) > 0 && (
              <p className="text-sm">
                ALERT: AED {(kpis.overdueAmount ?? 0).toLocaleString()} overdue
                {(kpis.overdueAmount ?? 0) > 50000 && ' [CRITICAL]'}
              </p>
            )}
            {(kpis.totalUnbilled ?? 0) > 10000 && (
              <p className="text-sm">
                AED {(kpis.totalUnbilled ?? 0).toLocaleString()} in pending operational charges (fines, fuel, overage)
              </p>
            )}
            {(kpis.expiringPolicies ?? 0) > 0 && (
              <p className="text-sm">
                {kpis.expiringPolicies} insurance {kpis.expiringPolicies === 1 ? 'policy' : 'policies'} expiring within 30 days
              </p>
            )}
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      {kpis && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-blue-900 bg-opacity-20 border border-blue-700 rounded-lg p-6">
            <p className="text-blue-300 text-sm font-medium mb-1">Active Contracts</p>
            <p className="text-3xl font-bold text-blue-200">{kpis.activeContracts}</p>
          </div>

          <div className="bg-emerald-900 bg-opacity-20 border border-emerald-700 rounded-lg p-6">
            <p className="text-emerald-300 text-sm font-medium mb-1">Monthly Revenue</p>
            <p className="text-3xl font-bold text-emerald-200">
              AED {((kpis.monthlyRevenue ?? 0) / 1000).toFixed(1)}K
            </p>
          </div>

          <div className="bg-indigo-900 bg-opacity-20 border border-indigo-700 rounded-lg p-6">
            <p className="text-indigo-300 text-sm font-medium mb-1">Portfolio Value</p>
            <p className="text-3xl font-bold text-indigo-200">
              AED {((kpis.portfolioValue ?? 0) / 1000000).toFixed(2)}M
            </p>
          </div>

          <div className={`border rounded-lg p-6 ${(kpis.overdueAmount ?? 0) > 50000 ? 'bg-red-900 bg-opacity-20 border-red-700' : 'bg-orange-900 bg-opacity-20 border-orange-700'}`}>
            <div className="flex justify-between items-start">
              <div>
                <p className={`text-sm font-medium mb-1 ${(kpis.overdueAmount ?? 0) > 50000 ? 'text-red-300' : 'text-orange-300'}`}>
                  Overdue Amount
                </p>
                <p className={`text-3xl font-bold ${(kpis.overdueAmount ?? 0) > 50000 ? 'text-red-200' : 'text-orange-200'}`}>
                  AED {(kpis.overdueAmount ?? 0).toLocaleString()}
                </p>
              </div>
              {(kpis.overdueAmount ?? 0) > 50000 && (
                <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">CRITICAL</span>
              )}
            </div>
          </div>

          <div className={`border rounded-lg p-6 ${getCollectionRateColor(kpis.collectionRate ?? 0)}`}>
            <p className="text-sm font-medium mb-1">Collection Rate</p>
            <p className="text-3xl font-bold">{(kpis.collectionRate ?? 0).toFixed(1)}%</p>
          </div>

          <div className="bg-amber-900 bg-opacity-20 border border-amber-700 rounded-lg p-6">
            <p className="text-amber-300 text-sm font-medium mb-1">Unbilled Operational Charges</p>
            <p className="text-3xl font-bold text-amber-200">
              AED {(kpis.totalUnbilled ?? 0).toLocaleString()}
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-600 rounded-lg p-6">
            <p className="text-slate-300 text-sm font-medium mb-1">Total Lessees</p>
            <p className="text-3xl font-bold text-white">{kpis.totalLessees ?? 0}</p>
            <p className="text-xs text-slate-400 mt-1">{kpis.corporateLessees ?? 0} corporate</p>
          </div>
        </div>
      )}

      {/* Quick Links Grid */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Quick Links</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg p-4 transition text-center"
            >
              <div className="text-2xl font-bold text-blue-400 mb-2">{link.icon}</div>
              <p className="text-xs text-gray-200 font-medium">{link.label}</p>
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900 border border-red-700 text-red-200 p-4 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
}
