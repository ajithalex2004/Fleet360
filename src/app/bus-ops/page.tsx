'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BusFront, Map as MapIcon, Calendar, Clock as ClockIcon, Users, AlertTriangle, FileText, ArrowRight, Sparkles,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/bus-ops/theme';

export default function BusOpsDashboard() {
  const [data, setData]     = useState<any>({ routes: [], schedules: [], staff: [], incidents: [], requests: [] });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, sRes, stRes, iRes, reqRes] = await Promise.all([
        fetch('/api/bus-ops/routes'),
        fetch('/api/bus-ops/schedules'),
        fetch('/api/bus-ops/staff'),
        fetch('/api/bus-ops/incidents'),
        fetch('/api/bus-ops/transport-requests'),
      ]);
      const [routes, schedules, staff, incidents, requests] = await Promise.all([
        rRes.json(), sRes.json(), stRes.json(), iRes.json(), reqRes.json(),
      ]);
      setData({
        routes:    Array.isArray(routes)    ? routes    : [],
        schedules: Array.isArray(schedules) ? schedules : [],
        staff:     Array.isArray(staff)     ? staff     : [],
        incidents: Array.isArray(incidents) ? incidents : [],
        requests:  Array.isArray(requests)  ? requests  : [],
      });
    } catch { /* show empty state */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { routes, schedules, staff, incidents, requests } = data;
  const todayTrips    = schedules.filter((s: any) => {
    const d = new Date(s.departureTime);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const activeTrips   = schedules.filter((s: any) => ['DEPARTED','IN_TRANSIT'].includes(s.status ?? ''));
  const openIncidents = incidents.filter((i: any) => i.status === 'OPEN');
  const pendingReqs   = requests.filter((r: any) => r.status === 'PENDING');

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading dashboard...</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Transportation"
        subtitle="Real-time overview of routes, trips, passengers, and incidents."
        icon={BusFront}
        accent="violet"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Link href="/bus-ops/routes"><KpiCard label="Active Routes"      value={routes.filter((r:any)=>r.isActive).length} icon={MapIcon}        accent="cyan" /></Link>
        <Link href="/bus-ops/schedules"><KpiCard label="Today's Trips"   value={todayTrips.length}                          icon={Calendar}       accent="emerald" /></Link>
        <Link href="/bus-ops/schedules"><KpiCard label="In Progress"     value={activeTrips.length}                         icon={ClockIcon}      accent="amber" /></Link>
        <Link href="/bus-ops/staff"><KpiCard label="Staff Registered"   value={staff.filter((s:any)=>s.isActive).length}  icon={Users}          accent="violet" /></Link>
        <Link href="/bus-ops/incidents"><KpiCard label="Open Incidents"  value={openIncidents.length}                       icon={AlertTriangle}  accent="rose" /></Link>
        <Link href="/bus-ops/passengers"><KpiCard label="Pending Requests" value={pendingReqs.length}                       icon={FileText}       accent="slate" /></Link>
      </div>

      {/* Today's Trips */}
      <Panel
        title="Today's Trips"
        icon={Calendar}
        accent="violet"
        actions={
          <Link href="/bus-ops/schedules" className="text-xs text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      >
        {todayTrips.length === 0 ? (
          <div className="text-center text-slate-400 py-6 text-sm">
            No trips scheduled for today. <Link href="/bus-ops/schedules" className="text-violet-300 hover:underline">Create one.</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {todayTrips.slice(0,6).map((t: any) => (
              <div key={t.id} className="rounded-xl bg-slate-800/40 border border-white/5 p-4 hover:border-white/10 transition-colors">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-white text-sm">{t.tripNumber ?? t.id.slice(0,8)}</div>
                    <div className="text-slate-400 text-xs truncate">{t.route?.name ?? '—'} · {t.shiftType ?? '—'} · {t.direction ?? '—'}</div>
                  </div>
                  <StatusPill status={t.status ?? 'SCHEDULED'} />
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1"><ClockIcon className="w-3 h-3" /> {new Date(t.departureTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {t.confirmedCount ?? 0}/{t.capacity ?? 30}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Active Incidents + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel
          title="Open Incidents"
          icon={AlertTriangle}
          accent="rose"
          actions={
            <Link href="/bus-ops/incidents" className="text-xs text-rose-300 hover:text-rose-200 inline-flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {openIncidents.length === 0 ? (
            <div className="text-center text-slate-400 py-6 text-sm">No open incidents</div>
          ) : (
            <div className="space-y-2">
              {openIncidents.slice(0,4).map((inc: any) => (
                <div key={inc.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/40 border border-white/5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${inc.severity === 'CRITICAL' ? 'bg-rose-500' : inc.severity === 'HIGH' ? 'bg-orange-500' : inc.severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-slate-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{inc.incidentNo} — {inc.incidentType}</div>
                    <div className="text-xs text-slate-500 truncate">{inc.location ?? '—'} · {new Date(inc.incidentDate).toLocaleDateString()}</div>
                  </div>
                  <StatusPill status={inc.severity === 'CRITICAL' || inc.severity === 'HIGH' ? 'danger' : 'warning'} label={inc.severity} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Quick Actions" icon={Sparkles} accent="violet">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Add Route',         href: '/bus-ops/routes',     icon: MapIcon,       accent: 'cyan' as const },
              { label: 'New Trip',          href: '/bus-ops/schedules',  icon: Calendar,      accent: 'emerald' as const },
              { label: 'Register Staff',    href: '/bus-ops/staff',      icon: Users,         accent: 'violet' as const },
              { label: 'Log Incident',      href: '/bus-ops/incidents',  icon: AlertTriangle, accent: 'rose' as const },
              { label: 'Manage Passengers', href: '/bus-ops/passengers', icon: Users,         accent: 'amber' as const },
              { label: 'Trip Requests',     href: '/bus-ops/passengers', icon: FileText,      accent: 'slate' as const },
            ].map(link => {
              const Icon = link.icon;
              return (
                <Link key={link.label} href={link.href}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/40 border border-white/5 hover:border-white/10 hover:bg-slate-800/60 transition-all">
                  <Icon className="w-4 h-4 text-slate-300 shrink-0" strokeWidth={1.75} />
                  <span className="text-xs text-slate-200 truncate">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
