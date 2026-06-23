'use client';

import React, { useEffect, useState } from 'react';
import { CalendarDays, CarFront, KeyRound, Route, SearchX } from 'lucide-react';

interface Booking {
  id: string;
  reference: string;
  serviceType: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'completed' | 'cancelled' | 'upcoming';
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | Booking['status']>('all');

  useEffect(() => {
    let mounted = true;
    fetch('/api/customer/bookings', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (mounted) setBookings(data?.bookings ?? []);
      })
      .catch(() => {
        if (mounted) setBookings([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const filteredBookings = filterTab === 'all'
    ? bookings
    : bookings.filter(booking => booking.status === filterTab);

  if (loading) {
    return <div className="h-44 animate-pulse rounded-lg bg-white/5" />;
  }

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-400/10 text-emerald-200 border-emerald-300/20';
    if (status === 'completed') return 'bg-cyan-400/10 text-cyan-200 border-cyan-300/20';
    if (status === 'cancelled') return 'bg-rose-400/10 text-rose-200 border-rose-300/20';
    return 'bg-amber-400/10 text-amber-200 border-amber-300/20';
  };

  const getServiceIcon = (type: string) => {
    if (type.includes('Rental')) return CarFront;
    if (type.includes('Lease')) return KeyRound;
    if (type.includes('Shuttle')) return Route;
    return CalendarDays;
  };

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-white">My Bookings</h1>
        <p className="mt-1 text-sm text-slate-400">Reservations linked to your corporate account</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {(['all', 'active', 'upcoming', 'completed', 'cancelled'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`h-9 rounded-md px-3 text-sm font-semibold whitespace-nowrap transition ${
              filterTab === tab
                ? 'bg-cyan-500 text-slate-950'
                : 'border border-white/10 bg-slate-900/70 text-slate-300 hover:bg-white/5'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredBookings.length > 0 ? filteredBookings.map((booking) => {
          const Icon = getServiceIcon(booking.serviceType);
          return (
            <div key={booking.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-4">
              <div className="flex gap-3">
                <Icon className="mt-1 h-6 w-6 shrink-0 text-cyan-200" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{booking.serviceType}</p>
                      <p className="mt-1 text-sm text-slate-400">{booking.reference}</p>
                    </div>
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${getStatusColor(booking.status)}`}>
                      {booking.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">
                    {new Date(booking.startDate).toLocaleDateString()} - {new Date(booking.endDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-slate-900/70 py-12 text-center">
            <SearchX className="mb-3 h-10 w-10 text-slate-500" />
            <p className="text-sm text-slate-400">No bookings found</p>
          </div>
        )}
      </div>
    </div>
  );
}
