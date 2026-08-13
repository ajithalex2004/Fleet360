/**
 * POST /api/bus-ops/plan/[id]/apply
 *
 * Apply a saved plan: write the run→driver and block→vehicle mappings
 * back to trip_schedules. Sets the plan's status to APPLIED and stamps
 * applied_at.
 *
 * Semantics:
 *   - "Apply runs":  every trip in every run gets driverId = run.assignedDriverId.
 *                    If the run doesn't have an assigned driver yet (e.g.
 *                    rostering wasn't computed), this pass is skipped.
 *   - "Apply blocks": every trip in every block gets vehicleId = block.assignedVehicleId.
 *                    We use a deterministic vehicle assignment — take the
 *                    first N available active vehicles in the tenant,
 *                    sorted by license-plate, and pair them with blocks in
 *                    order. The user can later re-assign vehicles manually.
 *
 *   The two passes are independent — applying a plan that has only runs
 *   (no blocks) just sets drivers. Applying a plan that has only blocks
 *   just sets vehicles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

const PLANS_TAG = 'staff-transport-plans';
const SCHEDULES_TAG = 'bus-ops:schedules';

interface BlockTrip {
  tripId: string;
  routeId?: string;
}
interface PlanBlock {
  id: string;
  vehicleLabel: string;
  date: string;
  tripIds: string[];
  trips: BlockTrip[];
}
interface RunTrip {
  tripId: string;
  routeId?: string;
}
interface PlanRun {
  id: string;
  date: string;
  tripIds: string[];
  trips: RunTrip[];
}
interface RosterDay {
  date: string;
  runIds: string[];
}
interface DriverRoster {
  driverId: string;
  days: RosterDay[];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  }

  try {
    const { id } = await params;

    // 1. Load the plan
    const plan = await withTenantRls(prisma, tenantId, async (tx) => {
      return tx.staffTransportPlan.findUnique({ where: { id } });
    });
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    // The schema uses un-suffixed names for these Json fields.
    const runs    = (plan.runs    as unknown as PlanRun[]) ?? [];
    const blocks  = (plan.blocks  as unknown as PlanBlock[]) ?? [];
    const rosters = (plan.rosters as unknown as DriverRoster[]) ?? [];

    // 2. Build the tripId → driverId map from runs + rosters.
    //    First, from rosters (which carry driverId), if present; else runs
    //    don't have an assigned driver.
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

    // 3. Build the tripId → vehicleId map from blocks. Pair blocks with
    //    available vehicles in this tenant (sorted by plate).
    const tripToVehicle = new Map<string, string>();
    const vehicles = await withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.vehicle.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ licensePlate: 'asc' }, { id: 'asc' }],
        take: 200,
        select: { id: true, licensePlate: true, registrationNo: true },
      });
      // Stable secondary sort
      return rows.sort((a, b) => {
        const ak = a.licensePlate ?? a.registrationNo ?? a.id;
        const bk = b.licensePlate ?? b.registrationNo ?? b.id;
        return ak.localeCompare(bk);
      });
    });
    let vehicleIdx = 0;
    for (const block of blocks) {
      const vehicle = vehicles[vehicleIdx++];
      if (!vehicle) break; // out of vehicles — remaining blocks get no assignment
      for (const tripId of block.tripIds) {
        if (!tripToVehicle.has(tripId)) tripToVehicle.set(tripId, vehicle.id);
      }
    }

    // 4. Apply to trip_schedules. Build a single transaction with a
    //    batched update; the SET list includes whichever columns we
    //    actually have a value for.
    const updates = [...new Set([...tripToDriver.keys(), ...tripToVehicle.keys()])];
    let appliedDriver = 0;
    let appliedVehicle = 0;

    await withTenantRls(prisma, tenantId, async (tx) => {
      for (const tripId of updates) {
        const newDriver  = tripToDriver.get(tripId) ?? null;
        const newVehicle = tripToVehicle.get(tripId) ?? null;
        if (!newDriver && !newVehicle) continue;
        const data: { driverId?: string; vehicleId?: string } = {};
        if (newDriver)  { data.driverId  = newDriver;  appliedDriver++; }
        if (newVehicle) { data.vehicleId = newVehicle; appliedVehicle++; }
        await tx.tripSchedule.update({ where: { id: tripId }, data });
      }
      // Mark plan applied
      await tx.staffTransportPlan.update({
        where: { id },
        data: { status: 'APPLIED', appliedAt: new Date() },
      });
    });

    revalidateCache([PLANS_TAG, SCHEDULES_TAG]);

    return NextResponse.json({
      success: true,
      planId: id,
      tripsAffected: updates.length,
      driversAssigned: appliedDriver,
      vehiclesAssigned: appliedVehicle,
      vehiclePoolSize: vehicles.length,
      rostersApplied: rosters.length,
    });
  } catch (e) {
    console.error('[plan apply]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Apply failed' },
      { status: 500 },
    );
  }
}
