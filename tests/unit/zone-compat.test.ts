/**
 * Unit tests for src/lib/planning/zone-compat.ts
 *
 * Pure function; direct truth-table coverage of the tier hierarchy:
 *   SAME_ZONE > DIFFERENT_ZONES > WITHIN_FALLBACK > OUTSIDE_FALLBACK > UNKNOWN
 *
 * Ported from the pre-merge vocabulary (ZONE_MATCH / ZONE_DIFFERENT /
 * FALLBACK_DISTANCE / FALLBACK_TOO_FAR) to the current canonical names.
 * The mapping is 1:1 and semantics are unchanged — isCompatPassing()
 * still passes exactly the "shared place" and "within threshold" tiers.
 * Two shape differences on the result type are reflected below:
 *   - the matched place is reported via `reason` rather than a
 *     `sharedPlaceId` field, so those assertions check `reason` contains
 *     the id (same intent: verifying WHICH place matched, not just that
 *     one did);
 *   - `distanceKm` is `number | null` (null on the placeId path).
 * `opts.fallbackKm` is now required, so cases that previously relied on
 * the default pass DEFAULT_FALLBACK_KM.PICKUP (3.0) explicitly — the
 * same value the old default resolved to.
 */

import { describe, it, expect } from 'vitest';
import { zoneCompatibility, isCompatPassing, DEFAULT_FALLBACK_KM, type ZonePoint } from '@/lib/planning/zone-compat';

/** ZonePoint requires all three fields; tests only care about some. */
function pt(p: Partial<ZonePoint>): ZonePoint {
  return { placeId: p.placeId ?? null, lat: p.lat ?? null, lng: p.lng ?? null };
}

const DEFAULT_OPTS = { fallbackKm: DEFAULT_FALLBACK_KM.PICKUP };

describe('zoneCompatibility', () => {
  it('SAME_ZONE when both sides share a placeId', () => {
    const r = zoneCompatibility(
      [pt({ placeId: 'zone-al-barsha', lat: 25.1, lng: 55.2 })],
      [pt({ placeId: 'zone-al-barsha', lat: 25.4, lng: 55.6 })],
      DEFAULT_OPTS,
    );
    expect(r.kind).toBe('SAME_ZONE');
    expect(r.reason).toContain('zone-al-barsha');
  });

  it('DIFFERENT_ZONES when both sides have places but no overlap — does NOT fall back to distance', () => {
    // Even if coords are 100m apart, an explicit "different zone"
    // signal wins. Highway barriers, industrial gates, etc.
    const r = zoneCompatibility(
      [pt({ placeId: 'zone-north', lat: 25.10, lng: 55.20 })],
      [pt({ placeId: 'zone-south', lat: 25.101, lng: 55.201 })],
      DEFAULT_OPTS,
    );
    expect(r.kind).toBe('DIFFERENT_ZONES');
    expect(isCompatPassing(r)).toBe(false);
  });

  it('WITHIN_FALLBACK when either side has no placeId but both have coords, within threshold', () => {
    const r = zoneCompatibility(
      [pt({ lat: 25.20, lng: 55.27 })],                        // no placeId
      [pt({ placeId: 'zone-x', lat: 25.205, lng: 55.275 })],   // has placeId, but the missing side degrades result
      { fallbackKm: 2 },
    );
    // ~0.7km apart at UAE latitude
    expect(r.kind).toBe('WITHIN_FALLBACK');
    expect(r.distanceKm).toBeGreaterThan(0);
    expect(r.distanceKm).toBeLessThan(1);
    expect(isCompatPassing(r)).toBe(true);
  });

  it('OUTSIDE_FALLBACK when coords exceed the fallback threshold', () => {
    const r = zoneCompatibility(
      [pt({ lat: 25.20, lng: 55.27 })],
      [pt({ lat: 25.30, lng: 55.40 })],   // ~16km
      { fallbackKm: 2 },
    );
    expect(r.kind).toBe('OUTSIDE_FALLBACK');
    expect(r.distanceKm).toBeGreaterThan(2);
    expect(isCompatPassing(r)).toBe(false);
  });

  it('UNKNOWN when neither side has usable placeId or coords', () => {
    const r = zoneCompatibility([pt({})], [], DEFAULT_OPTS);
    expect(r.kind).toBe('UNKNOWN');
    expect(isCompatPassing(r)).toBe(false);
  });

  it('multi-candidate side counts as match if ANY pair matches', () => {
    const r = zoneCompatibility(
      [pt({ placeId: 'z1' }), pt({ placeId: 'z2' }), pt({ placeId: 'z3' })],
      [pt({ placeId: 'z9' }), pt({ placeId: 'z3' })],
      DEFAULT_OPTS,
    );
    expect(r.kind).toBe('SAME_ZONE');
    expect(r.reason).toContain('z3');
  });

  it('computes min inter-side distance across candidate pairs, not just first-first', () => {
    // First-first would compare (25.20, 55.27) vs (25.30, 55.40) → 16km
    // Actual min pair is second-of-A vs first-of-B → very close
    const r = zoneCompatibility(
      [pt({ lat: 25.20, lng: 55.27 }), pt({ lat: 25.301, lng: 55.401 })],
      [pt({ lat: 25.30, lng: 55.40 }), pt({ lat: 25.50, lng: 55.70 })],
      { fallbackKm: 1 },
    );
    expect(r.kind).toBe('WITHIN_FALLBACK');
    expect(r.distanceKm).toBeLessThan(0.5);
  });
});
