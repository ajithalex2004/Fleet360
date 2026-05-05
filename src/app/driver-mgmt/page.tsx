'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

const alertColors: Record<string, string> = {
  critical:   'bg-red-500/20 text-red-400 border border-red-500/30',
  warning:    'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  incomplete: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  ok:         'bg-green-500/20 text-green-400 border border-green-500/30',
};

const docStatus: Record<string, { icon: string; cls: string }> = {
  valid:         { icon: '✓', cls: 'text-green-400' },
  expiring_soon: { icon: '⚠', cls: 'text-amber-400' },
  expired:       { icon: '✗', cls: 'text-red-400' },
  missing:       { icon: '—', cls: 'text-slate-500' },
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (diff < 0)  return `${label} (${Math.abs(diff)}d ago)`;
  if (diff < 30) return `${label} (${diff}d left)`;
  return label;
}

export default function DriverDashboard() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [drivers, setDrivers] = useState<{ total: number; active: number }>({ total: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [compRes, driversRes] = await Promise.all([
        fetch('/api/drivers/compliance'),
        fetch('/api/drivers?limit=1'),
      ]);
      const compData    = await compRes.json();
      const driversData = await driversRes.json();
      setData(compData);
      // driversRes might be array or {data, total}
      const arr = Array.isArray(driversData) ? driversData : (driversData.data ?? []);
      setDrivers({
        total:  compData.summary.total,
        active: compData.summary.ok + compData.summary.warning,
      });
    } catch (e) {
      setError('Failed to load driver compliance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-semibold">Failed to load</p>
        <p className="text-sm mt-1">{error}</p>
        <button onClick={load} className="mt-3 px-4 py-2 bg-red-500/20 rounded-xl text-sm hover:bg-red-500/30">Retry</button>
      </div>
    );
  }

  const s = data?.summary ?? { total: 0, ok: 0, warning: 0, critical: 0, incomplete: 0 };
  const issues = data?.issues ?? [];
  const criticalIssues = issues.filter(d => d.compliance.alertLevel === 'critical');
  const warningIssues  = issues.filter(d => d.compliance.alertLevel === 'warning');

  const okPct   = s.total > 0 ? Math.round((s.ok / s.total) * 100) : 0;
  const warnPct = s.total > 0 ? Math.round((s.warning / s.total) * 100) : 0;
  const critPct = s.total > 0 ? Math.round((s.critical / s.total) * 100) : 0;
  const incPct  = s.total > 0 ? Math.round((s.incomplete / s.total) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Driver Management Hub</h1>
          <p className="text-slate-400 mt-1">Central driver registry — compliance, identity &amp; assignments</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="px-4 py-2 text-sm bg-slate-800 border border-white/10 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors">
            ↻ Refresh
          </button>
          <Link href="/driver-mgmt/profiles" className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">
            + Add Driver
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Drivers',   value: s.total,      icon: '👥', color: 'text-white',       bg: 'from-slate-700/50 to-slate-800/50',   border: 'border-white/10' },
          { label: 'Compliant (OK)',  value: s.ok,         icon: '✅', color: 'text-green-400',   bg: 'from-green-500/10 to-emerald-500/10', border: 'border-green-500/20' },
          { label: 'Expiring Soon',   value: s.warning,    icon: '⚠️', color: 'text-amber-400',   bg: 'from-amber-500/10 to-yellow-500/10', border: 'border-amber-500/20' },
          { label: 'Critical / Expired', value: s.critical + s.incomplete, icon: '🚨', color: 'text-red-400', bg: 'from-red-500/10 to-rose-500/10', border: 'border-red-500/20' },
        ].map(card => (
          <div key={card.label} className={`bg-gradient-to-br ${card.bg} border ${card.border} rounded-2xl p-6`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-400 text-sm font-medium">{card.label}</p>
              <span className="text-2xl">{card.icon}</span>
            </div>
            <p className={`text-4xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Compliance Health Bar */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Fleet Compliance Health</h2>
          <span className="text-sm text-slate-400">{s.total} drivers</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex bg-slate-700">
          <div className="bg-green-500 h-full transition-all" style={{ width: `${okPct}%` }} title={`OK: ${s.ok}`} />
          <div className="bg-amber-500 h-full transition-all" style={{ width: `${warnPct}%` }} title={`Warning: ${s.warning}`} />
          <div className="bg-red-500 h-full transition-all" style={{ width: `${critPct}%` }} title={`Critical: ${s.critical}`} />
          <div className="bg-slate-600 h-full transition-all" style={{ width: `${incPct}%` }} title={`Incomplete: ${s.incomplete}`} />
        </div>
        <div className="flex items-center gap-6 mt-3 text-xs text-slate-400 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> OK ({okPct}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> Expiring soon ({warnPct}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Critical ({critPct}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-600 inline-block" /> Incomplete ({incPct}%)</span>
        </div>
      </div>

      {/* Issue Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Critical Issues */}
        <div className="bg-slate-800/50 border border-red-500/20 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">🚨 Critical / Expired</h2>
              <p className="text-xs text-slate-400 mt-0.5">Expired documents — immediate action required</p>
            </div>
            <span className="text-sm font-bold text-red-400 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20">{s.critical}</span>
          </div>
          <div className="overflow-x-auto">
            {criticalIssues.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-slate-500">
                <span className="text-3xl mb-2">✅</span>
                <p className="text-sm">No critical issues</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-800/60">
                  <tr>
                    {['Driver', 'License', 'Emirates ID', 'Passport', 'Visa'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs text-slate-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {criticalIssues.slice(0, 10).map(d => (
                    <tr key={d.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{d.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{d.licenseNumber}</div>
                      </td>
                      {([
                        { status: d.compliance.license,    date: d.licenseExpiry },
                        { status: d.compliance.emiratesId, date: d.emiratesIdExpiry },
                        { status: d.compliance.passport,   date: d.passportExpiry },
                        { status: d.compliance.visa,       date: d.visaExpiry },
                      ] as Array<{ status: string; date: string | null }>).map((doc, i) => {
                        const s = docStatus[doc.status] ?? docStatus.missing;
                        return (
                          <td key={i} className="px-4 py-3">
                            <span className={`font-bold text-base ${s.cls}`}>{s.icon}</span>
                            {doc.date && (
                              <div className="text-xs text-slate-500 mt-0.5">{fmtDate(doc.date)}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Warning Issues */}
        <div className="bg-slate-800/50 border border-amber-500/20 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">⚠️ Expiring in 30 Days</h2>
              <p className="text-xs text-slate-400 mt-0.5">Schedule renewals before expiry</p>
            </div>
            <span className="text-sm font-bold text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">{s.warning}</span>
          </div>
          <div className="overflow-x-auto">
            {warningIssues.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-slate-500">
                <span className="text-3xl mb-2">✅</span>
                <p className="text-sm">No expiring documents</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-800/60">
                  <tr>
                    {['Driver', 'License', 'Emirates ID', 'Passport', 'Visa'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs text-slate-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {warningIssues.slice(0, 10).map(d => (
                    <tr key={d.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{d.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{d.licenseNumber}</div>
                      </td>
                      {([
                        { status: d.compliance.license,    date: d.licenseExpiry },
                        { status: d.compliance.emiratesId, date: d.emiratesIdExpiry },
                        { status: d.compliance.passport,   date: d.passportExpiry },
                        { status: d.compliance.visa,       date: d.visaExpiry },
                      ] as Array<{ status: string; date: string | null }>).map((doc, i) => {
                        const s = docStatus[doc.status] ?? docStatus.missing;
                        return (
                          <td key={i} className="px-4 py-3">
                            <span className={`font-bold text-base ${s.cls}`}>{s.icon}</span>
                            {doc.date && (
                              <div className="text-xs text-slate-500 mt-0.5">{fmtDate(doc.date)}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'All Drivers',         href: '/driver-mgmt/profiles', icon: '👥', desc: 'View & manage driver records' },
          { label: 'Expiring Documents',  href: '/driver-mgmt/profiles?expiring=true', icon: '📋', desc: 'Filter drivers with issues' },
          { label: 'Shifts & Schedules',  href: '/driver-mgmt/shifts', icon: '🗓', desc: 'Manage driver shifts' },
          { label: 'Performance',         href: '/driver-mgmt/performance', icon: '📈', desc: 'Driver performance metrics' },
        ].map(a => (
          <Link key={a.href} href={a.href}
            className="bg-slate-800/40 border border-white/10 rounded-2xl p-5 hover:border-cyan-500/30 hover:bg-slate-700/40 transition-all group">
            <span className="text-3xl block mb-3">{a.icon}</span>
            <p className="text-white font-semibold text-sm group-hover:text-cyan-400 transition-colors">{a.label}</p>
            <p className="text-slate-500 text-xs mt-1">{a.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
