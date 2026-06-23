'use client';

import React, { useEffect, useState } from 'react';
import { BusFront, CalendarDays, Clock, MapPin, SearchX } from 'lucide-react';

interface ShuttleTrip {
  id: string;
  route: string;
  departureTime: string;
  boardingStop: string;
  vehicle: string;
  status: 'scheduled' | 'in_progress' | 'completed';
}

interface ScheduleItem {
  id: string;
  day: string;
  route: string;
  departureTime: string;
  boardingStop: string;
}

export default function TransportPage() {
  const [todayTrips, setTodayTrips] = useState<ShuttleTrip[]>([]);
  const [weeklySchedule, setWeeklySchedule] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'today' | 'weekly'>('today');

  useEffect(() => {
    let mounted = true;
    fetch('/api/customer/transport', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!mounted) return;
        setTodayTrips(data?.todayTrips ?? []);
        setWeeklySchedule(data?.weeklySchedule ?? []);
      })
      .catch(() => {
        if (!mounted) return;
        setTodayTrips([]);
        setWeeklySchedule([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return <div className="h-44 animate-pulse rounded-lg bg-white/5" />;
  }

  const getStatusColor = (status: string) => {
    if (status === 'in_progress') return 'bg-emerald-400/10 text-emerald-200 border-emerald-300/20';
    if (status === 'completed') return 'bg-cyan-400/10 text-cyan-200 border-cyan-300/20';
    return 'bg-amber-400/10 text-amber-200 border-amber-300/20';
  };

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-white">Corporate Transport</h1>
        <p className="mt-1 text-sm text-slate-400">Shuttle routes and schedules assigned to your company</p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-slate-900/70 p-1">
        <button
          onClick={() => setViewMode('today')}
          className={`h-10 rounded-md text-sm font-semibold transition ${
            viewMode === 'today' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-white/5'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setViewMode('weekly')}
          className={`h-10 rounded-md text-sm font-semibold transition ${
            viewMode === 'weekly' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-white/5'
          }`}
        >
          Weekly Schedule
        </button>
      </div>

      {viewMode === 'today' && (
        <div className="space-y-3">
          {todayTrips.length > 0 ? todayTrips.map((trip) => (
            <div key={trip.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <BusFront className="mt-1 h-6 w-6 text-cyan-200" />
                  <div>
                    <p className="font-semibold text-white">{trip.route}</p>
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-400">
                      <Clock className="h-4 w-4" />
                      {trip.departureTime}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-slate-400">
                      <MapPin className="h-4 w-4" />
                      {trip.boardingStop}
                    </p>
                  </div>
                </div>
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${getStatusColor(trip.status)}`}>
                  {trip.status.replace('_', ' ')}
                </span>
              </div>
            </div>
          )) : (
            <EmptyState label="No trips scheduled for today" />
          )}
        </div>
      )}

      {viewMode === 'weekly' && (
        <div className="space-y-3">
          {weeklySchedule.length > 0 ? weeklySchedule.map((item) => (
            <div key={item.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-start gap-3">
                <CalendarDays className="mt-1 h-6 w-6 text-cyan-200" />
                <div>
                  <p className="font-semibold text-white">{item.day}</p>
                  <p className="mt-2 text-sm text-slate-400">{item.route}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.departureTime} from {item.boardingStop}</p>
                </div>
              </div>
            </div>
          )) : (
            <EmptyState label="No weekly schedule available" />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-slate-900/70 py-12 text-center">
      <SearchX className="mb-3 h-10 w-10 text-slate-500" />
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}
