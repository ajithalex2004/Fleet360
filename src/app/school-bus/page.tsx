'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

const TRIP_STATUS: Record<string, string> = {
  SCHEDULED:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  DEPARTED:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  IN_TRANSIT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  COMPLETED:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  CANCELLED:  'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

function StatCard({ icon, label, value, sub, color = 'text-white', href }: {
  icon: string; label: string; value: number; sub?: string; color?: string; href?: string;
}) {
  const inner = (
    <div className="bg-slate-900/60 border border-white/10 hover:border-white/20 rounded-2xl p-5 transition-all group">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        {href && <span className="text-slate-600 group-hover:text-slate-300 text-sm transition-colors">→</span>}
      </div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm font-medium text-white mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">School Bus Transportation</h1>
          <p className="text-slate-400 mt-1">Student transport operations — routes, trips &amp; safety</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live · {lastUpdated.toLocaleTimeString()}
          </div>
          <Link href="/school-bus/routes"
            className="text-sm bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold px-4 py-2 rounded-xl transition-colors">
            Manage Routes
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_,i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse"/>)}
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🚌" label="School Buses"       value={stats?.totalVehicles ?? 0}
              sub="Total school bus fleet" href="/school-bus/routes" />
            <StatCard icon="✅" label="Available"           value={stats?.availableVehicles ?? 0}
              color="text-emerald-400" sub="Ready for trips" />
            <StatCard icon="🗺️" label="Active Routes"      value={stats?.activeRoutes ?? 0}
              color="text-blue-400" sub="School bus routes" href="/school-bus/routes" />
            <StatCard icon="📅" label="Today's Trips"      value={stats?.todaySchedules ?? 0}
              sub="Scheduled for today" />
            <StatCard icon="🔄" label="In Transit"          value={stats?.inTransit ?? 0}
              color={stats?.inTransit ?? 0 > 0 ? 'text-amber-400' : 'text-slate-400'}
              sub="Currently on route" />
            <StatCard icon="🔧" label="In Maintenance"     value={stats?.inMaintenance ?? 0}
              color="text-orange-400" sub="Buses under service" />
            <StatCard icon="👤" label="Drivers"             value={stats?.drivers ?? 0}
              sub="School bus drivers" />
            <StatCard icon="👧" label="Students"            value={0}
              sub="Registered students" href="/school-bus/students" />
          </div>

          {/* Safety notice */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 flex items-start gap-4">
            <span className="text-3xl flex-shrink-0">⚠️</span>
            <div>
              <h3 className="text-yellow-300 font-semibold text-sm">Student Safety First</h3>
              <p className="text-yellow-400/70 text-xs mt-1">
                All school bus trips require driver check-in, vehicle safety inspection, and student attendance confirmation before departure.
                Ensure all compliance documents are valid and GPS tracking is active.
              </p>
            </div>
          </div>

          {/* Today's trips */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Today&apos;s Schedule</h2>
              <Link href="/bus-ops/schedules" className="text-sm text-yellow-400 hover:text-yellow-300 transition-colors">
                Full schedule →
              </Link>
            </div>
            {stats?.todayTrips && stats.todayTrips.length > 0 ? (
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left px-5 py-3">Trip No.</th>
                      <th className="text-left px-5 py-3">Route</th>
                      <th className="text-left px-5 py-3">Status</th>
                      <th className="text-left px-5 py-3">Departure</th>
                      <th className="text-left px-5 py-3">Arrival</th>
                      <th className="text-left px-5 py-3">Vehicle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.todayTrips.map(trip => (
                      <tr key={trip.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-white">{trip.trip_no ?? trip.id.slice(0,8)}</td>
                        <td className="px-5 py-3 text-slate-300">{trip.route_name ?? '—'}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${TRIP_STATUS[trip.status] ?? TRIP_STATUS.SCHEDULED}`}>
                            {trip.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {trip.departure_time ? new Date(trip.departure_time).toLocaleTimeString('en-AE', { hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {trip.arrival_time ? new Date(trip.arrival_time).toLocaleTimeString('en-AE', { hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td className="px-5 py-3 text-slate-300 text-xs">{trip.vehicle_plate ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
                <div className="text-4xl mb-3">📅</div>
                <p className="text-slate-400 text-sm">No trips scheduled for today</p>
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { href: '/school-bus/routes',   icon: '🗺️', label: 'Route Management',    desc: 'Manage school bus routes and stops' },
              { href: '/school-bus/students', icon: '👧', label: 'Student Registry',     desc: 'Student enrollment and bus assignment' },
              { href: '/bus-ops/incidents',   icon: '🚨', label: 'Safety & Incidents',   desc: 'Report and track safety incidents' },
            ].map(link => (
              <Link key={link.href} href={link.href}
                className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 hover:border-yellow-500/30 hover:bg-yellow-500/5 transition-all group">
                <div className="text-3xl mb-3">{link.icon}</div>
                <h3 className="text-sm font-semibold text-white group-hover:text-yellow-300 transition-colors">{link.label}</h3>
                <p className="text-xs text-slate-500 mt-1">{link.desc}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
