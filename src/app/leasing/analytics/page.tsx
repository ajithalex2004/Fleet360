'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-theme';

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
  utilisationPct: number;
  activeVehicleMonths: number;
  totalVehicleMonths: number;
  fleetSize: number;
}

interface Charts {
  revenueByMonth: Record<string, number>;
  contractsByStatus: Record<string, number>;
  pendingBillingBreakdown: { fines: number; fuel: number; mileageOverage: number };
}

interface TopContract {
  contractId: string;
  contractNumber: string | null;
  revenue: number;
  exposure: number;
  netContribution: number;
}

interface AnalyticsData {
  kpis: KPIs;
  charts: Charts;
  topContracts: TopContract[];
}

const ANALYTICS_CACHE_TTL_MS = 120_000;

function analyticsCacheKey() {
  if (typeof window === 'undefined') return null;
  try {
    const session = JSON.parse(localStorage.getItem('xl_mobility_session') ?? '{}') as { tenantId?: string };
    return session.tenantId ? `leasing-analytics:${session.tenantId}` : null;
  } catch {
    return null;
  }
}

function readCachedAnalytics() {
  const key = analyticsCacheKey();
  if (!key || typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { ts: number; data: AnalyticsData } | null;
    if (!cached?.data || Date.now() - cached.ts > ANALYTICS_CACHE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedAnalytics(data: AnalyticsData) {
  const key = analyticsCacheKey();
  if (!key || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Cache writes are best effort; analytics must still render without them.
  }
}

export default function AnalyticsPage() {
  const [data, setData]               = useState<AnalyticsData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const dataRef = useRef<AnalyticsData | null>(null);

  const loadData = useCallback(async (force = false) => {
    const initialLoad = !dataRef.current;
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const url = force ? `/api/leasing/analytics?refresh=${Date.now()}` : '/api/leasing/analytics';
      const res = await fetch(url, force ? { cache: 'no-store' } : undefined);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json() as AnalyticsData;
      setData(json);
      dataRef.current = json;
      writeCachedAnalytics(json);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedAnalytics();
    if (cached) {
      setData(cached.data);
      dataRef.current = cached.data;
      setLastRefreshed(new Date(cached.ts));
      setLoading(false);
    }
    loadData();
  }, [loadData]);

  const collectionColor = (r: number) =>
    r > 90 ? 'fleet-readable-panel bg-emerald-100 border-emerald-400'
    : r > 70 ? 'fleet-readable-panel bg-amber-100 border-amber-400'
    : 'fleet-readable-panel bg-rose-100 border-rose-500';

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400 animate-pulse">Loading analytics...</div>
    </div>
  );

  if (!data) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-rose-400">{error ?? 'No data available'}</div>
    </div>
  );

  const { kpis, charts } = data;

  // Revenue chart data - API returns Record<string, number>
  const revenueEntries = Object.entries(charts?.revenueByMonth ?? {})
    .sort(([a], [b]) => a.localeCompare(b));
  const maxRevenue = Math.max(...revenueEntries.map(([, v]) => v), 1);

  // Contract status breakdown
  const statusEntries = Object.entries(charts?.contractsByStatus ?? {});
  const totalContracts = statusEntries.reduce((s, [, v]) => s + v, 0) || 1;
  const statusColors: Record<string, string> = {
    ACTIVE: 'bg-emerald-500', DRAFT: 'bg-blue-500',
    APPROVED: 'bg-indigo-500', EXTENDED: 'bg-violet-500',
    TERMINATED: 'bg-orange-500', CLOSED: 'bg-slate-500',
  };

  const billing = charts?.pendingBillingBreakdown ?? { fines: 0, fuel: 0, mileageOverage: 0 };

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title="Analytics & BI"
        subtitle={`Real-time leasing portfolio intelligence${lastRefreshed ? ` • Last refreshed: ${lastRefreshed.toLocaleTimeString()}` : ''}`}
        accent="blue"
        actions={(
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="px-5 py-2.5 rounded-xl bg-slate-700 border border-white/10 text-white text-sm font-medium hover:bg-slate-600 transition-all"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>
      )}

      {/* KPI Cards — clickable for drill-down */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[
          { label: 'Active Contracts',     value: kpis.activeContracts,                       sub: `of ${kpis.totalContracts} total`,      color: 'from-blue-500 to-indigo-600',          href: '/leasing/contracts-v2?status=ACTIVE' },
          { label: 'Monthly Revenue',      value: `AED ${((kpis.monthlyRevenue ?? 0) / 1000).toFixed(1)}K`, sub: 'from active contracts', color: 'from-emerald-500 to-teal-600',     href: '/leasing/payments?status=PAID' },
          { label: 'Portfolio Value',      value: `AED ${((kpis.portfolioValue ?? 0) / 1000000).toFixed(2)}M`, sub: 'total contract value',  color: 'from-indigo-500 to-violet-600',  href: '/leasing/contracts-v2' },
          { label: 'Overdue Amount',       value: `AED ${(kpis.overdueAmount ?? 0).toLocaleString()}`,     sub: (kpis.overdueAmount ?? 0) > 50000 ? 'CRITICAL' : 'pending collection', color: (kpis.overdueAmount ?? 0) > 50000 ? 'from-red-600 to-rose-600' : 'from-orange-500 to-amber-600', href: '/leasing/receivables' },
          { label: 'Unbilled Charges',     value: `AED ${(kpis.totalUnbilled ?? 0).toLocaleString()}`,     sub: 'fines + fuel + overage',   color: 'from-amber-500 to-orange-600',     href: '/leasing/mileage-overages?status=PENDING' },
          { label: 'Expiring Policies',    value: kpis.expiringPolicies ?? 0,                 sub: 'insurance within 30 days', color: (kpis.expiringPolicies ?? 0) > 0 ? 'from-rose-500 to-pink-600' : 'from-slate-600 to-slate-500', href: '/leasing/insurance' },
          { label: 'Renewal Pipeline',     value: kpis.renewalsPending ?? 0,                  sub: 'awaiting customer response', color: 'from-violet-500 to-purple-600',  href: '/leasing/renewals' },
          { label: 'Total Lessees',        value: kpis.totalLessees ?? 0,                     sub: `${kpis.corporateLessees ?? 0} corporate`, color: 'from-cyan-500 to-blue-600',  href: '/leasing/lessees' },
        ].map(({ label, value, sub, color, href }) => (
          <Link key={label} href={href} className={`rounded-2xl bg-gradient-to-br ${color} p-5 block hover:scale-[1.02] transition-transform`}>
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-sm font-medium text-white/80 mt-1">{label}</div>
            <div className="text-xs text-white/60 mt-0.5">{sub} <span className="opacity-70">→</span></div>
          </Link>
        ))}
      </div>

      {/* Fleet Utilisation — real vehicle-month-based calc */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Fleet Utilisation</h2>
            <p className="text-xs text-slate-400 mt-1">
              Active vehicle-months ÷ available vehicle-months over trailing 6 months
            </p>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-bold ${
              (kpis.utilisationPct ?? 0) >= 80 ? 'text-emerald-300' :
              (kpis.utilisationPct ?? 0) >= 60 ? 'text-amber-300' : 'text-rose-300'
            }`}>
              {(kpis.utilisationPct ?? 0).toFixed(1)}%
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {kpis.activeVehicleMonths ?? 0} / {kpis.totalVehicleMonths ?? 0} vehicle-months
            </div>
          </div>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              (kpis.utilisationPct ?? 0) >= 80 ? 'bg-emerald-500' :
              (kpis.utilisationPct ?? 0) >= 60 ? 'bg-amber-500' : 'bg-rose-500'
            }`}
            style={{ width: `${Math.min(kpis.utilisationPct ?? 0, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-slate-500">
          <span>Fleet size: {kpis.fleetSize ?? 0} vehicles under contract</span>
          <span>Target: 85%</span>
        </div>
      </div>

      {/* Collection Rate - standalone card */}
      <div className={`rounded-2xl border p-5 ${collectionColor(kpis.collectionRate ?? 0)}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium mb-1 opacity-80">Payment Collection Rate</div>
            <div className="text-4xl font-bold">{(kpis.collectionRate ?? 0).toFixed(1)}%</div>
          </div>
          <div className="text-right">
            <div className="text-xs opacity-60">Target: 95%</div>
            <div className="mt-1 text-sm font-semibold">
              {(kpis.collectionRate ?? 0) >= 95 ? 'On Target' : (kpis.collectionRate ?? 0) >= 70 ? 'Below Target' : 'Critical'}
            </div>
          </div>
        </div>
        <div className="mt-3 w-full bg-white/20 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-white/70 transition-all"
            style={{ width: `${Math.min(kpis.collectionRate ?? 0, 100)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Month */}
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-5">Revenue by Month</h2>
          {revenueEntries.length === 0 ? (
            <div className="text-center text-slate-500 py-8">No payment data yet</div>
          ) : (
            <div className="space-y-3">
              {revenueEntries.map(([month, amount]) => {
                const pct = Math.round((amount / maxRevenue) * 100);
                return (
                  <div key={month}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-slate-300">{month}</span>
                      <span className="text-sm font-semibold text-white">AED {(amount / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Contract Status Breakdown */}
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-5">Contract Status Breakdown</h2>
          {statusEntries.length === 0 ? (
            <div className="text-center text-slate-500 py-8">No contracts yet</div>
          ) : (
            <div className="space-y-3">
              {statusEntries.map(([status, count]) => {
                const pct = Math.round((count / totalContracts) * 100);
                return (
                  <div key={status}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-slate-300">{status}</span>
                      <span className="text-sm font-semibold text-white">{count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${statusColors[status] ?? 'bg-slate-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pending Billing Breakdown */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-5">Pending Operational Billing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Traffic Fines',    value: billing.fines,         color: 'from-rose-600 to-pink-600' },
            { label: 'Fuel Charges',     value: billing.fuel,          color: 'from-amber-600 to-orange-600' },
            { label: 'Mileage Overage',  value: billing.mileageOverage,color: 'from-violet-600 to-purple-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-xl bg-gradient-to-br ${color} p-5`}>
              <div className="text-xs font-medium text-white/70 mb-1">{label}</div>
              <div className="text-2xl font-bold text-white">AED {(value ?? 0).toLocaleString()}</div>
              <div className="text-xs text-white/60 mt-1">Unbilled to lessees</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top contracts by net contribution */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Top 5 Contracts by Net Contribution (YTD)</h2>
            <p className="text-xs text-slate-400 mt-1">YTD paid revenue minus unbilled exposure (fines + fuel + overage). Click to drill in.</p>
          </div>
        </div>
        {(data.topContracts ?? []).length === 0 ? (
          <div className="text-center text-slate-500 py-8">No active contracts with paid revenue yet.</div>
        ) : (
          <div className="space-y-2">
            {(data.topContracts ?? []).map((c, i) => {
              const maxContribution = Math.max(...(data.topContracts ?? []).map(x => Math.abs(x.netContribution)), 1);
              const pct = Math.abs(c.netContribution) / maxContribution * 100;
              const positive = c.netContribution >= 0;
              return (
                <Link
                  key={c.contractId}
                  href={`/leasing/contracts-v2/${c.contractId}`}
                  className="block p-3 rounded-xl border border-white/5 bg-slate-900/40 hover:bg-slate-900/70 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-slate-500 text-xs w-5 text-right">{i + 1}.</span>
                      <span className="font-mono text-cyan-300 text-sm truncate">{c.contractNumber ?? c.contractId.slice(0, 8)}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-base font-semibold ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                        AED {c.netContribution.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {c.revenue.toLocaleString('en-US', { maximumFractionDigits: 0 })} revenue · {c.exposure.toLocaleString('en-US', { maximumFractionDigits: 0 })} unbilled
                      </div>
                    </div>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${positive ? 'bg-emerald-500' : 'bg-rose-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Lessee Portfolio</h2>
        <p className="text-slate-400 text-sm mb-4">Active lessee breakdown by type</p>
        <div className="flex items-end gap-6">
          <div>
            <div className="text-4xl font-bold text-white">{kpis.totalLessees ?? 0}</div>
            <div className="text-xs text-slate-400 mt-1">Total Lessees</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-400">{kpis.corporateLessees ?? 0}</div>
            <div className="text-xs text-slate-400 mt-1">Corporate</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-violet-400">{(kpis.totalLessees ?? 0) - (kpis.corporateLessees ?? 0)}</div>
            <div className="text-xs text-slate-400 mt-1">Individual</div>
          </div>
        </div>
      </div>
    </div>
  );
}
