/**
 * src/app/(driver)/driver-app/navigate/page.tsx
 *
 * STUB — Turn-by-turn navigation with route stops.
 *
 * Real implementation needs:
 *   - A native maps SDK: Mapbox (recommended, see prior turn) with
 *     the iOS / Android SDKs, not the JS one. The Capacitor Mapbox
 *     plugin (https://github.com/ionic-team/capacitor-mapbox) is the
 *     path. JS Mapbox GL doesn't have access to background location
 *     updates, which a turn-by-turn nav app needs.
 *   - A route fetch from the dispatcher (a Trip with ordered stops).
 *     We pull from the offline trip cache; if the driver has never
 *     been online since the trip was assigned, this falls back to
 *     stale data.
 *   - Background geolocation: `@capacitor/geolocation` with
 *     `watchPosition` + iOS UIBackgroundModes / Android foreground
 *     service. Critical for keeping the route line + driver position
 *     updating when the screen is off.
 *   - Voice instructions: text-to-speech via `@capacitor/text-to-speech`
 *     or a native plugin; the JS Web Speech API is unreliable on
 *     mobile WebViews.
 *   - Stop arrival detection: geofence-radius check around each
 *     stop's lat/lng; the existing `route_stops.geofence_radius_m`
 *     column is the right value. Fires `markStopArrived` in the
 *     offline DB.
 *   - Re-routing on deviation: when the driver is > 200m off the
 *     route, call `/api/driver-app/replan` and re-render the polyline.
 *
 * The data flow is already wired:
 *   - Trip cache: `getTrip(id)` from `lib/driver-offline/db`
 *   - Stop arrival: `enqueueStopArrival` from `lib/driver-offline/sync`
 *   - Behaviour events: `enqueueBehaviorEvent` from `lib/driver-offline/sync`
 *
 * What this stub shows: the stop list, current position (one-shot
 * geolocation), and the actions a real nav page would take on each
 * stop. The map is a static "STUB" placeholder so the driver can
 * verify the page is reachable and the data flow is correct.
 */

'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';
import { getTrip, markStopArrived, type OfflineTrip } from '@/lib/driver-offline/db';
import { enqueueStopArrival, forceDrain } from '@/lib/driver-offline/sync';
import { getCurrentPosition } from '@/lib/driver-offline/capacitor';

function NavigateInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = params?.get('tripId') ?? '';

  const [trip, setTrip] = useState<OfflineTrip | null | undefined>(undefined);
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  useEffect(() => {
    (async () => {
      if (!tripId) { setTrip(null); return; }
      const t = await getTrip(tripId);
      setTrip(t ?? null);
    })();
  }, [tripId]);

  useEffect(() => {
    (async () => {
      const p = await getCurrentPosition();
      setPos(p);
    })();
  }, []);

  const onStopArrived = useCallback(async (stopId: string) => {
    const at = new Date().toISOString();
    if (tripId) {
      await markStopArrived(tripId, stopId, at);
      await enqueueStopArrival(tripId, stopId, at);
      void forceDrain();
    }
    // Optimistically update the visible state
    setTrip((prev) => prev ? {
      ...prev,
      stops: prev.stops.map((s) => s.id === stopId ? { ...s, arrivedAt: at } : s),
    } : prev);
  }, [tripId]);

  if (trip === undefined) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="absolute left-2 top-2">
          <BackButton />
        </div>
        Loading trip…
      </div>
    );
  }
  if (trip === null) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-center">
        <div className="absolute left-2 top-2 self-start">
          <BackButton />
        </div>
        <div className="text-rose-300">Trip not found in offline cache.</div>
        <div className="mt-2 text-xs text-slate-500">It hasn't been synced yet — connect to the internet and try again.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Navigate</div>
            <div className="truncate text-base font-semibold text-white">{trip.routeName}</div>
          </div>
        </div>
      </header>

      {/* Map placeholder. Replace with a real Mapbox native view. */}
      <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-slate-800 to-slate-900">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 text-center backdrop-blur">
            <div className="text-3xl">🗺️</div>
            <div className="mt-2 text-sm text-slate-300">Map view (stub)</div>
            <div className="mt-1 text-[11px] text-slate-500">Native Mapbox SDK — see DRIVER_MOBILE_APP_ROADMAP.md</div>
          </div>
        </div>
        {pos && (
          <div className="absolute bottom-2 left-2 rounded bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300">
            📍 {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} (±{Math.round(pos.accuracy)}m)
          </div>
        )}
      </div>

      <main className="px-4 py-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">Stops</h2>
        <ol className="space-y-2">
          {trip.stops.map((s, i) => (
            <li key={s.id} className={`rounded-xl border p-3 ${
              s.arrivedAt ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-slate-900'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Stop {i + 1}</div>
                  <div className="text-sm font-semibold text-white">{s.name}</div>
                  {s.estimatedArrival && (
                    <div className="text-[11px] text-slate-400">ETA {s.estimatedArrival}</div>
                  )}
                </div>
                {s.arrivedAt ? (
                  <div className="text-xs text-emerald-300">
                    ✓ {new Date(s.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onStopArrived(s.id)}
                    className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500"
                  >
                    Mark arrived
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}

export default function NavigatePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Loading…</div>}>
      <NavigateInner />
    </Suspense>
  );
}
