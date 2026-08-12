/**
 * src/app/(driver)/driver-app/trip-history/page.tsx
 *
 * List of the driver's past trips (all statuses), with per-trip
 * summaries: route, vehicle, scheduled vs actual times, and counts
 * of DVIR / fuel / expense entries attached to each trip.
 *
 * For the demo, the trip roster endpoint (/api/driver-app/assignments)
 * doesn't exist yet, so this page will likely show "no trips" for
 * the admin login. The endpoint is ready for when real trips start
 * flowing.
 *
 * Linked from the menu's "Trip History" card.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';

interface TripSummary {
  id: string;
  tripNumber: string | null;
  departureTime: string;
  arrivalTime: string;
  status: string;
  shiftType: string | null;
  direction: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  vehicleId: string | null;
  vehiclePlate: string | null;
  dvirCount: number;
  fuelCount: number;
  expenseCount: number;
  expenseTotalMinor: number;
  expenseCurrency: string;
}

const STATUS_BADGES: Record<string, string> = {
  SCHEDULED: 'bg-sky-500/15 text-sky-300',
  BOARDING: 'bg-amber-500/15 text-amber-300',
  IN_PROGRESS: 'bg-violet-500/15 text-violet-300',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300',
  CANCELLED: 'bg-rose-500/15 text-rose-300',
  NO_SHOW: 'bg-slate-500/15 text-slate-400',
};

function formatMinor(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function TripHistoryPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = statusFilter
          ? `/api/driver-app/trips/history?status=${statusFilter}`
          : '/api/driver-app/trips/history';
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        const data = await r.json();
        if (cancelled) return;
        setTrips(data.trips);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'load failed');
      }
    })();
    return () => { cancelled = true; };
  }, [statusFilter]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Past</div>
            <div className="text-xl font-bold text-white truncate">Trip History</div>
          </div>
        </div>
      </header>

      <main className="space-y-3 px-4 py-4">
        {err && (
          <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {['', 'COMPLETED', 'IN_PROGRESS', 'CANCELLED'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === s
                  ? 'bg-violet-600 text-white'
                  : 'border border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        {trips === null && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">
            Loading…
          </div>
        )}

        {trips !== null && trips.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">
            No trips in your history. Trip roster sync is on the roadmap — for now, the admin app's trip scheduler is the source of truth.
          </div>
        )}

        {trips?.map((t) => (
          <article key={t.id} className="rounded-2xl border border-white/10 bg-slate-900 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">
                  {t.tripNumber ?? 'Trip'}
                  {t.shiftType && ` · ${t.shiftType}`}
                  {t.direction && ` · ${t.direction}`}
                </div>
                <div className="text-base font-semibold text-white">
                  {new Date(t.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' – '}
                  {new Date(t.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {new Date(t.departureTime).toLocaleDateString(undefined, {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}
                  {t.vehiclePlate && ` · ${t.vehiclePlate}`}
                  {t.capacity != null && ` · cap ${t.confirmedCount ?? 0}/${t.capacity}`}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGES[t.status] ?? 'bg-slate-500/15 text-slate-400'}`}>
                {t.status.replace('_', ' ')}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {t.dvirCount > 0 && (
                <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-300">
                  🛡️ {t.dvirCount} DVIR
                </span>
              )}
              {t.fuelCount > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                  ⛽ {t.fuelCount} fuel
                </span>
              )}
              {t.expenseCount > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                  🧾 {t.expenseCount} ({formatMinor(t.expenseTotalMinor, t.expenseCurrency)})
                </span>
              )}
              {t.dvirCount === 0 && t.fuelCount === 0 && t.expenseCount === 0 && (
                <span className="text-[11px] text-slate-500">No data captured yet</span>
              )}
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
