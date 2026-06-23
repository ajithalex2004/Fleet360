'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface LeasingOperationalException {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  count: number;
  amount?: number;
  actionHref: string;
  actionLabel: string;
}

interface LeasingOperationalDashboard {
  generatedAt: string;
  kpis: {
    activeContracts: number;
    contractsAtRisk: number;
    openExceptions: number;
    criticalExceptions: number;
    highExceptions: number;
    overdueAmount: number;
    uninvoicedStatements: number;
    pendingExecutionApprovals: number;
  };
  exceptions: LeasingOperationalException[];
}

const quickLinks = [
  { label: 'Agreements', href: '/leasing/contracts-v2' },
  { label: 'Pre-Billing', href: '/finance/leasing-billing/pre-billing' },
  { label: 'Invoices', href: '/finance/leasing-billing/invoices' },
  { label: 'Receivables', href: '/finance/leasing-billing/receivables' },
  { label: 'Renewals', href: '/leasing/renewals' },
  { label: 'Documents', href: '/leasing/documents' },
  { label: 'Traffic Fines', href: '/finance/leasing-billing/traffic-fines' },
  { label: 'Fuel', href: '/finance/leasing-billing/fuel' },
  { label: 'Mileage', href: '/finance/leasing-billing/mileage' },
  { label: 'Analytics', href: '/leasing/analytics' },
];

function money(value: unknown, currency = 'AED') {
  return `${currency} ${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function severityClass(severity: Severity) {
  if (severity === 'critical') return 'fleet-readable-panel border-rose-500/40 bg-rose-500/10';
  if (severity === 'high') return 'fleet-readable-panel border-amber-500/40 bg-amber-500/10';
  if (severity === 'medium') return 'fleet-readable-panel border-blue-500/30 bg-blue-500/10';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-100';
}

function severityBadge(severity: Severity) {
  if (severity === 'critical') return 'fleet-readable-pill bg-rose-100 border-rose-400';
  if (severity === 'high') return 'fleet-readable-pill bg-amber-100 border-amber-400';
  if (severity === 'medium') return 'fleet-readable-pill bg-blue-100 border-blue-400';
  return 'bg-slate-500/20 text-slate-200 border-slate-500/40';
}

export default function LeasingDashboard() {
  const [dashboard, setDashboard] = useState<LeasingOperationalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const dashboardRef = useRef<LeasingOperationalDashboard | null>(null);

  const fetchDashboard = useCallback(async () => {
    const initialLoad = !dashboardRef.current;
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError('');
    try {
      const response = await fetch('/api/leasing/operational-dashboard');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Failed to load Leasing dashboard');
      setDashboard(data);
      dashboardRef.current = data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Leasing dashboard');
    } finally {
      if (initialLoad) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const healthLabel = useMemo(() => {
    if (!dashboard) return 'Loading';
    if (dashboard.kpis.criticalExceptions > 0) return 'Action required';
    if (dashboard.kpis.highExceptions > 0) return 'Needs attention';
    return 'Healthy';
  }, [dashboard]);

  const kpis = dashboard?.kpis;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Leasing Operations"
          subtitle="Exception-led control room for contracts, billing execution, collections, and approvals"
          icon={Gauge}
          accent="violet"
        />
        <button
          onClick={() => void fetchDashboard()}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      {loading && !dashboard ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-8 text-center text-slate-400">Loading Leasing operations...</div>
      ) : dashboard && kpis ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={ShieldAlert} label="Operational Health" value={healthLabel} sub={`${kpis.openExceptions} open exception${kpis.openExceptions === 1 ? '' : 's'}`} tone={kpis.criticalExceptions > 0 ? 'rose' : kpis.highExceptions > 0 ? 'amber' : 'emerald'} />
            <KpiCard icon={ClipboardList} label="Active Contracts" value={kpis.activeContracts} sub={`${kpis.contractsAtRisk} ending within 45 days`} tone="blue" />
            <KpiCard icon={Banknote} label="Overdue Exposure" value={money(kpis.overdueAmount)} sub="tenant-scoped receivables" tone={kpis.overdueAmount > 0 ? 'rose' : 'emerald'} />
            <KpiCard icon={FileText} label="Billing Execution" value={kpis.uninvoicedStatements} sub={`${kpis.pendingExecutionApprovals} approved action${kpis.pendingExecutionApprovals === 1 ? '' : 's'} not executed`} tone={kpis.uninvoicedStatements > 0 || kpis.pendingExecutionApprovals > 0 ? 'amber' : 'emerald'} />
          </div>

          {dashboard.exceptions.length === 0 ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" />
                <div>
                  <h2 className="font-semibold text-emerald-100">No Leasing exceptions detected</h2>
                  <p className="mt-1 text-sm text-emerald-100/70">Billing, approvals, receivables, tenant scope, and renewal readiness are currently clear for this tenant.</p>
                </div>
              </div>
            </div>
          ) : (
            <section className="rounded-xl border border-white/10 bg-slate-900/60">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Exception Queue</h2>
                  <p className="text-sm text-slate-400">Prioritized by severity; each item links to the page where the issue can be resolved.</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  Updated {new Date(dashboard.generatedAt).toLocaleString()}
                </span>
              </div>
              <div className="divide-y divide-white/10">
                {dashboard.exceptions.map(item => (
                  <div key={item.id} className={`p-5 ${severityClass(item.severity)}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${severityBadge(item.severity)}`}>{item.severity}</span>
                            <span className="text-xs font-semibold uppercase tracking-wide">{item.category}</span>
                          </div>
                          <h3 className="font-semibold">{item.title}</h3>
                          <p className="mt-1 text-sm">{item.detail}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
                            <span>Count: {item.count}</span>
                            {item.amount !== undefined && <span>Exposure: {money(item.amount)}</span>}
                          </div>
                        </div>
                      </div>
                      <Link
                        href={item.actionHref}
                        className="fleet-action-link inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-200"
                      >
                        {item.actionLabel} <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">Operational Shortcuts</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {quickLinks.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg border border-white/10 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-200 hover:border-violet-400/50 hover:bg-violet-500/10 hover:text-white"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string | number; sub: string; tone: 'rose' | 'amber' | 'emerald' | 'blue' }) {
  const colors = {
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[tone]}`}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{label}</span>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{sub}</div>
    </div>
  );
}
