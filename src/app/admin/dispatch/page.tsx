'use client';
/**
 * Admin › Dispatch Monitor
 *
 * Super Admin:   Cross-tenant dispatch health — all tenants, system-wide metrics,
 *                per-tenant breakdown, escalated jobs queue.
 * Tenant Admin:  Single-tenant dispatch health — KPIs, driver pool status,
 *                service mix, daily trend, urgent jobs.
 *
 * Auto-refreshes every 30 seconds.
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/* ═══════════════════════════════ TYPES ════════════════════════════════════ */

interface Summary {
  total: number; active: number; inProgress: number;
  completed: number; failed: number; cancelled: number;
  acceptanceRate: number; avgCompletionMin: number; avgAttempts: number;
}
interface Drivers {
  total: number; available: number; busy: number;
  onBreak: number; offDuty: number; utilizationPct: number;
}
interface SvcRow {
  serviceType: string; total: number; completed: number; failed: number; successRate: number;
}
interface TrendDay { day: string; total: number; completed: number; failed: number; }
interface UrgentJob {
  id: string; tenantId: string; serviceType: string; priority: string;
  status: string; currentAttempt: number; maxAttempts: number;
  createdAt: string; updatedAt: string;
}
interface TenantRow {
  tenantId: string; tenantName: string; total: number; completed: number;
  failed: number; active: number; acceptanceRate: number;
}
interface StatsPayload {
  period:           { days: number };
  summary:          Summary;
  drivers:          Drivers;
  serviceBreakdown: SvcRow[];
  trend:            TrendDay[];
  urgentJobs:       UrgentJob[];
  tenantBreakdown:  TenantRow[];
}

/* ═══════════════════════════════ CONSTANTS ════════════════════════════════ */

const SVC_ICON: Record<string, string> = {
  PASSENGER: '🚗', FREIGHT: '🚚', DELIVERY: '📦',
  AMBULANCE: '🚑', TECHNICIAN: '🔧', SCHOOL_BUS: '🚌',
};
const PRI_COLOR: Record<string, string> = {
  EMERGENCY: 'text-red-300 bg-red-500/20 border-red-500/40',
  P1:        'text-red-400 bg-red-500/15 border-red-500/30',
  P2:        'text-orange-400 bg-orange-500/15 border-orange-500/30',
  P3:        'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  URGENT:    'text-orange-400 bg-orange-500/15 border-orange-500/30',
  NORMAL:    'text-slate-400 bg-slate-700/50 border-slate-600',
  SCHEDULED: 'text-slate-500 bg-slate-800 border-slate-700',
};
const STATUS_COLOR: Record<string, string> = {
  ESCALATED: 'text-red-400',  FAILED: 'text-red-500',
};

/* ═══════════════════════════════ HELPERS ══════════════════════════════════ */

function fmtAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1)  return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/* ═══════════════════════════════ SUB-COMPONENTS ═══════════════════════════ */

