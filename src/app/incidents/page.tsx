'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Siren, AlertTriangle, ClipboardList, CheckCircle2, Ambulance, ShieldAlert,
  Activity, Plus, FileText,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface IncidentStats {
  totalIncidents: number;
  openIncidents: number;
  resolvedToday: number;
  ambulanceVehicles: number;
  ambulanceAvailable: number;
  criticalAlerts: number;
  incidents: Array<{
    id: string;
    incident_no: string | null;
    incident_type: string;
    severity: string | null;
    status: string | null;
    description: string | null;
    incident_date: string | null;
    location: string | null;
  }>;
}

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  HIGH:     'bg-orange-500/20 text-orange-300 border-orange-500/40',
  MEDIUM:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
  LOW:      'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

export default function IncidentsDashboard() {
  const [data, setData] = useState<IncidentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/incidents', { cache: 'no-store' });
      if (res.ok) {
        setData(await res.json());
        setLastUpdated(new Date());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const ambulancePct = data && data.ambulanceVehicles > 0
    ? Math.round((data.ambulanceAvailable / data.ambulanceVehicles) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incident & Ambulance Management"
        subtitle="Real-time incident tracking and emergency vehicle dispatch"
        icon={Siren}
        accent="rose"
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live · {lastUpdated.toLocaleTimeString()}
            </span>
            <Link href="/incidents/active"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-rose-500/30">
              <Plus className="w-4 h-4" /> Report incident
            </Link>
          </>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KpiCard label="Open incidents"     value={data?.openIncidents ?? 0}     sub="Requires attention"     icon={AlertTriangle} accent={data && data.openIncidents > 0 ? 'rose' : 'slate'} />
            <KpiCard label="Total incidents"    value={data?.totalIncidents ?? 0}    sub="All time"               icon={ClipboardList} accent="default" />
            <KpiCard label="Resolved today"     value={data?.resolvedToday ?? 0}     sub="Closed this session"    icon={CheckCircle2}  accent="emerald" />
            <KpiCard label="Ambulance fleet"    value={data?.ambulanceVehicles ?? 0} sub="Total vehicles"         icon={Ambulance}     accent="default" />
            <KpiCard label="Ambulance ready"    value={data?.ambulanceAvailable ?? 0} sub="Ready to dispatch"     icon={Ambulance}     accent="emerald" />
            <KpiCard label="Critical alerts"    value={data?.criticalAlerts ?? 0}    sub="Unresolved critical"    icon={ShieldAlert}   accent={data && data.criticalAlerts > 0 ? 'rose' : 'slate'} />
          </div>

          {(data?.ambulanceVehicles ?? 0) > 0 && (
            <Panel title="Ambulance fleet readiness" icon={Activity} accent="rose"
              actions={
                <span className={`text-sm font-bold ${ambulancePct >= 60 ? 'text-emerald-300' : ambulancePct >= 30 ? 'text-amber-300' : 'text-rose-300'}`}>
                  {ambulancePct}% Available
                </span>
              }>
              <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    ambulancePct >= 60 ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                    : ambulancePct >= 30 ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                    : 'bg-gradient-to-r from-rose-600 to-pink-500'
                  }`}
                  style={{ width: `${ambulancePct}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {data?.ambulanceAvailable} of {data?.ambulanceVehicles} ambulance vehicles ready
              </p>
            </Panel>
          )}

          <Panel title="Recent incidents" icon={ClipboardList} accent="rose"
            actions={<Link href="/incidents/active" className="text-sm text-rose-300 hover:text-rose-200">View all →</Link>}>
            {data?.incidents && data.incidents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider">
                      <th className="text-left py-2 font-medium">Incident</th>
                      <th className="text-left py-2 font-medium">Type</th>
                      <th className="text-left py-2 font-medium">Severity</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-left py-2 font-medium">Location</th>
                      <th className="text-left py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.incidents.map(inc => (
                      <tr key={inc.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 font-mono text-xs text-white">{inc.incident_no ?? inc.id.slice(0, 8)}</td>
                        <td className="py-3 text-slate-300 text-xs">{inc.incident_type.replace(/_/g, ' ')}</td>
                        <td className="py-3">
                          {inc.severity && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${SEVERITY_BADGE[inc.severity] ?? SEVERITY_BADGE.LOW}`}>
                              {inc.severity}
                            </span>
                          )}
                        </td>
                        <td className="py-3">{inc.status && <StatusPill status={inc.status} />}</td>
                        <td className="py-3 text-slate-300 text-xs max-w-xs truncate">{inc.location ?? '—'}</td>
                        <td className="py-3 text-slate-400 text-xs">
                          {inc.incident_date ? new Date(inc.incident_date).toLocaleDateString('en-AE') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No incidents recorded</p>
                <p className="text-slate-600 text-xs mt-1">Incidents from trip_incidents table will appear here</p>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { href: '/incidents/active',    icon: AlertTriangle, label: 'Active incidents',   desc: 'View and manage open incidents' },
              { href: '/incidents/ambulance', icon: Ambulance,     label: 'Ambulance dispatch', desc: 'Track and deploy ambulance fleet' },
              { href: '/incidents/reports',   icon: FileText,      label: 'Incident reports',   desc: 'Historical reports and analytics' },
            ].map(link => {
              const Icon = link.icon;
              return (
                <Link key={link.href} href={link.href}
                  className="rounded-2xl bg-slate-900/60 border border-white/10 hover:border-rose-500/30 hover:bg-rose-500/5 transition-all p-5 group block">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-rose-300" />
                  </div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-rose-300 transition-colors">{link.label}</h3>
                  <p className="text-xs text-slate-500 mt-1">{link.desc}</p>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
