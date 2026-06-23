'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ReadinessStatus = 'READY' | 'ATTENTION' | 'BLOCKED';
type Severity = 'blocker' | 'warning' | 'info' | 'pass';

interface ReadinessCheck {
  key: string;
  category: string;
  label: string;
  severity: Severity;
  message: string;
  actionHref?: string;
}

interface ReadinessCategory {
  key: string;
  label: string;
  score: number;
  status: ReadinessStatus;
  blockers: number;
  warnings: number;
  passes: number;
}

interface ReadinessRow {
  tenant?: {
    id: string;
    name: string;
    code?: string | null;
    plan?: string | null;
    isActive?: boolean | null;
  };
  readiness: {
    tenantId: string;
    score: number;
    status: ReadinessStatus;
    blockers: ReadinessCheck[];
    warnings: ReadinessCheck[];
    checks: ReadinessCheck[];
    categories: ReadinessCategory[];
    metrics: {
      enabledModules: number;
      totalModules: number;
      activeUsers: number;
      adminUsersWithoutMfa: number;
      pendingApprovals: number;
      openInvitations: number;
      failedLogins24h: number;
      activeModuleSubscriptions: number;
    };
    billing: null | {
      model: string;
      status: string;
      moduleMrr: number;
      currency: string;
    };
  };
}

interface ReadinessResponse {
  summary: {
    total: number;
    ready: number;
    attention: number;
    blocked: number;
    averageScore: number;
  };
  tenants: ReadinessRow[];
  generatedAt: string;
}

const STATUS_FILTERS: Array<'ALL' | ReadinessStatus> = ['ALL', 'BLOCKED', 'ATTENTION', 'READY'];

