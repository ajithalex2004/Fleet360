import { describe, expect, it } from 'vitest';
import {
  predictEta,
  observedSpeedKmh,
  etaDeltaMinutes,
  type TrackingPoint,
  type EtaConfig,
} from '@/lib/logistics/eta-predictor';

// Two points ~1km apart in Dubai for speed math (Deira area).
const A = { latitude: 25.2700, longitude: 55.3100 };
const B = { latitude: 25.2790, longitude: 55.3100 }; // ~1.0km north of A

// A destination ~10km north of A.
const DEST = { latitude: 25.3600, longitude: 55.3100 };

function pt(lat: number, lng: number, occurredAt: string): TrackingPoint {
  return { latitude: lat, longitude: lng, occurredAt };
}

const FULL_CFG: Required<EtaConfig> = {
  detourFactor: 1.3, defaultSpeedKmh: 60, stoppedSpeedFloorKmh: 5,
  maxPlausibleSpeedKmh: 140, arrivalRadiusKm: 0.5, minSpeedWindowSec: 60,
  speedWindowPoints: 5,
};

// ── observedSpeedKmh ───────────────────────────────────────────────────────

describe('observedSpeedKmh', () => {
  it('returns null with fewer than 2 points', () => {
    expect(observedSpeedKmh([pt(25.27, 55.31, '2026-06-22T08:00:00Z')], FULL_CFG)).toBeNull();
  });

  it('returns null when the time window is too short', () => {
    // 1km in 30s would be 120km/h but window < minSpeedWindowSec (60s) → null
    const pts = [
      pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z'),
      pt(B.latitude, B.longitude, '2026-06-22T08:00:30Z'),
    ];
    expect(observedSpeedKmh(pts, FULL_CFG)).toBeNull();
  });

  it('computes ~60km/h for 1km in 60s', () => {
    const pts = [
      pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z'),
      pt(B.latitude, B.longitude, '2026-06-22T08:01:00Z'),
    ];
    const speed = observedSpeedKmh(pts, FULL_CFG)!;
    expect(speed).toBeGreaterThan(55);
    expect(speed).toBeLessThan(65);
  });

  it('sums leg distances across the window, not just endpoints', () => {
    // Three points moving north steadily over 2 min.
    const pts = [
      pt(25.2700, 55.31, '2026-06-22T08:00:00Z'),
      pt(25.2745, 55.31, '2026-06-22T08:01:00Z'),
      pt(25.2790, 55.31, '2026-06-22T08:02:00Z'),
    ];
    const speed = observedSpeedKmh(pts, FULL_CFG)!;
    expect(speed).toBeGreaterThan(25);  // ~1km over 2min ≈ 30km/h
    expect(speed).toBeLessThan(35);
  });

  it('handles out-of-order points by sorting on occurredAt', () => {
    const pts = [
      pt(B.latitude, B.longitude, '2026-06-22T08:01:00Z'),
      pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z'),  // earlier, listed last
    ];
    const speed = observedSpeedKmh(pts, FULL_CFG)!;
    expect(speed).toBeGreaterThan(0);
  });
});

// ── predictEta — fallback ladder ───────────────────────────────────────────

