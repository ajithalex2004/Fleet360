'use client';
import React from 'react';
import KpiTileShell, { fetchJson, fmtInt, useTileData } from './KpiTileShell';

interface Booking {
  id: string;
  bookingRef: string | null;
  requestorName: string | null;
  vehicleCategory: string | null;
  startDate: string;
  status: string | null;
}

const OPEN = new Set(['PENDING', 'APPROVED', 'CONFIRMED']);
const dubaiDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

/** Executive (chauffeur) bookings, from the tenant's booking portal. */
export default function ServiceChauffeurKPICard() {
  const data = useTileData(() => fetchJson<Booking[]>('/api/bookings?serviceType=EXECUTIVE&limit=500'));
  const list = Array.isArray(data) ? data : [];
  const now = Date.now();
  const today = dubaiDay(new Date());
  const month = today.slice(0, 7);
  const upcoming = list
    .filter((b) => OPEN.has(b.status ?? '') && new Date(b.startDate).getTime() >= now)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  return (
    <KpiTileShell
      icon="🎩"
      title="Chauffeur & Executive"
      subtitle="Executive bookings today, in progress and coming up"
      accent="bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
      headerLink={{ href: '/booking-portal', label: 'Bookings' }}
      loading={data === undefined}
      unavailable={data === null}
      metrics={[
        { label: 'Bookings Today', value: data ? fmtInt(list.filter((b) => dubaiDay(new Date(b.startDate)) === today).length) : null, tone: 'text-rose-400' },
        { label: 'In Progress', value: data ? fmtInt(list.filter((b) => b.status === 'ACTIVE').length) : null, tone: 'text-emerald-400' },
        { label: 'Upcoming', value: data ? fmtInt(upcoming.length) : null, tone: 'text-cyan-400' },
        {
          label: 'Completed This Month',
          value: data ? fmtInt(list.filter((b) => b.status === 'COMPLETED' && dubaiDay(new Date(b.startDate)).startsWith(month)).length) : null,
          tone: 'text-amber-400',
        },
      ]}
      listTitle="Next bookings"
      listRows={upcoming.slice(0, 3).map((b) => ({
        key: b.id,
        title: b.requestorName ?? b.bookingRef ?? 'Booking',
        detail: [b.vehicleCategory, new Date(b.startDate).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · '),
        value: b.status ?? undefined,
      }))}
      emptyText="No upcoming executive bookings."
      footerLinks={[{ href: '/booking-portal', label: 'New booking' }, { href: '/dispatch', label: 'Dispatch' }]}
    />
  );
}
