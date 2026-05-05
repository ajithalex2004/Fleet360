'use client';
/**
 * Dispatch Module — Overview Dashboard
 * Entry point for the standalone Dispatch Control module.
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface KPI { label: string; value: string | number; sub?: string; color: string; icon: string; }

function KPICard({ kpi }: { kpi: KPI }) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-white/10 p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{kpi.icon}</span>
        <span className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</span>
      </div>
      <p className="text-slate-300 text-sm font-medium">{kpi.label}</p>
      {kpi.sub && <p className="text-slate-500 text-xs mt-0.5">{kpi.sub}</p>}
    </div>
  );
}

export default function DispatchOverview() {
  const [jobs,    setJobs]    = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/dispatch/jobs?limit=100').then(r => r.json()),
      fetch('/api/dispatch/availability?limit=100').then(r => r.json()),
    ]).then(([j, d]) => {
      setJobs(j.data ?? []);
      setDrivers(d.data ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const active    = jobs.filter(j => ['PENDING','SEARCHING','OFFERED','RETRYING'].includes(j.status)).length;
  const inProgress= jobs.filter(j => j.status === 'IN_PROGRESS').length;
  const completed = jobs.filter(j => j.status === 'COMPLETED').length;
  const failed    = jobs.filter(j => ['FAILED','ESCALATED'].includes(j.status)).length;
  const available = drivers.filter(d => d.status === 'AVAILABLE').length;
  const acceptance= jobs.length > 0
    ? Math.round((jobs.filter(j => ['ACCEPTED','IN_PROGRESS','COMPLETED'].includes(j.status)).length / jobs.length) * 100)
    : 0;

  const kpis: KPI[] = [
    { label: 'Active Jobs',       value: loading ? '…' : active,      color: 'text-blue-400',    icon: '📋', sub: 'Pending + Searching' },
    { label: 'In Progress',       value: loading ? '…' : inProgress,  color: 'text-cyan-400',    icon: '🚗', sub: 'Currently en route' },
    { label: 'Completed Today',   value: loading ? '…' : completed,   color: 'text-emerald-400', icon: '✅', sub: 'Delivered successfully' },
    { label: 'Exceptions',        value: loading ? '…' : failed,      color: 'text-red-400',     icon: '⚠️', sub: 'Failed or escalated' },
    { label: 'Available Drivers', value: loading ? '…' : available,   color: 'text-green-400',   icon: '👤', sub: 'Ready to be dispatched' },
    { label: 'Acceptance Rate',   value: loading ? '…' : `${acceptance}%`, color: 'text-yellow-400', icon: '📊', sub: 'Jobs accepted by drivers' },
  ];

  const recentJobs = jobs.slice(0, 8);

  const STATUS_COLOR: Record<string, string> = {
    PENDING:'text-slate-400', SEARCHING:'text-blue-400', OFFERED:'text-yellow-400',
    ACCEPTED:'text-green-400', IN_PROGRESS:'text-cyan-400', COMPLETED:'text-emerald-400',
    RETRYING:'text-orange-400', ESCALATED:'text-red-400', FAILED:'text-red-600', CANCELLED:'text-slate-600',
  };
  const SVC_ICON: Record<string, string> = {
    PASSENGER:'🚗', FREIGHT:'🚚', DELIVERY:'📦', AMBULANCE:'🚑', TECHNICIAN:'🔧', SCHOOL_BUS:'🚌',
  };

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">🚦 Dispatch Control</h1>
          <p className="text-slate-400 mt-1">Real-time operations overview · Auto-refreshes on page open</p>
        </div>
        <Link href="/dispatch/command"
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold text-sm hover:opacity-90 transition-all shadow-lg shadow-blue-500/20">
          🚦 Open Command Centre
          <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded">LIVE</span>
        </Link>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map(k => <KPICard key={k.label} kpi={k} />)}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Command Centre',  href: '/dispatch/command', icon: '🚦', desc: 'Live 3-panel control tower',  color: 'from-blue-600 to-cyan-600' },
          { label: 'Jobs Queue',      href: '/dispatch/jobs',    icon: '📋', desc: 'Full job list with filters',   color: 'from-slate-700 to-slate-600' },
          { label: 'Merge Optimizer', href: '/dispatch/merge',   icon: '🔀', desc: 'Trip merge recommendations',  color: 'from-violet-600 to-purple-600' },
        ].map(a => (
          <Link key={a.href} href={a.href}
            className={`rounded-2xl bg-gradient-to-br ${a.color} p-5 hover:opacity-90 transition-all group`}>
            <span className="text-3xl block mb-3">{a.icon}</span>
            <p className="text-white font-bold text-sm">{a.label}</p>
            <p className="text-white/60 text-xs mt-0.5">{a.desc}</p>
          </Link>
        ))}
      </div>

      {/* Ambulance cross-link — managed in the Incident & Ambulance module */}
      <Link href="/incidents/ambulance/dispatch"
        className="flex items-center justify-between gap-4 rounded-2xl bg-red-500/5 border border-red-500/20 px-5 py-4 hover:bg-red-500/10 transition-all group">
        <div className="flex items-center gap-4">
          <span className="text-3xl">🚑</span>
          <div>
            <p className="text-white font-semibold text-sm">Ambulance Dispatch</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Emergency response, P1/P2/P3 SLA timers, fleet availability and MOHAP/DHA compliance — managed in the Incident & Ambulance module
            </p>
          </div>
        </div>
        <span className="text-red-400 text-sm font-semibold group-hover:text-red-300 flex-shrink-0">
          Open Dispatch Board →
        </span>
      </Link>

      {/* School Bus cross-link — managed in its own module */}
      <Link href="/school-bus/dispatch"
        className="flex items-center justify-between gap-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 px-5 py-4 hover:bg-amber-500/10 transition-all group">
        <div className="flex items-center gap-4">
          <span className="text-3xl">🚌</span>
          <div>
            <p className="text-white font-semibold text-sm">School Bus Transportation</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Routes, student manifests, departure management and UAE compliance — managed in the School Bus module
            </p>
          </div>
        </div>
        <span className="text-amber-400 text-sm font-semibold group-hover:text-amber-300 flex-shrink-0">
          Open Dispatch Board →
        </span>
      </Link>

      {/* Recent jobs + driver summary */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Recent Jobs */}
        <div className="md:col-span-2 rounded-2xl bg-slate-900 border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-semibold">Recent Jobs</h2>
            <Link href="/dispatch/jobs" className="text-blue-400 text-xs hover:text-blue-300">View all →</Link>
          </div>
          {loading ? (
            <p className="text-slate-500 text-sm p-5">Loading…</p>
          ) : recentJobs.length === 0 ? (
            <p className="text-slate-500 text-sm p-5 text-center">No jobs yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-slate-500 text-xs">
                  <th className="text-left px-5 py-2.5">Job</th>
                  <th className="text-left px-3 py-2.5">Service</th>
                  <th className="text-left px-3 py-2.5">Priority</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="text-left px-3 py-2.5">Attempts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {recentJobs.map(j => (
                  <tr key={j.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">{j.id.slice(0, 12)}…</td>
                    <td className="px-3 py-3 text-slate-300">{SVC_ICON[j.service_type]} {j.service_type}</td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        j.priority === 'P1' || j.priority === 'EMERGENCY' ? 'bg-red-500/20 text-red-400'
                        : j.priority === 'URGENT' || j.priority === 'P2'  ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-slate-700 text-slate-400'
                      }`}>{j.priority}</span>
                    </td>
                    <td className={`px-3 py-3 text-xs font-semibold ${STATUS_COLOR[j.status] ?? 'text-slate-400'}`}>
                      {j.status}
                    </td>
                    <td className="px-3 py-3 text-slate-400 text-xs">{j.attempt_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Driver status summary */}
        <div className="rounded-2xl bg-slate-900 border border-white/10 p-5">
          <h2 className="text-white font-semibold mb-4">Driver Pool</h2>
          {loading ? (
            <p className="text-slate-500 text-sm">Loading…</p>
          ) : (
            <div className="space-y-3">
              {(['AVAILABLE','BUSY','BREAK','OFF_DUTY'] as const).map(s => {
                const n   = drivers.filter(d => d.status === s).length;
                const pct = drivers.length > 0 ? (n / drivers.length) * 100 : 0;
                const col = { AVAILABLE:'bg-green-500', BUSY:'bg-yellow-500', BREAK:'bg-blue-500', OFF_DUTY:'bg-slate-600' }[s];
                return (
                  <div key={s}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">{s.replace('_', ' ')}</span>
                      <span className="text-white font-semibold">{n}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800">
                      <div className={`h-1.5 rounded-full ${col} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-3 border-t border-white/10 text-xs text-slate-500">
                {drivers.length} total drivers tracked
              </div>
            </div>
          )}
          <Link href="/dispatch/command"
            className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold hover:bg-blue-500/20 transition-all">
            View Live Map →
          </Link>
        </div>
      </div>
    </div>
  );
}
