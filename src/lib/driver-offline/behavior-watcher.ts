/**
 * lib/driver-offline/behavior-watcher.ts
 *
 * Real-time driver-behaviour scoring. Watches the device's GPS at 1Hz
 * during a trip, classifies harsh events from speed / position
 * deltas, and persists them to the IndexedDB behavior_events store
 * (which the sync engine drains to /api/driver-app/behavior-events).
 *
 * Event classification (fleet-telematics standard thresholds):
 *   - HARSH_BRAKE  : decel > 5 km/h/s (driver braked hard)
 *   - HARSH_ACCEL  : accel > 4 km/h/s (driver floored it)
 *   - SPEEDING     : speed > 90 km/h for > 3 s (configurable per route)
 *   - IDLE_START   : speed < 2 km/h for > 60 s
 *   - IDLE_END     : speed > 5 km/h
 *
 * Score formula (start at 100, floor at 0):
 *   -5  per HARSH_BRAKE
 *   -5  per HARSH_ACCEL
 *   -2  per minute of IDLE (derived from IDLE_START/IDLE_END pair)
 *   -0.5 per km/h over the speed limit, integrated over time
 *
 * Usage:
 *   const w = createBehaviorWatcher({ tripId, shiftId, ... });
 *   w.start();    // begins watching GPS
 *   w.stop();     // cleans up
 *   w.on('event', (e) => { ... });   // subscribe to events
 *   w.on('score', (s) => { ... });   // subscribe to score updates
 *   w.getScore();                    // current score
 *
 * The browser's Geolocation API only gives us position + speed. For
 * inertial data (proper acceleration) you'd need a native plugin.
 * Fleet telematics mostly uses GPS-derived speed deltas anyway, so
 * this approximation is industry-standard.
 */

import { newId, putBehaviorEvent, type OfflineBehaviorEvent } from './db';
import { enqueueBehaviorEvent } from './sync';

// Classification thresholds (km/h per second). The fleet-telematics
// industry uses these as the standard defaults; per-tenant config
// is a roadmap item.
const HARSH_BRAKE_THRESHOLD = 5;   // decel > 5 km/h/s
const HARSH_ACCEL_THRESHOLD = 4;   // accel > 4 km/h/s
const SPEED_LIMIT_KPH = 90;        // configurable per route in the future
const SPEEDING_DURATION_MS = 3000; // 3 s over the limit
const IDLE_SPEED_KPH = 2;          // below this = idle
const IDLE_DURATION_MS = 60_000;    // 60 s of low speed = idle event
const IDLE_END_SPEED_KPH = 5;       // above this = idle ends

// Harsh event type enum. Matches the CHECK constraint on
// behavior_events.type in the DB schema.
export type BehaviorEventType =
  | 'HARSH_BRAKE'
  | 'HARSH_ACCEL'
  | 'SPEEDING'
  | 'IDLE_START'
  | 'IDLE_END';

export interface BehaviorEvent {
  id: string;
  type: BehaviorEventType;
  /** km/h/s for brake/accel; km/h over limit for speeding; null for idle */
  value: number | null;
  /** Reported GPS speed at the time of the event, in km/h */
  speedKph: number | null;
  /** GPS position at event time */
  lat: number | null;
  lng: number | null;
  note?: string;
  occurredAt: number;  // ms-since-epoch
}

export interface BehaviorWatcherOptions {
  tripId?: string;
  shiftId?: string;
  driverId: string;
  tenantId: string;
  speedLimitKph?: number;  // override default
}

export interface BehaviorScore {
  score: number;          // 0..100
  harshBrake: number;
  harshAccel: number;
  speeding: number;
  idleMinutes: number;
  totalDistanceKm: number;
}

type Listener<T> = (value: T) => void;

export interface BehaviorWatcher {
  start(): void;
  stop(): void;
  onEvent(fn: Listener<BehaviorEvent>): () => void;
  onScore(fn: Listener<BehaviorScore>): () => void;
  getScore(): BehaviorScore;
  injectPosition(lat: number, lng: number, speedKph: number, timestampMs?: number): void;
  /** True if the watcher is currently running (watching GPS or receiving injected positions) */
  isRunning(): boolean;
}

interface InternalState {
  events: BehaviorEvent[];
  /** The most recent GPS sample, used for delta computations. */
  last: { lat: number; lng: number; speedKph: number; ts: number } | null;
  /** IDLE state machine. We open an IDLE_START when speed stays low
   *  for IDLE_DURATION_MS; IDLE_END fires when speed climbs back up. */
  idleOpenedAt: number | null;
  /** SPEEDING state machine. We open a SPEEDING event when speed
   *  stays over the limit for SPEEDING_DURATION_MS. The event is
   *  recorded once, and the "still speeding" is just a UI state. */
  speedingOpenedAt: number | null;
  /** Track when the last "speed update" came in for the
   *  IDLE/SPEEDING timers. If the speed never changes, the timer
   *  wouldn't fire — we use a small wall-clock ping. */
  lastSampleAt: number;
  /** Total distance driven (sum of haversines between consecutive samples). */
  totalDistanceKm: number;
}

