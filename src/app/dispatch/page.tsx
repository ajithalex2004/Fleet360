'use client';
/**
 * Dispatch Module — Overview Dashboard.
 * Migrated to the shared page-theme primitives (Phase 2 pilot).
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Radio, ClipboardList, Car, CheckCircle2, AlertTriangle, UserCheck, BarChart3,
  Shuffle, Siren, Bus, ArrowRight, ListChecks,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface DispatchJob {
  id: string;
  service_type: 'PASSENGER' | 'FREIGHT' | 'DELIVERY' | 'AMBULANCE' | 'TECHNICIAN' | 'SCHOOL_BUS';
  priority:    string;
  status:      string;
  attempt_count: number;
}
interface DispatchDriver { id: string; status: 'AVAILABLE' | 'BUSY' | 'BREAK' | 'OFF_DUTY' }

const SVC_LABEL: Record<string, string> = {
  PASSENGER:'Passenger', FREIGHT:'Freight', DELIVERY:'Delivery',
  AMBULANCE:'Ambulance', TECHNICIAN:'Technician', SCHOOL_BUS:'School bus',
};

export default function DispatchOverview() {
  const [jobs,    setJobs]    = useState<DispatchJob[]>([]);
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
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

  const active     = jobs.filter(j => ['PENDING','SEARCHING','OFFERED','RETRYING'].includes(j.status)).length;
  const inProgress = jobs.filter(j => j.status === 'IN_PROGRESS').length;
  const completed  = jobs.filter(j => j.status === 'COMPLETED').length;
  const failed     = jobs.filter(j => ['FAILED','ESCALATED'].includes(j.status)).length;
  const available  = drivers.filter(d => d.status === 'AVAILABLE').length;
  const acceptance = jobs.length > 0
    ? Math.round((jobs.filter(j => ['ACCEPTED','IN_PROGRESS','COMPLETED'].includes(j.status)).length / jobs.length) * 100)
    : 0;

  const recentJobs = jobs.slice(0, 8);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Dispatch Control"
        subtitle="Real-time operations overview — jobs, drivers, exceptions."
        icon={Radio}
        accent="blue"
        actions={
          <Link href="/dispatch/command"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/30">
            <Radio className="w-4 h-4" /> Command Centre
            <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">LIVE</span>
          </Link>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Active jobs"       value={loading ? '…' : active}            sub="Pending + searching"  icon={ClipboardList} accent="blue"    />
        <KpiCard label="In progress"       value={loading ? '…' : inProgress}        sub="En route"             icon={Car}           accent="cyan"    />
        <KpiCard label="Completed today"   value={loading ? '…' : completed}         sub="Delivered"            icon={CheckCircle2}  accent="emerald" />
        <KpiCard label="Exceptions"        value={loading ? '…' : failed}            sub="Failed or escalated"  icon={AlertTriangle} accent="rose"    />
        <KpiCard label="Available drivers" value={loading ? '…' : available}         sub="Ready to dispatch"    icon={UserCheck}     accent="emerald" />
        <KpiCard label="Acceptance rate"   value={loading ? '…' : `${acceptance}%`}  sub="Accepted / total"     icon={BarChart3}     accent="amber"   />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ShortcutTile href="/dispatch/command" icon={Radio}        title="Command Centre"  desc="Live 3-panel control tower"  accent="blue"   />
        <ShortcutTile href="/dispatch/jobs"    icon={ListChecks}   title="Jobs queue"      desc="Full job list with filters"  accent="slate"  />
        <ShortcutTile href="/dispatch/merge"   icon={Shuffle}      title="Merge optimizer" desc="Trip merge recommendations"  accent="violet" />
      </div>

      {/* Cross-links */}
      <Link href="/incidents/ambulance/dispatch"
        className="flex items-center justify-between gap-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 px-5 py-4 hover:bg-rose-500/10 transition-all group">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-rose-500/10 flex items-center justify-center">
            <Siren className="w-5 h-5 text-rose-300" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Ambulance dispatch</p>
            <p className="text-slate-500 text-xs mt-0.5">
              P1/P2/P3 SLA timers, fleet availability and MOHAP/DHA compliance — managed in Incident &amp; Ambulance.
            </p>
          </div>
        </div>
        <span className="text-rose-300 text-sm font-semibold group-hover:text-rose-200 inline-flex items-center gap-1 shrink-0">
          Open <ArrowRight className="w-4 h-4" />
        </span>
      </Link>

      <Link href="/school-bus/dispatch"
        className="flex items-center justify-between gap-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 px-5 py-4 hover:bg-amber-500/10 transition-all group">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Bus className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">School Bus transportation</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Routes, student manifests, departure management and UAE compliance — managed in the School Bus module.
            </p>
          </div>
        </div>
        <span className="text-amber-300 text-sm font-semibold group-hover:text-amber-200 inline-flex items-center gap-1 shrink-0">
          Open <ArrowRight className="w-4 h-4" />
        </span>
      </Link>

      {/* Recent jobs + driver pool */}
      <div className="grid md:grid-cols-3 gap-4">
        <Panel title="Recent jobs" icon={ClipboardList} accent="blue" className="md:col-span-2"
          actions={<Link href="/dispatch/jobs" className="text-xs text-blue-400 hover:text-blue-300">View all →</Link>}>
          {loading ? (
            <p className="text-slate-500 text-sm">Loading…</p>
          ) : recentJobs.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">No jobs yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-slate-500 text-[11px] uppercase tracking-wider">
                  <th className="text-left py-2 font-medium">Job</th>
                  <th className="text-left py-2 font-medium">Service</th>
                  <th className="text-left py-2 font-medium">Priority</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-left py-2 font-medium">Attempts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {recentJobs.map(j => (
                  <tr key={j.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 font-mono text-xs text-slate-400">{j.id.slice(0, 12)}…</td>
                    <td className="py-3 text-slate-300">{SVC_LABEL[j.service_type] ?? j.service_type}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        j.priority === 'P1' || j.priority === 'EMERGENCY'  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : j.priority === 'URGENT' || j.priority === 'P2'    ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                        : 'bg-slate-700 text-slate-300 border-slate-600'
                      }`}>{j.priority}</span>
                    </td>
                    <td className="py-3"><StatusPill status={j.status} /></td>
                    <td className="py-3 text-slate-400 text-xs">{j.attempt_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Driver pool" icon={UserCheck} accent="emerald">
          {loading ? (
            <p className="text-slate-500 text-sm">Loading…</p>
          ) : (
            <div className="space-y-3">
              {(['AVAILABLE','BUSY','BREAK','OFF_DUTY'] as const).map(s => {
                const n   = drivers.filter(d => d.status === s).length;
                const pct = drivers.length > 0 ? (n / drivers.length) * 100 : 0;
                const col = { AVAILABLE:'bg-emerald-500', BUSY:'bg-amber-500', BREAK:'bg-blue-500', OFF_DUTY:'bg-slate-600' }[s];
                return (
                  <div key={s}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">{s.replace('_', ' ')}</span>
                      <span className="text-white font-semibold tabular-nums">{n}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800">
                      <div className={`h-1.5 rounded-full ${col} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-3 border-t border-white/10 text-[11px] text-slate-500">
                {drivers.length} total drivers tracked
              </div>
            </div>
          )}
          <Link href="/dispatch/command"
            className="mt-4 flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-semibold hover:bg-blue-500/20 transition-all">
            View live map <ArrowRight className="w-3 h-3" />
          </Link>
        </Panel>
      </div>
    </div>
  );
}

interface ShortcutTileProps {
  href: string; title: string; desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'blue' | 'slate' | 'violet';
}
function ShortcutTile({ href, title, desc, icon: Icon, accent }: ShortcutTileProps) {
  const tone = {
    blue:   { grad: 'from-blue-600/30 to-cyan-600/20',     icon: 'text-blue-300',   ring: 'border-blue-500/30 hover:border-blue-500/50' },
    slate:  { grad: 'from-slate-700/40 to-slate-600/20',   icon: 'text-slate-300',  ring: 'border-white/10 hover:border-white/20' },
    violet: { grad: 'from-violet-600/30 to-purple-600/20', icon: 'text-violet-300', ring: 'border-violet-500/30 hover:border-violet-500/50' },
  }[accent];
  return (
    <Link href={href}
      className={`group rounded-2xl bg-gradient-to-br ${tone.grad} border ${tone.ring} p-4 transition-all hover:scale-[1.01]`}>
      <Icon className={`w-6 h-6 ${tone.icon} mb-3`} />
      <p className="text-white font-semibold text-sm">{title}</p>
      <p className="text-slate-400 text-xs mt-0.5">{desc}</p>
    </Link>
  );
}
