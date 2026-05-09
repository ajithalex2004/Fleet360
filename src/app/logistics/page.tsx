'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Truck, CheckCircle2, MapPin, Inbox, ClipboardCheck, Wrench, UserCog,
  TrendingUp, Plus, Map, Users,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

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
    <div className="space-y-6">
      <PageHeader
        title="Logistics Management"
        subtitle="Real-time fleet dispatch & delivery tracking"
        icon={Truck}
        accent="amber"
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live · {lastUpdated.toLocaleTimeString()}
            </span>
            <Link href="/logistics/trips"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-amber-500/30">
              <Plus className="w-4 h-4" /> New trip
            </Link>
          </>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Fleet vehicles"   value={stats?.totalVehicles ?? 0}     sub="Logistics fleet"        icon={Truck}          accent="amber"   />
            <KpiCard label="Available now"    value={stats?.availableVehicles ?? 0} sub="Ready to dispatch"      icon={CheckCircle2}   accent="emerald" />
            <KpiCard label="Active trips"     value={stats?.activeTrips ?? 0}       sub="In transit"             icon={MapPin}         accent="cyan"    />
            <KpiCard label="Pending"          value={stats?.pendingBookings ?? 0}   sub="Awaiting dispatch"      icon={Inbox}          accent="amber"   />
            <KpiCard label="Completed today"  value={stats?.completedToday ?? 0}    sub="Trips finished today"   icon={ClipboardCheck} accent="emerald" />
            <KpiCard label="In maintenance"   value={stats?.inMaintenance ?? 0}     sub="Out of service"         icon={Wrench}         accent="rose"    />
            <KpiCard label="Drivers"          value={stats?.drivers ?? 0}           sub="Logistics-assigned"     icon={UserCog}        accent="cyan"    />

            {/* Utilisation tile with progress bar */}
            <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-4 hover:border-white/20 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Utilisation</span>
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-300" />
                </div>
              </div>
              <div className={`text-3xl font-bold ${utilPct >= 70 ? 'text-emerald-300' : utilPct >= 40 ? 'text-amber-300' : 'text-rose-300'}`}>
                {utilPct}%
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all" style={{ width: `${utilPct}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">Active vs available</div>
            </div>
          </div>

          <Panel title="Recent trips" icon={MapPin} accent="amber"
            actions={<Link href="/logistics/trips" className="text-sm text-amber-300 hover:text-amber-200">View all →</Link>}>
            {stats?.recentTrips && stats.recentTrips.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider">
                      <th className="text-left py-2 font-medium">Booking</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-left py-2 font-medium">Route</th>
                      <th className="text-left py-2 font-medium">Customer</th>
                      <th className="text-left py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {stats.recentTrips.map(trip => (
                      <tr key={trip.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 font-mono text-xs text-white">{trip.booking_ref}</td>
                        <td className="py-3"><StatusPill status={trip.status} /></td>
                        <td className="py-3 text-slate-300">
                          {trip.origin_location && trip.destination
                            ? `${trip.origin_location} → ${trip.destination}`
                            : trip.origin_location ?? trip.destination ?? '—'}
                        </td>
                        <td className="py-3 text-slate-300">{trip.customer_name ?? '—'}</td>
                        <td className="py-3 text-slate-400 text-xs">
                          {trip.start_date ? new Date(trip.start_date).toLocaleDateString('en-AE') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <Truck className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No logistics trips found</p>
                <p className="text-slate-600 text-xs mt-1">Trips with service_type = LOGISTICS will appear here</p>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { href: '/logistics/trips',    icon: Map,   label: 'Trips & dispatch', desc: 'Manage active and pending trips',           accent: 'amber'   as const },
              { href: '/logistics/vehicles', icon: Truck, label: 'Fleet vehicles',   desc: 'Logistics-assigned vehicle inventory',     accent: 'amber'   as const },
              { href: '/logistics/drivers',  icon: Users, label: 'Driver assignment',desc: 'Assign and track logistics drivers',       accent: 'cyan'    as const },
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
