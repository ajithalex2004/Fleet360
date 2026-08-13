/**
 * tests/unit/plan-runcut.test.ts
 *
 * Unit tests for the runcutting algorithm (lib/plan/runcut.ts).
 *
 * Strategy: feed hand-built trip lists with known properties, then assert
 * on run count, run contents, pay hours, OT detection, and unassigned trip
 * handling. Pure functions — no DB, no network.
 */

import { describe, expect, it } from 'vitest';
import {
  runcut,
  DEFAULT_WORK_RULES,
  type PlanTrip,
  type WorkRules,
} from '@/lib/plan/runcut';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a trip with sensible defaults. arrival = departure + durationMins. */
function trip(opts: {
  id: string;
  departure: string;     // ISO
  durationMins: number;
  routeId?: string;
  shift?: 'MORNING' | 'EVENING' | 'NIGHT' | 'SPLIT';
  origin?: string;
}): PlanTrip {
  const dep = new Date(opts.departure);
  const arr = new Date(dep.getTime() + opts.durationMins * 60_000);
  return {
    id: opts.id,
    routeId: opts.routeId ?? 'r1',
    routeName: 'Test Route',
    routeOrigin: opts.origin ?? 'Depot',
    routeDestination: 'HQ',
    departureTime: dep.toISOString(),
    arrivalTime: arr.toISOString(),
    durationMins: opts.durationMins,
    distanceKm: 10,
    shiftType: opts.shift ?? 'MORNING',
    vehicleId: null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('runcut — basic behaviour', () => {
  it('returns an empty result for no trips', () => {
    const r = runcut([]);
    expect(r.runs).toEqual([]);
    expect(r.unassignedTripIds).toEqual([]);
    expect(r.summary.runCount).toBe(0);
    expect(r.summary.tripCount).toBe(0);
    expect(r.summary.avgTripsPerRun).toBe(0);
  });

  it('packs a single trip into a single run', () => {
    const r = runcut([trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 })]);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].tripIds).toEqual(['t1']);
    expect(r.summary.runCount).toBe(1);
    expect(r.summary.tripCount).toBe(1);
  });

  it('packs two back-to-back trips into one run when rules allow', () => {
    // Trip 1: 06:00–07:00, Trip 2: 07:30–08:00 — 30-min break satisfies default
    const r = runcut([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T07:30:00Z', durationMins: 30 }),
    ]);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].tripIds).toEqual(['t1', 't2']);
  });

  it('opens a second run when the break is too short', () => {
    // Trip 1: 06:00–08:00, Trip 2: 08:10–08:30 — break is 10 min, default is 30
    const r = runcut([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 120 }),
      trip({ id: 't2', departure: '2026-08-04T08:10:00Z', durationMins: 20 }),
    ]);
    expect(r.runs).toHaveLength(2);
    expect(r.runs[0].tripIds).toEqual(['t1']);
    expect(r.runs[1].tripIds).toEqual(['t2']);
  });

  it('respects maxWorkHoursPerDay — caps a run at 8h', () => {
    // 6 trips of 60 min each = 6h drive. Spaced 60+15=75 min apart, so
    // each gap (trip-end to next trip-start) is 15 min. With minBreak=0
    // they all attach; workMins = 15 + 10 + 360 + 75 = 460 = 7.67h — fits
    // in one run. Now if we tighten maxWorkHours to 4h, the run caps.
    const trips: PlanTrip[] = [];
    let cursor = new Date('2026-08-04T06:00:00Z').getTime();
    for (let i = 1; i <= 6; i++) {
      trips.push(trip({
        id: `t${i}`,
        departure: new Date(cursor).toISOString(),
        durationMins: 60,
      }));
      cursor += 60 * 60_000 + 15 * 60_000; // 1h drive + 15 min deadhead
    }
    const r1 = runcut(trips, { ...DEFAULT_WORK_RULES, minBreakBetweenTripsMins: 0 });
    // 1 run, all 6 trips (work = 7.67h, under 8h cap)
    expect(r1.runs).toHaveLength(1);
    expect(r1.runs[0].tripIds).toHaveLength(6);

    // Now cap at 4h — should split
    const r2 = runcut(trips, { ...DEFAULT_WORK_RULES, minBreakBetweenTripsMins: 0, maxWorkHoursPerDay: 4 });
    // 3 trips of 60 min = 180 + 15 + 10 + 2*15 = 235 = 3.9h — fits
    // 4 trips of 60 min = 240 + 15 + 10 + 3*15 = 310 = 5.2h — fails 4h cap
    expect(r2.runs.length).toBeGreaterThanOrEqual(2);
  });

  it('does not span runs across dates', () => {
    // Trip on day 1 and trip on day 2 — should be separate runs
    const r = runcut([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-05T06:00:00Z', durationMins: 60 }),
    ]);
    expect(r.runs).toHaveLength(2);
    expect(r.runs[0].date).toBe('2026-08-04');
    expect(r.runs[1].date).toBe('2026-08-05');
  });

  it('respects maxTripsPerRun', () => {
    // maxTripsPerRun = 2 with 3 trips — should be 2 runs
    const r = runcut(
      [
        trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
        trip({ id: 't2', departure: '2026-08-04T08:00:00Z', durationMins: 60 }),
        trip({ id: 't3', departure: '2026-08-04T10:00:00Z', durationMins: 60 }),
      ],
      { ...DEFAULT_WORK_RULES, maxTripsPerRun: 2 },
    );
    // Run 1: t1, t2 (capped at 2). Run 2: t3.
    expect(r.runs).toHaveLength(2);
    expect(r.runs[0].tripIds.length).toBe(2);
    expect(r.runs[1].tripIds.length).toBe(1);
    expect(r.runs[0].notes.some((n) => n.includes('max-trip cap'))).toBe(true);
  });
});

