'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Trip {
  id: string;
  tripNumber: string | null;
  routeId: string;
  vehicleId: string | null;
  driverId: string | null;
  departureTime: string;
  arrivalTime: string | null;
  shiftType: string | null;
  direction: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  status: string | null;
  route?: { name?: string; origin?: string; destination?: string };
}

const STATUS_PILL: Record<string, string> = {
  SCHEDULED:  'bg-blue-500/20 text-blue-300 border-blue-500/40',
  DEPARTED:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
  IN_TRANSIT: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  COMPLETED:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CANCELLED:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function DriverTodayPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driverCode, setDriverCode] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDriverCode(localStorage.getItem('busDriverCode') ?? '');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bus-ops/schedules');
      const data = res.ok ? await res.json() : [];
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
      const today = (Array.isArray(data) ? data : []).filter((t: Trip) => {
        const d = new Date(t.departureTime);
        return d >= todayStart && d < todayEnd;
      });
      // Optional driver filter: if user pinned a driver code locally, narrow.
      const filtered = driverCode
        ? today.filter((t: Trip) => t.driverId === driverCode)
        : today;
      filtered.sort((a: Trip, b: Trip) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime());
      setTrips(filtered);
    } finally {
      setLoading(false);
    }
  }, [driverCode]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, kind: 'depart' | 'complete') => {
    setBusy(id + kind); setError(null);
    try {
      const body = kind === 'depart'
        ? { departureTime: new Date().toISOString(), startMileage: prompt('Start odometer (km)') ?? null, loggedBy: driverCode || null }
        : { arrivalTime: new Date().toISOString(), endMileage: prompt('End odometer (km)') ?? null, fuelUsed: prompt('Fuel used (L) — optional') ?? null, loggedBy: driverCode || null };
      const res = await fetch(`/api/bus-ops/schedules/${id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (res.status === 412 && kind === 'depart') {
          throw new Error('Safety check required first — tap "🛡 Safety Check" above.');
        }
        throw new Error(d.error ?? 'Action failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-slate-500">Loading today's trips…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Today's Trips</h1>
        <p className="text-sm text-slate-400">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
          {driverCode ? ` · driver ${driverCode}` : ''}
        </p>
      </div>

      {!driverCode && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200">
          No driver code set — showing all today's trips. Pin your code in <Link href="/bus-ops/driver/profile" className="underline">Me</Link> to filter.
        </div>
      )}

      {error && <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">{error}</div>}

      {trips.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No trips scheduled for today{driverCode ? ' on your code' : ''}.
        </div>
      ) : (
        <div className="space-y-3">
          {trips.map(t => {
            const status = (t.status ?? 'SCHEDULED').toUpperCase();
            const isBusy = busy?.startsWith(t.id);
            return (
              <div key={t.id} className="rounded-2xl bg-slate-800/60 border border-white/10 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-violet-300">{t.tripNumber ?? t.id.slice(0, 8)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_PILL[status]}`}>{status}</span>
                      {t.shiftType && <span className="text-[10px] text-slate-400 uppercase tracking-wide">{t.shiftType}</span>}
                    </div>
                    <div className="text-base font-semibold mt-1 truncate">
                      {t.route?.name ?? 'Route'}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      {t.route?.origin ?? '?'} → {t.route?.destination ?? '?'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold">{fmtTime(t.departureTime)}</div>
                    <div className="text-[10px] text-slate-500 uppercase">depart</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>👥 {t.confirmedCount ?? 0}/{t.capacity ?? '—'}</span>
                  <span>{t.direction ?? '—'}</span>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Link
                    href={`/bus-ops/driver/trip/${t.id}`}
                    className="flex-1 text-center py-2.5 rounded-xl border border-white/10 bg-slate-900/40 text-sm hover:bg-slate-900/70"
                  >
                    Manifest
                  </Link>
                  {status === 'SCHEDULED' && (
                    <>
                      <Link
                        href={`/bus-ops/driver/trip/${t.id}/pretrip`}
                        className="flex-1 text-center py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm"
                      >
                        🛡 Safety Check
                      </Link>
                      <button
                        onClick={() => action(t.id, 'depart')}
                        disabled={isBusy}
                        className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm disabled:opacity-50"
                      >
                        🚌 Depart
                      </button>
                    </>
                  )}
                  {(status === 'DEPARTED' || status === 'IN_TRANSIT') && (
                    <button
                      onClick={() => action(t.id, 'complete')}
                      disabled={isBusy}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50"
                    >
                      ✓ Arrive
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
