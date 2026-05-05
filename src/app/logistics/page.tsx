'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface LogisticsStats {
  totalVehicles: number;
  availableVehicles: number;
  inMaintenance: number;
  activeTrips: number;
  completedToday: number;
  pendingBookings: number;
  drivers: number;
  recentTrips: Array<{
    id: string;
    booking_ref: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    origin_location: string | null;
    destination: string | null;
    customer_name: string | null;
    created_at: string | null;
  }>;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACTIVE:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  CANCELLED: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function StatCard({
  icon, label, value, sub, color = 'text-white', href,
}: {
  icon: string; label: string; value: number | string;
  sub?: string; color?: string; href?: string;
}) {
  const inner = (
    <div className="glass-card rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all group">
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

export default function LogisticsDashboard() {
  const [stats, setStats] = useState<LogisticsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/stats', { cache: 'no-store' });
      if (res.ok) {
        setStats(await res.json());
        setLastUpdated(new Date());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const utilPct = stats && stats.totalVehicles > 0
    ? Math.round(((stats.totalVehicles - stats.availableVehicles) / stats.totalVehicles) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Logistics Management</h1>
          <p className="text-slate-400 mt-1">Real-time fleet dispatch &amp; delivery tracking</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live · {lastUpdated.toLocaleTimeString()}
          </div>
          <Link href="/logistics/trips"
            className="text-sm bg-amber-500 hover:bg-amber-400 text-white font-semibold px-4 py-2 rounded-xl transition-colors">
            + New Trip
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🚛" label="Fleet Vehicles" value={stats?.totalVehicles ?? 0}
              sub="Logistics fleet" href="/logistics/vehicles" />
            <StatCard icon="✅" label="Available Now" value={stats?.availableVehicles ?? 0}
              color="text-emerald-400" sub="Ready to dispatch" href="/logistics/vehicles" />
            <StatCard icon="🗺️" label="Active Trips" value={stats?.activeTrips ?? 0}
              color="text-blue-400" sub="Confirmed & in-transit" href="/logistics/trips" />
            <StatCard icon="📋" label="Pending" value={stats?.pendingBookings ?? 0}
              color="text-amber-400" sub="Awaiting dispatch" href="/logistics/trips" />
            <StatCard icon="✔️" label="Completed Today" value={stats?.completedToday ?? 0}
              color="text-emerald-400" sub="Trips finished today" />
            <StatCard icon="🔧" label="In Maintenance" value={stats?.inMaintenance ?? 0}
              color="text-orange-400" sub="Logistics vehicles" href="/logistics/vehicles" />
            <StatCard icon="👤" label="Drivers" value={stats?.drivers ?? 0}
              sub="Logistics-assigned" href="/logistics/drivers" />
            <div className="glass-card rounded-2xl p-5 border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl">📈</span>
                <span className={`text-sm font-bold ${utilPct >= 70 ? 'text-emerald-400' : utilPct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                  {utilPct}%
                </span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all"
                  style={{ width: `${utilPct}%` }}
                />
              </div>
              <div className="text-sm font-medium text-white">Fleet Utilization</div>
              <div className="text-xs text-slate-500 mt-0.5">Active vs available</div>
            </div>
          </div>

          {/* Recent Trips */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Recent Trips</h2>
              <Link href="/logistics/trips" className="text-sm text-amber-400 hover:text-amber-300 transition-colors">
                View all →
              </Link>
            </div>
            {stats?.recentTrips && stats.recentTrips.length > 0 ? (
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left px-5 py-3">Booking Ref</th>
                      <th className="text-left px-5 py-3">Status</th>
                      <th className="text-left px-5 py-3">Route</th>
                      <th className="text-left px-5 py-3">Customer</th>
                      <th className="text-left px-5 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentTrips.map((trip, i) => (
                      <tr key={trip.id}
                        className={`border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-900/20'}`}>
                        <td className="px-5 py-3 font-mono text-xs text-white">{trip.booking_ref}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[trip.status] ?? STATUS_BADGE.PENDING}`}>
                            {trip.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-300">
                          {trip.origin_location && trip.destination
                            ? `${trip.origin_location} → ${trip.destination}`
                            : trip.origin_location ?? trip.destination ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-slate-300">{trip.customer_name ?? '—'}</td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {trip.start_date ? new Date(trip.start_date).toLocaleDateString('en-AE') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
                <div className="text-4xl mb-3">🚛</div>
                <p className="text-slate-400 text-sm">No logistics trips found</p>
                <p className="text-slate-600 text-xs mt-1">Trips with service_type = LOGISTICS will appear here</p>
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { href: '/logistics/trips',    icon: '🗺️', label: 'Trips & Dispatch',  desc: 'Manage active and pending trips' },
              { href: '/logistics/vehicles', icon: '🚛', label: 'Fleet Vehicles',     desc: 'Logistics-assigned vehicle inventory' },
              { href: '/logistics/drivers',  icon: '👤', label: 'Driver Assignment',  desc: 'Assign and track logistics drivers' },
            ].map(link => (
              <Link key={link.href} href={link.href}
                className="glass-card rounded-2xl p-5 border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all group">
                <div className="text-3xl mb-3">{link.icon}</div>
                <h3 className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">{link.label}</h3>
                <p className="text-xs text-slate-500 mt-1">{link.desc}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
