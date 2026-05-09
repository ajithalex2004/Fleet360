'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

interface Trip {
  passengerId: string;
  status: string;
  boardedAt: string | null;
  boardingStop: string | null;
  alightingStop: string | null;
  trip: {
    id: string;
    tripNumber: string | null;
    departureTime: string;
    arrivalTime: string | null;
    shiftType: string | null;
    direction: string | null;
    status: string | null;
    vehicleId: string | null;
    route: { name?: string; origin?: string; destination?: string };
    bleBeaconUuid: string | null;
  };
}

interface Today {
  staff: { id: string; name: string; employeeId: string; department: string | null; defaultStopName: string | null };
  trips: Trip[];
  rfidTag: { tagUid: string } | null;
}

const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  BOARDED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  ABSENT:    'bg-amber-500/20 text-amber-300 border-amber-500/40',
  NO_SHOW:   'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function relativeFromNow(iso: string): string {
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (diff < -1) return `departed ${Math.abs(diff)}m ago`;
  if (diff < 1) return `now`;
  if (diff < 60) return `in ${diff}m`;
  const hrs = Math.floor(diff / 60);
  return `in ${hrs}h ${diff % 60}m`;
}

function PassengerHomeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const incomingQr = sp.get('qr');
  const [today, setToday] = useState<Today | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (eid: string) => {
    if (!eid) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/bus-ops/passenger/today?employeeId=${encodeURIComponent(eid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed');
      setToday(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
      setToday(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const eid = localStorage.getItem('busPassengerEmployeeId') ?? '';
    setEmployeeId(eid);
    load(eid);
  }, [load]);

  // QR-scan deep link: ?qr=<token>. Once we have the staff loaded, find the
  // matching passenger row and route into the board flow with the token.
  useEffect(() => {
    if (!incomingQr || !today || today.trips.length === 0) return;
    const parts = incomingQr.split('.');
    if (parts.length !== 3) return;
    const tokenScheduleId = parts[0];
    const match = today.trips.find(t => t.trip.id === tokenScheduleId);
    if (match) {
      router.replace(`/bus-ops/passenger/board?passengerId=${match.passengerId}&scheduleId=${match.trip.id}&qrToken=${encodeURIComponent(incomingQr)}${match.trip.bleBeaconUuid ? `&beacon=${match.trip.bleBeaconUuid}` : ''}`);
    }
  }, [incomingQr, today, router]);

  if (!employeeId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My Bus</h1>
        <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-5">
          <p className="text-sm text-slate-300 mb-3">
            Pin your employee ID first so this app can find your trips. Stored on this device only.
          </p>
          <Link href="/bus-ops/passenger/profile" className="block w-full text-center py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold">
            Set Employee ID →
          </Link>
        </div>
      </div>
    );
  }

  if (loading) return <div className="text-slate-500">Loading…</div>;

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My Bus</h1>
        <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">{error}</div>
        <Link href="/bus-ops/passenger/profile" className="block text-center text-sm text-cyan-400 underline">
          Re-check your employee ID
        </Link>
      </div>
    );
  }

  if (!today) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{today.staff.name?.split(' ')[0] ?? 'Hi'}</h1>
        <p className="text-sm text-slate-400">
          {today.staff.department ? `${today.staff.department} · ` : ''}{today.staff.employeeId}
        </p>
      </div>

      {today.trips.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-sm text-slate-400 space-y-3">
          <p>No bus trips on your manifest today.</p>
          <Link
            href="/bus-ops/passenger/waitlist"
            className="inline-block px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold"
          >
            Join a waitlist
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {today.trips.map(t => {
            const status = t.status;
            const trip = t.trip;
            const tStatus = (trip.status ?? 'SCHEDULED').toUpperCase();
            const canBoard = ['CONFIRMED'].includes(status) && ['SCHEDULED', 'DEPARTED', 'IN_TRANSIT'].includes(tStatus);
            return (
              <div key={t.passengerId} className="rounded-2xl bg-slate-800/60 border border-white/10 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-cyan-300">{trip.tripNumber ?? trip.id.slice(0, 8)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_PILL[status]}`}>{status}</span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wide">{trip.shiftType ?? '—'} · {trip.direction ?? '—'}</span>
                    </div>
                    <div className="text-base font-semibold mt-1 truncate">{trip.route?.name ?? 'Route'}</div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      {trip.route?.origin} → {trip.route?.destination}
                    </div>
                    {t.boardingStop && (
                      <div className="text-xs text-slate-400 mt-1">📍 Stop: <span className="text-slate-200">{t.boardingStop}</span></div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold">{fmtTime(trip.departureTime)}</div>
                    <div className="text-[10px] text-slate-500 uppercase">{relativeFromNow(trip.departureTime)}</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  {canBoard ? (
                    <Link
                      href={`/bus-ops/passenger/board?passengerId=${t.passengerId}&scheduleId=${trip.id}${trip.bleBeaconUuid ? `&beacon=${trip.bleBeaconUuid}` : ''}`}
                      className="flex-1 text-center py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    >
                      ✓ Board
                    </Link>
                  ) : (
                    <div className="flex-1 text-center py-3 rounded-xl bg-slate-700/60 text-slate-400 text-sm">
                      {status === 'BOARDED' ? `Boarded at ${t.boardedAt ? fmtTime(t.boardedAt) : ''}` : status}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4 text-xs text-slate-400">
        Boarding methods: BLE auto-detect → QR scan → manual tap. Need to skip a day? <Link href="/bus-ops/passenger/absence" className="text-cyan-400">Mark absence</Link>.
      </div>
    </div>
  );
}

export default function PassengerHomePage() {
  return (
    <React.Suspense fallback={<div className="text-slate-500">Loading…</div>}>
      <PassengerHomeInner />
    </React.Suspense>
  );
}