describe('predictEta', () => {
  const NOW = '2026-06-22T08:05:00Z';

  it('falls back to planned arrival with no destination', () => {
    const r = predictEta({
      trackingPoints: [pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z')],
      destination: null,
      now: NOW,
      plannedArrivalAt: '2026-06-22T10:00:00Z',
    });
    expect(r.method).toBe('planned');
    expect(r.etaAt).toBe('2026-06-22T10:00:00Z');
    expect(r.confidence).toBe('low');
  });

  it('falls back to planned arrival with no GPS pings', () => {
    const r = predictEta({
      trackingPoints: [],
      destination: DEST,
      now: NOW,
      plannedArrivalAt: '2026-06-22T10:00:00Z',
    });
    expect(r.method).toBe('planned');
    expect(r.etaAt).toBe('2026-06-22T10:00:00Z');
  });

  it('uses observed speed when the truck is moving steadily', () => {
    const pts = [
      pt(25.2700, 55.31, '2026-06-22T08:00:00Z'),
      pt(25.2745, 55.31, '2026-06-22T08:01:30Z'),
      pt(25.2790, 55.31, '2026-06-22T08:03:00Z'),  // ~1km in 3min ≈ 20km/h
    ];
    const r = predictEta({ trackingPoints: pts, destination: DEST, now: NOW });
    expect(r.method).toBe('observed-speed');
    expect(r.confidence).toBe('high');
    expect(r.effectiveSpeedKmh).toBeGreaterThan(15);
    expect(r.etaAt).not.toBeNull();
    // Remaining ~10km × 1.3 detour at ~20km/h ≈ 39 min out.
    const deltaMin = etaDeltaMinutes(NOW, r.etaAt)!;
    expect(deltaMin).toBeGreaterThan(20);
    expect(deltaMin).toBeLessThan(70);
  });

  it('treats a stopped truck (≈0 speed) as temporarily stopped and uses lane average', () => {
    // Three pings at the SAME spot over 5 min → observed speed ≈ 0.
    const pts = [
      pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z'),
      pt(A.latitude, A.longitude, '2026-06-22T08:02:30Z'),
      pt(A.latitude, A.longitude, '2026-06-22T08:05:00Z'),
    ];
    const r = predictEta({
      trackingPoints: pts, destination: DEST, now: NOW,
      laneAverageSpeedKmh: 50,
    });
    expect(r.method).toBe('lane-average');
    expect(r.effectiveSpeedKmh).toBe(50);
    expect(r.reason).toMatch(/stopped/i);
    expect(r.etaAt).not.toBeNull();  // NOT infinity
  });

  it('uses default speed when stopped and no lane average', () => {
    const pts = [
      pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z'),
      pt(A.latitude, A.longitude, '2026-06-22T08:05:00Z'),
    ];
    const r = predictEta({ trackingPoints: pts, destination: DEST, now: NOW });
    expect(r.method).toBe('default-speed');
    expect(r.effectiveSpeedKmh).toBe(60);
    expect(r.confidence).toBe('low');
  });

  it('rejects an implausible GPS jump and falls back to lane average', () => {
    // 1km in 60s after a huge jump would read >140km/h on a leg... build a
    // window whose total speed exceeds maxPlausibleSpeedKmh.
    const pts = [
      pt(25.2700, 55.31, '2026-06-22T08:00:00Z'),
      pt(25.4000, 55.31, '2026-06-22T08:01:30Z'),  // ~14km in 90s ≈ 580km/h
    ];
    const r = predictEta({
      trackingPoints: pts, destination: DEST, now: NOW,
      laneAverageSpeedKmh: 50,
    });
    expect(r.method).toBe('lane-average');
  });

  it('reports arrived when within the arrival radius', () => {
    const nearDest = pt(DEST.latitude + 0.001, DEST.longitude, '2026-06-22T08:04:00Z'); // ~110m
    const r = predictEta({
      trackingPoints: [pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z'), nearDest],
      destination: DEST, now: NOW,
    });
    expect(r.method).toBe('arrived');
    expect(r.etaAt).toBe(NOW);
    expect(r.confidence).toBe('high');
  });

  it('computes a later ETA when the truck is slower', () => {
    const slow = predictEta({
      trackingPoints: [
        pt(25.2700, 55.31, '2026-06-22T08:00:00Z'),
        pt(25.2715, 55.31, '2026-06-22T08:03:00Z'),  // ~0.17km in 3min ≈ 3.3km/h → stopped floor
      ],
      destination: DEST, now: NOW, laneAverageSpeedKmh: 20,
    });
    const fast = predictEta({
      trackingPoints: [
        pt(25.2700, 55.31, '2026-06-22T08:00:00Z'),
        pt(25.2715, 55.31, '2026-06-22T08:03:00Z'),
      ],
      destination: DEST, now: NOW, laneAverageSpeedKmh: 80,
    });
    const slowDelta = etaDeltaMinutes(NOW, slow.etaAt)!;
    const fastDelta = etaDeltaMinutes(NOW, fast.etaAt)!;
    expect(slowDelta).toBeGreaterThan(fastDelta);
  });

  it('returns a remainingKm that includes the detour factor', () => {
    const r = predictEta({
      trackingPoints: [pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z')],
      destination: DEST, now: NOW, laneAverageSpeedKmh: 50,
    });
    // crow-flies ~10km × 1.3 ≈ 13km
    expect(r.remainingKm).toBeGreaterThan(11);
    expect(r.remainingKm).toBeLessThan(15);
  });

  it('respects a custom config (detour factor + default speed)', () => {
    const r = predictEta({
      trackingPoints: [pt(A.latitude, A.longitude, '2026-06-22T08:00:00Z')],
      destination: DEST, now: NOW,
      config: { detourFactor: 1.0, defaultSpeedKmh: 100 },
    });
    expect(r.effectiveSpeedKmh).toBe(100);
    expect(r.remainingKm).toBeLessThan(11);  // no detour inflation
  });
});

// ── etaDeltaMinutes ────────────────────────────────────────────────────────

describe('etaDeltaMinutes', () => {
  it('returns positive when b is later than a', () => {
    expect(etaDeltaMinutes('2026-06-22T10:00:00Z', '2026-06-22T10:35:00Z')).toBe(35);
  });
  it('returns negative when b is earlier', () => {
    expect(etaDeltaMinutes('2026-06-22T10:00:00Z', '2026-06-22T09:50:00Z')).toBe(-10);
  });
  it('returns null when either side is null', () => {
    expect(etaDeltaMinutes(null, '2026-06-22T10:00:00Z')).toBeNull();
    expect(etaDeltaMinutes('2026-06-22T10:00:00Z', null)).toBeNull();
  });
});
