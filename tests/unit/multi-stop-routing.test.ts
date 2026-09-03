import { describe, it, expect } from 'vitest';
import {
  calculateDistanceBetweenCoords,
  optimizeWaypointSequence,
  computeMultiStopRoute,
  WaypointNode,
  UAE_KEY_HUBS,
} from '@/lib/multi-stop-routing';

describe('Multi-Stop Waypoints & LTL Load Consolidation Route Engine', () => {
  const origin: WaypointNode = {
    id: 'orig-jafza',
    sequence: 1,
    type: 'PICKUP',
    address: 'JAFZA Base Gate 4',
    lat: UAE_KEY_HUBS.jafza.lat,
    lng: UAE_KEY_HUBS.jafza.lng,
    pallets: 3,
    weightTons: 1.8,
  };

  const stop1: WaypointNode = {
    id: 'stop-dso',
    sequence: 2,
    type: 'DROPOFF',
    address: 'Dubai Silicon Oasis Depot',
    lat: UAE_KEY_HUBS.dso.lat,
    lng: UAE_KEY_HUBS.dso.lng,
    pallets: 1,
    weightTons: 0.5,
  };

  const stop2: WaypointNode = {
    id: 'stop-dubai-mall',
    sequence: 3,
    type: 'DROPOFF',
    address: 'Dubai Mall Service Dock 3',
    lat: UAE_KEY_HUBS.dubai_mall.lat,
    lng: UAE_KEY_HUBS.dubai_mall.lng,
    pallets: 2,
    weightTons: 1.0,
  };

  const destination: WaypointNode = {
    id: 'dest-kizad',
    sequence: 4,
    type: 'DROPOFF',
    address: 'Abu Dhabi Kizad Hub Dock 2',
    lat: UAE_KEY_HUBS.abu_dhabi_kizad.lat,
    lng: UAE_KEY_HUBS.abu_dhabi_kizad.lng,
    pallets: 1,
    weightTons: 0.7,
  };

  it('calculates accurate road-factored geodesic distance in UAE network', () => {
    const dist = calculateDistanceBetweenCoords(
      UAE_KEY_HUBS.jafza.lat,
      UAE_KEY_HUBS.jafza.lng,
      UAE_KEY_HUBS.dubai_mall.lat,
      UAE_KEY_HUBS.dubai_mall.lng
    );

    expect(dist).toBeGreaterThanOrEqual(25);
    expect(dist).toBeLessThanOrEqual(45);
  });

  it('optimizes waypoint sequence using TSP algorithm for shortest route', () => {
    const optimized = optimizeWaypointSequence(origin, [stop1, stop2], destination);

    expect(optimized.length).toBe(4);
    expect(optimized[0].id).toBe('orig-jafza');
    expect(optimized[3].id).toBe('dest-kizad');
    expect(optimized[0].sequence).toBe(1);
    expect(optimized[3].sequence).toBe(4);
  });

  it('computes leg-by-leg metrics, UAE Salik tolls, and total carbon footprint', () => {
    const result = computeMultiStopRoute(origin, [stop2], destination, 600);

    expect(result.legs.length).toBe(2);
    expect(result.totalDistanceKm).toBeGreaterThan(50);
    expect(result.totalDurationMins).toBeGreaterThan(60);
    expect(result.totalSalikTollsAed).toBeGreaterThanOrEqual(4);
    expect(result.totalPallets).toBe(6);
    expect(result.totalWeightTons).toBe(3.5);
    expect(result.co2EmissionsKg).toBeGreaterThan(30);
  });

  it('evaluates LTL load consolidation eligibility and applies 20% eco-discount', () => {
    const result = computeMultiStopRoute(origin, [stop2], destination, 600);

    expect(result.ltlConsolidation.isEligible).toBe(true);
    expect(result.ltlConsolidation.discountPercent).toBe(20);
    expect(result.ltlConsolidation.discountAmountAed).toBe(120); // 20% of 600
    expect(result.ltlConsolidation.co2SavedKg).toBeGreaterThan(10);
    expect(result.ltlConsolidation.poolId).toContain('LTL-CORRIDOR');
  });
});
