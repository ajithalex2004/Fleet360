'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  School, Map, Calendar, Users,
  AlertTriangle, Siren,
} from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import { useFetchedData } from '@/hooks/useFetchedData';

interface SchoolBusStats {
  totalVehicles: number;
  availableVehicles: number;
  inMaintenance: number;
  activeRoutes: number;
  todaySchedules: number;
  inTransit: number;
  drivers: number;
  todayTrips: Array<{
    id: string;
    trip_no: string | null;
    status: string;
    departure_time: string | null;
    arrival_time: string | null;
    route_name: string | null;
    vehicle_plate: string | null;
  }>;
}

export default function SchoolBusDashboard() {
  // Session-scoped fetch cache — 1st visit hits the cached stats
  // endpoint (unstable_cache + private s-maxage), 2nd visit in the
  // same tab is instant. The 30s auto-refresh still works because
  // the server cache is also 30s — the auto-refresh hits the
  // Data Cache instead of Neon.
  const { data: stats, loading: statsLoading, refresh: refreshStats } =
    useFetchedData<SchoolBusStats>('/api/school-bus/stats');
  const loading = statsLoading;
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Refresh once a minute and update the "Live" pill. The hook's
  // session cache means the navigation-away-and-back case is
  // already instant; the auto-refresh keeps the data fresh.
  useEffect(() => {
    setLastUpdated(new Date());
    const t = setInterval(() => { refreshStats(); setLastUpdated(new Date()); }, 60000);
    return () => clearInterval(t);
  }, [refreshStats]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="School Bus Transportation"
        subtitle="Student transport operations — routes, trips & safety"
        icon={School}
        accent="amber"
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live · {lastUpdated.toLocaleTimeString()}
            </span>
            <Link href="/school-bus/routes"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-amber-500/30">
              <Map className="w-4 h-4" /> Manage routes
            </Link>
          </>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_,i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse"/>)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'School buses',   value: stats?.totalVehicles ?? 0,     sub: 'Total fleet',         tone: 'from-amber-500 to-orange-600' },
              { label: 'Available',      value: stats?.availableVehicles ?? 0, sub: 'Ready for trips',     tone: 'from-emerald-500 to-teal-600' },
              { label: 'Active routes',  value: stats?.activeRoutes ?? 0,      sub: 'Bus routes',          tone: 'from-cyan-500 to-blue-600' },
              { label: "Today's trips",  value: stats?.todaySchedules ?? 0,    sub: 'Scheduled today',     tone: 'from-blue-500 to-indigo-600' },
              { label: 'In transit',     value: stats?.inTransit ?? 0,         sub: 'Currently on route',  tone: (stats?.inTransit ?? 0) > 0 ? 'from-amber-500 to-orange-600' : 'from-slate-500 to-slate-700' },
              { label: 'In maintenance', value: stats?.inMaintenance ?? 0,     sub: 'Buses under service', tone: 'from-rose-500 to-pink-600' },
              { label: 'Drivers',        value: stats?.drivers ?? 0,           sub: 'School bus drivers',  tone: 'from-violet-500 to-purple-600' },
              { label: 'Students',       value: 0,                              sub: 'Registered students', tone: 'from-teal-500 to-cyan-600' },
            ].map(card => (
              <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.tone} p-4 shadow-sm`}>
                <p className="text-[11px] uppercase tracking-wider text-white/80 font-medium">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-white">{card.value}</p>
                <p className="text-xs text-white/60 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-amber-200 font-semibold text-sm">Student safety first</h3>
              <p className="text-amber-100/70 text-xs mt-1 leading-relaxed">
                All school bus trips require driver check-in, vehicle safety inspection, and
                student attendance confirmation before departure. Ensure all compliance documents
                are valid and GPS tracking is active.
              </p>
            </div>
          </div>

          <Panel title="Today's schedule" icon={Calendar} accent="amber"
            actions={<Link href="/bus-ops/schedules" className="text-sm text-amber-300 hover:text-amber-200">Full schedule →</Link>}>
            {stats?.todayTrips && stats.todayTrips.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider">
                      <th className="text-left py-2 font-medium">Trip</th>
                      <th className="text-left py-2 font-medium">Route</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-left py-2 font-medium">Departure</th>
                      <th className="text-left py-2 font-medium">Arrival</th>
                      <th className="text-left py-2 font-medium">Vehicle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {stats.todayTrips.map(trip => (
                      <tr key={trip.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 font-mono text-xs text-white">{trip.trip_no ?? trip.id.slice(0,8)}</td>
                        <td className="py-3 text-slate-300">{trip.route_name ?? '—'}</td>
                        <td className="py-3"><StatusPill status={trip.status} /></td>
                        <td className="py-3 text-slate-400 text-xs">
                          {trip.departure_time ? new Date(trip.departure_time).toLocaleTimeString('en-AE', { hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td className="py-3 text-slate-400 text-xs">
                          {trip.arrival_time ? new Date(trip.arrival_time).toLocaleTimeString('en-AE', { hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td className="py-3 text-slate-300 text-xs">{trip.vehicle_plate ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No trips scheduled for today</p>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { href: '/school-bus/routes',   icon: Map,   label: 'Route management', desc: 'Manage school bus routes and stops' },
              { href: '/school-bus/students', icon: Users, label: 'Student registry', desc: 'Student enrolment and bus assignment' },
              { href: '/bus-ops/incidents',   icon: Siren, label: 'Safety & incidents', desc: 'Report and track safety incidents' },
            ].map(link => {
              const Icon = link.icon;
              return (
                <Link key={link.href} href={link.href}
                  className="rounded-2xl bg-slate-900/60 border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all p-5 group block">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-amber-300" />
                  </div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">{link.label}</h3>
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
