'use client';
import React from 'react';
import KpiTileShell, { fetchJson, fmtInt, fmtPct, useTileData } from './KpiTileShell';

interface BusOpsAnalytics {
  kpis?: {
    totalTrips?: number;
    totalPassengers?: number;
    totalRoutes?: number;
    avgOccupancy?: number;
    onTimeDeparturePct?: number;
  };
  charts?: { byShift?: Array<{ name: string; value: number }> };
}

/** Staff transport over the last 30 days, from the tenant's trip logs. */
export default function ServiceStaffBusKPICard() {
  const data = useTileData(() => fetchJson<BusOpsAnalytics>('/api/bus-ops/analytics'));
  const k = data?.kpis;
  const hasTrips = (k?.totalTrips ?? 0) > 0;

  return (
    <KpiTileShell
      icon="🚍"
      title="Staff Transportation"
      subtitle="Last 30 days of staff bus trips, passengers and punctuality"
      accent="bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20"
      headerLink={{ href: '/bus-ops', label: 'Staff Transport' }}
      loading={data === undefined}
      unavailable={data === null}
      metrics={[
        { label: 'Routes', value: fmtInt(k?.totalRoutes), tone: 'text-emerald-400' },
        { label: 'Passengers (30 days)', value: hasTrips ? fmtInt(k?.totalPassengers) : null, tone: 'text-cyan-400' },
        { label: 'On-Time Departure', value: hasTrips ? fmtPct(k?.onTimeDeparturePct) : null, tone: 'text-emerald-400' },
        { label: 'Avg Occupancy', value: hasTrips ? fmtPct(k?.avgOccupancy) : null, tone: 'text-indigo-400' },
      ]}
      listTitle="Trips by shift (30 days)"
      listRows={(data?.charts?.byShift ?? []).slice(0, 3).map((s) => ({
        key: s.name,
        title: s.name,
        value: `${s.value.toLocaleString('en-AE')} trips`,
      }))}
      emptyText="No staff bus trips recorded in the last 30 days."
      footerLinks={[{ href: '/bus-ops/route-planner', label: 'Route planner' }, { href: '/reports/fleet-utilization', label: 'Utilization' }]}
    />
  );
}
