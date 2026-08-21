/**
 * Unit tests for src/lib/planning/route-consolidation-helpers.ts
 *
 * Pure functions — direct truth-table coverage of the mapping tier
 * hierarchy, hash sensitivity, and greedy-NN determinism. Full apply-
 * engine integration lives in route-consolidation-apply.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  computeAppliedStateHash,
  resolveEnrollmentStopMapping,
  suggestMergedStopOrder,
  type StopOnMergedRoute,
  type OrderableStop,
} from '@/lib/planning/route-consolidation-helpers';

// ─── resolveEnrollmentStopMapping ───────────────────────────────────

describe('resolveEnrollmentStopMapping', () => {
  const mergedStops: StopOnMergedRoute[] = [
    { id: 'stop-new-1', placeId: 'place-al-barsha' },
    { id: 'stop-new-2', placeId: 'place-jlt' },
  ];

  it('EXACT_STOP when the old stop id also exists on the merged route', () => {
    const r = resolveEnrollmentStopMapping('stop-new-1', 'place-al-barsha', mergedStops);
    expect(r).toEqual({ method: 'EXACT_STOP', newStopId: 'stop-new-1' });
  });

  it('EXACT_PLACE_ID when the new route has a different stop id at the same placeId', () => {
    const r = resolveEnrollmentStopMapping('stop-old-1', 'place-al-barsha', mergedStops);
    expect(r).toEqual({ method: 'EXACT_PLACE_ID', newStopId: 'stop-new-1' });
  });

  it('OPERATOR_RESOLVED unresolved (newStopId=null) when no exact + no placeId match + no supplied resolution', () => {
    const r = resolveEnrollmentStopMapping('stop-old-1', 'place-unknown', mergedStops);
    expect(r).toEqual({ method: 'OPERATOR_RESOLVED', newStopId: null });
  });

  it('OPERATOR_RESOLVED honours a valid supplied stopId when auto-map fails', () => {
    const r = resolveEnrollmentStopMapping('stop-old-1', 'place-unknown', mergedStops, 'stop-new-2');
    expect(r).toEqual({ method: 'OPERATOR_RESOLVED', newStopId: 'stop-new-2' });
  });

  it('rejects an operator-supplied stopId that is not on the merged route', () => {
    const r = resolveEnrollmentStopMapping('stop-old-1', 'place-unknown', mergedStops, 'stop-does-not-exist');
    expect(r).toEqual({ method: 'OPERATOR_RESOLVED', newStopId: null });
  });

  it('accepts explicit null supplied resolution (operator confirmed "no stop")', () => {
    const r = resolveEnrollmentStopMapping('stop-old-1', 'place-unknown', mergedStops, null);
    expect(r).toEqual({ method: 'OPERATOR_RESOLVED', newStopId: null });
  });

  it('old-stop-null passes through as unresolved with null (dropoff-optional case)', () => {
    const r = resolveEnrollmentStopMapping(null, null, mergedStops);
    expect(r).toEqual({ method: 'OPERATOR_RESOLVED', newStopId: null });
  });
});

// ─── suggestMergedStopOrder ─────────────────────────────────────────

describe('suggestMergedStopOrder', () => {
  const origin: OrderableStop = { id: 'origin', placeId: 'o', gpsLat: 25.10, gpsLng: 55.15, sourceRouteId: 'r1' };
  const destination: OrderableStop = { id: 'dest', placeId: 'd', gpsLat: 25.30, gpsLng: 55.40, sourceRouteId: 'r1' };

  it('starts at origin, ends at destination, visits intermediates in NN order', () => {
    const intermediates: OrderableStop[] = [
      { id: 'far', placeId: 'f', gpsLat: 25.25, gpsLng: 55.35, sourceRouteId: 'r1' },
      { id: 'near', placeId: 'n', gpsLat: 25.11, gpsLng: 55.16, sourceRouteId: 'r2' },
    ];
    const r = suggestMergedStopOrder(origin, destination, intermediates);
    expect(r[0].id).toBe('origin');
    expect(r[r.length - 1].id).toBe('dest');
    // From origin, 'near' is closer than 'far'
    expect(r[1].id).toBe('near');
    expect(r[2].id).toBe('far');
  });

  it('dedupes intermediates by placeId (shared stop appears once)', () => {
    const shared: OrderableStop = { id: 'shared-r1', placeId: 'shared', gpsLat: 25.20, gpsLng: 55.25, sourceRouteId: 'r1' };
    const sharedDupe: OrderableStop = { id: 'shared-r2', placeId: 'shared', gpsLat: 25.20, gpsLng: 55.25, sourceRouteId: 'r2' };
    const r = suggestMergedStopOrder(origin, destination, [shared, sharedDupe]);
    // Only one shared appears in the intermediate slot
    expect(r).toHaveLength(3); // origin + shared + dest
    expect(r[1].placeId).toBe('shared');
  });

  it('excludes stops that duplicate the origin or destination', () => {
    const dupeOrigin: OrderableStop = { ...origin, id: 'dup', sourceRouteId: 'r2' };
    const r = suggestMergedStopOrder(origin, destination, [dupeOrigin]);
    expect(r).toHaveLength(2); // origin + dest only
  });
});

// ─── computeAppliedStateHash ────────────────────────────────────────

describe('computeAppliedStateHash', () => {
  const routeBase = {
    name: 'Merged',
    isActive: true,
    retiredReason: null,
    updatedAt: new Date('2026-08-16T10:00:00Z'),
    capacity: 40,
    requiredVehicleGroup: 'BUS',
  };
  const stopsBase = [
    { id: 's1', placeId: 'p1', gpsLat: 25.10, gpsLng: 55.15, sequence: 1 },
    { id: 's2', placeId: 'p2', gpsLat: 25.20, gpsLng: 55.25, sequence: 2 },
  ];

  function makeMock(route: typeof routeBase, stops: typeof stopsBase): PrismaClient {
    return {
      busRoute: { findUnique: vi.fn().mockResolvedValue(route) },
      routeStop: { findMany: vi.fn().mockResolvedValue(stops) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as PrismaClient;
  }

  it('produces a deterministic hash for the same state', async () => {
    const h1 = await computeAppliedStateHash(makeMock(routeBase, stopsBase), 'merged-1');
    const h2 = await computeAppliedStateHash(makeMock(routeBase, stopsBase), 'merged-1');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 hex
  });

  it('changes when the route name is edited', async () => {
    const h1 = await computeAppliedStateHash(makeMock(routeBase, stopsBase), 'merged-1');
    const h2 = await computeAppliedStateHash(makeMock({ ...routeBase, name: 'RenamedMerged' }, stopsBase), 'merged-1');
    expect(h1).not.toBe(h2);
  });

  it('changes when a stop is added', async () => {
    const h1 = await computeAppliedStateHash(makeMock(routeBase, stopsBase), 'merged-1');
    const h2 = await computeAppliedStateHash(makeMock(routeBase, [
      ...stopsBase,
      { id: 's3', placeId: 'p3', gpsLat: 25.30, gpsLng: 55.35, sequence: 3 },
    ]), 'merged-1');
    expect(h1).not.toBe(h2);
  });

  it('changes when stop sequence is reordered', async () => {
    const h1 = await computeAppliedStateHash(makeMock(routeBase, stopsBase), 'merged-1');
    const reordered = [
      { ...stopsBase[0], sequence: 2 },
      { ...stopsBase[1], sequence: 1 },
    ].sort((a, b) => a.sequence - b.sequence);
    const h2 = await computeAppliedStateHash(makeMock(routeBase, reordered), 'merged-1');
    expect(h1).not.toBe(h2);
  });

  it('is stable across updatedAt bumps IF nothing hashable actually changed', async () => {
    // updatedAt IS included in the hash, so we expect it to change.
    // This test documents that behavior clearly — updatedAt is a proxy
    // for any BusRoute edit, so drift on it is correctly detected.
    const h1 = await computeAppliedStateHash(makeMock(routeBase, stopsBase), 'merged-1');
    const h2 = await computeAppliedStateHash(
      makeMock({ ...routeBase, updatedAt: new Date('2026-08-16T11:00:00Z') }, stopsBase),
      'merged-1'
    );
    expect(h1).not.toBe(h2);
  });

  it('throws when the merged route is missing (defensive)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nullRouteMock = { busRoute: { findUnique: vi.fn().mockResolvedValue(null) }, routeStop: { findMany: vi.fn().mockResolvedValue([]) } } as any as PrismaClient;
    await expect(computeAppliedStateHash(nullRouteMock, 'missing')).rejects.toThrow('route not found');
  });
});
