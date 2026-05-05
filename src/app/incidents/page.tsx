'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
  HIGH:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  LOW:      'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const STATUS_BADGE: Record<string, string> = {
  OPEN:       'bg-red-500/20 text-red-400 border-red-500/30',
  IN_PROGRESS:'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RESOLVED:   'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  CLOSED:     'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const TYPE_ICON: Record<string, string> = {
  ACCIDENT:             '💥',
  BREAKDOWN:            '🔧',
  DELAY:                '⏱️',
  MEDICAL:              '🚑',
  PASSENGER_COMPLAINT:  '📢',
  OTHER:                '⚠️',
};

function KPICard({ icon, label, value, sub, color, urgent }: {
  icon: string; label: string; value: number; sub?: string; color: string; urgent?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-5 border transition-all ${
      urgent && value > 0
        ? 'bg-red-500/10 border-red-500/30 animate-pulse'
        : 'bg-slate-900/60 border-white/10'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        {urgent && value > 0 && (
          <span className="text-xs text-red-400 font-medium animate-pulse">URGENT</span>
        )}
      </div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm font-medium text-white mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

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
    const t = setInterval(load, 20000); // refresh every 20s for incident data
    return () => clearInterval(t);
  }, [load]);

  const ambulancePct = data && data.ambulanceVehicles > 0
    ? Math.round((data.ambulanceAvailable / data.ambulanceVehicles) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Incident &amp; Ambulance Management</h1>
          <p className="text-slate-400 mt-1">Real-time incident tracking and emergency vehicle dispatch</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live · {lastUpdated.toLocaleTimeString()}
          </div>
          <Link href="/incidents/active"
            className="text-sm bg-red-600 hover:bg-red-500 text-white font-semibold px-4 py-2 rounded-xl transition-colors">
            + Report Incident
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KPICard icon="🚨" label="Open Incidents"    value={data?.openIncidents ?? 0}
              color="text-red-400" sub="Requires attention" urgent />
            <KPICard icon="📋" label="Total Incidents"   value={data?.totalIncidents ?? 0}
              color="text-white" sub="All time" />
            <KPICard icon="✅" label="Resolved Today"    value={data?.resolvedToday ?? 0}
              color="text-emerald-400" sub="Closed this session" />
            <KPICard icon="🚑" label="Ambulance Fleet"  value={data?.ambulanceVehicles ?? 0}
              color="text-white" sub="Total ambulance vehicles" />
            <KPICard icon="✔️" label="Ambulance Available" value={data?.ambulanceAvailable ?? 0}
              color="text-emerald-400" sub="Ready to dispatch" />
            <KPICard icon="⚠️" label="Critical Alerts"  value={data?.criticalAlerts ?? 0}
              color="text-red-400" sub="Unresolved critical" urgent />
          </div>

          {/* Ambulance readiness bar */}
          {(data?.ambulanceVehicles ?? 0) > 0 && (
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">🚑 Ambulance Fleet Readiness</h3>
                <span className={`text-sm font-bold ${ambulancePct >= 60 ? 'text-emerald-400' : ambulancePct >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
                  {ambulancePct}% Available
                </span>
              </div>
              <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${ambulancePct >= 60 ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : ambulancePct >= 30 ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-red-600 to-rose-500'}`}
                  style={{ width: `${ambulancePct}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {data?.ambulanceAvailable} of {data?.ambulanceVehicles} ambulance vehicles ready
              </p>
            </div>
          )}

          {/* Recent incidents table */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Recent Incidents</h2>
              <Link href="/incidents/active" className="text-sm text-red-400 hover:text-red-300 transition-colors">
                View all →
              </Link>
            </div>
            {data?.incidents && data.incidents.length > 0 ? (
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left px-5 py-3">Incident</th>
                      <th className="text-left px-5 py-3">Type</th>
                      <th className="text-left px-5 py-3">Severity</th>
                      <th className="text-left px-5 py-3">Status</th>
                      <th className="text-left px-5 py-3">Location</th>
                      <th className="text-left px-5 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.incidents.map(inc => (
                      <tr key={inc.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs text-white">{inc.incident_no ?? inc.id.slice(0, 8)}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="flex items-center gap-1.5 text-slate-300">
                            {TYPE_ICON[inc.incident_type] ?? '⚠️'}
                            <span className="text-xs">{inc.incident_type.replace(/_/g, ' ')}</span>
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {inc.severity && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SEVERITY_BADGE[inc.severity] ?? SEVERITY_BADGE.LOW}`}>
                              {inc.severity}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {inc.status && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[inc.status] ?? STATUS_BADGE.OPEN}`}>
                              {inc.status}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-300 text-xs max-w-xs truncate">{inc.location ?? '—'}</td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {inc.incident_date ? new Date(inc.incident_date).toLocaleDateString('en-AE') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-slate-400 text-sm">No incidents recorded</p>
                <p className="text-slate-600 text-xs mt-1">Incidents from trip_incidents table will appear here</p>
              </div>
            )}
          </div>

          {/* Quick nav */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { href: '/incidents/active',    icon: '🔴', label: 'Active Incidents',   desc: 'View and manage open incidents' },
              { href: '/incidents/ambulance', icon: '🚑', label: 'Ambulance Dispatch', desc: 'Track and deploy ambulance fleet' },
              { href: '/incidents/reports',   icon: '📋', label: 'Incident Reports',   desc: 'Historical reports and analytics' },
            ].map(link => (
              <Link key={link.href} href={link.href}
                className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 hover:border-red-500/30 hover:bg-red-500/5 transition-all group">
                <div className="text-3xl mb-3">{link.icon}</div>
                <h3 className="text-sm font-semibold text-white group-hover:text-red-300 transition-colors">{link.label}</h3>
                <p className="text-xs text-slate-500 mt-1">{link.desc}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
