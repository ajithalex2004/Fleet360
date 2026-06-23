'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Users, CheckCircle2, Clock, AlertOctagon, Activity, RefreshCw, Plus,
  Calendar, BarChart3, FileWarning, Check, X, Minus, AlertTriangle,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel } from '@/components/ui/page-theme';
import ChauffeurDriverIcon from '@/components/icons/ChauffeurDriverIcon';

interface ComplianceSummary {
  total: number;
  ok: number;
  warning: number;
  critical: number;
  incomplete: number;
}

interface ComplianceIssue {
  id: string;
  name: string;
  licenseNumber: string;
  driverType: string | null;
  status: string;
  compliance: {
    license: string;
    emiratesId: string;
    passport: string;
    visa: string;
    alertLevel: string;
  };
  licenseExpiry: string | null;
  emiratesIdExpiry: string | null;
  passportExpiry: string | null;
  visaExpiry: string | null;
  assignedVehicle: { licensePlate: string; make: string; model: string } | null;
}

interface ComplianceData {
  summary: ComplianceSummary;
  issues: ComplianceIssue[];
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (diff < 0)  return `${label} (${Math.abs(diff)}d ago)`;
  if (diff < 30) return `${label} (${diff}d left)`;
  return label;
}

function DocCell({ status, date }: { status: string; date: string | null }) {
  const map = {
    valid:         { Icon: Check,    cls: 'text-emerald-400' },
    expiring_soon: { Icon: AlertTriangle, cls: 'text-amber-400' },
    expired:       { Icon: X,        cls: 'text-rose-400' },
    missing:       { Icon: Minus,    cls: 'text-slate-500' },
  } as const;
  const { Icon, cls } = map[status as keyof typeof map] ?? map.missing;
  return (
    <td className="py-3 align-top">
      <Icon className={`w-4 h-4 ${cls}`} />
      {date && <div className="text-[11px] text-slate-500 mt-1">{fmtDate(date)}</div>}
    </td>
  );
}

