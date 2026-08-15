/**
 * Unit tests for src/lib/planning/zone-compat.ts
 *
 * Pure function; direct truth-table coverage of the tier hierarchy:
 *   ZONE_MATCH > ZONE_DIFFERENT > FALLBACK_DISTANCE > FALLBACK_TOO_FAR > UNKNOWN
 */

import { describe, it, expect } from 'vitest';
import { zoneCompatibility, isCompatPassing } from '@/lib/planning/zone-compat';

describe('zoneCompatibility', () => {
  it('ZONE_MATCH when both sides share a placeId', () => {
    const r = zoneCompatibility(
      [{ placeId: 'zone-al-barsha', lat: 25.1, lng: 55.2 }],
      [{ placeId: 'zone-al-barsha', lat: 25.4, lng: 55.6 }],
    );
    expect(r.kind).toBe('ZONE_MATCH');
    expect(r.sharedPlaceId).toBe('zone-al-barsha');
  });

  it('ZONE_DIFFERENT when both sides have places but no overlap — does NOT fall back to distance', () => {
    // Even if coords are 100m apart, an explicit "different zone"
    // signal wins. Highway barriers, industrial gates, etc.
    const r = zoneCompatibility(
      [{ placeId: 'zone-north', lat: 25.10, lng: 55.20 }],
      [{ placeId: 'zone-south', lat: 25.101, lng: 55.201 }],
    );
    expect(r.kind).toBe('ZONE_DIFFERENT');
    expect(isCompatPassing(r)).toBe(false);
  });

  it('FALLBACK_DISTANCE when either side has no placeId but both have coords, within threshold', () => {
    const r = zoneCompatibility(
      [{ lat: 25.20, lng: 55.27 }],                        // no placeId
      [{ placeId: 'zone-x', lat: 25.205, lng: 55.275 }],   // has placeId, but the missing side degrades result
      { fallbackKm: 2 },
    );
    // ~0.7km apart at UAE latitude
    expect(r.kind).toBe('FALLBACK_DISTANCE');
    expect(r.distanceKm).toBeGreaterThan(0);
    expect(r.distanceKm).toBeLessThan(1);
    expect(isCompatPassing(r)).toBe(true);
  });

  it('FALLBACK_TOO_FAR when coords exceed the fallback threshold', () => {
    const r = zoneCompatibility(
      [{ lat: 25.20, lng: 55.27 }],
      [{ lat: 25.30, lng: 55.40 }],   // ~16km
      { fallbackKm: 2 },
    );
    expect(r.kind).toBe('FALLBACK_TOO_FAR');
    expect(r.distanceKm).toBeGreaterThan(2);
    expect(isCompatPassing(r)).toBe(false);
  });

  it('UNKNOWN when neither side has usable placeId or coords', () => {
    const r = zoneCompatibility([{ placeId: null, lat: null, lng: null }], []);
    expect(r.kind).toBe('UNKNOWN');
    expect(isCompatPassing(r)).toBe(false);
  });

  it('multi-candidate side counts as match if ANY pair matches', () => {
    const r = zoneCompatibility(
      [{ placeId: 'z1' }, { placeId: 'z2' }, { placeId: 'z3' }],
      [{ placeId: 'z9' }, { placeId: 'z3' }],
    );
    expect(r.kind).toBe('ZONE_MATCH');
    expect(r.sharedPlaceId).toBe('z3');
  });

  it('computes min inter-side distance across candidate pairs, not just first-first', () => {
    // First-first would compare (25.20, 55.27) vs (25.30, 55.40) → 16km
    // Actual min pair is second-of-A vs first-of-B → very close
    const r = zoneCompatibility(
      [{ lat: 25.20, lng: 55.27 }, { lat: 25.301, lng: 55.401 }],
      [{ lat: 25.30, lng: 55.40 }, { lat: 25.50, lng: 55.70 }],
      { fallbackKm: 1 },
    );
    expect(r.kind).toBe('FALLBACK_DISTANCE');
    expect(r.distanceKm).toBeLessThan(0.5);
  });
});
