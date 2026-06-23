/**
 * Phase 0 integration test for the Route Optimizer.
 *
 * Exercises the geocoder + distance-matrix end-to-end against the live
 * Mapbox API and a real Postgres. Skipped automatically when MAPBOX_TOKEN
 * is unset so CI without the secret doesn't fail.
 *
 * Coverage:
 *   - ensureRouteOptimizerSchema creates the new tables + ALTERs cleanly
 *   - First geocode call hits Mapbox; second is served from cache
 *   - Different tenants don't share cache (multi-tenant isolation)
 *   - computeDistanceMatrix returns a sensible road-network matrix
 *   - Sanity check: Mapbox road distance > haversine straight-line
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ensureRouteOptimizerSchema } from '@/lib/logistics/route-optimizer-schema';
import { geocode } from '@/lib/logistics/geocoder';
import { computeDistanceMatrix, haversineKm } from '@/lib/logistics/distance-matrix';

const prisma = new PrismaClient();
const TENANT_A = `phase0-${randomUUID().slice(0, 8)}`;
const TENANT_B = `phase0-${randomUUID().slice(0, 8)}`;

const ADDRESSES = [
  'Dubai Mall, Dubai, UAE',
  'Abu Dhabi Mall, Abu Dhabi, UAE',
  'Sharjah City Centre, Sharjah, UAE',
];

const hasToken = !!process.env.MAPBOX_TOKEN;
const liveTest = hasToken ? it : it.skip;

beforeAll(async () => {
  await ensureRouteOptimizerSchema();
}, 60_000);

afterAll(async () => {
  // Remove anything this run wrote.
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_geocode_cache WHERE tenant_id = ANY($1::text[])`,
    [TENANT_A, TENANT_B],
  ).catch(() => {});
  await prisma.$disconnect();
});

describe('Route Optimizer Phase 0 (live)', () => {
  liveTest('geocodes via Mapbox on first call and from cache on second', async () => {
    const first = await geocode(ADDRESSES[0], TENANT_A);
    expect(first.source).toBe('mapbox');
    expect(first.latitude).toBeCloseTo(25.2, 0);   // Dubai Mall ≈ 25.2
    expect(first.longitude).toBeCloseTo(55.3, 0);  // ≈ 55.3
    expect(first.confidence).toBeGreaterThan(0);

    const second = await geocode(ADDRESSES[0], TENANT_A);
    expect(second.source).toBe('cache');
    expect(second.latitude).toBeCloseTo(first.latitude, 4);
    expect(second.longitude).toBeCloseTo(first.longitude, 4);
  }, 30_000);

  liveTest('cache is tenant-scoped — another tenant requesting the same address hits Mapbox again', async () => {
    // TENANT_A already cached Dubai Mall above.
    const fromB = await geocode(ADDRESSES[0], TENANT_B);
    // TENANT_B has no cache row yet, so this must come from Mapbox.
    expect(fromB.source).toBe('mapbox');
    expect(fromB.latitude).toBeCloseTo(25.2, 0);
  }, 30_000);

  liveTest('builds a 3×3 road-distance matrix via Mapbox', async () => {
    // Reuse cached geocodes — these were populated by the test above.
    const geos = await Promise.all(ADDRESSES.map(a => geocode(a, TENANT_A)));
    const points = geos.map(g => ({ latitude: g.latitude, longitude: g.longitude }));

    const matrix = await computeDistanceMatrix(points, { provider: 'mapbox' });
    expect(matrix.provider).toBe('mapbox');
    expect(matrix.distances.length).toBe(3);
    expect(matrix.distances[0].length).toBe(3);

    // Diagonal = 0
    for (let i = 0; i < 3; i++) {
      expect(matrix.distances[i][i]).toBe(0);
      expect(matrix.durations[i][i]).toBe(0);
    }

    // Dubai → Abu Dhabi via road should be 120-200km (E11 highway varies by routing)
    const dubaiToAd = matrix.distances[0][1];
    expect(dubaiToAd).toBeGreaterThan(100);
    expect(dubaiToAd).toBeLessThan(200);
  }, 30_000);

  liveTest('road distance exceeds straight-line — sanity check on the detour factor assumption', async () => {
    const geos = await Promise.all(ADDRESSES.map(a => geocode(a, TENANT_A)));
    const points = geos.map(g => ({ latitude: g.latitude, longitude: g.longitude }));

    const road = await computeDistanceMatrix(points, { provider: 'mapbox' });
    const straight = haversineKm(points[0], points[1]);

    const ratio = road.distances[0][1] / straight;
    // For Dubai → Abu Dhabi the real ratio is ~1.15-1.30. Anything outside
    // 1.0-1.6 indicates either Mapbox routing failed or we wrote a bug.
    expect(ratio).toBeGreaterThan(1.0);
    expect(ratio).toBeLessThan(1.6);
  }, 30_000);

  it('falls back to haversine when no token is configured (offline mode)', async () => {
    // Temporarily clear the token to simulate dev/CI without secret.
    const saved = process.env.MAPBOX_TOKEN;
    delete process.env.MAPBOX_TOKEN;
    try {
      const points = [
        { latitude: 25.197, longitude: 55.279 },
        { latitude: 24.453, longitude: 54.378 },
      ];
      const matrix = await computeDistanceMatrix(points);
      expect(matrix.provider).toBe('haversine');
      // Default detour factor is 1.3, so Dubai → Abu Dhabi ≈ 123km × 1.3 ≈ 160km
      expect(matrix.distances[0][1]).toBeGreaterThan(130);
      expect(matrix.distances[0][1]).toBeLessThan(180);
    } finally {
      if (saved) process.env.MAPBOX_TOKEN = saved;
    }
  });

  it('schema migration is idempotent (running twice doesn\'t error)', async () => {
    // Both calls should resolve without throwing
    await ensureRouteOptimizerSchema();
    await ensureRouteOptimizerSchema();
  });
});