export default function TenantReadinessPage() {
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [status, setStatus] = useState<'ALL' | ReadinessStatus>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = status === 'ALL' ? 'limit=100' : `limit=100&status=${status}`;
      const res = await fetch(`/api/admin/tenants/readiness?${query}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to load tenant readiness');
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant readiness');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const categorySummary = useMemo(() => {
    const buckets = new Map<string, { label: string; total: number; score: number; blockers: number; warnings: number }>();
    for (const row of data?.tenants ?? []) {
      for (const category of row.readiness.categories) {
        const current = buckets.get(category.key) ?? { label: category.label, total: 0, score: 0, blockers: 0, warnings: 0 };
        current.total += 1;
        current.score += category.score;
        current.blockers += category.blockers;
        current.warnings += category.warnings;
        buckets.set(category.key, current);
      }
    }
    return Array.from(buckets.entries()).map(([key, value]) => ({
      key,
      label: value.label,
      score: value.total ? Math.round(value.score / value.total) : 0,
      blockers: value.blockers,
      warnings: value.warnings,
    })).sort((a, b) => a.score - b.score);
  }, [data]);

  const topIssues = useMemo(() => {
    return (data?.tenants ?? [])
      .flatMap(row => {
        const tenantName = row.tenant?.name ?? row.readiness.tenantId;
        return [...row.readiness.blockers, ...row.readiness.warnings].map(issue => ({
          ...issue,
          tenantName,
          tenantId: row.readiness.tenantId,
          score: row.readiness.score,
        }));
      })
      .slice(0, 8);
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading tenant readiness...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
        <div>
          <div className="flex items-center gap-3 text-sm text-slate-400 mb-2">
            <Link href="/admin/tenants" className="text-blue-300 hover:text-blue-200">Tenants</Link>
            <span>/</span>
            <span>Readiness</span>
          </div>
          <h1 className="text-4xl font-bold text-white">Tenant Readiness</h1>
          <p className="text-slate-400 mt-2 max-w-3xl">
            A control-plane view of tenant launch health across identity, access, billing, security, service configuration, and admin operations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(item => (
            <button
              key={item}
              onClick={() => setStatus(item)}
              className={`px-4 py-2 rounded-xl border text-sm font-semibold transition ${
                status === item
                  ? 'bg-blue-600 text-white border-blue-400'
                  : 'bg-slate-900/70 text-slate-300 border-white/10 hover:bg-white/5'
              }`}
            >
              {item === 'ALL' ? 'All' : item}
            </button>
          ))}
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 border border-white/10 text-sm font-semibold hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        {[
          ['Average Score', `${data?.summary.averageScore ?? 0}%`, 'text-blue-300'],
          ['Ready', data?.summary.ready ?? 0, 'text-emerald-300'],
          ['Attention', data?.summary.attention ?? 0, 'text-amber-300'],
          ['Blocked', data?.summary.blocked ?? 0, 'text-rose-300'],
          ['Tenants', data?.summary.total ?? 0, 'text-slate-100'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
            <p className={`mt-3 text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-white">Tenant Queue</h2>
            <p className="text-sm text-slate-400">Sorted by readiness score, with the highest-risk tenants first.</p>
          </div>
          <div className="divide-y divide-white/10">
            {(data?.tenants ?? [])
              .slice()
              .sort((a, b) => a.readiness.score - b.readiness.score)
              .map(row => {
                const topIssue = row.readiness.blockers[0] ?? row.readiness.warnings[0];
                return (
                  <div key={row.readiness.tenantId} className="p-5">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-white truncate">{row.tenant?.name ?? row.readiness.tenantId}</h3>
                          {row.tenant?.code && <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{row.tenant.code}</span>}
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(row.readiness.status)}`}>
                            {row.readiness.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-400">
                          {row.readiness.metrics.enabledModules}/{row.readiness.metrics.totalModules} modules,
                          {' '}{row.readiness.metrics.activeUsers} users,
                          {' '}{row.readiness.metrics.activeModuleSubscriptions} subscriptions
                        </p>
                        {topIssue && <p className="mt-3 text-sm text-amber-100">{topIssue.message}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-3xl font-bold text-white">{row.readiness.score}%</div>
                          <div className="text-xs text-slate-500">readiness</div>
                        </div>
                        <Link
                          href={`/admin/tenants/${row.readiness.tenantId}`}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                        >
                          Open 360
                        </Link>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
                      {row.readiness.categories.slice(0, 4).map(category => (
                        <div key={category.key} className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-400 truncate">{category.label}</span>
                            <span className={`text-xs font-bold ${scoreTextClass(category.score)}`}>{category.score}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            {(data?.tenants ?? []).length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">No tenants match this readiness filter.</div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Category Health</h2>
              <p className="text-sm text-slate-400">Lowest platform-wide readiness areas.</p>
            </div>
            <div className="divide-y divide-white/10">
              {categorySummary.map(category => (
                <div key={category.key} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">{category.label}</span>
                    <span className={`text-sm font-bold ${scoreTextClass(category.score)}`}>{category.score}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div className={`h-full ${scoreBarClass(category.score)}`} style={{ width: `${category.score}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{category.blockers} blockers, {category.warnings} warnings</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Top Actions</h2>
              <p className="text-sm text-slate-400">Immediate remediation links.</p>
            </div>
            <div className="divide-y divide-white/10">
              {topIssues.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No blockers or warnings.</div>
              ) : topIssues.map((issue, index) => (
                <div key={`${issue.tenantId}-${issue.key}-${index}`} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${issue.severity === 'blocker' ? 'bg-rose-500/20 text-rose-200' : 'bg-amber-500/20 text-amber-200'}`}>
                      {issue.severity}
                    </span>
                    <span className="text-xs text-slate-500">{issue.score}%</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{issue.tenantName}</p>
                  <p className="mt-1 text-xs text-slate-400">{issue.message}</p>
                  <Link href={issue.actionHref || `/admin/tenants/${issue.tenantId}`} className="mt-3 inline-block text-xs text-blue-300 hover:text-blue-200">
                    Resolve
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function statusClass(status: ReadinessStatus) {
  if (status === 'READY') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
  if (status === 'ATTENTION') return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
  return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
}

function scoreTextClass(score: number) {
  if (score >= 80) return 'text-emerald-300';
  if (score >= 50) return 'text-amber-300';
  return 'text-rose-300';
}

function scoreBarClass(score: number) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}
