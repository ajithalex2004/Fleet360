/**
 * tests/unit/auto-lifecycle.test.ts
 *
 * Pins the auto-lifecycle contract:
 *   - haversine distance (Dubai coords as a sanity check)
 *   - origin geofence exit fires onShouldStart
 *   - destination geofence enter fires onShouldEnd
 *   - both events fire only ONCE per watcher instance
 *   - the watcher's injectPosition is a clean test seam
 *   - the watcher's start/stop is idempotent
 *
 * Run: npx vitest run tests/unit/auto-lifecycle.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAutoLifecycle,
  haversineMeters,
  type LatLng,
  type WatchHandlers,
  type AutoLifecycleOptions,
} from '@/lib/driver-offline/auto-lifecycle';

// Burj Khalifa → Dubai Mall: about 1.5 km south-east
const BURJ_KHALIFA: LatLng = { lat: 25.197197, lng: 55.274376 };
const DUBAI_MALL:   LatLng = { lat: 25.197525, lng: 55.279624 };

// A point ~250 m east of the origin (well outside the 100 m origin geofence)
const OUTSIDE_ORIGIN: LatLng = { lat: 25.197197, lng: 55.276876 };

// A point ~50 m from the destination (inside the 100 m destination geofence)
const NEAR_DESTINATION: LatLng = { lat: 25.197525, lng: 55.280075 };

function makeOptions(
  onStart: (pos: LatLng, d: number) => void,
  onEnd:   (pos: LatLng, d: number) => void,
): AutoLifecycleOptions {
  return {
    tripId: 'test-trip',
    origin: { ...BURJ_KHALIFA, radiusM: 100, name: 'Burj Khalifa' },
    destination: { ...DUBAI_MALL, radiusM: 100, name: 'Dubai Mall' },
    onShouldStart: onStart,
    onShouldEnd: onEnd,
    // Inject a no-op watch source so the watcher doesn't try to
    // use the browser's geolocation (which isn't available in vitest).
    watchPosition: (_handlers: WatchHandlers) => () => {},
  };
}

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMeters(BURJ_KHALIFA, BURJ_KHALIFA)).toBe(0);
  });

  it('Burj Khalifa → Dubai Mall is ~500 m (allowing GPS slop)', () => {
    const d = haversineMeters(BURJ_KHALIFA, DUBAI_MALL);
    // Real distance is about 526 m. Allow ±50 m.
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(600);
  });

  it('A → B → A is symmetric', () => {
    const a: LatLng = { lat: 25.0, lng: 55.0 };
    const b: LatLng = { lat: 25.001, lng: 55.002 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 3);
  });
});

describe('createAutoLifecycle', () => {
  it('is not running before start()', () => {
    const w = createAutoLifecycle(makeOptions(vi.fn(), vi.fn()));
    expect(w.isRunning()).toBe(false);
  });

  it('start() flips isRunning to true; stop() back to false', () => {
    const w = createAutoLifecycle(makeOptions(vi.fn(), vi.fn()));
    w.start();
    expect(w.isRunning()).toBe(true);
    w.stop();
    expect(w.isRunning()).toBe(false);
  });

  it('start() is idempotent — calling twice does not double-watch', () => {
    let watchCalls = 0;
    const opts = makeOptions(vi.fn(), vi.fn());
    opts.watchPosition = (_h: WatchHandlers) => {
      watchCalls++;
      return () => {};
    };
    const w = createAutoLifecycle(opts);
    w.start();
    w.start();
    w.start();
    expect(watchCalls).toBe(1);
  });

  it('does not fire onShouldStart when the driver is at the origin (within geofence)', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const w = createAutoLifecycle(makeOptions(onStart, onEnd));
    w.injectPosition({ ...BURJ_KHALIFA });
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('fires onShouldStart once when the driver moves outside the origin geofence', () => {
    const onStart = vi.fn();
    const w = createAutoLifecycle(makeOptions(onStart, vi.fn()));
    w.injectPosition({ ...OUTSIDE_ORIGIN });
    expect(onStart).toHaveBeenCalledTimes(1);
    const [pos, dist] = onStart.mock.calls[0];
    expect(pos.lat).toBe(OUTSIDE_ORIGIN.lat);
    expect(dist).toBeGreaterThan(100);
  });

  it('fires onShouldStart only ONCE even if the driver keeps moving', () => {
    const onStart = vi.fn();
    const w = createAutoLifecycle(makeOptions(onStart, vi.fn()));
    w.injectPosition({ ...OUTSIDE_ORIGIN });
    w.injectPosition({ ...OUTSIDE_ORIGIN, lng: 55.28 });
    w.injectPosition({ ...OUTSIDE_ORIGIN, lat: 25.20 });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('fires onShouldEnd once when the driver gets within the destination geofence', () => {
    const onEnd = vi.fn();
    const w = createAutoLifecycle(makeOptions(vi.fn(), onEnd));
    w.injectPosition({ ...NEAR_DESTINATION });
    expect(onEnd).toHaveBeenCalledTimes(1);
    const [pos, dist] = onEnd.mock.calls[0];
    expect(pos.lat).toBe(NEAR_DESTINATION.lat);
    expect(dist).toBeLessThan(100);
  });

  it('does not fire onShouldEnd when the driver is far from the destination', () => {
    const onEnd = vi.fn();
    const w = createAutoLifecycle(makeOptions(vi.fn(), onEnd));
    w.injectPosition({ ...BURJ_KHALIFA });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('fires both onShouldStart and onShouldEnd as the driver moves through the trip', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const w = createAutoLifecycle(makeOptions(onStart, onEnd));
    // 1) at the origin
    w.injectPosition({ ...BURJ_KHALIFA });
    expect(onStart).not.toHaveBeenCalled();
    // 2) left the origin
    w.injectPosition({ ...OUTSIDE_ORIGIN });
    expect(onStart).toHaveBeenCalledTimes(1);
    // 3) approached the destination
    w.injectPosition({ ...NEAR_DESTINATION });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('getStatus() exposes the last position + distances', () => {
    const w = createAutoLifecycle(makeOptions(vi.fn(), vi.fn()));
    w.injectPosition({ ...OUTSIDE_ORIGIN });
    const s = w.getStatus();
    expect(s.lastPosition).toEqual(OUTSIDE_ORIGIN);
    expect(s.distanceFromOriginM).toBeGreaterThan(100);
    expect(s.distanceToDestinationM).toBeGreaterThan(0);
    expect(s.fired.start).toBe(true);
  });

  it('stop() is idempotent and does not throw', () => {
    const w = createAutoLifecycle(makeOptions(vi.fn(), vi.fn()));
    w.start();
    w.stop();
    w.stop();
    expect(w.isRunning()).toBe(false);
  });

  it('respects a custom origin radius (large radius = harder to leave)', () => {
    const onStart = vi.fn();
    const opts = makeOptions(onStart, vi.fn());
    opts.origin.radiusM = 10_000; // 10 km — Burj → Dubai Mall doesn't trigger
    const w = createAutoLifecycle(opts);
    w.injectPosition({ ...DUBAI_MALL }); // ~500 m away, well within 10 km
    expect(onStart).not.toHaveBeenCalled();
  });
});
