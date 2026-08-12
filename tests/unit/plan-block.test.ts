/**
 * tests/unit/plan-block.test.ts
 *
 * Unit tests for the blocking algorithm (lib/plan/block.ts).
 */

import { describe, expect, it } from 'vitest';
import { runcut, type PlanTrip } from '@/lib/plan/runcut';
import { block } from '@/lib/plan/block';

function trip(opts: {
  id: string;
  departure: string;
  durationMins: number;
  origin?: string;
}): PlanTrip {
  const dep = new Date(opts.departure);
  const arr = new Date(dep.getTime() + opts.durationMins * 60_000);
  return {
    id: opts.id,
    routeId: 'r1',
    routeName: 'Test Route',
    routeOrigin: opts.origin ?? 'Depot',
    routeDestination: 'HQ',
    departureTime: dep.toISOString(),
    arrivalTime: arr.toISOString(),
    durationMins: opts.durationMins,
    distanceKm: 10,
    shiftType: 'MORNING',
    vehicleId: null,
  };
}

describe('block — basic behaviour', () => {
  it('returns an empty result for no trips', () => {
    const r = block([]);
    expect(r.blocks).toEqual([]);
    expect(r.unassignedTripIds).toEqual([]);
    expect(r.summary.blockCount).toBe(0);
  });

  it('packs trips within deadhead window into one block', () => {
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T07:30:00Z', durationMins: 60 }), // 30 min deadhead
    ], { maxDeadheadMins: 60 });
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].tripIds).toEqual(['t1', 't2']);
    expect(r.blocks[0].deadheadMins).toBe(30);
  });

  it('opens a new block when deadhead exceeds limit', () => {
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T08:30:00Z', durationMins: 60 }), // 90 min gap
    ], { maxDeadheadMins: 60 });
    expect(r.blocks).toHaveLength(2);
  });

  it('respects maxBlockWorkMins (sum of trip durations)', () => {
    // Each trip 120 min. 3 trips = 360 min. Default maxBlockWorkMins = 480 (8h)
    // 4 trips = 480 min = at limit. 5 trips = 600 min > limit. So 4th fits, 5th should start a new block.
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 120 }),
      trip({ id: 't2', departure: '2026-08-04T08:00:00Z', durationMins: 120 }),
      trip({ id: 't3', departure: '2026-08-04T10:00:00Z', durationMins: 120 }),
      trip({ id: 't4', departure: '2026-08-04T12:00:00Z', durationMins: 120 }),
      trip({ id: 't5', departure: '2026-08-04T14:00:00Z', durationMins: 120 }),
    ], { maxDeadheadMins: 240 }); // wide enough that work-time is the constraint
    // Block 1: t1, t2, t3, t4 (480 min). Block 2: t5 (120 min).
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].tripIds.length).toBe(4);
    expect(r.blocks[1].tripIds.length).toBe(1);
  });

  it('does not span blocks across dates', () => {
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-05T06:00:00Z', durationMins: 60 }),
    ], { maxDeadheadMins: 60 });
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].date).toBe('2026-08-04');
    expect(r.blocks[1].date).toBe('2026-08-05');
  });

  it('labels blocks sequentially (Block A, Block B, …)', () => {
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-05T06:00:00Z', durationMins: 60 }),
    ], { maxDeadheadMins: 60 });
    expect(r.blocks[0].vehicleLabel).toBe('Block A1');
    expect(r.blocks[1].vehicleLabel).toBe('Block B1');
  });

  it('chooses the block with the smallest deadhead when multiple are candidates', () => {
    // Force t1 and t2 into separate blocks with the default 60-min maxDeadhead.
    //   t1: 06:00-06:30, t2: 08:00-08:30 (90 min deadhead, separate)
    //   t3: 08:40-09:10 (10 min deadhead from t2 end, 130 min from t1 end)
    // t3 should attach to t2 (smaller deadhead).
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 30 }),
      trip({ id: 't2', departure: '2026-08-04T08:00:00Z', durationMins: 30 }),
      trip({ id: 't3', departure: '2026-08-04T08:40:00Z', durationMins: 30 }),
    ]); // default maxDeadheadMins=60, default maxBlockWorkMins=480
    // t1 and t2 in separate blocks (90 min > 60)
    // t3 attaches to t2 (10 min vs 130 min)
    const t3Block = r.blocks.find((b) => b.tripIds.includes('t3'));
    expect(t3Block!.tripIds).toContain('t2');
    expect(t3Block!.tripIds).not.toContain('t1');
    expect(t3Block!.deadheadMins).toBe(10);
  });
});

describe('block — summary metrics', () => {
  it('totals deadhead and work hours correctly', () => {
    // 3 back-to-back trips (60 min each, 60 min apart) → 1 block, 0 deadhead, 3h work
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T07:00:00Z', durationMins: 60 }),
      trip({ id: 't3', departure: '2026-08-04T08:00:00Z', durationMins: 60 }),
    ], { maxDeadheadMins: 60 });
    expect(r.summary.blockCount).toBe(1);
    expect(r.summary.totalWorkHours).toBe(3); // 3 * 60 min = 180 min = 3h
    // Trips are back-to-back (60-min gap = trip duration), so deadhead is 0
    expect(r.summary.totalDeadheadHours).toBe(0);
  });

  it('counts avgTripsPerBlock', () => {
    // 3 trips on 2 days: 1+2 on day1, 1 on day2. t1 ends 07:00, t2 starts 08:00 = 60 min deadhead (at limit, fits).
    // So all 3 are in 2 blocks: [t1, t2] and [t3]. avg = 3/2 = 1.5
    const r = block([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T08:00:00Z', durationMins: 60 }),
      trip({ id: 't3', departure: '2026-08-05T06:00:00Z', durationMins: 60 }),
    ], { maxDeadheadMins: 60 });
    expect(r.summary.blockCount).toBe(2);
    expect(r.summary.avgTripsPerBlock).toBe(1.5); // 3 / 2
  });
});
