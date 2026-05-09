'use client';
/**
 * Dispatch › Analytics — Performance metrics, acceptance rates, SLA compliance, driver scorecards
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface JobStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  escalated: number;
  cancelled: number;
  avgAttempts: number;
}

interface DriverStats {
  total: number;
  available: number;
  busy: number;
  break: number;
  offDuty: number;
}

interface ServiceBreakdown {
  service_type: string;
  count: number;
  completed: number;
  failed: number;
}

function MetricCard({ icon, label, value, sub, color = 'text-white' }: {
  icon: string; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-white/10 p-5">
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        <span className={`text-3xl font-bold ${color}`}>{value}</span>
      </div>
      <p className="text-slate-300 text-sm font-medium">{label}</p>
      {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function DonutSegment({ value, total, color, label }: { value: number; total: number; color: string; label: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="text-slate-400 text-xs">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-white text-xs font-semibold w-6 text-right">{value}</span>
        <span className="text-slate-600 text-xs w-8">{pct}%</span>
      </div>
    </div>
  );
}

const SVC_ICON: Record<string, string> = {
  PASSENGER:'🚗', FREIGHT:'🚚', DELIVERY:'📦', AMBULANCE:'🚑', TECHNICIAN:'🔧', SCHOOL_BUS:'🚌',
};
const SVC_COLOR: Record<string, string> = {
  PASSENGER:'text-blue-400', FREIGHT:'text-amber-400', DELIVERY:'text-emerald-400',
  AMBULANCE:'text-red-400', TECHNICIAN:'text-purple-400', SCHOOL_BUS:'text-orange-400',
};

function SlaGauge({ rate }: { rate: number }) {
  const color = rate >= 90 ? 'text-emerald-400' : rate >= 70 ? 'text-amber-400' : 'text-red-400';
  const bar   = rate >= 90 ? 'bg-emerald-500' : rate >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="text-slate-400 text-xs">SLA Compliance</span>
        <span className={`text-2xl font-bold ${color}`}>{rate}%</span>
      </div>
      <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${rate}%` }} />
      </div>
      <p className="text-slate-500 text-xs">{rate >= 90 ? '✅ Excellent' : rate >= 70 ? '⚠️ Below target' : '❌ Critical — review dispatch weights'}</p>
    </div>
  );
}

export default function DispatchAnalyticsPage() {
  const [jobs,    setJobs]    = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range,   setRange]   = useState<'today'|'7d'|'30d'>('today');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/dispatch/jobs?limit=500').then(r => r.json()),
      fetch('/api/dispatch/availability?limit=200').then(r => r.json()),
    ]).then(([j, d]) => {
      setJobs(j.data ?? []);
      setDrivers(d.data ?? []);
    }).finally(() => setLoading(false));
  }, [range]);

  /* ── Computed metrics ── */
  const jobStats: JobStats = {
    total:      jobs.length,
    pending:    jobs.filter(j => j.status === 'PENDING').length,
    inProgress: jobs.filter(j => j.status === 'IN_PROGRESS').length,
    completed:  jobs.filter(j => j.status === 'COMPLETED').length,
    failed:     jobs.filter(j => j.status === 'FAILED').length,
    escalated:  jobs.filter(j => j.status === 'ESCALATED').length,
    cancelled:  jobs.filter(j => j.status === 'CANCELLED').length,
    avgAttempts: jobs.length > 0
      ? Math.round((jobs.reduce((s, j) => s + (j.attempt_count ?? 0), 0) / jobs.length) * 10) / 10
      : 0,
  };

  const driverStats: DriverStats = {
    total:    drivers.length,
    available:drivers.filter(d => d.status === 'AVAILABLE').length,
    busy:     drivers.filter(d => d.status === 'BUSY').length,
    break:    drivers.filter(d => d.status === 'BREAK').length,
    offDuty:  drivers.filter(d => d.status === 'OFF_DUTY').length,
  };

  const acceptanceRate = jobStats.total > 0
    ? Math.round((jobs.filter(j => ['ACCEPTED','IN_PROGRESS','COMPLETED'].includes(j.status)).length / jobStats.total) * 100)
    : 0;

  const completionRate = (jobStats.completed + jobStats.failed + jobStats.cancelled) > 0
    ? Math.round((jobStats.completed / (jobStats.completed + jobStats.failed + jobStats.cancelled)) * 100)
    : 0;

  const utilizationRate = driverStats.total > 0
    ? Math.round((driverStats.busy / driverStats.total) * 100)
    : 0;

  // Service breakdown — explicit reducer type so jobs: any[] doesn't
  // erode the result to unknown[]. Iterate values() instead of [k, v]
  // entries so Array.from gives ServiceBreakdown[] directly.
  const serviceBreakdown: ServiceBreakdown[] = Array.from(
    jobs.reduce<Map<string, ServiceBreakdown>>((map, j) => {
      const k = j.service_type ?? 'UNKNOWN';
      if (!map.has(k)) map.set(k, { service_type: k, count: 0, completed: 0, failed: 0 });
      const e = map.get(k)!;
      e.count++;
      if (j.status === 'COMPLETED') e.completed++;
      if (['FAILED','ESCALATED'].includes(j.status)) e.failed++;
      return map;
    }, new Map<string, ServiceBreakdown>()).values()
  ).sort((a, b) => b.count - a.count);

  // Priority breakdown
  const priorityCounts = ['P1','EMERGENCY','URGENT','P2','NORMAL','P3','SCHEDULED'].map(p => ({
    p, count: jobs.filter(j => j.priority === p).length,
  })).filter(x => x.count > 0);

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📈 Dispatch Analytics</h1>
          <p className="text-slate-400 text-sm mt-0.5">Performance metrics, acceptance rates, fleet utilisation</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-900 border border-white/10 rounded-xl p-1">
            {(['today','7d','30d'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  range === r ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30' : 'text-slate-400 hover:text-white'
                }`}>{r === 'today' ? 'Today' : r === '7d' ? '7 Days' : '30 Days'}</button>
            ))}
          </div>
          <Link href="/reports" className="px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:bg-slate-700 transition-all">
            Full Reports →
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-500 text-sm">Loading analytics…</div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard icon="📋" label="Total Jobs"        value={jobStats.total}        color="text-blue-400"    sub="In selected period" />
            <MetricCard icon="✅" label="Completed"         value={jobStats.completed}    color="text-emerald-400" sub={`${completionRate}% completion rate`} />
            <MetricCard icon="📊" label="Acceptance Rate"   value={`${acceptanceRate}%`}  color={acceptanceRate >= 80 ? 'text-emerald-400' : 'text-amber-400'} sub="Jobs accepted by drivers" />
            <MetricCard icon="🔁" label="Avg. Attempts"     value={jobStats.avgAttempts}  color={jobStats.avgAttempts > 2 ? 'text-red-400' : 'text-slate-300'} sub="Per job dispatched" />
            <MetricCard icon="👤" label="Fleet Utilisation" value={`${utilizationRate}%`} color={utilizationRate >= 70 ? 'text-green-400' : 'text-yellow-400'} sub={`${driverStats.busy}/${driverStats.total} drivers`} />
            <MetricCard icon="⚠️" label="Exceptions"        value={jobStats.failed + jobStats.escalated} color={jobStats.failed > 0 ? 'text-red-400' : 'text-slate-300'} sub="Failed + Escalated" />
            <MetricCard icon="🚗" label="In Progress"       value={jobStats.inProgress}   color="text-cyan-400"    sub="Currently en route" />
            <MetricCard icon="🟢" label="Available Drivers" value={driverStats.available} color="text-green-400"   sub="Ready to be dispatched" />
          </div>

          {/* Main analytics row */}
          <div className="grid md:grid-cols-3 gap-6">
            {/* Job Status Distribution */}
            <div className="rounded-2xl bg-slate-900 border border-white/10 p-5 space-y-3">
              <h2 className="text-white font-semibold text-sm">Job Status Distribution</h2>
              <DonutSegment value={jobStats.inProgress} total={jobStats.total} color="bg-cyan-500"    label="In Progress" />
              <DonutSegment value={jobStats.completed}  total={jobStats.total} color="bg-emerald-500" label="Completed" />
              <DonutSegment value={jobStats.pending}    total={jobStats.total} color="bg-slate-500"   label="Pending" />
              <DonutSegment value={jobStats.failed}     total={jobStats.total} color="bg-red-600"     label="Failed" />
              <DonutSegment value={jobStats.escalated}  total={jobStats.total} color="bg-red-400"     label="Escalated" />
              <DonutSegment value={jobStats.cancelled}  total={jobStats.total} color="bg-slate-700"   label="Cancelled" />
            </div>

            {/* Driver Pool */}
            <div className="rounded-2xl bg-slate-900 border border-white/10 p-5 space-y-3">
              <h2 className="text-white font-semibold text-sm">Driver Pool Status</h2>
              <DonutSegment value={driverStats.available} total={driverStats.total} color="bg-green-500"  label="Available" />
              <DonutSegment value={driverStats.busy}      total={driverStats.total} color="bg-yellow-500" label="Busy" />
              <DonutSegment value={driverStats.break}     total={driverStats.total} color="bg-blue-500"   label="On Break" />
              <DonutSegment value={driverStats.offDuty}   total={driverStats.total} color="bg-slate-600"  label="Off Duty" />
              <div className="pt-3 border-t border-white/5">
                <p className="text-slate-500 text-xs">{driverStats.total} total drivers tracked</p>
              </div>
            </div>

            {/* SLA & Acceptance */}
            <div className="rounded-2xl bg-slate-900 border border-white/10 p-5 space-y-5">
              <h2 className="text-white font-semibold text-sm">SLA & Acceptance</h2>
              <SlaGauge rate={completionRate} />
              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-400 text-xs">Driver Acceptance</span>
                  <span className={`text-2xl font-bold ${acceptanceRate >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{acceptanceRate}%</span>
                </div>
                <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${acceptanceRate >= 80 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${acceptanceRate}%` }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-400 text-xs">Fleet Utilisation</span>
                  <span className={`text-2xl font-bold ${utilizationRate >= 70 ? 'text-green-400' : 'text-yellow-400'}`}>{utilizationRate}%</span>
                </div>
                <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${utilizationRate >= 70 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${utilizationRate}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Service Breakdown table */}
          <div className="rounded-2xl bg-slate-900 border border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="text-white font-semibold text-sm">Service Type Breakdown</h2>
            </div>
            {serviceBreakdown.length === 0 ? (
              <p className="text-slate-500 text-sm p-5 text-center">No jobs in selected period</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-slate-500 text-xs">
                    <th className="px-5 py-3 text-left">Service</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Completed</th>
                    <th className="px-4 py-3 text-right">Failed</th>
                    <th className="px-4 py-3 text-left">Success Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {serviceBreakdown.map(s => {
                    const successRate = s.count > 0 ? Math.round((s.completed / s.count) * 100) : 0;
                    return (
                      <tr key={s.service_type} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-3">
                          <span className={`font-medium text-sm ${SVC_COLOR[s.service_type] ?? 'text-slate-300'}`}>
                            {SVC_ICON[s.service_type] ?? '🚗'} {s.service_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-white font-semibold">{s.count}</td>
                        <td className="px-4 py-3 text-right text-emerald-400">{s.completed}</td>
                        <td className="px-4 py-3 text-right text-red-400">{s.failed}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${successRate >= 80 ? 'bg-emerald-500' : successRate >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${successRate}%` }} />
                            </div>
                            <span className={`text-xs font-semibold w-10 ${successRate >= 80 ? 'text-emerald-400' : successRate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                              {successRate}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Priority breakdown */}
          {priorityCounts.length > 0 && (
            <div className="rounded-2xl bg-slate-900 border border-white/10 p-5 space-y-4">
              <h2 className="text-white font-semibold text-sm">Jobs by Priority</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {priorityCounts.map(({ p, count }) => (
                  <div key={p} className={`rounded-xl p-3 text-center border ${
                    p === 'P1' || p === 'EMERGENCY' ? 'bg-red-500/10 border-red-500/20' :
                    p === 'URGENT' || p === 'P2'    ? 'bg-orange-500/10 border-orange-500/20' :
                    'bg-slate-800 border-white/5'
                  }`}>
                    <p className={`text-2xl font-bold ${
                      p === 'P1' || p === 'EMERGENCY' ? 'text-red-400' :
                      p === 'URGENT' || p === 'P2'    ? 'text-orange-400' :
                      'text-white'
                    }`}>{count}</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">{p}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Link to full reports */}
          <div className="rounded-2xl bg-slate-800/50 border border-white/5 p-5 flex items-center justify-between">
            <div>
              <p className="text-slate-300 font-semibold text-sm">Cross-Module BI & Advanced Reports</p>
              <p className="text-slate-500 text-xs mt-0.5">Fleet utilization trends, driver performance scorecards, revenue analysis, scheduled exports</p>
            </div>
            <Link href="/reports"
              className="px-4 py-2 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-400 text-sm font-semibold hover:bg-fuchsia-500/30 transition-all">
              Open Reports →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