function KPICard({
  icon, label, value, sub, color = 'text-white',
  href,
}: {
  icon: string; label: string; value: string | number;
  sub?: string; color?: string; href?: string;
}) {
  const inner = (
    <div className="rounded-2xl bg-slate-900 border border-white/10 p-5 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <span className={`text-3xl font-bold tabular-nums ${color}`}>{value}</span>
      </div>
      <p className="text-slate-300 text-sm font-medium">{label}</p>
      {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function TrendChart({ trend, days }: { trend: TrendDay[]; days: number }) {
  if (!trend.length) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
        No job activity in the last {days} days
      </div>
    );
  }
  const maxVal = Math.max(...trend.map(t => t.total), 1);
  return (
    <div className="flex items-end gap-1 h-32 w-full">
      {trend.map(t => {
        const totalH  = Math.round((t.total     / maxVal) * 100);
        const compH   = Math.round((t.completed / maxVal) * 100);
        const failH   = Math.round((t.failed    / maxVal) * 100);
        return (
          <div key={t.day} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 border border-white/10 rounded px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              {fmtDate(t.day)}: {t.total} jobs
            </div>
            <div className="w-full flex flex-col justify-end rounded-sm overflow-hidden" style={{ height: `${totalH}%` }}>
              {/* Stacked: failed (red bottom), completed (green), pending (slate top) */}
              {failH > 0 && <div className="bg-red-500/60" style={{ height: `${Math.round((failH / totalH) * 100)}%` }} />}
              {compH > 0 && <div className="bg-emerald-500/60" style={{ height: `${Math.round((compH / totalH) * 100)}%` }} />}
              <div className="bg-blue-500/40 flex-1" />
            </div>
            <span className="text-slate-600 text-[9px]">{fmtDate(t.day).split(' ')[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════ MAIN PAGE ════════════════════════════════ */

export default function AdminDispatchPage() {
  const [stats,    setStats]    = useState<StatsPayload | null>(null);
  const [me,       setMe]       = useState<{ isSuperAdmin: boolean; tenantId: string } | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [days,     setDays]     = useState(7);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  // load session
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => setMe(data))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!me) return;
    setLoading(true);
    const tenantParam = me.isSuperAdmin ? '' : `&tenantId=${me.tenantId}`;
    fetch(`/api/admin/dispatch-stats?days=${days}${tenantParam}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setStats(data); setLastRefresh(Date.now()); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [me, days]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const s = stats?.summary;
  const d = stats?.drivers;

  return (
    <div className="space-y-8 max-w-7xl">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            🚦 Dispatch Monitor
            {loading && <span className="w-3 h-3 rounded-full bg-blue-400 animate-pulse" />}
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {me?.isSuperAdmin
              ? 'Platform-wide dispatch health across all tenants'
              : "Your tenant’s dispatch operations overview"}
            {' · '}<span className="text-slate-600">Updated {fmtAgo(new Date(lastRefresh).toISOString())}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Day range picker */}
          <div className="flex items-center gap-1 bg-slate-900 border border-white/10 rounded-xl p-1">
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}>
                {d}d
              </button>
            ))}
          </div>
          <button onClick={load}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-all">
            ↺ Refresh
          </button>
          <Link href="/dispatch/command"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold text-sm hover:opacity-90 transition-all shadow-lg shadow-blue-500/20">
            🚦 Command Centre
            <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-semibold">LIVE</span>
          </Link>
        </div>
      </div>

      {/* ── KPI Bar ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard icon="📋" label="Total Jobs"       value={loading ? '…' : (s?.total ?? 0)}
          sub={`Last ${days} days`} href="/dispatch/jobs" />
        <KPICard icon="🔵" label="Active"           value={loading ? '…' : (s?.active ?? 0)}
          color="text-blue-400"    sub="Pending / Searching" />
        <KPICard icon="🚗" label="In Progress"      value={loading ? '…' : (s?.inProgress ?? 0)}
          color="text-cyan-400"    sub="Currently en route" />
        <KPICard icon="✅" label="Completed"        value={loading ? '…' : (s?.completed ?? 0)}
          color="text-emerald-400" sub="Delivered / Resolved" />
        <KPICard icon="⚠️" label="Exceptions"       value={loading ? '…' : (s?.failed ?? 0)}
          color="text-red-400"     sub="Failed + Escalated" />
        <KPICard icon="📊" label="Acceptance Rate"  value={loading ? '…' : `${s?.acceptanceRate ?? 0}%`}
          color="text-yellow-400"  sub={`Avg ${s?.avgCompletionMin ?? 0} min / job`} />
      </div>

      {/* ── Driver Pool + Service Mix ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Driver pool */}
        <div className="rounded-2xl bg-slate-900 border border-white/10 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">🤵 Driver Pool</h2>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${
                (d?.utilizationPct ?? 0) >= 90 ? 'text-red-400' :
                (d?.utilizationPct ?? 0) >= 70 ? 'text-amber-400' : 'text-emerald-400'
              }`}>{loading ? '…' : `${d?.utilizationPct ?? 0}%`}</span>
              <span className="text-slate-500 text-xs">utilised</span>
            </div>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-8 bg-slate-800 rounded animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-4">
              {[
                { label: 'Available', value: d?.available ?? 0, color: 'bg-emerald-500', dot: 'bg-emerald-400' },
                { label: 'Busy',      value: d?.busy      ?? 0, color: 'bg-yellow-500',  dot: 'bg-yellow-400'  },
                { label: 'On Break',  value: d?.onBreak   ?? 0, color: 'bg-blue-500',    dot: 'bg-blue-400'    },
                { label: 'Off Duty',  value: d?.offDuty   ?? 0, color: 'bg-slate-600',   dot: 'bg-slate-500'   },
              ].map(row => {
                const pct = (d?.total ?? 0) > 0 ? Math.round((row.value / (d?.total ?? 1)) * 100) : 0;
                return (
                  <div key={row.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${row.dot}`} />
                        <span className="text-slate-300">{row.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold tabular-nums">{row.value}</span>
                        <span className="text-slate-600 text-xs">{pct}%</span>
                      </div>
                    </div>
                    <MiniBar pct={pct} color={row.color} />
                  </div>
                );
              })}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-slate-500">
                <span>Total drivers tracked</span>
                <span className="text-slate-300 font-semibold">{d?.total ?? 0}</span>
              </div>
              <Link href="/dispatch/jobs"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-semibold transition-all border border-white/5">
                View Driver Availability →
              </Link>
            </div>
          )}
        </div>

        {/* Service type breakdown */}
        <div className="rounded-2xl bg-slate-900 border border-white/10 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">🚦 Service Mix</h2>
            <span className="text-slate-500 text-xs">Last {days} days</span>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-10 bg-slate-800 rounded animate-pulse" />)}
            </div>
          ) : !stats?.serviceBreakdown.length ? (
            <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
              No jobs dispatched in this period
            </div>
          ) : (
            <div className="space-y-3">
              {stats.serviceBreakdown.map(svc => (
                <div key={svc.serviceType} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span>{SVC_ICON[svc.serviceType] ?? '🚗'}</span>
                      <span className="text-slate-300 capitalize">
                        {svc.serviceType.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-400">{svc.completed} done</span>
                      {svc.failed > 0 && <span className="text-red-400">{svc.failed} failed</span>}
                      <span className={`font-semibold ${
                        svc.successRate >= 80 ? 'text-emerald-400' :
                        svc.successRate >= 60 ? 'text-amber-400'   : 'text-red-400'
                      }`}>{svc.successRate}%</span>
                    </div>
                  </div>
                  <MiniBar pct={svc.successRate} color={
                    svc.successRate >= 80 ? 'bg-emerald-500' :
                    svc.successRate >= 60 ? 'bg-amber-500'   : 'bg-red-500'
                  } />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Daily Trend ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-slate-900 border border-white/10 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white font-bold text-lg">📈 Daily Job Volume</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500/40 inline-block" /> Pending
              </span>
              <span className="inline-flex items-center gap-1 ml-3">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/60 inline-block" /> Completed
              </span>
              <span className="inline-flex items-center gap-1 ml-3">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500/60 inline-block" /> Failed
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-white font-bold text-xl">{s?.total ?? 0}</p>
            <p className="text-slate-500 text-xs">total jobs</p>
          </div>
        </div>
        {loading ? (
          <div className="h-32 bg-slate-800 rounded animate-pulse" />
        ) : (
          <TrendChart trend={stats?.trend ?? []} days={days} />
        )}
      </div>

      {/* ── Cross-Tenant Breakdown (Super Admin only) ────────────────────── */}
      {me?.isSuperAdmin && (
        <div className="rounded-2xl bg-slate-900 border border-white/10 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">🏢 Per-Tenant Activity</h2>
            <span className="text-slate-500 text-xs">Last {days} days · Super Admin view</span>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />)}
            </div>
          ) : !stats?.tenantBreakdown.length ? (
            <div className="flex items-center justify-center h-20 text-slate-600 text-sm">
              No dispatch activity found across tenants
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
                    <th className="text-left pb-3 pr-4">Tenant</th>
                    <th className="text-right pb-3 px-4">Total</th>
                    <th className="text-right pb-3 px-4">Active</th>
                    <th className="text-right pb-3 px-4">Completed</th>
                    <th className="text-right pb-3 px-4">Failed</th>
                    <th className="text-right pb-3 pl-4">Acceptance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {stats.tenantBreakdown.map(row => (
                    <tr key={row.tenantId} className="hover:bg-white/3 transition-colors">
                      <td className="py-3 pr-4">
                        <span className="text-white font-medium">{row.tenantName}</span>
                        <span className="block text-slate-600 text-xs font-mono">{row.tenantId.slice(0, 8)}…</span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300 tabular-nums font-semibold">{row.total}</td>
                      <td className="py-3 px-4 text-right text-blue-400 tabular-nums">{row.active}</td>
                      <td className="py-3 px-4 text-right text-emerald-400 tabular-nums">{row.completed}</td>
                      <td className="py-3 px-4 text-right text-red-400 tabular-nums">{row.failed}</td>
                      <td className="py-3 pl-4 text-right">
                        <span className={`font-bold tabular-nums ${
                          row.acceptanceRate >= 80 ? 'text-emerald-400' :
                          row.acceptanceRate >= 60 ? 'text-amber-400'   : 'text-red-400'
                        }`}>{row.acceptanceRate}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Urgent Jobs Requiring Attention ──────────────────────────────── */}
      <div className="rounded-2xl bg-slate-900 border border-white/10 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold text-lg">
            ⚠️ Escalations &amp; Failures
            {!loading && (stats?.urgentJobs.length ?? 0) > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/30">
                {stats!.urgentJobs.length}
              </span>
            )}
          </h2>
          <Link href="/dispatch/jobs?status=ESCALATED"
            className="text-blue-400 hover:text-blue-300 text-xs font-semibold transition-colors">
            View all in Jobs →
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />)}
          </div>
        ) : !stats?.urgentJobs.length ? (
          <div className="flex items-center justify-center h-20 gap-3 text-emerald-400">
            <span className="text-2xl">✅</span>
            <span className="text-sm font-semibold">No escalations or failures in the last {days} days</span>
          </div>
        ) : (
          <div className="space-y-2">
            {stats.urgentJobs.map(job => (
              <div key={job.id}
                className="flex items-center justify-between rounded-xl bg-slate-800/50 border border-white/5 px-4 py-3 hover:border-white/15 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{SVC_ICON[job.serviceType] ?? '🚗'}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${PRI_COLOR[job.priority] ?? PRI_COLOR['NORMAL']}`}>
                        {job.priority}
                      </span>
                      <span className={`text-sm font-semibold ${STATUS_COLOR[job.status] ?? 'text-slate-300'}`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {job.serviceType.replace(/_/g, ' ')} · {job.currentAttempt}/{job.maxAttempts} attempts ·
                      ID: <span className="font-mono">{job.id.slice(0, 8)}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-xs">{fmtAgo(job.updatedAt)}</p>
                  <p className="text-slate-600 text-[10px]">{fmtAgo(job.createdAt)} created</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Quick Navigation ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-slate-400 text-sm font-semibold uppercase tracking-wide mb-4">
          Quick Navigation
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: '/dispatch',          icon: '📊', label: 'Dispatch Overview',  desc: 'Module home + KPIs'       },
            { href: '/dispatch/command',  icon: '🚦', label: 'Command Centre',      desc: 'Live 3-panel control'     },
            { href: '/dispatch/jobs',     icon: '📋', label: 'Job Queue',           desc: 'Filter + manage all jobs' },
            { href: '/dispatch/merge',    icon: '🔀', label: 'Merge Optimizer',     desc: 'Trip consolidation recs'  },
            { href: '/dispatch/analytics',icon: '📈', label: 'Analytics',           desc: 'Performance metrics'      },
            { href: '/school-bus/dispatch',icon:'🚌', label: 'School Bus Dispatch', desc: 'Dedicated route board'    },
            { href: '/incidents/ambulance/dispatch', icon: '🚑', label: 'Ambulance Dispatch', desc: 'Emergency board' },
            { href: '/admin/tenants',     icon: '🏢', label: 'Tenants',             desc: 'Tenant management',       },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="rounded-xl bg-slate-900 border border-white/10 p-4 hover:border-blue-500/30 hover:bg-slate-800 transition-all group">
              <span className="text-2xl block mb-2">{l.icon}</span>
              <p className="text-white text-xs font-semibold group-hover:text-blue-300 transition-colors">{l.label}</p>
              <p className="text-slate-600 text-[10px] mt-0.5 leading-relaxed">{l.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* ── System stats footer ───────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900/50 border border-white/5 px-6 py-4 flex flex-wrap gap-6 text-xs text-slate-600">
        <span>Avg completion: <strong className="text-slate-400">{s?.avgCompletionMin ?? 0} min</strong></span>
        <span>Avg attempts: <strong className="text-slate-400">{s?.avgAttempts ?? 0}</strong></span>
        <span>Jobs cancelled: <strong className="text-slate-400">{s?.cancelled ?? 0}</strong></span>
        <span>Auto-refreshes every 30s</span>
      </div>
    </div>
  );
}
