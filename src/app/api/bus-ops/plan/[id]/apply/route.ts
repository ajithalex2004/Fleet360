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
 *   - "Apply blocks": every trip in every block gets vehicleId = the block's
 *                    best-fit vehicle, via assignVehiclesToBlocks() —
 *                    gated on seating capacity and vehicle-type match,
 *                    ranked by proximity to the block's first pickup (see
 *                    lib/plan/assign-vehicles.ts for the full algorithm).
 *                    Capacity/type/route data is re-queried fresh at
 *                    Apply time (not read from the saved plan JSON), so
 *                    it reflects current bookings, not whatever they were
 *                    when the plan was computed. A block with no eligible
 *                    vehicle is left unassigned and reported in
 *                    vehicleAssignmentIssues rather than force-fit.
 *
 *   The two passes are independent — applying a plan that has only runs
 *   (no blocks) just sets drivers. Applying a plan that has only blocks
 *   just sets vehicles.
 *
 *   - "PCE apply-gate": once both maps are built, the resulting
 *                    assignment deltas are evaluated against the
 *                    tenant's planning constraints. A BLOCK verdict
 *                    aborts the whole apply with a 409 before anything
 *                    is written — see evaluatePlanApply / apply-gate.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import { evaluatePlanApply } from '@/lib/planning/apply-gate';
import {
  assignVehiclesToBlocks,
  VEHICLE_GROUP_CONFLICT,
  type BlockVehicleRequirement,
  type VehicleCandidate,
} from '@/lib/plan/assign-vehicles';

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
  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;

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

    // 3. Smart vehicle assignment — capacity, vehicle-type, and proximity
    //    to each block's first pickup. Re-query trips/routes/vehicles
    //    fresh (not the saved plan JSON) so this reflects current
    //    bookings and the current fleet, not a stale snapshot.
    const tripToVehicle = new Map<string, string>();
    const vehicleAssignmentIssues: Array<{ blockId: string; vehicleLabel: string; reason: string }> = [];
    const allTripIds = [...new Set(blocks.flatMap((b) => b.tripIds))];

    const [tripFacts, vehicleCandidates] = await withTenantRls(prisma, tenantId, async (tx) => {
      const tripRows = await tx.tripSchedule.findMany({
        where: { id: { in: allTripIds }, tenantId },
        select: {
          id: true,
          confirmedCount: true,
          route: {
            select: {
              requiredVehicleGroup: true,
              zoneId: true,
              stops: { select: { gpsLat: true, gpsLng: true, sequence: true }, orderBy: { sequence: 'asc' }, take: 1 },
            },
          },
        },
      });

      // Proximity uses the vehicle's home depot. There's also a live
      // current_lat/current_lng/current_location_at on the vehicles
      // table, but those columns were never added to schema.prisma (DB
      // has them, the Prisma model doesn't) — pre-existing schema drift,
      // out of scope here. Depot coordinates are properly declared and
      // typed, and are a reasonable proxy for "where this vehicle starts
      // its day" even without a live GPS feed.
      const vehicleRows = await tx.vehicle.findMany({
        where: { tenantId, isActive: true, deletedAt: null },
        take: 200,
        select: {
          id: true, licensePlate: true, seatingCapacity: true, vehicleGroup: true, zoneId: true,
          homeDepot: { select: { centerLat: true, centerLng: true } },
        },
      });
      const candidates: VehicleCandidate[] = vehicleRows.map((v) => ({
        id: v.id,
        licensePlate: v.licensePlate,
        seatingCapacity: v.seatingCapacity,
        vehicleGroup: v.vehicleGroup,
        zoneId: v.zoneId,
        lat: v.homeDepot?.centerLat ?? null,
        lng: v.homeDepot?.centerLng ?? null,
      }));
      return [tripRows, candidates] as const;
    });

    const tripFactsById = new Map(tripFacts.map((t) => [t.id, t]));

    const blockRequirements: BlockVehicleRequirement[] = blocks.map((b) => {
      const relevantTrips = b.tripIds
        .map((tid) => tripFactsById.get(tid))
        .filter((t): t is NonNullable<typeof t> => !!t);
      const maxPassengers = relevantTrips.reduce((m, t) => Math.max(m, t.confirmedCount ?? 0), 0);
      const requiredGroups = new Set(
        relevantTrips.map((t) => t.route.requiredVehicleGroup).filter((g): g is string => !!g),
      );
      const requiredVehicleGroup =
        requiredGroups.size === 0 ? null
        : requiredGroups.size === 1 ? [...requiredGroups][0]
        : VEHICLE_GROUP_CONFLICT;
      // Zone is soft (see assign-vehicles.ts) — unlike requiredVehicleGroup,
      // a block whose trips disagree on zone doesn't need a conflict
      // sentinel, it just falls back to null (no zone-match bonus for
      // this block, ranking drops straight to proximity).
      const zones = new Set(relevantTrips.map((t) => t.route.zoneId).filter((z): z is string => !!z));
      const zoneId = zones.size === 1 ? [...zones][0] : null;
      const firstTripId = b.trips[0]?.tripId;
      const firstStop = firstTripId ? tripFactsById.get(firstTripId)?.route.stops[0] : undefined;
      return {
        blockId: b.id,
        maxPassengers,
        requiredVehicleGroup,
        zoneId,
        pickupPoint: { lat: firstStop?.gpsLat ?? null, lng: firstStop?.gpsLng ?? null },
      };
    });

    const vehicleAssignments = assignVehiclesToBlocks(blockRequirements, vehicleCandidates);
    for (const a of vehicleAssignments) {
      const b = blocks.find((bl) => bl.id === a.blockId);
      if (!b) continue;
      if (a.vehicleId) {
        for (const tripId of b.tripIds) {
          if (!tripToVehicle.has(tripId)) tripToVehicle.set(tripId, a.vehicleId);
        }
      } else {
        vehicleAssignmentIssues.push({ blockId: a.blockId, vehicleLabel: b.vehicleLabel, reason: a.reason ?? 'UNKNOWN' });
      }
    }

    // 4. Apply to trip_schedules. Build a single transaction with a
    //    batched update; the SET list includes whichever columns we
    //    actually have a value for.
    const updates = [...new Set([...tripToDriver.keys(), ...tripToVehicle.keys()])];
    let appliedDriver = 0;
    let appliedVehicle = 0;

    // 4a. PCE apply-gate — evaluate the resulting assignment deltas
    //     against the tenant's planning constraints BEFORE writing
    //     anything. A BLOCK verdict aborts the entire apply with a 409;
    //     PASS/WARN fall through and the verdict is echoed in the
    //     success payload so the UI can surface warnings.
    let gateResult: Awaited<ReturnType<typeof evaluatePlanApply>> | null = null;
    if (isPceGateEnabled() && updates.length > 0) {
      const deltas = updates.map((tripId) => ({
        tripId,
        newDriverId: tripToDriver.get(tripId) ?? null,
        newVehicleId: tripToVehicle.get(tripId) ?? null,
      }));
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
          { status: 409 },
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
      vehiclePoolSize: vehicleCandidates.length,
      rostersApplied: rosters.length,
      vehicleAssignmentIssues,
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
