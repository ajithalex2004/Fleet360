import { describe, expect, it } from 'vitest';
import {
  pointInCircle,
  distanceToCircleM,
  distanceToSegmentM,
  distanceToPolylineM,
  withinCorridor,
  evaluateGeofences,
  geofenceEventType,
  geofenceEventSeverity,
  geofenceEventTitle,
  circleToPolygon,
  type CircleFence,
  type CorridorFence,
} from '@/lib/logistics/geofence';

// Dubai coordinates. ~0.001 deg latitude ≈ 111m.
const STOP = { latitude: 25.2700, longitude: 55.3100 };

const pickupFence: CircleFence = { id: 'pu', kind: 'PICKUP', center: STOP, radiusM: 200, label: 'Jebel Ali' };

// ── circle geometry ────────────────────────────────────────────────────────

describe('pointInCircle / distanceToCircleM', () => {
  it('point at the centre is inside', () => {
    expect(pointInCircle(STOP, pickupFence)).toBe(true);
    expect(distanceToCircleM(STOP, pickupFence)).toBeLessThan(1);
  });

  it('point ~100m away is inside a 200m fence', () => {
    const near = { latitude: 25.2709, longitude: 55.3100 };  // ~100m north
    expect(pointInCircle(near, pickupFence)).toBe(true);
  });

  it('point ~330m away is outside a 200m fence', () => {
    const far = { latitude: 25.2730, longitude: 55.3100 };  // ~330m north
    expect(pointInCircle(far, pickupFence)).toBe(false);
    expect(distanceToCircleM(far, pickupFence)).toBeGreaterThan(200);
  });
});

// ── segment / polyline distance ────────────────────────────────────────────

describe('distanceToSegmentM', () => {
  const a = { latitude: 25.2700, longitude: 55.3100 };
  const b = { latitude: 25.2800, longitude: 55.3100 };  // ~1.1km due north

  it('returns ~0 for a point on the segment', () => {
    const mid = { latitude: 25.2750, longitude: 55.3100 };
    expect(distanceToSegmentM(mid, a, b)).toBeLessThan(2);
  });

  it('returns the perpendicular distance for a point beside the segment', () => {
    // ~100m east of the midpoint
    const beside = { latitude: 25.2750, longitude: 55.3110 };
    const d = distanceToSegmentM(beside, a, b);
    expect(d).toBeGreaterThan(80);
    expect(d).toBeLessThan(120);
  });

  it('clamps to the endpoint for a point beyond the segment end', () => {
    const beyond = { latitude: 25.2900, longitude: 55.3100 };  // ~1.1km past b
    const d = distanceToSegmentM(beyond, a, b);
    // distance to b, not an infinite-line projection
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1300);
  });

  it('handles a degenerate (zero-length) segment', () => {
    const d = distanceToSegmentM({ latitude: 25.2710, longitude: 55.3100 }, a, a);
    expect(d).toBeGreaterThan(100);  // distance to the single point
  });
});

describe('distanceToPolylineM / withinCorridor', () => {
  const polyline = [
    { latitude: 25.2700, longitude: 55.3100 },
    { latitude: 25.2800, longitude: 55.3100 },
    { latitude: 25.2800, longitude: 55.3200 },  // an L-shaped route
  ];
  const corridor: CorridorFence = { polyline, widthM: 150 };

  it('a point on the route is within the corridor', () => {
    expect(withinCorridor({ latitude: 25.2750, longitude: 55.3100 }, corridor)).toBe(true);
  });

  it('a point near the bend is within', () => {
    expect(withinCorridor({ latitude: 25.2800, longitude: 55.3150 }, corridor)).toBe(true);
  });

  it('a point 300m off the route is outside', () => {
    expect(withinCorridor({ latitude: 25.2750, longitude: 55.3130 }, corridor)).toBe(false);
  });

  it('takes the min distance across all segments', () => {
    const d = distanceToPolylineM({ latitude: 25.2800, longitude: 55.3150 }, polyline);
    expect(d).toBeLessThan(150);
  });

  it('no corridor (empty polyline) → always within', () => {
    expect(withinCorridor({ latitude: 0, longitude: 0 }, { polyline: [], widthM: 100 })).toBe(true);
  });
});

// ── transitions ─────────────────────────────────────────────────────────────

describe('evaluateGeofences — circle transitions', () => {
  const outside = { latitude: 25.2740, longitude: 55.3100 };  // ~440m N, outside 200m
  const inside = { latitude: 25.2705, longitude: 55.3100 };   // ~55m N, inside

  it('ENTER when crossing from outside to inside', () => {
    const ev = evaluateGeofences({ prev: outside, curr: inside, circles: [pickupFence] });
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('ENTER');
    expect((ev[0] as { fenceKind: string }).fenceKind).toBe('PICKUP');
  });

  it('EXIT when crossing from inside to outside', () => {
    const ev = evaluateGeofences({ prev: inside, curr: outside, circles: [pickupFence] });
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('EXIT');
  });

  it('no event when staying inside (no re-alert on idle)', () => {
    const stillInside = { latitude: 25.2702, longitude: 55.3100 };
    const ev = evaluateGeofences({ prev: inside, curr: stillInside, circles: [pickupFence] });
    expect(ev).toHaveLength(0);
  });

  it('no event when staying outside', () => {
    const ev = evaluateGeofences({ prev: outside, curr: { latitude: 25.2745, longitude: 55.31 }, circles: [pickupFence] });
    expect(ev).toHaveLength(0);
  });

  it('first ping already inside → ENTER (prev absent = treated as outside)', () => {
    const ev = evaluateGeofences({ prev: null, curr: inside, circles: [pickupFence] });
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('ENTER');
  });

  it('evaluates multiple fences independently', () => {
    const deliveryFence: CircleFence = { id: 'dl', kind: 'DELIVERY', center: { latitude: 25.30, longitude: 55.31 }, radiusM: 200 };
    const ev = evaluateGeofences({ prev: outside, curr: inside, circles: [pickupFence, deliveryFence] });
    // Only the pickup fence transitions
    expect(ev).toHaveLength(1);
    expect((ev[0] as { fenceId: string }).fenceId).toBe('pu');
  });
});

