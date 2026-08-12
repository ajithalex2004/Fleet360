/**
 * src/lib/driver-offline/auto-lifecycle.ts
 *
 * Auto-lifecycle watcher: starts a trip when the vehicle has
 * physically left the origin geofence, ends it when the vehicle
 * has entered the destination geofence. Catches the
 * "driver forgot to tap Start/End" case without human action.
 *
 * Geofence model:
 *   - Origin stop has a `radiusM` (default 100 m). If the driver
 *     is more than that distance from the origin AND the trip is
 *     still SCHEDULED, the watcher fires `onShouldStart`.
 *   - Destination stop has a `radiusM` (default 100 m). If the
 *     driver is closer than that to the destination AND the trip
 *     is IN_PROGRESS, the watcher fires `onShouldEnd`.
 *
 * Position source: the browser's `navigator.geolocation.watchPosition`
 * at 1 Hz by default. For tests / demos, `injectPosition()` lets
 * you feed synthetic fixes.
 *
 * The watcher is intentionally NOT a long-running background
 * service — it runs only while the today page (or a trip-detail
 * page) is open. Production would promote this to a Capacitor
 * foreground service on Android or a significant-change service
 * on iOS. The watcher is designed so the swap is just a different
 * `getCurrentPosition` implementation.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface AutoLifecycleOptions {
  tripId: string;
  origin: LatLng & { radiusM: number; name?: string | null };
  destination: LatLng & { radiusM: number; name?: string | null };
  /** Called when the vehicle has left the origin geofence. */
  onShouldStart: (position: LatLng, distanceFromOriginM: number) => void;
  /** Called when the vehicle has entered the destination geofence. */
  onShouldEnd: (position: LatLng, distanceToDestinationM: number) => void;
  /** Position source. Defaults to navigator.geolocation.watchPosition. */
  watchPosition?: (handlers: WatchHandlers) => () => void;
}

export interface WatchHandlers {
  onPosition: (pos: LatLng) => void;
  onError?: (err: GeolocationPositionError | Error) => void;
}

export interface AutoLifecycleHandle {
  start(): void;
  stop(): void;
  injectPosition(pos: LatLng): void;
  isRunning(): boolean;
  getStatus(): AutoLifecycleStatus;
  /** Forces a one-shot re-check using the last known position. */
  poke(): void;
}

export interface AutoLifecycleStatus {
  running: boolean;
  lastPosition: LatLng | null;
  distanceFromOriginM: number | null;
  distanceToDestinationM: number | null;
  fired: { start: boolean; end: boolean };
}

// ──────────────────────────────────────────────────────────────────────
// Geometry — Haversine distance
// ──────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// ──────────────────────────────────────────────────────────────────────
// Default position source: navigator.geolocation
// ──────────────────────────────────────────────────────────────────────

function browserWatchPosition(handlers: WatchHandlers): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    // Caller is server-side or browser doesn't support geolocation —
    // return a noop. The watcher stays idle until `injectPosition`
    // is called (which is how tests and the demo will work).
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => handlers.onPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    }),
    (err) => handlers.onError?.(err),
    { enableHighAccuracy: true, maximumAge: 2_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

// ──────────────────────────────────────────────────────────────────────
// createAutoLifecycle
// ──────────────────────────────────────────────────────────────────────

export function createAutoLifecycle(opts: AutoLifecycleOptions): AutoLifecycleHandle {
  let running = false;
  let lastPosition: LatLng | null = null;
  let distanceFromOrigin: number | null = null;
  let distanceToDestination: number | null = null;
  const fired = { start: false, end: false };
  let clearWatch: (() => void) | null = null;

  const evaluate = (pos: LatLng) => {
    lastPosition = pos;
    distanceFromOrigin = haversineMeters(pos, opts.origin);
    distanceToDestination = haversineMeters(pos, opts.destination);

    // SCHEDULED → fired once when the vehicle has left the origin
    if (!fired.start && distanceFromOrigin > opts.origin.radiusM) {
      fired.start = true;
      try {
        opts.onShouldStart(pos, distanceFromOrigin);
      } catch (e) {
        // Swallow — the host page may not be ready yet
        console.warn('[auto-lifecycle] onShouldStart threw:', e);
      }
    }
    // IN_PROGRESS → fired once when the vehicle has entered the
    // destination geofence.
    if (!fired.end && distanceToDestination < opts.destination.radiusM) {
      fired.end = true;
      try {
        opts.onShouldEnd(pos, distanceToDestination);
      } catch (e) {
        console.warn('[auto-lifecycle] onShouldEnd threw:', e);
      }
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      fired.start = false;
      fired.end = false;
      const source = opts.watchPosition ?? browserWatchPosition;
      clearWatch = source({
        onPosition: (pos) => evaluate(pos),
        onError: (err) => console.warn('[auto-lifecycle] watch error:', err),
      });
    },

    stop() {
      if (!running) return;
      running = false;
      clearWatch?.();
      clearWatch = null;
    },

    injectPosition(pos: LatLng) {
      evaluate(pos);
    },

    isRunning() {
      return running;
    },

    getStatus() {
      return {
        running,
        lastPosition,
        distanceFromOriginM: distanceFromOrigin,
        distanceToDestinationM: distanceToDestination,
        fired: { ...fired },
      };
    },

    poke() {
      if (lastPosition) evaluate(lastPosition);
    },
  };
}
