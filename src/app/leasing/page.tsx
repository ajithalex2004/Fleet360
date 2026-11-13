'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CarFront,
  FileText,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, KpiCard, StatGrid } from '@/components/ui/page-theme';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFetchedData, invalidate } from '@/hooks/useFetchedData';

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
  totalLessees: number;
  corporateLessees: number;
}

interface AnalyticsData {
  kpis: KPIs;
}

interface QuickLink {
  label: string;
  href: string;
  icon: LucideIcon;
  tone: string;
  description: string;
}

const EMPTY_KPIS: KPIs = {
  activeContracts: 0,
  totalContracts: 0,
  monthlyRevenue: 0,
  portfolioValue: 0,
  overdueAmount: 0,
  collectionRate: 0,
  totalUnbilled: 0,
  expiringPolicies: 0,
  renewalsPending: 0,
  totalLessees: 0,
  corporateLessees: 0,
};

const quickLinks: QuickLink[] = [
  { label: 'Inquiries', href: '/leasing/inquiries', icon: MessageCircle, tone: 'from-blue-500 to-cyan-500', description: 'Capture leasing demand' },
  { label: 'Quotations', href: '/leasing/quotations', icon: FileText, tone: 'from-indigo-500 to-blue-500', description: 'Build customer offers' },
  { label: 'Lease Agreements', href: '/leasing/contracts-v2', icon: FileText, tone: 'from-violet-500 to-purple-500', description: 'Manage active agreements' },
  { label: 'Mileage', href: '/leasing/mileage', icon: Activity, tone: 'from-sky-500 to-indigo-500', description: 'Readings and overage' },
  { label: 'Renewals', href: '/leasing/renewals', icon: RefreshCw, tone: 'from-emerald-500 to-teal-500', description: 'Manage renewal pipeline' },
  { label: 'Early Terminations', href: '/leasing/early-terminations', icon: AlertTriangle, tone: 'from-rose-500 to-pink-500', description: 'Close contracts cleanly' },
  { label: 'Credit Assessments', href: '/leasing/credit-assessments', icon: ShieldCheck, tone: 'from-violet-500 to-purple-500', description: 'Risk and approval checks' },
  { label: 'Analytics', href: '/leasing/analytics', icon: BarChart3, tone: 'from-blue-500 to-indigo-500', description: 'Portfolio insights' },
  { label: 'Fleet Operations', href: '/fleet', icon: CarFront, tone: 'from-slate-600 to-slate-800', description: 'Fuel, fines, insurance, and documents' },
];

function moneyShort(value: number, divisor: number, suffix: string) {
  return `AED ${(value / divisor).toFixed(1)}${suffix}`;
}

export default function LeasingDashboard() {
  const { tLabel } = useLanguage();

  // Session-scoped fetch cache — 1st visit hits the cached analytics
  // endpoint (unstable_cache + private s-maxage), 2nd visit in the same
  // tab is instant from the in-memory Map.
  const { data: analyticsData, loading: loadingAnalytics, error: analyticsError,
          refresh: refreshAnalytics } =
    useFetchedData<AnalyticsData>('/api/leasing/analytics');

  // Expose a manual refresh trigger so other parts of the app can call
  // window.fleet360.refreshLeasing() after a write.
  useEffect(() => {
    const w = window as unknown as { fleet360?: Record<string, () => void> };
    w.fleet360 = w.fleet360 ?? {};
    w.fleet360.refreshLeasing = refreshAnalytics;
    return () => { delete w.fleet360?.refreshLeasing; };
  }, [refreshAnalytics]);

  const error = analyticsError
    ? 'Live analytics are temporarily unavailable. Showing the Leasing workspace with safe fallback values.'
    : null;
  const kpis = analyticsData?.kpis ?? EMPTY_KPIS;

  const attentionItems = [
    {
      label: 'Overdue amount',
      value: `AED ${kpis.overdueAmount.toLocaleString()}`,
      state: kpis.overdueAmount > 0 ? 'Needs attention' : 'Clear',
    },
    {
      label: 'Unbilled charges',
      value: `AED ${kpis.totalUnbilled.toLocaleString()}`,
      state: kpis.totalUnbilled > 0 ? 'Ready for review' : 'Clear',
    },
    {
      label: 'Expiring policies',
      value: String(kpis.expiringPolicies),
      state: kpis.expiringPolicies > 0 ? 'Next 30 days' : 'Clear',
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={tLabel("Leasing Dashboard")}
        subtitle={tLabel("Vehicle leasing contracts, renewals, compliance, and operational billing readiness.")}
        icon={FileText}
        accent="violet"
      />

      {error && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-400">
          {error}
        </div>
      )}

      <StatGrid cols={4}>
        {[
          { label: 'Active contracts', value: kpis.activeContracts, sub: `${kpis.totalContracts} ${tLabel('total contracts')}`, accent: 'cyan' as const },
          { label: 'Monthly revenue', value: moneyShort(kpis.monthlyRevenue, 1000, 'K'), sub: tLabel('active lease run-rate'), accent: 'emerald' as const },
          { label: 'Portfolio value', value: moneyShort(kpis.portfolioValue, 1000000, 'M'), sub: tLabel('contracted value'), accent: 'violet' as const },
          { label: 'Collection rate', value: `${kpis.collectionRate.toFixed(0)}%`, sub: tLabel('finance-owned collections'), accent: 'amber' as const },
        ].map(card => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={loadingAnalytics ? '...' : card.value}
            sub={card.sub}
            accent={card.accent}
          />
        ))}
      </StatGrid>

      <StatGrid cols={3}>
        {attentionItems.map((item, idx) => {
          const accents = ['rose', 'amber', 'violet'] as const;
          return (
            <KpiCard
              key={item.label}
              label={item.label}
              value={loadingAnalytics ? '...' : item.value}
              sub={tLabel(item.state)}
              accent={accents[idx % accents.length]}
            />
          );
        })}
      </StatGrid>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-main)]">{tLabel("Quick Actions")}</h2>
            <p className="text-sm text-[var(--text-faint)]">{tLabel("Focused Leasing operations after finance and remarketing cleanup.")}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {quickLinks.map(link => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md"
              >
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${link.tone} text-white shadow-sm`}>
                  <Icon className="h-6 w-6" />
                </div>
                <p className="font-semibold text-[var(--text-main)]">{tLabel(link.label)}</p>
                <p className="mt-1 text-sm text-[var(--text-faint)]">{tLabel(link.description)}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
