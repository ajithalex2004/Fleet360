/**
 * src/app/(driver)/driver-app/behavior/page.tsx
 *
 * Live driver-behaviour scoring page. Wraps the offline behaviour
 * watcher with React state and renders:
 *   - The continuous-driving CBA alert card (NEW — see below)
 *   - The current score (0..100)
 *   - A summary chip row (harsh brake, harsh accel, speeding, idle)
 *   - A live event log (most recent first)
 *
 * The driver cannot start or simulate the watcher from this page —
 * the watcher is started automatically when a trip begins (trip
 * dispatcher / trip-status websocket is the trigger; that's a
 * roadmap item, see docs/DRIVER_MOBILE_APP_ROADMAP.md). The only
 * control shown to the driver is a "Stop" button that becomes
 * visible while a watcher is running, so the driver can pause
 * monitoring if they need to.
 *
 * Events are written to IndexedDB and queued for sync. The score
 * is computed entirely client-side from the in-memory event list.
 *
 * Continuous-driving card (top of the page)
 * ─────────────────────────────────────────
 * Driven by the tenant's CBA rule `MAX_DRIVING_HOURS_CONTINUOUS`
 * (default 4.5h). Counts time since the shift started (or since the
 * last IDLE_END event from the behaviour watcher — when it fires,
 * the counter resets). The card is colour-coded:
 *   green  (0-80% of limit)  — no alert
 *   yellow (80-100%)         — "break soon"
 *   orange (100-120%)        — "over the limit"
 *   red    (>120%)           — "stop driving now"
 *
 * Source: src/lib/driver-offline/continuous-driving-watcher.ts +
 *         src/hooks/useContinuousDriving.ts +
 *         /api/driver-app/cba/continuous-driving-limit
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';
import { getCurrentShift } from '@/lib/driver-session-client';
import {
  type BehaviorEvent,
  type BehaviorScore,
  type BehaviorWatcher,
} from '@/lib/driver-offline/behavior-watcher';
import { ALERT_LEVEL_META } from '@/lib/driver-offline/continuous-driving-watcher';
import { useContinuousDriving } from '@/hooks/useContinuousDriving';

const TYPE_ICONS: Record<BehaviorEvent['type'], string> = {
  HARSH_BRAKE: '🛑',
  HARSH_ACCEL: '⚡',
  SPEEDING: '🏎',
  IDLE_START: '⏸',
  IDLE_END: '▶',
};

const TYPE_LABELS: Record<BehaviorEvent['type'], string> = {
  HARSH_BRAKE: 'Harsh brake',
  HARSH_ACCEL: 'Harsh acceleration',
  SPEEDING: 'Speeding',
  IDLE_START: 'Idle started',
  IDLE_END: 'Idle ended',
};

const TYPE_COLORS: Record<BehaviorEvent['type'], string> = {
  HARSH_BRAKE: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  HARSH_ACCEL: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  SPEEDING:   'border-amber-500/40 bg-amber-500/10 text-amber-200',
  IDLE_START:  'border-slate-500/30 bg-slate-700/30 text-slate-200',
  IDLE_END:    'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
};

const ZERO_SCORE: BehaviorScore = {
  score: 100,
  harshBrake: 0,
  harshAccel: 0,
  speeding: 0,
  idleMinutes: 0,
  totalDistanceKm: 0,
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-300';
  if (score >= 60) return 'text-amber-300';
  if (score >= 40) return 'text-orange-300';
  return 'text-rose-300';
}

function scoreRingColor(score: number): string {
  if (score >= 80) return 'stroke-emerald-400';
  if (score >= 60) return 'stroke-amber-400';
  if (score >= 40) return 'stroke-orange-400';
  return 'stroke-rose-400';
}

function BehaviorInner() {
  const params = useSearchParams();
  const tripId = params?.get('tripId') ?? undefined;

  const [score, setScore] = useState<BehaviorScore>(ZERO_SCORE);
  const [events, setEvents] = useState<BehaviorEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'idle' | 'live' | 'simulated'>('idle');
  const [shiftId, setShiftId] = useState<string | undefined>(undefined);
  const [driverId, setDriverId] = useState<string>('');
  const [tenantId, setTenantId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const watcherRef = useRef<BehaviorWatcher | null>(null);
  const eventsRef = useRef<BehaviorEvent[]>([]);

  // Pull the driver + tenant + shift from the session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentShift();
        if (cancelled) return;
        if (ctx) {
          setDriverId(ctx.driverId);
          setTenantId(ctx.tenantId);
          setShiftId(ctx.shiftId ?? undefined);
        }
      } catch {
        // ignore — UI will show a "not signed in" message
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Score arc: how much of the circle to draw for the score
  const arcDasharray = 2 * Math.PI * 50; // r=50
  const arcDashoffset = arcDasharray * (1 - score.score / 100);

  // Stop button — only shown if a watcher is currently running.
  // In production the watcher is started automatically by trip
  // events; this is the driver's panic-stop.
  const stop = useCallback(() => {
    if (watcherRef.current) {
      watcherRef.current.stop();
      watcherRef.current = null;
    }
    setRunning(false);
    setMode('idle');
  }, []);

  // Continuous-driving CBA watcher — colour-coded break alert at top
  // of the page. Resets when the driver takes a break (we hook
  // IDLE_END events from the behavior watcher once it starts; for
  // the demo a manual "I took a break" button is shown so the alert
  // can be exercised without a moving vehicle).
  const driving = useContinuousDriving({
    onLevelChange: (prev, next) => {
      // Best-effort side effect: log to console (will be replaced
      // with a toast / vibration once the driver app has a global
      // notification system — see DRIVER_MOBILE_APP_ROADMAP.md).
      if (typeof console !== 'undefined' && next !== 'ok') {
        console.info(`[continuous-driving] level changed: ${prev} → ${next}`);
      }
    },
  });

  const handleBreakTaken = useCallback(() => {
    driving.notifyBreakEnded();
  }, [driving]);

  // Format a duration in ms as "Hh Mm" (e.g. 16200000 → "4h 30m")
  const formatH = useCallback((ms: number): string => {
    const totalMin = Math.max(0, Math.floor(ms / 60_000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              {mode === 'live' && '● Live GPS · '}
              {mode === 'simulated' && '● Simulated · '}
              {mode === 'idle' && '○ Idle · '}
              Driver behaviour
            </div>
            <div className="text-xl font-bold text-white truncate">Score & events</div>
          </div>
          {running && (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-500/20"
            >
              ⏹ Stop
            </button>
          )}
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {/* Continuous-driving CBA alert (drives the "take a break" notification) */}
        {driving.state && (
          <section
            data-testid="continuous-driving-card"
            data-level={driving.state.level}
            className={`rounded-2xl border p-4 ${
              driving.state.level === 'ok'       ? 'border-emerald-500/30 bg-emerald-500/5' :
              driving.state.level === 'warning'  ? 'border-amber-500/30 bg-amber-500/10' :
              driving.state.level === 'critical' ? 'border-orange-500/30 bg-orange-500/10' :
                                                   'border-rose-500/50 bg-rose-500/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">
                  {ALERT_LEVEL_META[driving.state.level].emoji}
                </span>
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wider ${
                    driving.state.level === 'ok'       ? 'text-emerald-300' :
                    driving.state.level === 'warning'  ? 'text-amber-300' :
                    driving.state.level === 'critical' ? 'text-orange-300' :
                                                         'text-rose-300'
                  }`}>
                    Continuous driving
                  </div>
                  <div className="text-base font-semibold text-white">
                    {driving.state.levelLabel}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-bold text-white">
                  {formatH(driving.state.drivingMs)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  of {formatH(driving.state.limitMs)} CBA limit
                </div>
              </div>
            </div>
            {/* Progress bar — fills green→amber→orange→rose as the driver approaches / passes the limit */}
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full transition-all duration-500 ${
                  driving.state.level === 'ok'       ? 'bg-emerald-400' :
                  driving.state.level === 'warning'  ? 'bg-amber-400' :
                  driving.state.level === 'critical' ? 'bg-orange-400' :
                                                       'bg-rose-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, driving.state.ratio * 80))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
              <span>
                {driving.state.msUntilLimit > 0
                  ? `${formatH(driving.state.msUntilLimit)} until break required`
                  : `${formatH(-driving.state.msUntilLimit)} past the limit`}
              </span>
              <span className="text-slate-500">
                {driving.source === 'CBA'
                  ? `CBA · ${driving.rule?.name ?? 'continuous driving'}`
                  : 'Platform default'}
              </span>
            </div>
            {(driving.state.level === 'warning' || driving.state.level === 'critical' || driving.state.level === 'breach') && (
              <button
                type="button"
                onClick={handleBreakTaken}
                data-testid="break-taken-btn"
                className="mt-3 w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-500"
              >
                ☕ I just took a break — reset counter
              </button>
            )}
          </section>
        )}
        {driving.loading && !driving.state && (
          <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-center text-xs text-slate-500">
            Loading CBA limit…
          </section>
        )}
        {driving.err && (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            ⚠ Continuous-driving alert unavailable: {driving.err}
          </section>
        )}

        {/* Score ring */}
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-6">
          <div className="flex items-center justify-center">
            <div className="relative h-40 w-40">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="50" fill="none"
                  className={scoreRingColor(score.score)}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={arcDasharray}
                  strokeDashoffset={arcDashoffset}
                  style={{ transition: 'stroke-dashoffset 300ms ease, stroke 200ms ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className={`text-4xl font-bold ${scoreColor(score.score)}`}>
                  {Math.round(score.score)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">/ 100</div>
              </div>
            </div>
          </div>

          {/* Summary chips */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
            <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-rose-300">
              🛑 {score.harshBrake} harsh brake
            </span>
            <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-rose-300">
              ⚡ {score.harshAccel} harsh accel
            </span>
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-300">
              🏎 {score.speeding} speeding
            </span>
            <span className="rounded-full bg-slate-700/50 px-2.5 py-1 text-slate-300">
              ⏸ {score.idleMinutes}m idle
            </span>
            <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-sky-300">
              📍 {score.totalDistanceKm} km
            </span>
          </div>
        </section>

        {err && (
          <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        {!driverId && !err && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Loading session… (or sign in via the launcher if you haven't)
          </div>
        )}

        {events.length === 0 && running && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-3 text-sm text-slate-400">
            Watching for events… GPS samples arrive at 1Hz.
          </div>
        )}

        {/* Event log */}
        {events.length > 0 && (
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Events ({events.length})
            </h2>
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li
                  key={e.id}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${TYPE_COLORS[e.type]}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{TYPE_ICONS[e.type]}</span>
                    <div>
                      <div className="font-medium">{TYPE_LABELS[e.type]}</div>
                      {e.note && (
                        <div className="text-[11px] text-slate-400">{e.note}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-slate-400">
                    {e.speedKph != null && <div>{e.speedKph.toFixed(0)} km/h</div>}
                    <div>{new Date(e.occurredAt).toLocaleTimeString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

export default function BehaviorPage() {
  return (
    <React.Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Loading…</div>}>
      <BehaviorInner />
    </React.Suspense>
  );
}
