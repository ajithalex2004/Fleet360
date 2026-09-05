import { describe, it, expect } from 'vitest';
import {
  RoutingIntelligenceService,
  encodeGeohash,
  haversineKm,
  getTtlMsForTier,
} from '../../src/lib/routing/intelligence-service';
import { computeDistanceMatrix } from '../../src/lib/logistics/distance-matrix';

describe('Phase 2: Routing Intelligence Service & Matrix Cache', () => {
  const service = new RoutingIntelligenceService();

  // Reference points in Dubai
  const muhaisnahGateA = {
    canonicalLocationId: 'LOC-MUH-004',
    name: 'Muhaisnah 4 Staff Accommodations Gate A',
    latitude: 25.2750,
    longitude: 55.4050,
    accessPoint: { latitude: 25.2752, longitude: 55.4053 },
    zoneId: 'ZONE-DXB-NORTH',
  };

  const airportT3 = {
    canonicalLocationId: 'LOC-DXB-T3',
    name: 'Dubai International Airport Terminal 3 Arrival',
    latitude: 25.2532,
    longitude: 55.3657,
    accessPoint: { latitude: 25.2535, longitude: 55.3660 },
    zoneId: 'ZONE-DXB-AIRPORT',
  };

  const alQuozHub = {
    canonicalLocationId: 'LOC-QUOZ-01',
    name: 'Al Quoz Industrial 3 Logistics Depot',
    latitude: 25.1250,
    longitude: 55.2350,
    zoneId: 'ZONE-DXB-SOUTH',
  };

  describe('1. Canonical Location Normalization & Geohashing', () => {
    it('encodes lat/lng into a 6-character geohash accurately', () => {
      const hash1 = encodeGeohash(25.2750, 55.4050, 6);
      const hash2 = encodeGeohash(25.2750, 55.4050, 6);
      expect(hash1).toHaveLength(6);
      expect(hash1).toBe(hash2);
    });

    it('canonicalizes locations with access points and geohash metadata', () => {
      const canonical = service.canonicalizeLocation(muhaisnahGateA);
      expect(canonical.canonicalLocationId).toBe('LOC-MUH-004');
      expect(canonical.geohash).toBeDefined();
      expect(canonical.accessPoint).toEqual({ latitude: 25.2752, longitude: 55.4053 });
      expect(canonical.zoneId).toBe('ZONE-DXB-NORTH');
    });

    it('calculates road distance with GCC detour factor (1.3x)', () => {
      const distDirect = haversineKm(25.2750, 55.4050, 25.2532, 55.3657, 1.0);
      const distRoad = haversineKm(25.2750, 55.4050, 25.2532, 55.3657, 1.3);

      expect(distRoad).toBeGreaterThan(distDirect);
      expect(distRoad).toBeCloseTo(distDirect * 1.3, 1);
    });
  });

  describe('2. Adaptive Spatial Shortlisting with Radius Expansion', () => {
    const origin = { latitude: 25.2750, longitude: 55.4050 };

    // Nearby candidate ~2 km away
    const nearbyCandidate = { id: 'V-01', lat: 25.2850, lng: 55.4150, zoneId: 'ZONE-DXB-NORTH' };
    // Medium candidate ~12 km away
    const mediumCandidate = { id: 'V-02', lat: 25.2000, lng: 55.3000, zoneId: 'ZONE-DXB-CENTRAL' };
    // Distant candidate ~28 km away
    const distantCandidate = { id: 'V-03', lat: 25.1000, lng: 55.2000, zoneId: 'ZONE-DXB-SOUTH' };

    it('selects candidates within initial radius when sufficient', () => {
      const candidates = [nearbyCandidate, mediumCandidate, distantCandidate];
      const result = service.spatialShortlist(origin, candidates, {
        initialRadiusKm: 5,
        minCandidates: 1,
        maxCandidates: 5,
      });

      expect(result.selected).toHaveLength(1);
      expect(result.selected[0].id).toBe('V-01');
      expect(result.radiusKmUsed).toBe(5);
      expect(result.expanded).toBe(false);
    });

    it('adaptively expands search radius when candidate count is below minCandidates', () => {
      // Require at least 2 candidates
      const candidates = [nearbyCandidate, mediumCandidate, distantCandidate];
      const result = service.spatialShortlist(origin, candidates, {
        initialRadiusKm: 5,
        expansionStepKm: 5,
        maxRadiusKm: 20,
        minCandidates: 2,
        maxCandidates: 5,
      });

      expect(result.selected.length).toBeGreaterThanOrEqual(2);
      expect(result.selected.map(c => c.id)).toContain('V-01');
      expect(result.selected.map(c => c.id)).toContain('V-02');
      expect(result.expanded).toBe(true);
      expect(result.radiusKmUsed).toBeGreaterThan(5);
    });

    it('enforces maxCandidates ceiling to control downstream matrix cost', () => {
      const manyCandidates = Array.from({ length: 30 }, (_, i) => ({
        id: `V-${i + 1}`,
        lat: 25.2750 + (i * 0.001),
        lng: 55.4050 + (i * 0.001),
      }));

      const result = service.spatialShortlist(origin, manyCandidates, {
        initialRadiusKm: 5,
        maxCandidates: 8,
      });

      expect(result.selected).toHaveLength(8);
      expect(result.totalCandidatesEvaluated).toBe(30);
    });
  });

  describe('3. Multi-Tier TTL Matrix Cache & Avoided Cost Telemetry', () => {
    it('returns valid TTL durations for each caching tier', () => {
      expect(getTtlMsForTier('STATIC_DISTANCE')).toBe(30 * 24 * 60 * 60 * 1000);
      expect(getTtlMsForTier('HISTORICAL_TRAVEL_TIME')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(getTtlMsForTier('TRAFFIC_DYNAMIC')).toBe(15 * 60 * 1000);
    });

    it('queries distance matrix, caches results, and records avoided cost on subsequent hits', async () => {
      const points = [muhaisnahGateA, airportT3];

      // First call -> Cache Miss
      const firstRun = await service.getMatrix(points, points, {
        tier: 'HISTORICAL_TRAVEL_TIME',
        preferredProvider: 'haversine',
        forceFresh: true,
      });

      expect(firstRun.elementsQueried).toBe(4);
      expect(firstRun.distances[0][0]).toBe(0);
      expect(firstRun.distances[0][1]).toBeGreaterThan(0);
      expect(firstRun.durations[0][1]).toBeGreaterThan(0);

      // Second call -> Cache Hit (L1 memory cache hit)
      const secondRun = await service.getMatrix(points, points, {
        tier: 'HISTORICAL_TRAVEL_TIME',
        preferredProvider: 'haversine',
        forceFresh: false,
      });

      expect(secondRun.cacheHits).toBe(4);
      expect(secondRun.cacheMisses).toBe(0);
      expect(secondRun.providerCallsAvoided).toBe(4);
      expect(secondRun.distances[0][1]).toBe(firstRun.distances[0][1]);
    });
  });

  describe('4. Backward-Compatible Logistics Adapter', () => {
    it('seamlessly routes computeDistanceMatrix through RoutingIntelligenceService', async () => {
      const pts = [
        { latitude: 25.2750, longitude: 55.4050 },
        { latitude: 25.2532, longitude: 55.3657 },
      ];

      const res = await computeDistanceMatrix(pts, { provider: 'haversine' });
      expect(res.distances).toHaveLength(2);
      expect(res.durations).toHaveLength(2);
      expect(res.distances[0][0]).toBe(0);
      expect(res.distances[0][1]).toBeGreaterThan(0);
      expect(res.provider).toBe('haversine');
    });
  });
});
