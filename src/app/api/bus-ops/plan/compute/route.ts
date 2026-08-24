/**
 * POST /api/bus-ops/plan/compute
 *
 * Compute a runcutting + blocking + (optional) rostering plan for a
 * date range and return the result. Optionally persist the plan to
 * the database by passing `save: true` + `name` + `description`.
 *
 * Body:
 *   {
 *     dateFrom:           string  (YYYY-MM-DD)
 *     dateTo:             string  (YYYY-MM-DD)
 *     name?:              string
 *     description?:       string
 *     save?:              boolean
 *     workRules:          WorkRules
 *     blockOptions?:      BlockOptions
 *     roster?:            { defaultPattern?: RosterPattern, driverIds?: string[] }
 *   }
 *
 * Response:
 *   { plan: { id, name, ..., runs, blocks, rosters, summary } }
 *   When `save: true`, the plan gets a real DB id and is queryable via
 *   GET /api/bus-ops/plan/[id].
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';
import { runcut, type PlanTrip, DEFAULT_WORK_RULES, type WorkRules } from '@/lib/plan/runcut';
import { block, type BlockOptions } from '@/lib/plan/block';
import { roster, type RosterPattern, type RosterDriver } from '@/lib/plan/roster';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import {
  resolveVehicleTurnaroundMinutes,
  resolveMaxVehicleReuseWindowMinutes,
} from '@/lib/planning/route-consolidation-vehicle-reuse-policy';
import { resolveZoneFallbackKm } from '@/lib/planning/zone-compat-policy';
import { resolveCbaWorkRules } from '@/lib/cba/engine';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const CACHE_TAG = 'staff-transport-plans';

export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id') ?? '';
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }
    const permError = requireBusOpsAdminAccess(req, 'planning-core');
    if (permError) return permError;

    const body = await req.json();
    const {
      dateFrom,
      dateTo,
      name,
      description,
      save,
      workRules,
      blockOptions,
      roster: rosterOpts,
    } = body as {
      dateFrom: string;
      dateTo: string;
      name?: string;
      description?: string;
      save?: boolean;
      workRules?: WorkRules;
      blockOptions?: BlockOptions;
      roster?: { defaultPattern?: RosterPattern; driverIds?: string[] };
    };

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
    }
    if (new Date(dateTo) < new Date(dateFrom)) {
      return NextResponse.json({ error: 'dateTo must be after dateFrom' }, { status: 400 });
    }

    // 1. Load trips in the date range (scoped to this tenant) and resolve
    //    the PCE-driven blocking thresholds + the tenant's default CBA
    //    work rules in parallel — none of these depend on each other,
    //    and the lookups are cheap tenant-level reads.
    const [trips, minTurnaroundMins, resolvedMaxDeadheadMins, zoneFallbackKm, cbaWorkRules] = await Promise.all([
      withTenantRls(prisma, tenantId, async (tx) => {
        const rows = await tx.tripSchedule.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: { not: 'CANCELLED' },
            departureTime: {
              gte: new Date(`${dateFrom}T00:00:00Z`),
              lte: new Date(`${dateTo}T23:59:59Z`),
            },
          },
          include: {
            route: {
              select: {
                name: true, origin: true, destination: true, estimatedDurationMins: true, totalDistanceKm: true,
                stops: { select: { placeId: true, gpsLat: true, gpsLng: true, sequence: true }, orderBy: { sequence: 'asc' } },
              },
            },
          },
          orderBy: { departureTime: 'asc' },
        });
        return rows.map((t) => {
          const depMs = t.departureTime.getTime();
          const arr = t.arrivalTime ?? new Date(depMs + (t.route.estimatedDurationMins ?? 60) * 60_000);
          const durationMins = Math.max(15, Math.round((arr.getTime() - depMs) / 60_000));
          const stops = t.route.stops;
          const pickupStop = stops[0];
          const dropoffStop = stops[stops.length - 1];
          const planTrip: PlanTrip = {
            id: t.id,
            routeId: t.routeId,
            routeName: t.route.name,
            routeOrigin: t.route.origin,
            routeDestination: t.route.destination,
            departureTime: t.departureTime.toISOString(),
            arrivalTime: arr.toISOString(),
            durationMins,
            distanceKm: t.route.totalDistanceKm,
            shiftType: (t.shiftType as 'MORNING' | 'EVENING' | 'NIGHT' | 'SPLIT' | null) ?? 'MORNING',
            vehicleId: t.vehicleId,
            pickupPoint: pickupStop ? { placeId: pickupStop.placeId, lat: pickupStop.gpsLat, lng: pickupStop.gpsLng } : undefined,
            dropoffPoint: dropoffStop ? { placeId: dropoffStop.placeId, lat: dropoffStop.gpsLat, lng: dropoffStop.gpsLng } : undefined,
          };
          return planTrip;
        });
      }),
      // Hard floor — never overridable from the request body (see
      // BlockOptions.minTurnaroundMins doc in block.ts for why).
      resolveVehicleTurnaroundMinutes(prisma, tenantId),
      // Business-tradeoff ceiling — PCE default, per-run override allowed.
      resolveMaxVehicleReuseWindowMinutes(prisma, tenantId, blockOptions?.maxDeadheadMins),
      // Geography gate threshold — Case 2 reuses the pickup-side fallback
      // for this exact "A.dropoff vs B.pickup" comparison; match it.
      resolveZoneFallbackKm(prisma, tenantId).then((z) => z.pickup),
      // Tenant's default CBA rule-set, converted to WorkRules. null when
      // no default rule-set exists — falls back to DEFAULT_WORK_RULES
      // below, same as before this was wired in.
      resolveCbaWorkRules(prisma, tenantId),
    ]);

    // CBA is the tenant-level default layer, same precedence pattern as
    // maxDeadheadMins above — an explicit request-body value still wins
    // (the Planning Core page pre-fills its form from this same CBA
    // resolution client-side, so by the time a value reaches here as an
    // explicit override it reflects a deliberate edit, not a stale
    // hardcoded default silently beating the tenant's CBA).
    const rules: WorkRules = { ...DEFAULT_WORK_RULES, ...(cbaWorkRules ?? {}), ...(workRules ?? {}) };

    const blockOpts: BlockOptions = {
      ...(blockOptions ?? {}),
      maxDeadheadMins: resolvedMaxDeadheadMins,
      minTurnaroundMins,
      zoneFallbackKm,
    };

    if (trips.length === 0) {
      return NextResponse.json({
        plan: {
          name: name ?? 'Plan',
          description: description ?? null,
          dateFrom,
          dateTo,
          workRules: rules,
          blockOptions: blockOpts,
          runs: [],
          blocks: [],
          rosters: [],
          summary: {
            tripCount: 0, runCount: 0, blockCount: 0, driverCount: 0,
            avgTripsPerRun: 0, avgTripsPerBlock: 0, avgRunsPerDriver: 0,
            totalPayHours: 0, totalPayCost: 0, totalWorkHours: 0,
            totalDeadheadHours: 0, overtimeHours: 0,
          },
          unassignedTripIds: [],
        },
      });
    }

    // 2. Runcut (driver piece-of-work)
    const runcutResult = runcut(trips, rules);

    // 3. Block (vehicle grouping)
    const blockResult = block(trips, blockOpts, rules);

    // 4. Optional rostering
    let rosterResult: ReturnType<typeof roster> = {
      rosters: [], unassignedRunIds: [], summary: { runCount: 0, driverCount: 0, avgRunsPerDriver: 0, totalWorkHours: 0, overtimeHours: 0 },
    };
    if (rosterOpts?.driverIds && rosterOpts.driverIds.length > 0) {
      const drivers = await withTenantRls(prisma, tenantId, async (tx) => {
        const rows = await tx.driver.findMany({
          where: { id: { in: rosterOpts.driverIds }, deletedAt: null, status: { not: 'INACTIVE' } },
          select: { id: true, firstName: true, lastName: true, name: true, licenseType: true },
        });
        return rows.map((d) => ({
          id: d.id,
          name: d.name ?? ([d.firstName, d.lastName].filter(Boolean).join(' ') || 'Driver'),
          licenseType: d.licenseType,
          pattern: rosterOpts.defaultPattern ?? '5/2',
        }));
      });
      rosterResult = roster(runcutResult.runs, drivers, { defaultPattern: rosterOpts.defaultPattern }, rules);
    }

    // 5. Combined summary
    const combinedSummary = {
      tripCount: trips.length,
      runCount: runcutResult.runs.length,
      blockCount: blockResult.blocks.length,
      driverCount: rosterResult.rosters.length,
      avgTripsPerRun:  runcutResult.summary.avgTripsPerRun,
      avgTripsPerBlock: blockResult.summary.avgTripsPerBlock,
      avgRunsPerDriver: rosterResult.summary.avgRunsPerDriver,
      totalPayHours:  runcutResult.summary.totalPayHours,
      totalPayCost:   runcutResult.summary.totalPayCost,
      totalWorkHours: blockResult.summary.totalWorkHours,
      totalDeadheadHours: blockResult.summary.totalDeadheadHours,
      overtimeHours:  runcutResult.summary.overtimeHours,
    };

    let savedId: string | null = null;
    if (save) {
      const created = await withTenantRls(prisma, tenantId, async (tx) => {
        return tx.staffTransportPlan.create({
          data: {
            tenantId,
            name: name ?? `Plan ${dateFrom} → ${dateTo}`,
            description: description ?? null,
            dateFrom: new Date(`${dateFrom}T00:00:00Z`),
            dateTo:   new Date(`${dateTo}T00:00:00Z`),
            // The schema uses the un-suffixed names for these Json fields
            // (workRules, blockOptions, runs, blocks, rosters, summary).
            workRules:    rules             as unknown as object,
            blockOptions: blockOpts         as unknown as object,
            runs:         runcutResult.runs as unknown as object,
            blocks:       blockResult.blocks as unknown as object,
            rosters:      rosterResult.rosters as unknown as object,
            summary:      combinedSummary   as unknown as object,
            status: 'DRAFT',
          },
        });
      });
      savedId = created.id;
      revalidateCache([CACHE_TAG]);
    }

    return NextResponse.json({
      plan: {
        id: savedId,
        name: name ?? `Plan ${dateFrom} → ${dateTo}`,
        description: description ?? null,
        dateFrom,
        dateTo,
        workRules: rules,
        blockOptions: blockOpts,
        runs: runcutResult.runs,
        blocks: blockResult.blocks,
        rosters: rosterResult.rosters,
        summary: combinedSummary,
        unassignedTripIds: runcutResult.unassignedTripIds,
        unassignedRosterRunIds: rosterResult.unassignedRunIds,
      },
    });
  } catch (e) {
    console.error('[plan/compute]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Plan compute failed' },
      { status: 500 },
    );
  }
}
