/**
 * Shared plan → assignment-delta builder.
 *
 * A saved StaffTransportPlan carries `runs`, `blocks`, and `rosters` as
 * JSON. The tripId → {driverId, vehicleId} mapping they imply is what
 * both the /plan/[id]/apply route (to actually write) and the
 * planning-optimizer (to score without writing) need.
 *
 * Keeping the walk in one place means the optimizer scores exactly what
 * apply would produce — a divergence would silently make the ranking
 * useless ("optimizer said this plan is fine but apply now says BLOCK").
 *
 * Vehicle pairing is deliberately deterministic (sort by plate,
 * position-in-blocks order) so the same plan always yields the same
 * deltas across scoring runs.
 */

import type { PrismaClient } from '@prisma/client';
import type { AssignmentDelta } from './apply-gate';

// ── JSON shapes stored in StaffTransportPlan.runs / .blocks / .rosters
// Duplicated here rather than imported from the runcut/block/roster
// modules because the DB stores plain JSON; if the algorithm module's
// types drift these are the wire contract we actually depend on.

export type PlanRun = {
  id: string;
  date: string;
  tripIds: string[];
};

export type PlanBlock = {
  id: string;
  vehicleLabel: string;
  date: string;
  tripIds: string[];
};

export type RosterDay = {
  date: string;
  runIds: string[];
};

export type DriverRoster = {
  driverId: string;
  days: RosterDay[];
};

export type PlanShape = {
  runs?: PlanRun[] | null;
  blocks?: PlanBlock[] | null;
  rosters?: DriverRoster[] | null;
};

export type VehiclePoolRow = {
  id: string;
  licensePlate: string | null;
  registrationNo: string | null;
};

/**
 * Fetches the vehicle pool the plan will pair its blocks against.
 * Sorted deterministically so the pairing is reproducible across
 * scoring calls and matches what apply would do.
 */
export async function loadVehiclePool(
  prisma: PrismaClient,
  tenantId: string
): Promise<VehiclePoolRow[]> {
  const rows = await prisma.vehicle.findMany({
    where: { tenantId, isActive: true, deletedAt: null },
    orderBy: [{ licensePlate: 'asc' }, { id: 'asc' }],
    take: 200,
    select: { id: true, licensePlate: true, registrationNo: true },
  });
  return rows.sort((a, b) => {
    const ak = a.licensePlate ?? a.registrationNo ?? a.id;
    const bk = b.licensePlate ?? b.registrationNo ?? b.id;
    return ak.localeCompare(bk);
  });
}

/**
 * Walks a plan's rosters/runs to derive tripId → driverId, and its
 * blocks to derive tripId → vehicleId (via the provided vehicle pool),
 * then returns the union as AssignmentDelta[] suitable for
 * evaluatePlanApply.
 *
 * Trips referenced by a run without a roster-assigned driver get
 * driverId=null; blocks past the vehicle pool size get vehicleId=null.
 * A trip touched by neither is dropped — no delta to evaluate.
 */
export function buildAssignmentDeltasFromPlan(
  plan: PlanShape,
  vehiclePool: VehiclePoolRow[]
): AssignmentDelta[] {
  const runs = plan.runs ?? [];
  const blocks = plan.blocks ?? [];
  const rosters = plan.rosters ?? [];

  const tripToDriver = new Map<string, string>();
  for (const roster of rosters) {
    for (const day of roster.days) {
      for (const runId of day.runIds) {
        const run = runs.find((r) => r.id === runId);
        if (!run) continue;
        for (const tripId of run.tripIds) {
          if (!tripToDriver.has(tripId)) tripToDriver.set(tripId, roster.driverId);
        }
      }
    }
  }

  const tripToVehicle = new Map<string, string>();
  let vehicleIdx = 0;
  for (const block of blocks) {
    const vehicle = vehiclePool[vehicleIdx++];
    if (!vehicle) break;
    for (const tripId of block.tripIds) {
      if (!tripToVehicle.has(tripId)) tripToVehicle.set(tripId, vehicle.id);
    }
  }

  const allTripIds = new Set<string>([...tripToDriver.keys(), ...tripToVehicle.keys()]);
  return [...allTripIds].map((tripId) => ({
    tripId,
    newDriverId: tripToDriver.get(tripId) ?? null,
    newVehicleId: tripToVehicle.get(tripId) ?? null,
  }));
}
