import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// vi.mock() is hoisted before imports, so the stub must live inside
// vi.hoisted() to be defined when the factory runs. The geocoder's
// module-level prisma import resolves to this stub.
const { prismaStub } = vi.hoisted(() => ({
  prismaStub: {
    $queryRawUnsafe:   vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaStub }));
vi.mock('@/lib/logistics/route-optimizer-schema', () => ({
  ensureRouteOptimizerSchema: vi.fn().mockResolvedValue(undefined),
}));

import {
  geocode,
  geocodeBatch,
  normaliseAddress,
  _setFetchForTests,
  _resetFetchForTests,
  GeocodeError,
} from '@/lib/logistics/geocoder';

const TENANT = 't-test';

function mockMapboxOk(lat: number, lng: number, relevance = 0.95) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ features: [{ center: [lng, lat], relevance }] }),
  });
}

beforeEach(() => {
  prismaStub.$queryRawUnsafe.mockReset().mockResolvedValue([]);
  prismaStub.$executeRawUnsafe.mockReset().mockResolvedValue(0);
  process.env.MAPBOX_TOKEN = 'test-token-xyz';
});

afterEach(() => {
  _resetFetchForTests();
});

// ── normaliseAddress — pure ────────────────────────────────────────────────

describe('normaliseAddress', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseAddress('  WAREHOUSE  A1  ')).toBe('warehouse a1');
  });

  it('strips common punctuation so typo variants collide', () => {
    expect(normaliseAddress("Plot 12, Al-Quoz, Dubai."))
      .toBe(normaliseAddress("plot 12 al-quoz dubai"));
  });

  it('does not collapse semantically meaningful tokens', () => {
    expect(normaliseAddress('123 Street')).not.toBe(normaliseAddress('123Street'));
  });
});

// ── geocode — cache + Mapbox path ──────────────────────────────────────────

describe('geocode', () => {
  it('returns from cache without calling Mapbox on a hit', async () => {
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{
      latitude: '25.197', longitude: '55.274', confidence: '0.9',
    }]);
    const noFetch = vi.fn().mockRejectedValue(new Error('fetch should not be called'));
    _setFetchForTests(noFetch as unknown as typeof fetch);

    const r = await geocode('Dubai Mall', TENANT);
    expect(r.latitude).toBeCloseTo(25.197);
    expect(r.longitude).toBeCloseTo(55.274);
    expect(r.source).toBe('cache');
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('calls Mapbox on cache miss and writes the result back', async () => {
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([]); // cache miss
    const fetchSpy = mockMapboxOk(25.197, 55.274, 0.97);
    _setFetchForTests(fetchSpy as unknown as typeof fetch);

    const r = await geocode('Dubai Mall', TENANT);
    expect(r.source).toBe('mapbox');
    expect(r.latitude).toBeCloseTo(25.197);
    expect(r.confidence).toBe(0.97);
    expect(fetchSpy).toHaveBeenCalledOnce();
    // Cache write happened
    expect(prismaStub.$executeRawUnsafe).toHaveBeenCalled();
  });

  it('throws no_token when MAPBOX_TOKEN is missing and cache is empty', async () => {
    delete process.env.MAPBOX_TOKEN;
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(geocode('Some Address', TENANT))
      .rejects.toMatchObject({ kind: 'no_token' });
  });

  it('still returns cached result when MAPBOX_TOKEN is missing (offline mode)', async () => {
    delete process.env.MAPBOX_TOKEN;
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{
      latitude: '24.4', longitude: '54.5', confidence: '0.8',
    }]);
    const r = await geocode('Cached Place', TENANT);
    expect(r.source).toBe('cache');
  });

  it('throws GeocodeError on empty input', async () => {
    await expect(geocode('', TENANT)).rejects.toBeInstanceOf(GeocodeError);
    await expect(geocode('   ', TENANT)).rejects.toBeInstanceOf(GeocodeError);
  });

  it('throws no_match when Mapbox returns no features', async () => {
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([]);
    const noResultsFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ features: [] }),
    });
    _setFetchForTests(noResultsFetch as unknown as typeof fetch);
    await expect(geocode('Atlantis Sea Mountain', TENANT))
      .rejects.toMatchObject({ kind: 'no_match' });
  });

  it('throws api_error when Mapbox returns non-2xx', async () => {
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([]);
    const errorFetch = vi.fn().mockResolvedValue({
      ok: false, status: 429,
      text: () => Promise.resolve('Rate limit exceeded'),
    });
    _setFetchForTests(errorFetch as unknown as typeof fetch);
    await expect(geocode('Anywhere', TENANT))
      .rejects.toMatchObject({ kind: 'api_error' });
  });

  it('different tenants do not share cache (multi-tenant isolation)', async () => {
    // Both tenants miss cache, both call Mapbox separately
    prismaStub.$queryRawUnsafe
      .mockResolvedValueOnce([])  // tenant A miss
      .mockResolvedValueOnce([]); // tenant B miss
    const fetchSpy = mockMapboxOk(25, 55);
    _setFetchForTests(fetchSpy as unknown as typeof fetch);

    await geocode('Same Address', 'tenant-a');
    await geocode('Same Address', 'tenant-b');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Each cache read scoped its tenant
    const readCalls = prismaStub.$queryRawUnsafe.mock.calls;
    expect(readCalls[0][1]).toBe('tenant-a');
    expect(readCalls[1][1]).toBe('tenant-b');
  });
});

// ── geocodeBatch ───────────────────────────────────────────────────────────

describe('geocodeBatch', () => {
  it('returns per-item results and never throws on partial failure', async () => {
    prismaStub.$queryRawUnsafe.mockResolvedValue([]);  // every read misses cache
    let call = 0;
    _setFetchForTests((vi.fn(() => {
      call += 1;
      // Item 2 (index 1) fails; others succeed
      if (call === 2) {
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ features: [{ center: [55, 25], relevance: 0.9 }] }),
      });
    })) as unknown as typeof fetch);

    const outcomes = await geocodeBatch(['A', 'B', 'C'], TENANT);
    expect(outcomes).toHaveLength(3);
    expect(outcomes.filter(o => o.result).length).toBe(2);
    expect(outcomes.filter(o => o.error).length).toBe(1);
  });

  it('handles empty input gracefully', async () => {
    const outcomes = await geocodeBatch([], TENANT);
    expect(outcomes).toEqual([]);
  });
});
