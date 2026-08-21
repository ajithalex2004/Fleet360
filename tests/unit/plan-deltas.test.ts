/**
 * Unit tests for src/lib/planning/plan-deltas.ts
 *
 * buildAssignmentDeltasFromPlan is a pure function — no Prisma, no
 * async. Straightforward truth-table coverage of the walking rules.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAssignmentDeltasFromPlan,
  type VehiclePoolRow,
  type PlanShape,
} from '@/lib/planning/plan-deltas';

const pool = (n: number): VehiclePoolRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `veh-${i + 1}`,
    licensePlate: `AA-${(i + 1).toString().padStart(3, '0')}`,
    registrationNo: null,
  }));

describe('buildAssignmentDeltasFromPlan', () => {
  it('returns empty array for an empty plan', () => {
    expect(buildAssignmentDeltasFromPlan({}, pool(3))).toEqual([]);
  });

  it('pairs blocks with vehicles in pool order', () => {
    const plan: PlanShape = {
      blocks: [
        { id: 'b1', vehicleLabel: 'V1', date: '2026-08-14', tripIds: ['t1', 't2'] },
        { id: 'b2', vehicleLabel: 'V2', date: '2026-08-14', tripIds: ['t3'] },
      ],
    };
    const deltas = buildAssignmentDeltasFromPlan(plan, pool(3));
    // t1, t2 → veh-1;  t3 → veh-2
    const byTrip = Object.fromEntries(deltas.map((d) => [d.tripId, d.newVehicleId]));
    expect(byTrip).toEqual({ t1: 'veh-1', t2: 'veh-1', t3: 'veh-2' });
  });

  it('trips past the vehicle pool size get newVehicleId=null (block dropped)', () => {
    const plan: PlanShape = {
      blocks: [
        { id: 'b1', vehicleLabel: 'V1', date: '2026-08-14', tripIds: ['t1'] },
        { id: 'b2', vehicleLabel: 'V2', date: '2026-08-14', tripIds: ['t2'] },
        { id: 'b3', vehicleLabel: 'V3', date: '2026-08-14', tripIds: ['t3'] },
      ],
    };
    const deltas = buildAssignmentDeltasFromPlan(plan, pool(2));
    const byTrip = Object.fromEntries(deltas.map((d) => [d.tripId, d.newVehicleId]));
    expect(byTrip).toEqual({ t1: 'veh-1', t2: 'veh-2' });
    // t3 is not present at all because its block was past the pool
    expect(byTrip.t3).toBeUndefined();
  });

  it('assigns drivers via roster→run→trip chain', () => {
    const plan: PlanShape = {
      runs: [{ id: 'r1', date: '2026-08-14', tripIds: ['t1', 't2'] }],
      rosters: [{ driverId: 'drv-A', days: [{ date: '2026-08-14', runIds: ['r1'] }] }],
    };
    const deltas = buildAssignmentDeltasFromPlan(plan, []);
    const byTrip = Object.fromEntries(deltas.map((d) => [d.tripId, d.newDriverId]));
    expect(byTrip).toEqual({ t1: 'drv-A', t2: 'drv-A' });
  });

  it('a trip touched by both a run and a block gets both driver and vehicle', () => {
    const plan: PlanShape = {
      runs: [{ id: 'r1', date: '2026-08-14', tripIds: ['t1'] }],
      blocks: [{ id: 'b1', vehicleLabel: 'V', date: '2026-08-14', tripIds: ['t1'] }],
      rosters: [{ driverId: 'drv-A', days: [{ date: '2026-08-14', runIds: ['r1'] }] }],
    };
    const [delta] = buildAssignmentDeltasFromPlan(plan, pool(1));
    expect(delta).toEqual({ tripId: 't1', newDriverId: 'drv-A', newVehicleId: 'veh-1' });
  });

  it('roster referencing a missing run is skipped, not errored', () => {
    const plan: PlanShape = {
      runs: [{ id: 'r1', date: '2026-08-14', tripIds: ['t1'] }],
      rosters: [{ driverId: 'drv-A', days: [{ date: '2026-08-14', runIds: ['r-does-not-exist'] }] }],
    };
    expect(buildAssignmentDeltasFromPlan(plan, [])).toEqual([]);
  });
});
