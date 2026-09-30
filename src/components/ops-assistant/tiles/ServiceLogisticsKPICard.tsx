'use client';
import React from 'react';
import KpiTileShell, { fetchJson, fmtInt, useTileData } from './KpiTileShell';

interface LogisticsStats {
  activeTrips?: number;
  completedToday?: number;
  pendingBookings?: number;
  drivers?: number;
  recentTrips?: Array<{ id: string; booking_ref: string; status: string; origin_location: string | null; destination: string | null; customer_name: string | null }>;
}

/** Logistics today, from the tenant's logistics bookings and drivers. */
export default function ServiceLogisticsKPICard() {
  const data = useTileData(() => fetchJson<LogisticsStats>('/api/logistics/stats'));

  return (
    <KpiTileShell
      icon="🚚"
      title="Logistics & Freight"
      subtitle="Trips in progress, deliveries completed today and pending bookings"
      accent="bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20"
      headerLink={{ href: '/logistics', label: 'Logistics' }}
      loading={data === undefined}
      unavailable={data === null}
      metrics={[
        { label: 'Trips In Progress', value: fmtInt(data?.activeTrips), tone: 'text-yellow-400' },
        { label: 'Completed Today', value: fmtInt(data?.completedToday), tone: 'text-emerald-400' },
        { label: 'Pending Bookings', value: fmtInt(data?.pendingBookings), tone: 'text-amber-400' },
        { label: 'Drivers', value: fmtInt(data?.drivers), tone: 'text-cyan-400' },
      ]}
      listTitle="Recent trips"
      listRows={(data?.recentTrips ?? []).slice(0, 3).map((t) => ({
        key: t.id,
        title: [t.origin_location, t.destination].filter(Boolean).join(' → ') || t.booking_ref,
        detail: [t.booking_ref, t.customer_name].filter(Boolean).join(' · ') || undefined,
        value: t.status,
      }))}
      emptyText="No logistics trips recorded yet."
      footerLinks={[{ href: '/logistics', label: 'Shipments' }, { href: '/reports/revenue', label: 'Revenue report' }]}
    />
  );
}
