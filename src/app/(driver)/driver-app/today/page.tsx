/**
 * src/app/(driver)/driver-app/today/page.tsx
 *
 * Driver's home screen — the first thing they see after login.
 *
 * Shows the current trip assignment, a "Start pre-trip inspection"
 * CTA, a sync-status badge, and a trip roster fetched from the
 * server. The roster is the source of truth for online mode; the
 * IndexedDB cache (driver-offline/db.ts) is the offline fallback.
 *
 * Each trip card carries a per-trip behaviour score (#14 in the
 * roadmap) — see /api/driver-app/today/assignments for the
 * computation. The score is colour-coded: green ≥ 80, amber
 * 60-79, red < 60. No score yet = neutral (grey) pending.
 */

'use client';

import React, { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getAllTrips, type OfflineTrip } from '@/lib/driver-offline/db';
import { syncSummary, forceDrain } from '@/lib/driver-offline/sync';
import { BackButton } from '@/components/driver-app/BackButton';
import { ALERT_LEVEL_META } from '@/lib/driver-offline/continuous-driving-watcher';
import { useContinuousDriving } from '@/hooks/useContinuousDriving';
import {
  startButtonState,
  timingChipClass,
  type TripStatus,
  type StartButtonState,
} from '@/lib/trip-state';
import {
  createAutoLifecycle,
  type AutoLifecycleHandle,
  type LatLng,
} from '@/lib/driver-offline/auto-lifecycle';

interface ServerTrip {
  id: string;
  status: string;
  departureTime: string;
  arrivalTime: string;
  direction: string | null;
  tripNumber: string | null;
  routeId: string;
  routeName: string | null;
  vehiclePlate: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  // Driver-controlled lifecycle
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  startedByDriverId: string | null;
  endedByDriverId: string | null;
  lateMinutes: number | null;
  durationMinutes: number | null;
  score: {
    score: number;
    harshBrake: number;
    harshAccel: number;
    speeding: number;
    idleMinutes: number;
  };
  eventCount: number;
}

function scoreColor(score: number | null): { bg: string; text: string; ring: string; label: string } {
  if (score == null) {
    return { bg: 'bg-slate-500/15', text: 'text-slate-300', ring: 'ring-slate-500/30', label: '—' };
  }
  if (score >= 80) return { bg: 'bg-emerald-500/15', text: 'text-emerald-300', ring: 'ring-emerald-500/30', label: String(score) };
  if (score >= 60) return { bg: 'bg-amber-500/15',   text: 'text-amber-300',   ring: 'ring-amber-500/30',   label: String(score) };
  return                     { bg: 'bg-rose-500/15',   text: 'text-rose-300',    ring: 'ring-rose-500/30',    label: String(score) };
}

function statusBadge(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case 'COMPLETED':   return { bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Completed' };
    case 'IN_PROGRESS': return { bg: 'bg-amber-500/15',   text: 'text-amber-300',   label: 'In progress' };
    case 'CANCELLED':   return { bg: 'bg-rose-500/15',    text: 'text-rose-300',    label: 'Cancelled' };
    case 'AUTO_CLOSED': return { bg: 'bg-slate-500/15',   text: 'text-slate-300',   label: 'Auto-closed' };
    case 'SCHEDULED':   return { bg: 'bg-sky-500/15',     text: 'text-sky-300',     label: 'Scheduled' };
    default:            return { bg: 'bg-slate-500/15',   text: 'text-slate-300',   label: status };
  }
}

/** Best-effort one-shot GPS. Returns null silently on failure. */
function captureLocationAsync(timeoutMs: number): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
      }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 5000, enableHighAccuracy: false },
    );
  });
}

function TodayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const justSubmittedDvir = params?.get('dvir') ?? null;

  const [offlineTrips, setOfflineTrips] = useState<OfflineTrip[] | null>(null);
  const [serverTrips, setServerTrips] = useState<ServerTrip[] | null | undefined>(undefined);
  const [sync, setSync] = useState<{ queued: number; failed: number; oldestAgeMs: number | null } | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  // Stable SSR/client header date — `en-GB` always formats "Thursday 6 Aug"
  // (no comma) so the server and client agree.
  const headerDate = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    return `${weekday} ${day} ${month}`;
  }, [now]);
  // Per-tenant feature flags (DVIR is opt-in — see /api/driver-app/feature-flags)
  const [dvirEnabled, setDvirEnabled] = useState<boolean>(false);
  // Per-trip pending state (while Start/End is in flight)
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Auto-lifecycle: when the vehicle leaves the origin geofence, the
  // trip should auto-start; when it enters the destination, auto-end.
  // The watchers are owned by refs so they survive renders.
  const autoWatchersRef = useRef<Map<string, AutoLifecycleHandle>>(new Map());
  // Per-trip toast when an auto-transition fires (so the driver
  // sees what happened — "Trip auto-started at 14:32")
  const [autoToasts, setAutoToasts] = useState<Array<{ id: string; tripId: string; text: string; at: number }>>([]);

  // Continuous-driving CBA alert (tenant-configured via the
  // MAX_DRIVING_HOURS_CONTINUOUS rule). Shown as a chip in the
  // header and as a full-screen banner when the limit is breached.
  const driving = useContinuousDriving({
    onLevelChange: (prev, next, s) => {
      if (next === 'breach' || (next === 'critical' && prev === 'ok')) {
        // Show a one-shot toast so the driver sees the alert even
        // if they're scrolled past the header.
        setAutoToasts((t) => [...t, {
          id: `cd-${Date.now()}`,
          tripId: '',
          text: `⏱ Continuous driving: ${(s.drivingMs / 3600000).toFixed(1)}h — ${s.levelLabel}`,
          at: Date.now(),
        }]);
      }
    },
  });
  const formatH = useCallback((ms: number): string => {
    const totalMin = Math.max(0, Math.floor(ms / 60_000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, []);

  const refresh = useCallback(async () => {
    const all = await getAllTrips();
    setOfflineTrips(all);
    setSync(await syncSummary());
  }, []);

  // Fetch the server roster
  const fetchRoster = useCallback(async () => {
    try {
      const r = await fetch('/api/driver-app/today/assignments', { credentials: 'include' });
      if (!r.ok) {
        setServerTrips(null);
        return;
      }
      const data = await r.json();
      setServerTrips(data.trips ?? []);
    } catch {
      setServerTrips(null);
    }
  }, []);

  // Fetch feature flags. Default = dvir disabled. The endpoint is
  // private-cached 5 min, so this is cheap to call on every page mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/driver-app/feature-flags', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setDvirEnabled(Boolean(data.dvirEnabled));
      } catch {
        // stay false
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void refresh();
    void fetchRoster();
  }, [refresh, fetchRoster]);

  // Keep "now" fresh so the dep/arr times are correct after a tab is left open
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Lifecycle action: tap Start or End on a trip. The button state
  // tells us which endpoint to hit. The API also rejects with 409
  // for invalid transitions — we show the server's reason to the
  // driver instead of swallowing it.
  const handleLifecycle = useCallback(async (tripId: string, action: 'START' | 'END') => {
    if (pending.has(tripId)) return;
    setPending((p) => new Set(p).add(tripId));
    try {
      // Best-effort: try to grab GPS at the moment of the tap. Don't
      // block the call on it — the API accepts (and stores) location
      // as optional.
      const loc = await captureLocationAsync(3000).catch(() => null);
      const r = await fetch(`/api/driver-app/trips/${tripId}/${action.toLowerCase()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loc ?? {}),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const reason = body.reason ?? body.error ?? `Failed (${r.status})`;
        window.alert(reason);
        return;
      }
      // Re-fetch the roster to pick up the new status + actual_*
      await fetchRoster();
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(tripId);
        return n;
      });
    }
  }, [pending, fetchRoster]);

  // Auto-lifecycle: for each SCHEDULED or IN_PROGRESS trip, fetch
  // the origin + destination geofences, start a watcher. The
  // watcher fires onShouldStart when the vehicle leaves the origin
  // (and the trip is still SCHEDULED), or onShouldEnd when it
  // enters the destination (and the trip is IN_PROGRESS).
  useEffect(() => {
    if (!serverTrips) return;
    const active = (serverTrips ?? []).filter(
      (t) => t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS',
    );
    const live = new Set(active.map((t) => t.id));
    // Stop watchers for trips that are no longer active
    for (const [tripId, w] of autoWatchersRef.current.entries()) {
      if (!live.has(tripId)) {
        w.stop();
        autoWatchersRef.current.delete(tripId);
      }
    }
    // Start watchers for new active trips
    for (const t of active) {
      if (autoWatchersRef.current.has(t.id)) continue;
      void setupAutoWatcher(t);
    }
    return () => {
      // Don't tear down here — we manage lifecycle manually above
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTrips]);

  const setupAutoWatcher = useCallback(async (trip: ServerTrip) => {
    try {
      const r = await fetch(`/api/driver-app/trips/${trip.id}/geofences`, { credentials: 'include' });
      if (!r.ok) {
        // 422 (no stops) is expected for some routes — silent
        return;
      }
      const gf = await r.json();
      if (!gf.origin || !gf.destination) return;

      const watcher = createAutoLifecycle({
        tripId: trip.id,
        origin: { lat: gf.origin.lat, lng: gf.origin.lng, radiusM: gf.origin.radiusM, name: gf.origin.name },
        destination: { lat: gf.destination.lat, lng: gf.destination.lng, radiusM: gf.destination.radiusM, name: gf.destination.name },
        onShouldStart: (pos, distanceM) => {
          // Only auto-start if the trip is still SCHEDULED. The
          // server is the source of truth (it returns 409 if not).
          if (trip.status !== 'SCHEDULED') return;
          void autoTransition(trip.id, 'START', pos, distanceM);
        },
        onShouldEnd: (pos, distanceM) => {
          if (trip.status !== 'IN_PROGRESS') return;
          void autoTransition(trip.id, 'END', pos, distanceM);
        },
      });
      watcher.start();
      autoWatchersRef.current.set(trip.id, watcher);
    } catch (e) {
      console.warn('[auto-lifecycle] setup failed for trip', trip.id, e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire the start/end API as a result of an auto-lifecycle event.
  const autoTransition = useCallback(async (
    tripId: string,
    action: 'START' | 'END',
    pos: LatLng,
    distanceM: number,
  ) => {
    try {
      const r = await fetch(`/api/driver-app/trips/${tripId}/${action.toLowerCase()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          at: new Date().toISOString(),
          lat: pos.lat,
          lng: pos.lng,
          accuracyM: undefined,
        }),
      });
      if (r.ok) {
        const label = action === 'START' ? 'auto-started' : 'auto-ended';
        const detail = action === 'START'
          ? `Vehicle left the origin (${Math.round(distanceM)} m away)`
          : `Vehicle reached the destination (within ${Math.round(distanceM)} m)`;
        setAutoToasts((t) => [...t, {
          id: `${tripId}-${action}-${Date.now()}`,
          tripId,
          text: `Trip ${label} · ${detail}`,
          at: Date.now(),
        }]);
        // Re-fetch the roster so the UI reflects the new state
        await fetchRoster();
      }
      // 409 etc. — the trip status doesn't match; the watcher
      // already fired, just silently skip. Next time the user
      // opens the page, the roster is the source of truth.
    } catch (e) {
      console.warn(`[auto-lifecycle] ${action} failed for trip`, tripId, e);
    }
  }, [fetchRoster]);

  // Cleanup all watchers on unmount
  useEffect(() => {
    const watchers = autoWatchersRef.current;
    return () => {
      for (const w of watchers.values()) w.stop();
      watchers.clear();
    };
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Today</div>
            <div className="text-xl font-bold text-white truncate">
              {headerDate}
            </div>
          </div>
          {/* Continuous-driving CBA chip — color-coded, click for details */}
          {driving.state && (
            <button
              type="button"
              data-testid="continuous-driving-chip"
              data-level={driving.state.level}
              onClick={() => router.push('/driver-app/behavior')}
              title={`${driving.state.levelLabel} · ${formatH(driving.state.drivingMs)} of ${formatH(driving.state.limitMs)} CBA limit`}
              className={`flex flex-col items-end rounded-lg px-3 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                driving.state.level === 'ok'       ? 'bg-emerald-500/15 text-emerald-200' :
                driving.state.level === 'warning'  ? 'bg-amber-500/15 text-amber-200' :
                driving.state.level === 'critical' ? 'bg-orange-500/15 text-orange-200' :
                                                     'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40 animate-pulse'
              }`}
            >
              <span>{ALERT_LEVEL_META[driving.state.level].emoji} {driving.state.levelLabel}</span>
              <span className="font-mono text-[10px] opacity-80">
                {formatH(driving.state.drivingMs)} / {formatH(driving.state.limitMs)}
              </span>
            </button>
          )}
          {sync && (sync.queued > 0 || sync.failed > 0) && (
            <button
              type="button"
              onClick={() => void forceDrain().then(refresh)}
              className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-200"
            >
              {sync.queued} queued
              {sync.failed > 0 && ` · ${sync.failed} failed`}
            </button>
          )}
        </div>
      </header>

      <main className="px-4 py-4">
        {/* Continuous-driving breach modal — full-screen blocker when
            the driver is well past the CBA limit. The driver can
            dismiss after acknowledging, but it re-appears on the
            next level change. */}
        {driving.state && driving.state.level === 'breach' && (
          <div
            data-testid="continuous-driving-breach-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          >
            <div className="w-full max-w-md rounded-2xl border-2 border-rose-500/60 bg-rose-500/15 p-6 text-center shadow-2xl shadow-rose-900/40">
              <div className="text-5xl">🚨</div>
              <h2 className="mt-3 text-2xl font-bold text-white">Take a break now</h2>
              <p className="mt-2 text-sm text-rose-100">
                You have been driving continuously for{' '}
                <span className="font-mono font-bold">{formatH(driving.state.drivingMs)}</span>.
                The CBA limit is{' '}
                <span className="font-mono font-bold">{formatH(driving.state.limitMs)}</span> —
                you are{' '}
                <span className="font-mono font-bold">
                  {formatH(-driving.state.msUntilLimit)}
                </span>{' '}
                over.
              </p>
              <p className="mt-3 text-xs text-rose-200/80">
                {driving.source === 'CBA'
                  ? `This limit is from your tenant's CBA: ${driving.rule?.name ?? 'continuous driving'}.`
                  : 'Platform default limit (no CBA configured for this tenant).'}
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => driving.notifyBreakEnded()}
                  className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  ☕ I just took a break
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/driver-app/behavior')}
                  className="flex-1 rounded-xl bg-slate-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-600"
                >
                  View details
                </button>
              </div>
            </div>
          </div>
        )}

        {justSubmittedDvir && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            ✓ Inspection recorded. Will sync when online.
          </div>
        )}

        {/* Auto-lifecycle toasts. The trip's status changed because
            the vehicle left the origin / entered the destination
            geofence (not the driver tapping the button). */}
        {autoToasts.length > 0 && (
          <div className="mb-4 space-y-2">
            {autoToasts.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200"
              >
                <span>🛰 {t.text}</span>
                <button
                  type="button"
                  onClick={() => setAutoToasts((all) => all.filter((x) => x.id !== t.id))}
                  className="ml-3 text-sky-400 hover:text-sky-200"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Primary CTA: Driver Checklist (shift-level). Always visible
            but the canonical entry point is at login, from the Menu.
            If the driver needs to re-check or update their checklist
            mid-shift (e.g. "I missed something"), this is the path. */}
        <button
          type="button"
          onClick={() => router.push('/driver-app/shift-checklist')}
          className="mb-4 flex w-full items-center justify-between rounded-2xl border border-violet-500/30 bg-violet-600/15 px-4 py-4 text-left transition hover:bg-violet-600/25"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600 text-xl">
              🛡️
            </div>
            <div>
              <div className="text-base font-semibold text-white">Driver Checklist</div>
              <div className="text-xs text-slate-400">18-point shift inspection · done at login</div>
            </div>
          </div>
          <div className="text-violet-300">→</div>
        </button>

        {/* Quick-access grid — same shape as the menu page so the
            driver can always find what they need from the home
            screen. */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => router.push('/driver-app/fuel-entry')}
            className="rounded-2xl border border-white/10 bg-slate-900 p-3 text-left transition hover:bg-slate-800"
          >
            <div className="mb-1 text-xl">⛽</div>
            <div className="text-xs font-semibold text-white">Fuel entry</div>
          </button>
          <button
            type="button"
            onClick={() => router.push('/driver-app/expenses')}
            className="rounded-2xl border border-white/10 bg-slate-900 p-3 text-left transition hover:bg-slate-800"
          >
            <div className="mb-1 text-xl">🧾</div>
            <div className="text-xs font-semibold text-white">Expenses</div>
          </button>
          <button
            type="button"
            onClick={() => router.push('/driver-app/menu')}
            className="rounded-2xl border border-white/10 bg-slate-900 p-3 text-left transition hover:bg-slate-800"
          >
            <div className="mb-1 text-xl">📋</div>
            <div className="text-xs font-semibold text-white">Menu</div>
          </button>
        </div>

        {serverTrips === undefined && offlineTrips === null && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">Loading your assignments…</div>
        )}

        {/* Empty state — show whether the server returned nothing or
            just hasn't responded yet. The driver is never stuck. */}
        {serverTrips != null && serverTrips.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">
            No trips assigned for today. Use the buttons above to start a DVIR or test the demo screens.
          </div>
        )}

        <div className="space-y-3">
          {serverTrips?.map((t) => {
            const s = scoreColor(t.eventCount > 0 ? t.score.score : null);
            const sb = statusBadge(t.status);
            const depTime = new Date(t.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const arrTime = new Date(t.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const lifecycle = startButtonState({
              status: t.status as TripStatus,
              scheduledDeparture: t.departureTime,
              actualDeparture: t.actualDepartureAt,
              actualArrival: t.actualArrivalAt,
              durationMinutes: t.durationMinutes,
            });
            return (
              <article key={t.id} className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wider text-slate-400">
                      {t.routeName ?? t.routeId.slice(0, 8)}
                      {t.tripNumber ? ` · Trip ${t.tripNumber}` : ''}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {depTime} → {arrTime}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {t.vehiclePlate ? `${t.vehiclePlate} · ` : ''}
                      {t.capacity != null && t.confirmedCount != null
                        ? `${t.confirmedCount}/${t.capacity} confirmed`
                        : t.capacity != null
                        ? `${t.capacity} seats`
                        : ''}
                      {t.direction ? ` · ${t.direction.toLowerCase()}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${sb.bg} ${sb.text}`}>
                      {sb.label}
                    </span>
                    {t.eventCount > 0 && (
                      <div
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${s.bg} ${s.text} ${s.ring}`}
                        title={`${t.score.harshBrake} harsh brake · ${t.score.harshAccel} harsh accel · ${t.score.speeding} speeding · ${t.score.idleMinutes}m idle`}
                      >
                        <span className="text-base font-bold leading-none">{s.label}</span>
                        <span className="text-[9px] uppercase tracking-wider opacity-70">score</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Scheduled vs Actual readout — only shown once
                    actual_departure_at is set. This is what makes
                    the "late / on time / early" classification
                    visible to the driver. */}
                {t.actualDepartureAt && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-black/30 px-3 py-2 text-xs">
                    <span className="text-slate-400">Scheduled {depTime}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-400">
                      Actual {new Date(t.actualDepartureAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {lifecycle.timing !== 'unknown' && (
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${timingChipClass(lifecycle.timing)}`}>
                        {lifecycle.timing === 'on_time' ? 'On time' : lifecycle.timing === 'late' ? `Late ${lifecycle.deltaMinutes}m` : `Early ${Math.abs(lifecycle.deltaMinutes)}m`}
                      </span>
                    )}
                    {t.durationMinutes != null && (
                      <span className="ml-auto text-slate-500">⏱ {t.durationMinutes} min</span>
                    )}
                  </div>
                )}

                {/* Lifecycle button — the only thing that flips the
                    status. The driver owns this. */}
                {lifecycle.action && (
                  <button
                    type="button"
                    disabled={pending.has(t.id)}
                    onClick={() => lifecycle.action && handleLifecycle(t.id, lifecycle.action)}
                    className={
                      lifecycle.variant === 'primary'
                        ? 'mt-3 w-full rounded-xl bg-violet-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50'
                        : lifecycle.variant === 'secondary'
                        ? 'mt-3 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-base font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50'
                        : 'mt-3 w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-base font-semibold text-slate-400 disabled:opacity-50'
                    }
                  >
                    {pending.has(t.id) ? 'Working…' : lifecycle.label}
                  </button>
                )}
                {lifecycle.helperLine && (
                  <p className="mt-1.5 text-center text-[11px] text-slate-500">
                    {lifecycle.helperLine}
                  </p>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {/* Top row — the actions a driver uses during a trip */}
                  <button
                    type="button"
                    onClick={() => router.push(`/driver-app/navigate?tripId=${t.id}`)}
                    className="rounded-xl border border-white/10 bg-slate-800 px-3 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Navigate
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/driver-app/behavior?tripId=${t.id}`)}
                    className="rounded-xl border border-white/10 bg-slate-800 px-3 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    My score
                  </button>
                  {/* Bottom row — DVIR is opt-in per tenant. Disabled
                      with a clear explanation when the tenant hasn't
                      enabled it. */}
                  <button
                    type="button"
                    disabled={!dvirEnabled}
                    onClick={() => router.push(`/driver-app/dvirs/new?tripId=${t.id}&type=PRE_TRIP`)}
                    title={dvirEnabled ? undefined : 'DVIR is not enabled for your tenant. Contact your dispatcher.'}
                    className="rounded-xl bg-violet-600 px-3 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:hover:bg-slate-800"
                  >
                    Pre-trip DVIR
                  </button>
                  <button
                    type="button"
                    disabled={!dvirEnabled}
                    onClick={() => router.push(`/driver-app/dvirs/new?tripId=${t.id}&type=POST_TRIP`)}
                    title={dvirEnabled ? undefined : 'DVIR is not enabled for your tenant. Contact your dispatcher.'}
                    className="rounded-xl border border-white/10 bg-slate-800 px-3 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-slate-900 disabled:text-slate-500 disabled:hover:bg-slate-900"
                  >
                    Post-trip DVIR
                  </button>
                </div>
              </article>
            );
          })}

          {/* Offline fallback — only show if server returned nothing or
              failed AND the local cache has today's trips. The
              roster-sync roadmap item will populate this for real. */}
          {serverTrips != null && serverTrips.length === 0 && (offlineTrips ?? []).filter((t) => {
            const dep = new Date(t.scheduledDeparture);
            return dep.toDateString() === now.toDateString();
          }).map((t) => (
            <article key={'offline-' + t.id} className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 opacity-75">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400">Cached · {t.routeName}</div>
                  <div className="text-lg font-semibold text-white">
                    {t.origin} → {t.destination}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {new Date(t.scheduledDeparture).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {t.vehiclePlate && ` · ${t.vehiclePlate}`}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Loading…</div>}>
      <TodayInner />
    </Suspense>
  );
}