describe('runcut — pay computation', () => {
  it('computes straight-time + OT correctly for a run that exceeds 8h', () => {
    // 5 trips of 100 min each, 15 min deadhead between, with a 10h work cap
    // so they all fit in one run.
    // workMins = 5*100 + 15 (report) + 10 (wrap) + 4*15 (deadhead)
    //          = 500 + 25 + 60 = 585 min = 9.75h
    // straight = 480 min (8h), OT = 105 min (1.75h)
    // cost: 8h*25 + 1.75h*25*1.5 = 200 + 65.625 = 265.625
    const trips: PlanTrip[] = [];
    let cursor = new Date('2026-08-04T06:00:00Z').getTime();
    for (let i = 1; i <= 5; i++) {
      trips.push(trip({
        id: `t${i}`,
        departure: new Date(cursor).toISOString(),
        durationMins: 100,
      }));
      cursor += 100 * 60_000 + 15 * 60_000; // 100 min drive + 15 min deadhead
    }
    const r = runcut(trips, {
      ...DEFAULT_WORK_RULES,
      minBreakBetweenTripsMins: 0,
      maxWorkHoursPerDay: 10,
    });
    expect(r.runs).toHaveLength(1);
    const run = r.runs[0];
    expect(run.workMins).toBe(585);
    expect(run.straightTimeMins).toBe(480);
    expect(run.overtimeMins).toBe(105);
    expect(run.payCost).toBeCloseTo(265.625, 1);
    expect(run.notes.some((n) => n.includes('overtime'))).toBe(true);
  });

  it('uses defaults when rules are not provided', () => {
    const r = runcut([trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 })]);
    expect(r.runs[0].workMins).toBe(60 + DEFAULT_WORK_RULES.reportTimeMins + DEFAULT_WORK_RULES.wrapTimeMins);
  });

  it('summary aggregates payCost and payHours across runs', () => {
    const rules: WorkRules = { ...DEFAULT_WORK_RULES, minBreakBetweenTripsMins: 0, maxTripsPerRun: 1 };
    const r = runcut([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T08:00:00Z', durationMins: 60 }),
    ], rules);
    expect(r.runs).toHaveLength(2);
    const sumPay = r.runs.reduce((s, run) => s + run.payCost, 0);
    expect(r.summary.totalPayCost).toBeCloseTo(sumPay, 2);
    expect(r.summary.runCount).toBe(2);
  });
});

describe('runcut — summary metrics', () => {
  it('computes avgTripsPerRun correctly', () => {
    const r = runcut([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T08:00:00Z', durationMins: 60 }),
      trip({ id: 't3', departure: '2026-08-04T10:00:00Z', durationMins: 60 }),
      trip({ id: 't4', departure: '2026-08-05T06:00:00Z', durationMins: 60 }),
    ], { ...DEFAULT_WORK_RULES, minBreakBetweenTripsMins: 0 });
    // 3 trips on day 1, 1 on day 2 — 2 runs
    expect(r.runs).toHaveLength(2);
    expect(r.summary.avgTripsPerRun).toBe(2); // 4 / 2
  });

  it('computes spreadMins from first departure to last arrival + report + wrap', () => {
    const r = runcut([
      trip({ id: 't1', departure: '2026-08-04T06:00:00Z', durationMins: 60 }),
      trip({ id: 't2', departure: '2026-08-04T08:00:00Z', durationMins: 60 }),
    ], { ...DEFAULT_WORK_RULES, minBreakBetweenTripsMins: 0 });
    // First dep 06:00, last arr 09:00 = 180 min. + 15 report + 10 wrap = 205 min
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].spreadMins).toBe(205);
  });
});
