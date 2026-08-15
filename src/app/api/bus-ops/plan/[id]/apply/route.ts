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
import { evaluatePlanApply } from '@/lib/planning/apply-gate';
import {
  buildAssignmentDeltasFromPlan,
  loadVehiclePool,
  type PlanBlock,
  type PlanRun,
  type DriverRoster,
  type VehiclePoolRow,
} from '@/lib/planning/plan-deltas';

const PLANS_TAG = 'staff-transport-plans';
const SCHEDULES_TAG = 'bus-ops:schedules';

/**
 * Feature flag for the PCE apply-gate. Default ON — matches RVE's
 * RESOURCE_VALIDATION_ENABLED pattern. Set PCE_APPLY_GATE_ENABLED='false'
 * to bypass in emergencies (should be followed by a fix, not left off).
 */
function isPceGateEnabled(): boolean {
  return process.env.PCE_APPLY_GATE_ENABLED !== 'false';
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

    // 2. Build tripId → {driverId, vehicleId} deltas via the shared
    //    walker (also used by the planning-optimizer to score without
    //    writing — the two paths agreeing on this walk is what makes
    //    "the optimizer said PASS but apply now says BLOCK" impossible).
    const vehicles: VehiclePoolRow[] = await withTenantRls(prisma, tenantId, (tx) =>
      loadVehiclePool(tx as unknown as typeof prisma, tenantId)
    );
    const deltas = buildAssignmentDeltasFromPlan(
      {
        runs: runs as PlanRun[],
        blocks: blocks as PlanBlock[],
        rosters: rosters as DriverRoster[],
      },
      vehicles
    );
    const tripToDriver = new Map(deltas.filter((d) => d.newDriverId).map((d) => [d.tripId, d.newDriverId!]));
    const tripToVehicle = new Map(deltas.filter((d) => d.newVehicleId).map((d) => [d.tripId, d.newVehicleId!]));

    // 4. Apply to trip_schedules. Build a single transaction with a
    //    batched update; the SET list includes whichever columns we
    //    actually have a value for.
    const updates = deltas.map((d) => d.tripId);
    let appliedDriver = 0;
    let appliedVehicle = 0;

    // 4a. PCE gate — refuse the whole apply if any trip's post-apply
    // state violates a BLOCK-level planning constraint. WARN passes but
    // surfaces in the response payload. Bypassable via env flag for
    // emergency backouts; a bypass leaves an audit trail in the response.
    let gateResult: Awaited<ReturnType<typeof evaluatePlanApply>> | null = null;
    if (isPceGateEnabled() && updates.length > 0) {
      gateResult = await evaluatePlanApply(prisma, { tenantId, deltas });
      if (gateResult.verdict === 'BLOCK') {
        return NextResponse.json(
          {
            error: 'Plan apply blocked by planning constraints.',
            planId: id,
            verdict: 'BLOCK',
            blockedTripIds: gateResult.blockedTripIds,
            trips: gateResult.trips.filter((t) => t.verdict !== 'PASS'),
            totalPenalty: gateResult.totalPenalty,
          },
          { status: 409 }
        );
      }
    }

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
      // Gate diagnostic: absent when disabled by flag, present otherwise.
      // WARN verdicts include warningTripIds so the UI can surface them;
      // PASS is included too so downstream tooling can key on "gate ran".
      pceGate: gateResult
        ? {
            verdict: gateResult.verdict,
            totalPenalty: gateResult.totalPenalty,
            warningTripIds: gateResult.warningTripIds,
            trips: gateResult.trips.filter((t) => t.verdict !== 'PASS'),
          }
        : { verdict: 'DISABLED' as const },
    });
  } catch (e) {
    console.error('[plan apply]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Apply failed' },
      { status: 500 },
    );
  }
}
