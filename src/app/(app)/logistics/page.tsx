'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Truck, MapPin, Inbox,
  Plus, Map, Gavel, Building2, WalletCards,
} from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import ChauffeurDriverIcon from '@/components/icons/ChauffeurDriverIcon';
import { fetchCached } from '@/lib/fetch-cache';
import RateCoveragePanel from '@/components/logistics/RateCoveragePanel';
import LaneProfitabilityPanel from '@/components/logistics/LaneProfitabilityPanel';

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
      // fetchCached dedupes: panel remounts within the 30s TTL return the
      // cached payload instantly; concurrent mounts share one network call.
      // See src/lib/fetch-cache.ts for the deduplication strategy.
      const data = await fetchCached<LogisticsStats>('/api/logistics/stats');
      setStats(data);
      setLastUpdated(new Date());
    } catch { /* silent — page stays usable with stale data */ }
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
              <Plus className="w-4 h-4" /> New shipment
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
            {[
              { label: 'Fleet vehicles',   value: stats?.totalVehicles ?? 0,     sub: 'Logistics fleet',   tone: 'from-amber-500 to-orange-600' },
              { label: 'Available now',    value: stats?.availableVehicles ?? 0, sub: 'Ready to dispatch', tone: 'from-emerald-500 to-teal-600' },
              { label: 'Active shipments', value: stats?.activeTrips ?? 0,       sub: 'In transit',        tone: 'from-cyan-500 to-blue-600' },
              { label: 'Pending',          value: stats?.pendingBookings ?? 0,   sub: 'Awaiting dispatch', tone: 'from-orange-500 to-red-600' },
              { label: 'Completed today',  value: stats?.completedToday ?? 0,    sub: 'Shipments finished',tone: 'from-green-500 to-emerald-600' },
              { label: 'In maintenance',   value: stats?.inMaintenance ?? 0,     sub: 'Out of service',    tone: 'from-rose-500 to-pink-600' },
              { label: 'Drivers',          value: stats?.drivers ?? 0,           sub: 'Logistics-assigned',tone: 'from-violet-500 to-purple-600' },
            ].map(card => (
              <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.tone} p-4 shadow-sm`}>
                <p className="text-[11px] uppercase tracking-wider text-white/80 font-medium">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-white">{card.value}</p>
                <p className="text-xs text-white/60 mt-1">{card.sub}</p>
              </div>
            ))}

            {/* Utilisation tile with progress bar */}
            <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 shadow-sm ${
              utilPct >= 70 ? 'from-emerald-500 to-teal-600' : utilPct >= 40 ? 'from-amber-500 to-orange-600' : 'from-rose-500 to-pink-600'
            }`}>
              <p className="text-[11px] uppercase tracking-wider text-white/80 font-medium">Utilisation</p>
              <p className="mt-2 text-3xl font-bold text-white">{utilPct}%</p>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-white rounded-full transition-all" style={{ width: `${utilPct}%` }} />
              </div>
              <p className="text-xs text-white/60 mt-1">Active vs available</p>
            </div>
          </div>

          <RateCoveragePanel />

          <LaneProfitabilityPanel />

          <Panel title="Recent shipments" icon={MapPin} accent="amber"
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
                <p className="text-slate-400 text-sm">No logistics shipments found</p>
                <p className="text-slate-600 text-xs mt-1">Shipment orders will appear here</p>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { href: '/logistics/trips',    icon: Map,   label: 'Shipment orders', desc: 'Manage active and pending shipments',        accent: 'amber'   as const },
              { href: '/logistics/marketplace', icon: Gavel, label: 'Freight marketplace', desc: 'Open RFQs, compare carrier bids, and award loads', accent: 'emerald' as const },
              { href: '/logistics/carriers', icon: Truck, label: 'Carrier network', desc: 'Onboard carriers, compliance, scorecards, and app tokens', accent: 'emerald' as const },
              { href: '/logistics/shippers', icon: Building2, label: 'Shippers', desc: 'Onboard cargo owners and grant tracking-portal access', accent: 'emerald' as const },
              { href: '/logistics/shipping-requests', icon: Inbox, label: 'Shipping requests', desc: 'Review shipper demand and convert it into job orders', accent: 'emerald' as const },
              { href: '/logistics/settlements', icon: WalletCards, label: 'Settlements', desc: 'Post customer invoices, carrier payables, and payout entries', accent: 'amber' as const },
              { href: '/logistics/vehicles', icon: Truck, label: 'Fleet vehicles',   desc: 'Logistics-assigned vehicle inventory',     accent: 'amber'   as const },
              { href: '/logistics/drivers',  icon: ChauffeurDriverIcon, label: 'Driver assignment',desc: 'Assign and track logistics drivers',       accent: 'cyan'    as const },
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
