'use client';
import React from 'react';
import KpiTileShell, { fetchJson, fmtInt, useTileData } from './KpiTileShell';

interface SchoolBusStats {
  totalVehicles?: number;
  activeRoutes?: number;
  todaySchedules?: number;
  inTransit?: number;
  todayTrips?: Array<{ id: string; trip_no: string | null; status: string; departure_time: string | null; route_name: string | null; vehicle_plate: string | null }>;
}

/** School transport today, from the tenant's buses, routes, students and trips. */
export default function ServiceSchoolBusKPICard() {
  const data = useTileData(async () => {
    const [stats, students] = await Promise.all([
      fetchJson<SchoolBusStats>('/api/school-bus/stats'),
      fetchJson<{ total?: number }>('/api/school-bus/students?limit=1'),
    ]);
    return { stats, students };
  });
  const s = data?.stats;

  return (
    <KpiTileShell
      icon="🏫"
      title="School Transportation"
      subtitle="Students, buses, routes and today's trips"
      accent="bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
      headerLink={{ href: '/school-bus', label: 'School Bus' }}
      loading={data === undefined}
      unavailable={!!data && !data.stats && !data.students}
      metrics={[
        { label: 'Students', value: fmtInt(data?.students?.total), tone: 'text-amber-400' },
        { label: 'School Buses', value: fmtInt(s?.totalVehicles), tone: 'text-cyan-400' },
        { label: 'Active Routes', value: fmtInt(s?.activeRoutes), tone: 'text-emerald-400' },
        { label: 'Trips In Progress', value: fmtInt(s?.inTransit), tone: 'text-indigo-400' },
      ]}
      listTitle="Today's trips"
      listRows={(s?.todayTrips ?? []).slice(0, 3).map((t) => ({
        key: t.id,
        title: t.route_name ?? t.trip_no ?? 'Trip',
        detail: [t.vehicle_plate, t.departure_time?.slice(0, 5)].filter(Boolean).join(' · ') || undefined,
        value: t.status,
      }))}
      emptyText="No school bus trips scheduled today."
      footerLinks={[{ href: '/school-bus', label: 'Operations' }, { href: '/school-bus/reports', label: 'Reports' }]}
    />
  );
}
