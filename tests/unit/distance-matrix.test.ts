import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  computeDistanceMatrix,
  haversineKm,
  _setFetchForTests,
  _resetFetchForTests,
  type LatLng,
} from '@/lib/logistics/distance-matrix';

// Sample GCC points used across tests
const DUBAI_MALL:   LatLng = { latitude: 25.197, longitude: 55.279 };
const ABU_DHABI:    LatLng = { latitude: 24.453, longitude: 54.378 };
const SHARJAH:      LatLng = { latitude: 25.357, longitude: 55.391 };

beforeEach(() => {
  delete process.env.MAPBOX_TOKEN;  // start in offline mode unless test sets it
});

afterEach(() => {
  _resetFetchForTests();
});

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

// ── computeDistanceMatrix: Mapbox path ────────────────────────────────────

describe('computeDistanceMatrix · mapbox', () => {
  function mapboxResponse(distMetres: number[][], durSec: number[][]) {
    return vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ code: 'Ok', distances: distMetres, durations: durSec }),
    });
  }

  it('calls Mapbox when provider is explicitly mapbox and token is set', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    const fetchSpy = mapboxResponse(
      [[0, 145000], [145000, 0]],
      [[0, 5400],   [5400, 0]],
    );
    _setFetchForTests(fetchSpy as unknown as typeof fetch);

    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI], { provider: 'mapbox' });
    expect(m.provider).toBe('mapbox');
    // Mapbox returns metres + seconds; we want km + minutes
    expect(m.distances[0][1]).toBeCloseTo(145, 1);
    expect(m.durations[0][1]).toBeCloseTo(90, 1); // 5400s = 90min
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('throws when provider=mapbox but no token configured', async () => {
    delete process.env.MAPBOX_TOKEN;
    await expect(computeDistanceMatrix([DUBAI_MALL, ABU_DHABI], { provider: 'mapbox' }))
      .rejects.toThrow(/MAPBOX_TOKEN not configured/);
  });

  it('auto-selects mapbox when token is set and no explicit provider', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    const fetchSpy = mapboxResponse([[0, 1000], [1000, 0]], [[0, 60], [60, 0]]);
    _setFetchForTests(fetchSpy as unknown as typeof fetch);

    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI]);
    expect(m.provider).toBe('mapbox');
  });

  it('auto-selects haversine when no token (silent fallback for dev)', async () => {
    delete process.env.MAPBOX_TOKEN;
    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI]);
    expect(m.provider).toBe('haversine');
  });

  it('returns Infinity for unreachable cells (null in Mapbox response)', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        code: 'Ok',
        distances: [[0, null], [null, 0]],
        durations: [[0, null], [null, 0]],
      }),
    });
    _setFetchForTests(fetchSpy as unknown as typeof fetch);
    const m = await computeDistanceMatrix([DUBAI_MALL, ABU_DHABI], { provider: 'mapbox' });
    expect(m.distances[0][1]).toBe(Infinity);
  });

  it('chunks into multiple calls when point count exceeds 25', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    // 30 points → needs 2 row-strips × 2 col-strips = 4 calls
    const points = Array.from({ length: 30 }, (_, i) => ({
      latitude: 25 + i * 0.001, longitude: 55 + i * 0.001,
    }));
    const callCount = { n: 0 };
    _setFetchForTests((vi.fn().mockImplementation(async (url: string) => {
      callCount.n += 1;
      // Parse sources / destinations to know the chunk size
      const srcMatch = url.match(/sources=([^&]+)/);
      const dstMatch = url.match(/destinations=([^&]+)/);
      const srcCount = srcMatch ? srcMatch[1].split(';').length : points.length;
      const dstCount = dstMatch ? dstMatch[1].split(';').length : points.length;
      const distRow = new Array(dstCount).fill(1000);
      const durRow  = new Array(dstCount).fill(60);
      return {
        ok: true, status: 200,
        json: () => Promise.resolve({
          code: 'Ok',
          distances: Array.from({ length: srcCount }, () => [...distRow]),
          durations: Array.from({ length: srcCount }, () => [...durRow]),
        }),
      };
    })) as unknown as typeof fetch);

    const m = await computeDistanceMatrix(points, { provider: 'mapbox' });
    expect(m.distances.length).toBe(30);
    expect(m.distances[0].length).toBe(30);
    expect(callCount.n).toBe(4);  // 2×2 chunks
  });

  it('propagates Mapbox API errors with status code', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    _setFetchForTests((vi.fn().mockResolvedValue({
      ok: false, status: 429,
      text: () => Promise.resolve('Rate limit'),
    })) as unknown as typeof fetch);
    await expect(computeDistanceMatrix([DUBAI_MALL, ABU_DHABI], { provider: 'mapbox' }))
      .rejects.toThrow(/429/);
  });
});

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
