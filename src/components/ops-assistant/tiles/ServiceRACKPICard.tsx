'use client';
import React from 'react';
import KpiTileShell, { fetchJson, fmtAed, fmtInt, useTileData } from './KpiTileShell';

interface RentalAnalytics {
  overview?: { total_revenue?: number; total_bookings?: number; avg_rental_days?: number };
  by_vehicle_type?: Array<{ vehicle_type: string; count: number; revenue: number }>;
}
interface FleetStats { totalVehicles?: number }

/** Rent-a-car over the last 90 days, from the tenant's rental bookings. */
export default function ServiceRACKPICard() {
  const data = useTileData(async () => {
    const [rental, fleet] = await Promise.all([
      fetchJson<RentalAnalytics>('/api/rental/analytics'),
      fetchJson<FleetStats>('/api/fleet/stats'),
    ]);
    return { rental, fleet };
  });
  const o = data?.rental?.overview;
  const rentalDays = (o?.total_bookings ?? 0) * (o?.avg_rental_days ?? 0);

  return (
    <KpiTileShell
      icon="🚗"
      title="Rent-A-Car (RAC)"
      subtitle="Last 90 days of rental bookings and revenue"
      accent="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
      headerLink={{ href: '/rental/bookings', label: 'RAC Desk' }}
      loading={data === undefined}
      unavailable={!!data && !data.rental && !data.fleet}
      metrics={[
        { label: 'Fleet Vehicles', value: fmtInt(data?.fleet?.totalVehicles), tone: 'text-indigo-400' },
        { label: 'Bookings (90 days)', value: fmtInt(o?.total_bookings), tone: 'text-emerald-400' },
        { label: 'Avg Daily Rate', value: rentalDays > 0 ? fmtAed((o?.total_revenue ?? 0) / rentalDays) : null, tone: 'text-cyan-400' },
        { label: 'Revenue (90 days)', value: o?.total_bookings ? fmtAed(o.total_revenue) : null, tone: 'text-amber-400' },
      ]}
      listTitle="Bookings by vehicle category"
      listRows={(data?.rental?.by_vehicle_type ?? []).slice(0, 3).map((c) => ({
        key: c.vehicle_type,
        title: c.vehicle_type,
        detail: `${c.count.toLocaleString('en-AE')} bookings`,
        value: fmtAed(c.revenue) ?? undefined,
      }))}
      emptyText="No rental bookings in the last 90 days."
      footerLinks={[{ href: '/rental/bookings', label: 'Bookings' }, { href: '/reports/revenue', label: 'Revenue report' }]}
    />
  );
}