describe('evaluateGeofences — corridor transitions', () => {
  const polyline = [
    { latitude: 25.2700, longitude: 55.3100 },
    { latitude: 25.2800, longitude: 55.3100 },
  ];
  const corridor: CorridorFence = { polyline, widthM: 150 };
  const onRoute = { latitude: 25.2750, longitude: 55.3100 };
  const offRoute = { latitude: 25.2750, longitude: 55.3140 };  // ~400m off

  it('DEVIATION when leaving the corridor', () => {
    const ev = evaluateGeofences({ prev: onRoute, curr: offRoute, circles: [], corridor });
    expect(ev.some(e => e.type === 'DEVIATION')).toBe(true);
    const dev = ev.find(e => e.type === 'DEVIATION') as { offCorridorM: number };
    expect(dev.offCorridorM).toBeGreaterThan(150);
  });

  it('RETURN when coming back onto the corridor', () => {
    const ev = evaluateGeofences({ prev: offRoute, curr: onRoute, circles: [], corridor });
    expect(ev.some(e => e.type === 'RETURN')).toBe(true);
  });

  it('no corridor event while staying on route', () => {
    const ev = evaluateGeofences({ prev: onRoute, curr: { latitude: 25.2760, longitude: 55.31 }, circles: [], corridor });
    expect(ev).toHaveLength(0);
  });

  it('a 1-point corridor is ignored (needs ≥2 for a line)', () => {
    const ev = evaluateGeofences({ prev: onRoute, curr: offRoute, circles: [], corridor: { polyline: [polyline[0]], widthM: 150 } });
    expect(ev).toHaveLength(0);
  });
});

// ── alert mapping helpers ────────────────────────────────────────────────────

describe('geofence event mapping', () => {
  it('maps event types to stable codes', () => {
    expect(geofenceEventType({ type: 'ENTER', fenceId: 'x', fenceKind: 'PICKUP', label: null, distanceM: 10 })).toBe('GEOFENCE_ARRIVED_PICKUP');
    expect(geofenceEventType({ type: 'EXIT', fenceId: 'x', fenceKind: 'DELIVERY', label: null, distanceM: 10 })).toBe('GEOFENCE_DEPARTED_DELIVERY');
    expect(geofenceEventType({ type: 'DEVIATION', offCorridorM: 300 })).toBe('GEOFENCE_ROUTE_DEVIATION');
  });

  it('deviation is HIGH severity, arrivals are LOW', () => {
    expect(geofenceEventSeverity({ type: 'DEVIATION', offCorridorM: 300 })).toBe('HIGH');
    expect(geofenceEventSeverity({ type: 'ENTER', fenceId: 'x', fenceKind: 'PICKUP', label: null, distanceM: 10 })).toBe('LOW');
  });

  it('titles are human-readable and include the shipment number', () => {
    expect(geofenceEventTitle({ type: 'ENTER', fenceId: 'x', fenceKind: 'PICKUP', label: null, distanceM: 10 }, 'LOG-1')).toMatch(/LOG-1.*arrived at pickup/i);
    expect(geofenceEventTitle({ type: 'DEVIATION', offCorridorM: 300 }, 'LOG-1')).toMatch(/LOG-1.*deviated/i);
  });
});

// ── circleToPolygon ──────────────────────────────────────────────────────────

describe('circleToPolygon', () => {
  it('returns a closed ring ([lng,lat], first == last)', () => {
    const ring = circleToPolygon(STOP, 200, 32);
    expect(ring).toHaveLength(33);  // segments + closing point
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('every vertex sits ~radius metres from the centre', () => {
    const radiusM = 200;
    const ring = circleToPolygon(STOP, radiusM, 64);
    for (const [lng, lat] of ring) {
      const d = distanceToCircleM({ latitude: lat, longitude: lng }, { id: 'c', kind: 'STOP', center: STOP, radiusM });
      expect(d).toBeGreaterThan(radiusM - 5);
      expect(d).toBeLessThan(radiusM + 5);
    }
  });

  it('a bigger radius produces a wider ring', () => {
    const small = circleToPolygon(STOP, 100, 16);
    const big = circleToPolygon(STOP, 500, 16);
    const spread = (ring: Array<[number, number]>) => Math.max(...ring.map(p => Math.abs(p[1] - STOP.latitude)));
    expect(spread(big)).toBeGreaterThan(spread(small));
  });
});