export default function DriverDashboard() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/drivers/compliance');
      const d = await res.json();
      setData(d);
    } catch {
      setError('Failed to load driver compliance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary ?? { total: 0, ok: 0, warning: 0, critical: 0, incomplete: 0 };
  const issues = data?.issues ?? [];
  const criticalIssues = issues.filter(d => d.compliance.alertLevel === 'critical');
  const warningIssues  = issues.filter(d => d.compliance.alertLevel === 'warning');

  const okPct   = s.total > 0 ? Math.round((s.ok / s.total) * 100) : 0;
  const warnPct = s.total > 0 ? Math.round((s.warning / s.total) * 100) : 0;
  const critPct = s.total > 0 ? Math.round((s.critical / s.total) * 100) : 0;
  const incPct  = s.total > 0 ? Math.round((s.incomplete / s.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Management Hub"
        subtitle="Central driver registry — compliance, identity & assignments"
        icon={ChauffeurDriverIcon}
        accent="cyan"
        actions={
          <>
            <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <Link href="/driver-mgmt/profiles"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-cyan-500/30">
              <Plus className="w-4 h-4" /> Add driver
            </Link>
          </>
        }
      />

      {error ? (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-rose-300 flex items-center justify-between">
          <div>
            <p className="font-semibold">Failed to load</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="px-4 py-2 bg-rose-500/20 rounded-xl text-sm hover:bg-rose-500/30">Retry</button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_,i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse"/>)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Total drivers"         value={s.total}                  icon={Users}        accent="default" />
            <KpiCard label="Compliant (OK)"        value={s.ok}                     icon={CheckCircle2} accent="emerald" />
            <KpiCard label="Expiring soon"         value={s.warning}                icon={Clock}        accent="amber"   />
            <KpiCard label="Critical / Expired"    value={s.critical + s.incomplete} icon={AlertOctagon} accent={s.critical + s.incomplete > 0 ? 'rose' : 'slate'} />
          </div>

          <Panel title="Fleet compliance health" icon={Activity} accent="cyan"
            actions={<span className="text-xs text-slate-400">{s.total} drivers</span>}>
            <div className="h-2.5 rounded-full overflow-hidden flex bg-slate-800">
              <div className="bg-emerald-500 h-full transition-all" style={{ width: `${okPct}%` }}    title={`OK: ${s.ok}`} />
              <div className="bg-amber-500   h-full transition-all" style={{ width: `${warnPct}%` }}  title={`Warning: ${s.warning}`} />
              <div className="bg-rose-500    h-full transition-all" style={{ width: `${critPct}%` }}  title={`Critical: ${s.critical}`} />
              <div className="bg-slate-600   h-full transition-all" style={{ width: `${incPct}%` }}   title={`Incomplete: ${s.incomplete}`} />
            </div>
            <div className="flex items-center gap-5 mt-3 text-[11px] text-slate-400 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> OK ({okPct}%)</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Expiring ({warnPct}%)</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Critical ({critPct}%)</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-600" /> Incomplete ({incPct}%)</span>
            </div>
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel title="Critical / expired" subtitle="Expired documents — immediate action required" icon={AlertOctagon} accent="rose"
              actions={<span className="text-xs font-bold text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/30">{s.critical}</span>}>
              {criticalIssues.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No critical issues</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider">
                        <th className="text-left py-2 font-medium">Driver</th>
                        <th className="text-left py-2 font-medium">License</th>
                        <th className="text-left py-2 font-medium">Emirates ID</th>
                        <th className="text-left py-2 font-medium">Passport</th>
                        <th className="text-left py-2 font-medium">Visa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {criticalIssues.slice(0, 10).map(d => (
                        <tr key={d.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 align-top">
                            <div className="font-medium text-white">{d.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{d.licenseNumber}</div>
                          </td>
                          <DocCell status={d.compliance.license}    date={d.licenseExpiry} />
                          <DocCell status={d.compliance.emiratesId} date={d.emiratesIdExpiry} />
                          <DocCell status={d.compliance.passport}   date={d.passportExpiry} />
                          <DocCell status={d.compliance.visa}       date={d.visaExpiry} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Expiring in 30 days" subtitle="Schedule renewals before expiry" icon={Clock} accent="amber"
              actions={<span className="text-xs font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30">{s.warning}</span>}>
              {warningIssues.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No expiring documents</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider">
                        <th className="text-left py-2 font-medium">Driver</th>
                        <th className="text-left py-2 font-medium">License</th>
                        <th className="text-left py-2 font-medium">Emirates ID</th>
                        <th className="text-left py-2 font-medium">Passport</th>
                        <th className="text-left py-2 font-medium">Visa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {warningIssues.slice(0, 10).map(d => (
                        <tr key={d.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 align-top">
                            <div className="font-medium text-white">{d.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{d.licenseNumber}</div>
                          </td>
                          <DocCell status={d.compliance.license}    date={d.licenseExpiry} />
                          <DocCell status={d.compliance.emiratesId} date={d.emiratesIdExpiry} />
                          <DocCell status={d.compliance.passport}   date={d.passportExpiry} />
                          <DocCell status={d.compliance.visa}       date={d.visaExpiry} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'All drivers',          href: '/driver-mgmt/profiles',                Icon: Users,       desc: 'View & manage driver records' },
              { label: 'Expiring documents',   href: '/driver-mgmt/profiles?expiring=true',  Icon: FileWarning, desc: 'Filter drivers with issues' },
              { label: 'Shifts & schedules',   href: '/driver-mgmt/shifts',                  Icon: Calendar,    desc: 'Manage driver shifts' },
              { label: 'Performance',          href: '/driver-mgmt/performance',             Icon: BarChart3,   desc: 'Driver performance metrics' },
            ].map(a => (
              <Link key={a.href} href={a.href}
                className="rounded-2xl bg-slate-900/60 border border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all p-5 group block">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center mb-3">
                  <a.Icon className="w-5 h-5 text-cyan-300" />
                </div>
                <p className="text-white font-semibold text-sm group-hover:text-cyan-300 transition-colors">{a.label}</p>
                <p className="text-slate-500 text-xs mt-1">{a.desc}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
