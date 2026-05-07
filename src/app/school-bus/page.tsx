'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  School, CheckCircle2, Map, Calendar, Activity, Wrench, UserCog, Users,
  AlertTriangle, Bus, Siren,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

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
  const [stats, setStats] = useState<SchoolBusStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/school-bus/stats', { cache: 'no-store' });
      if (res.ok) { setStats(await res.json()); setLastUpdated(new Date()); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

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
            <KpiCard label="School buses"     value={stats?.totalVehicles ?? 0}     sub="Total fleet"             icon={Bus}            accent="amber"   />
            <KpiCard label="Available"        value={stats?.availableVehicles ?? 0} sub="Ready for trips"         icon={CheckCircle2}   accent="emerald" />
            <KpiCard label="Active routes"    value={stats?.activeRoutes ?? 0}      sub="Bus routes"              icon={Map}            accent="cyan"    />
            <KpiCard label="Today's trips"    value={stats?.todaySchedules ?? 0}    sub="Scheduled today"         icon={Calendar}       accent="default" />
            <KpiCard label="In transit"       value={stats?.inTransit ?? 0}         sub="Currently on route"      icon={Activity}       accent={(stats?.inTransit ?? 0) > 0 ? 'amber' : 'slate'} />
            <KpiCard label="In maintenance"   value={stats?.inMaintenance ?? 0}     sub="Buses under service"     icon={Wrench}         accent="rose"    />
            <KpiCard label="Drivers"          value={stats?.drivers ?? 0}           sub="School bus drivers"      icon={UserCog}        accent="cyan"    />
            <KpiCard label="Students"         value={0}                              sub="Registered students"     icon={Users}          accent="default" />
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