const ZERO_SCORE: BehaviorScore = {
  score: 100,
  harshBrake: 0,
  harshAccel: 0,
  speeding: 0,
  idleMinutes: 0,
  totalDistanceKm: 0,
};

/** Haversine distance between two lat/lng points, in km. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Pure speed-delta classifier. Returns the event to record, or null. */
function classify(prev: { speedKph: number; ts: number } | null, cur: {
  lat: number;
  lng: number;
  speedKph: number;
  ts: number;
}, state: InternalState, speedLimit: number): BehaviorEvent | null {
  // First sample: nothing to compare against.
  if (!prev) return null;
  const dtSec = Math.max(0.5, (cur.ts - prev.ts) / 1000); // floor at 0.5s for divide-by-zero
  const dSpeed = cur.speedKph - prev.speedKph;
  const decel = -dSpeed / dtSec;       // positive when slowing
  const accel = dSpeed / dtSec;        // positive when speeding up

  // Harsh events are based on speed delta, not GPS position
  // (GPS position jitter would cause false positives).
  if (decel > HARSH_BRAKE_THRESHOLD) {
    return {
      id: newId(),
      type: 'HARSH_BRAKE',
      value: Math.round(decel * 100) / 100,
      speedKph: cur.speedKph,
      lat: cur.lat, lng: cur.lng,
      note: `decel ${decel.toFixed(1)} km/h/s`,
      occurredAt: cur.ts,
    };
  }
  if (accel > HARSH_ACCEL_THRESHOLD) {
    return {
      id: newId(),
      type: 'HARSH_ACCEL',
      value: Math.round(accel * 100) / 100,
      speedKph: cur.speedKph,
      lat: cur.lat, lng: cur.lng,
      note: `accel ${accel.toFixed(1)} km/h/s`,
      occurredAt: cur.ts,
    };
  }
  return null;
}

