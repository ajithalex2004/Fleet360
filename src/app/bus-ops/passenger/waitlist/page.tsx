'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface Trip {
  id: string;
  tripNumber: string | null;
  departureTime: string;
  shiftType: string | null;
  direction: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  status: string | null;
  route?: { name: string; origin: string; destination: string };
}

export default function PassengerWaitlistPage() {
  const [employeeId, setEmployeeId] = useState('');
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const eid = typeof window !== 'undefined' ? localStorage.getItem('busPassengerEmployeeId') : null;
    if (!eid) { setLoading(false); return; }
    setEmployeeId(eid);

    (async () => {
      try {
        const me = await fetch(`/api/bus-ops/passenger/today?employeeId=${encodeURIComponent(eid)}`).then(r => r.ok ? r.json() : null);
        setStaffMemberId(me?.staff?.id ?? null);

        // Fetch upcoming trips (next 3 days, SCHEDULED).
        const all = await fetch('/api/bus-ops/schedules').then(r => r.ok ? r.json() : []);
        const now = Date.now();
        const horizon = now + 3 * 86400000;
        const upcoming = (Array.isArray(all) ? all : [])
          .filter((t: Trip) => {
            const d = new Date(t.departureTime).getTime();
            return d >= now && d <= horizon && (t.status ?? 'SCHEDULED') === 'SCHEDULED';
          })
          .sort((a: Trip, b: Trip) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime())
          .slice(0, 20);
        setTrips(upcoming);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const join = async (trip: Trip) => {
    if (!staffMemberId) { setMsg({ kind: 'err', text: 'Profile not loaded.' }); return; }
    setJoining(trip.id); setMsg(null);
    try {
      const res = await fetch('/api/bus-ops/passenger/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffMemberId, tripId: trip.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Join failed');
      setMsg({ kind: 'ok', text: 'On the waitlist. You\'ll be notified by WhatsApp / email if a seat opens up.' });
      setTrips(prev => prev.filter(t => t.id !== trip.id));
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Join failed' });
    } finally {
      setJoining(null);
    }
  };

  if (!employeeId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Waitlist</h1>
        <Link href="/bus-ops/passenger/profile" className="block text-center py-3 rounded-xl bg-cyan-600 text-white">Set Employee ID first →</Link>
      </div>
    );
  }
  if (loading) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <Link href="/bus-ops/passenger" className="text-xs text-cyan-400 hover:underline">← My Bus</Link>
      <div>
        <h1 className="text-2xl font-bold">Join Waitlist</h1>
        <p className="text-sm text-slate-400">Pick a trip in the next 3 days. You'll auto-promote if a seat frees up.</p>
      </div>

      {msg && (
        <div className={`p-3 rounded-xl text-sm border ${msg.kind === 'ok' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200' : 'bg-rose-500/20 border-rose-500/40 text-rose-200'}`}>
          {msg.text}
        </div>
      )}

      {trips.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-sm text-slate-400">
          No SCHEDULED trips in the next 3 days.
        </div>
      ) : (
        <div className="space-y-2">
          {trips.map(t => {
            const filled = t.confirmedCount ?? 0;
            const cap = t.capacity ?? 0;
            const headroom = cap > 0 ? cap - filled : 0;
            return (
              <div key={t.id} className="rounded-2xl bg-slate-800/60 border border-white/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{t.route?.name ?? 'Route'}</div>
                    <div className="text-xs text-slate-400 truncate">{t.route?.origin} → {t.route?.destination}</div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {t.shiftType ?? '—'} · {t.direction ?? '—'} · {filled}/{cap || '—'} seats
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold">{new Date(t.departureTime).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
                <button
                  onClick={() => join(t)}
                  disabled={joining === t.id}
                  className="mt-3 w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {joining === t.id ? 'Joining…' : headroom > 0 ? `Request seat (${headroom} open)` : 'Join waitlist (full)'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
