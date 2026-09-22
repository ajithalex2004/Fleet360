import { describe, expect, it } from 'vitest';
import {
  computeDistanceMatrix,
  haversineKm,
  type LatLng,
} from '@/lib/logistics/distance-matrix';

// Sample GCC points used across tests
const DUBAI_MALL:   LatLng = { latitude: 25.197, longitude: 55.279 };
const ABU_DHABI:    LatLng = { latitude: 24.453, longitude: 54.378 };
const SHARJAH:      LatLng = { latitude: 25.357, longitude: 55.391 };

// ── haversineKm — pure ─────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('returns 0 for the same point', () => {
    expect(haversineKm(DUBAI_MALL, DUBAI_MALL)).toBe(0);
  });

  it('returns roughly 123km Dubai Mall → Abu Dhabi (great-circle)', () => {
    const km = haversineKm(DUBAI_MALL, ABU_DHABI);
    expect(km).toBeGreaterThan(118);
    expect(km).toBeLessThan(128);
  });

  it('is symmetric', () => {
    const ab = haversineKm(DUBAI_MALL, ABU_DHABI);
    const ba = haversineKm(ABU_DHABI, DUBAI_MALL);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

// ── computeDistanceMatrix: haversine path ─────────────────────────────────

describe('computeDistanceMatrix · haversine', () => {
  it('returns an empty matrix for zero points', async () => {
    const m = await computeDistanceMatrix([]);
    expect(m.distances).toEqual([]);
    expect(m.durations).toEqual([]);
  });

  it('returns a 1x1 zero matrix for a single point', async () => {
    const m = await computeDistanceMatrix([DUBAI_MALL]);
    expect(m.distances).toEqual([[0]]);
    expect(m.durations).toEqual([[0]]);
  });

  it('builds a symmetric NxN matrix with 0 diagonal', async () => {
    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI, SHARJAH], { provider: 'haversine' });
    expect(m.provider).toBe('haversine');
    expect(m.distances.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(m.distances[i][i]).toBe(0);
      expect(m.durations[i][i]).toBe(0);
      for (let j = 0; j < 3; j++) {
        expect(m.distances[i][j]).toBeCloseTo(m.distances[j][i], 2);
      }
    }
  });

  it('applies the detour factor (1.3× by default)', async () => {
    const m1 = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI], { provider: 'haversine', detourFactor: 1.0 });
    const m2 = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI], { provider: 'haversine', detourFactor: 1.3 });
    expect(m2.distances[0][1]).toBeCloseTo(m1.distances[0][1] * 1.3, 1);
  });

  it('computes duration from distance and avg speed', async () => {
    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI], {
      provider: 'haversine', detourFactor: 1.0, avgSpeedKmh: 60,
    });
    // ~123km @ 60km/h ≈ 123min. With detour=1.0, distance≈123km, duration≈123min.
    expect(m.durations[0][1]).toBeGreaterThan(115);
    expect(m.durations[0][1]).toBeLessThan(135);
  });
});

// Mapbox HTTP calls used to be made directly from this module (and were
// intercepted in tests via _setFetchForTests/_resetFetchForTests). That
// logic has since moved into RoutingIntelligenceService.getMatrix(), which
// computeDistanceMatrix now unconditionally delegates to — there's no
// fetch seam left at this layer to test against. Provider selection and
// the Mapbox HTTP path are covered where they now live, in
// tests/unit/routing-intelligence.test.ts ("Backward-Compatible Logistics
// Adapter" verifies computeDistanceMatrix routes through the service).

// ── Sanity check: solver-relevant invariants ──────────────────────────────

describe('matrix invariants the solver relies on', () => {
  it('diagonal is always 0 (haversine)', async () => {
    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI, SHARJAH], { provider: 'haversine' });
    for (let i = 0; i < 3; i++) {
      expect(m.distances[i][i]).toBe(0);
      expect(m.durations[i][i]).toBe(0);
    }
  });

  it('distances are non-negative (haversine)', async () => {
    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI, SHARJAH], { provider: 'haversine' });
    for (const row of m.distances) {
      for (const v of row) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