export function createBehaviorWatcher(opts: BehaviorWatcherOptions): BehaviorWatcher {
  const speedLimit = opts.speedLimitKph ?? SPEED_LIMIT_KPH;
  const state: InternalState = {
    events: [],
    last: null,
    idleOpenedAt: null,
    speedingOpenedAt: null,
    lastSampleAt: 0,
    totalDistanceKm: 0,
  };

  const eventListeners = new Set<Listener<BehaviorEvent>>();
  const scoreListeners = new Set<Listener<BehaviorScore>>();

  const computeScore = (): BehaviorScore => {
    let harshBrake = 0;
    let harshAccel = 0;
    let speeding = 0;
    let idleMs = 0;
    let speedingSeconds = 0;

    // Walk the events in order. IDLE_START / IDLE_END are pairs.
    let openIdle: number | null = null;
    for (const e of state.events) {
      if (e.type === 'HARSH_BRAKE') harshBrake++;
      else if (e.type === 'HARSH_ACCEL') harshAccel++;
      else if (e.type === 'SPEEDING') speeding++;
      else if (e.type === 'IDLE_START') openIdle = e.occurredAt;
      else if (e.type === 'IDLE_END' && openIdle != null) {
        idleMs += e.occurredAt - openIdle;
        openIdle = null;
      }
    }
    // If the trip ended while still idle, close the interval
    if (openIdle != null && state.last) {
      idleMs += state.last.ts - openIdle;
    }
    const idleMinutes = Math.round(idleMs / 60_000);
    const score = Math.max(
      0,
      100 - 5 * harshBrake - 5 * harshAccel - 2 * idleMinutes - 0.5 * speedingSeconds,
    );
    return {
      score,
      harshBrake,
      harshAccel,
      speeding,
      idleMinutes,
      totalDistanceKm: Math.round(state.totalDistanceKm * 10) / 10,
    };
  };

  const fireEvent = (e: BehaviorEvent) => {
    state.events.push(e);
    // Also persist to IndexedDB + enqueue to sync queue. Both fire
    // best-effort — the live UI doesn't depend on persistence, and
    // the sync engine will drain the queue when the network returns.
    const offline: OfflineBehaviorEvent = {
      id: e.id,
      tripId: opts.tripId ?? null,
      shiftId: opts.shiftId ?? null,
      driverId: opts.driverId,
      tenantId: opts.tenantId,
      type: e.type,
      value: e.value,
      speedKmh: e.speedKph,
      lat: e.lat,
      lng: e.lng,
      note: e.note ?? null,
      occurredAt: new Date(e.occurredAt).toISOString(),
      status: 'PENDING_SYNC',
      enqueuedAt: Date.now(),
      lastSyncError: null,
    };
    void Promise.all([
      putBehaviorEvent(offline).catch(() => { /* best-effort */ }),
      enqueueBehaviorEvent({
        id: e.id,
        tripId: opts.tripId ?? null,
        shiftId: opts.shiftId ?? null,
        driverId: opts.driverId,
        tenantId: opts.tenantId,
        type: e.type,
        value: e.value,
        lat: e.lat,
        lng: e.lng,
        speedKmh: e.speedKph,
        note: e.note ?? null,
        occurredAt: new Date(e.occurredAt).toISOString(),
      }).catch(() => { /* best-effort */ }),
    ]);
    eventListeners.forEach((fn) => fn(e));
    scoreListeners.forEach((fn) => fn(computeScore()));
  };

  const process = (lat: number, lng: number, speedKph: number, ts: number) => {
    const cur = { lat, lng, speedKph, ts };
    if (state.last) {
      state.totalDistanceKm += haversineKm(state.last.lat, state.last.lng, lat, lng);
    }
    // Run delta-based classification
    const deltaEvent = classify(state.last, cur, state, speedLimit);
    if (deltaEvent) fireEvent(deltaEvent);

    // IDLE state machine
    if (speedKph < IDLE_SPEED_KPH) {
      if (state.idleOpenedAt == null) state.idleOpenedAt = ts;
      if (ts - state.idleOpenedAt >= IDLE_DURATION_MS) {
        fireEvent({
          id: newId(),
          type: 'IDLE_START',
          value: null,
          speedKph,
          lat, lng,
          note: `idle for ${Math.round((ts - state.idleOpenedAt) / 1000)} s`,
          occurredAt: ts,
        });
        // Reset so we don't keep firing IDLE_START
        state.idleOpenedAt = null;
      }
    } else {
      if (state.idleOpenedAt != null) {
        // Speed came back up before the 60s threshold. Don't fire
        // IDLE_START (the engine was a false positive).
        state.idleOpenedAt = null;
      }
    }
    if (state.idleOpenedAt == null && speedKph > IDLE_END_SPEED_KPH) {
      // If we recently fired IDLE_START, close it with IDLE_END.
      const last = state.events[state.events.length - 1];
      if (last?.type === 'IDLE_START') {
        fireEvent({
          id: newId(),
          type: 'IDLE_END',
          value: null,
          speedKph,
          lat, lng,
          occurredAt: ts,
        });
      }
    }

    // SPEEDING state machine
    if (speedKph > speedLimit) {
      if (state.speedingOpenedAt == null) state.speedingOpenedAt = ts;
      if (
        ts - state.speedingOpenedAt >= SPEEDING_DURATION_MS &&
        state.events[state.events.length - 1]?.type !== 'SPEEDING'
      ) {
        fireEvent({
          id: newId(),
          type: 'SPEEDING',
          value: Math.round((speedKph - speedLimit) * 10) / 10,
          speedKph,
          lat, lng,
          note: `+${Math.round(speedKph - speedLimit)} km/h over limit`,
          occurredAt: ts,
        });
        // Don't re-fire on every sample; the "still speeding" state
        // is implicit until speed drops below the limit.
      }
    } else {
      // Speed came back under the limit. Allow re-firing on next
      // speeding event.
      state.speedingOpenedAt = null;
    }

    state.last = cur;
    state.lastSampleAt = ts;
  };

  let watchId: number | null = null;
  let running = false;

  const start = () => {
    if (running) return;
    running = true;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const speedKph = (pos.coords.speed ?? 0) * 3.6; // m/s -> km/h
        process(pos.coords.latitude, pos.coords.longitude, speedKph, pos.timestamp || Date.now());
      },
      () => { /* ignore — simulator injection still works */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5_000 },
    );
  };

  const stop = () => {
    running = false;
    if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    // Close any open idle interval
    if (state.idleOpenedAt != null && state.last) {
      fireEvent({
        id: newId(),
        type: 'IDLE_END',
        value: null,
        speedKph: 0,
        lat: state.last.lat, lng: state.last.lng,
        occurredAt: state.last.ts,
      });
      state.idleOpenedAt = null;
    }
  };

  return {
    start,
    stop,
    onEvent: (fn) => { eventListeners.add(fn); return () => eventListeners.delete(fn); },
    onScore: (fn) => { scoreListeners.add(fn); return () => scoreListeners.delete(fn); },
    getScore: () => computeScore(),
    /** Used by the simulate-drive controller to inject samples. */
    injectPosition: (lat, lng, speedKph, ts) => {
      if (!running) running = true; // implicit "running" for injected mode
      process(lat, lng, speedKph, ts ?? Date.now());
    },
    isRunning: () => running,
  };
}
