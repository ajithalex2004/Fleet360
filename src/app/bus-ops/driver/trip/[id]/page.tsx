'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';

interface Passenger {
  id: string;
  staffMemberId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  boardingStopName: string | null;
  alightingStopName: string | null;
  boardedAt: string | null;
  status: string | null;
}

interface Trip {
  id: string;
  tripNumber: string | null;
  departureTime: string;
  status: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  route?: { name?: string; origin?: string; destination?: string };
}

const STATUS_OPTIONS = ['CONFIRMED', 'BOARDED', 'ABSENT', 'NO_SHOW'] as const;
const STATUS_BG: Record<string, string> = {
  CONFIRMED: 'bg-blue-500/20 text-blue-200 border-blue-500/40',
  BOARDED:   'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  ABSENT:    'bg-amber-500/20 text-amber-200 border-amber-500/40',
  NO_SHOW:   'bg-rose-500/20 text-rose-200 border-rose-500/40',
};

export default function DriverTripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending'>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        fetch(`/api/bus-ops/schedules/${id}`),
        fetch(`/api/bus-ops/schedules/${id}/passengers`),
      ]);
      if (tRes.ok) setTrip(await tRes.json());
      if (pRes.ok) setPassengers(await pRes.json());
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (passenger: Passenger, newStatus: typeof STATUS_OPTIONS[number]) => {
    setBusy(passenger.id);
    try {
      const res = await fetch(`/api/bus-ops/passengers/${passenger.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          boardedAt: newStatus === 'BOARDED' ? new Date().toISOString() : null,
        }),
      });
      if (!res.ok) {
        alert('Failed to update');
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-slate-500">Loading…</div>;
  if (!trip) return <div className="text-rose-400">Trip not found</div>;

  const visible = filter === 'pending'
    ? passengers.filter(p => (p.status ?? 'CONFIRMED') === 'CONFIRMED')
    : passengers;

  const counts = passengers.reduce<Record<string, number>>((acc, p) => {
    const s = p.status ?? 'CONFIRMED';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/bus-ops/driver" className="text-xs text-violet-400 hover:underline">← Today's trips</Link>
        <div className="flex gap-2">
          <a
            href={`/api/bus-ops/schedules/${id}/manifest/pdf?lang=en&download=1`}
            target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300"
          >
            Manifest · EN
          </a>
          <a
            href={`/api/bus-ops/schedules/${id}/manifest/pdf?lang=ar&download=1`}
            target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300"
          >
            Manifest · AR
          </a>
          <Link href={`/bus-ops/driver/trip/${id}/qr`} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/40 text-violet-300">
            Show QR
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-violet-300">{trip.tripNumber ?? trip.id.slice(0, 8)}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{trip.status ?? '—'}</span>
        </div>
        <div className="text-lg font-bold mt-1">{trip.route?.name ?? 'Route'}</div>
        <div className="text-xs text-slate-400">
          {trip.route?.origin} → {trip.route?.destination} · depart {new Date(trip.departureTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="Confirmed" value={counts.CONFIRMED ?? 0} />
        <Stat label="Boarded" value={counts.BOARDED ?? 0} accent="emerald" />
        <Stat label="Absent" value={counts.ABSENT ?? 0} accent="amber" />
        <Stat label="No-show" value={counts.NO_SHOW ?? 0} accent="rose" />
      </div>

      <div className="inline-flex rounded-xl bg-slate-800/60 border border-white/10 p-1 w-full">
        <button
          onClick={() => setFilter('pending')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium ${filter === 'pending' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
        >
          Pending boarding
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium ${filter === 'all' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
        >
          All ({passengers.length})
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="p-6 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-sm text-slate-400">
          {filter === 'pending' ? '✓ All passengers accounted for.' : 'No passengers on this trip.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(p => {
            const status = p.status ?? 'CONFIRMED';
            const isBusy = busy === p.id;
            return (
              <div key={p.id} className="p-3 rounded-xl bg-slate-800/40 border border-white/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.employeeName ?? '—'}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {p.employeeId ? `#${p.employeeId}` : ''} {p.department ? ` · ${p.department}` : ''}
                    </div>
                    {p.boardingStopName && (
                      <div className="text-[11px] text-slate-500 mt-0.5">📍 {p.boardingStopName}</div>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_BG[status]}`}>{status}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 mt-2">
                  {(['BOARDED', 'ABSENT', 'NO_SHOW'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatus(p, s)}
                      disabled={isBusy || status === s}
                      className={`py-2 rounded-lg text-[11px] font-medium border ${
                        status === s
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-slate-900/40 border-white/10 text-slate-300 hover:bg-slate-900/70'
                      } disabled:opacity-50`}
                    >
                      {s === 'BOARDED' ? '✓ Board' : s === 'ABSENT' ? 'Absent' : 'No-show'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = 'slate' }: { label: string; value: number; accent?: string }) {
  const cls: Record<string, string> = { slate: 'text-white', emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' };
  return (
    <div className="rounded-xl bg-slate-800/60 border border-white/10 p-2">
      <div className={`text-2xl font-bold ${cls[accent]}`}>{value}</div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}
