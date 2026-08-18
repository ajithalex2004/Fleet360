/**
 * Fleet Routing — solve orchestrator.
 *
 * Drives the FleetOptimizationRun state machine end-to-end:
 *
 *   PENDING → VALIDATING → SOLVING → SUCCESS | INFEASIBLE | FAILED
 *                              ↓
 *                          CANCELLED (if run was cancelled mid-flight)
 *
 * State transitions are persisted at each step so the polling API + UI
 * see progress. Structured results are written on SUCCESS/INFEASIBLE;
 * raw Google response is preserved on every non-FAILED run for
 * traceability.
 *
 * Not exported: startSolve() is the public entrypoint from the /solve
 * endpoint. It creates the run row, kicks off the async pipeline, and
 * returns the runId immediately. The pipeline runs in the background.
 */

import { prisma } from '@/lib/prisma';
import { assembleInputs, AssemblyError } from './assemble-inputs';
import { buildOptimizeToursRequest } from './input-builder';
import { optimizeTours, GoogleApiError } from './google-client';
import { parseSuccess } from './response-parser';
import type { RunStatus } from './types';

// ── Public API ──────────────────────────────────────────────────────────────

export interface StartSolveInput {
  tenantId:    string;
  createdBy:   string;
  targetDate:  Date;
  vehicleIds?: string[];
  /** Optional solver wall-clock budget. Default '30s'. */
  timeout?:    string;
}

/**
 * Create a run row, kick off the async solve pipeline, return the runId.
 * The pipeline is fire-and-forget; the caller polls GET /runs/:id for
 * status updates. Errors thrown inside the pipeline are caught and
 * written to the row as FAILED — they never bubble out.
 */
export async function startSolve(input: StartSolveInput): Promise<{ runId: string }> {
  const run = await prisma.fleetOptimizationRun.create({
    data: {
      tenantId:  input.tenantId,
      createdBy: input.createdBy,
      status:    'PENDING' satisfies RunStatus,
      targetDate: input.targetDate,
      inputSnapshot: {
        requestedVehicleIds: input.vehicleIds ?? null,
        timeout: input.timeout ?? '30s',
      },
    },
    select: { id: true },
  });

  // Kick off the pipeline. void so we don't block the API response.
  void runSolvePipeline({ runId: run.id, ...input }).catch(err => {
    // Last-ditch safety net — the pipeline internals should have caught
    // this already, but if something slips through we mark the run FAILED
    // rather than leaving it stuck in SOLVING forever.
    console.error(`[fleet-routing/orchestrator] runaway error on run ${run.id}:`, err);
    void prisma.fleetOptimizationRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED' satisfies RunStatus,
        statusReason: 'Uncaught pipeline error — see server logs',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => { /* really give up */ });
  });

  return { runId: run.id };
}

// ── Pipeline internals ──────────────────────────────────────────────────────

interface PipelineInput extends StartSolveInput { runId: string }

async function runSolvePipeline(input: PipelineInput): Promise<void> {
  const { runId } = input;
  const solveStart = Date.now();

  // ── 1. VALIDATING ─────────────────────────────────────────────────────────
  await setStatus(runId, 'VALIDATING', 'Assembling shipments + vehicles');

  let assembled: Awaited<ReturnType<typeof assembleInputs>>;
  try {
    assembled = await assembleInputs({
      tenantId:   input.tenantId,
      targetDate: input.targetDate,
      vehicleIds: input.vehicleIds,
    });
  } catch (e) {
    // AssemblyError = validation failure; other errors = FAILED with generic reason.
    const isAssembly = e instanceof AssemblyError;
    await setStatus(
      runId,
      'FAILED',
      isAssembly ? `Input validation: ${(e as AssemblyError).code}` : 'Input assembly threw',
      e instanceof Error ? e.message : String(e),
    );
    return;
  }

  // Enrich the input snapshot with the assembler's meta so the UI can render
  // "N routes touched" / "N passengers dropped" without a second query.
  await prisma.fleetOptimizationRun.update({
    where: { id: runId },
    data: {
      inputSnapshot: {
        ...(await getRunInputSnapshot(runId)),
        assemblyMeta: assembled.meta,
        globalStart: assembled.globalStart,
        globalEnd:   assembled.globalEnd,
      },
    },
  });

  // Guard: if the run was cancelled while we were assembling, don't burn a solve.
  if (await wasCancelled(runId)) return;

  // ── 2. SOLVING ───────────────────────────────────────────────────────────
  await setStatus(runId, 'SOLVING', `Solving ${assembled.shipments.length} shipments across ${assembled.vehicles.length} vehicles`);

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!projectId) {
    await setStatus(runId, 'FAILED', 'GOOGLE_CLOUD_PROJECT_ID env var not set');
    return;
  }

  const request = buildOptimizeToursRequest({
    projectId,
    shipments:   assembled.shipments,
    vehicles:    assembled.vehicles,
    globalStart: assembled.globalStart,
    globalEnd:   assembled.globalEnd,
    timeout:     input.timeout ?? '30s',
  });

  let rawResponse: Awaited<ReturnType<typeof optimizeTours>>;
  try {
    rawResponse = await optimizeTours(request);
  } catch (e) {
    // Non-2xx from Google = FAILED (auth/quota/network). NOT infeasible.
    const isGoogle = e instanceof GoogleApiError;
    await setStatus(
      runId,
      'FAILED',
      isGoogle ? `Google API error HTTP ${(e as GoogleApiError).status}` : 'Google API call threw',
      isGoogle
        ? `${(e as GoogleApiError).responseBody.slice(0, 500)}`
        : e instanceof Error ? e.message : String(e),
    );
    return;
  }

  // If cancelled mid-solve, we still persist the results (paid for them)
  // but mark the final state CANCELLED so the operator sees their intent
  // was respected.
  const cancelledMidflight = await wasCancelled(runId);

  // ── 3. Persist raw + parsed results ──────────────────────────────────────
  const solveSec = (Date.now() - solveStart) / 1000;

  // Look up driver ids for each requested vehicle — needed for structured
  // route rows. Cheap: one query, keys on vehicleId.
  const driverLookup = new Map<string, string | null>();
  const vehiclesForLookup = await prisma.vehicle.findMany({
    where: { id: { in: assembled.vehicles.map(v => v.vehicleId) } },
    select: { id: true },
  });
  for (const v of vehiclesForLookup) driverLookup.set(v.id, null); // driver TBD in later phase

  const parsed = parseSuccess(rawResponse, assembled.shipments, driverLookup, solveSec);
  const routeCount = parsed.routes.length;

  // ── 4. Final status ──────────────────────────────────────────────────────
  let finalStatus: RunStatus;
  let statusReason: string;
  if (cancelledMidflight) {
    finalStatus = 'CANCELLED';
    statusReason = 'Cancelled by operator during solve; results retained for audit';
  } else if (routeCount === 0) {
    // Google returned no routes at all — problem is genuinely infeasible.
    finalStatus = 'INFEASIBLE';
    statusReason = parsed.unassigned.length > 0
      ? `No feasible routes; ${parsed.unassigned.length} shipment(s) rejected`
      : 'No feasible routes and no shipments — check vehicle capacity and time windows';
  } else {
    // At least one route was produced. Success even if some shipments were
    // skipped (those are still surfaced in the unassigned table so the
    // operator can decide whether to relax constraints and re-solve).
    finalStatus = 'SUCCESS';
    statusReason = parsed.unassigned.length > 0
      ? `${routeCount} route(s) generated; ${parsed.unassigned.length} shipment(s) unassigned`
      : `${routeCount} route(s) generated; all shipments assigned`;
  }

  await prisma.$transaction(async (tx) => {
    await tx.fleetOptimizationRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        statusReason,
        rawResponse: rawResponse as unknown as object,
        metrics: {
          totalDistanceKm:  parsed.metrics.totalDistanceKm,
          totalDurationMin: parsed.metrics.totalDurationMin,
          unassignedCount:  parsed.metrics.unassignedCount,
          solveSec:         parsed.metrics.solveSec,
        },
      },
    });

    // Persist structured children only when we actually got results.
    for (const r of parsed.routes) {
      const created = await tx.fleetOptimizationRunRoute.create({
        data: {
          tenantId: input.tenantId,
          runId,
          vehicleId:        r.vehicleId,
          driverId:         r.driverId,
          sequenceInRun:    r.sequenceInRun,
          totalDistanceKm:  r.totalDistanceKm,
          totalDurationMin: r.totalDurationMin,
          totalPassengers:  r.totalPassengers,
          encodedPolyline:  r.encodedPolyline,
          startTime:        r.startTime,
          endTime:          r.endTime,
        },
        select: { id: true },
      });
      if (r.stops.length > 0) {
        await tx.fleetOptimizationRunStop.createMany({
          data: r.stops.map(s => ({
            tenantId: input.tenantId,
            runRouteId:     created.id,
            sequence:       s.sequence,
            stopId:         s.stopId,
            lat:            s.lat,
            lng:            s.lng,
            label:          s.label,
            arrivalTime:    s.arrivalTime,
            departureTime:  s.departureTime,
            passengerCount: s.passengerCount,
            passengerIds:   s.passengerIds as unknown as object,
          })),
        });
      }
    }

    if (parsed.unassigned.length > 0) {
      await tx.fleetOptimizationRunUnassigned.createMany({
        data: parsed.unassigned.map(u => ({
          tenantId: input.tenantId,
          runId,
          passengerId:  u.passengerId,
          stopLat:      u.stopLat,
          stopLng:      u.stopLng,
          stopLabel:    u.stopLabel,
          reason:       u.reason,
          reasonDetail: u.reasonDetail,
        })),
      });
    }
  });
}

// ── Small helpers ──────────────────────────────────────────────────────────

async function setStatus(
  runId: string,
  status: RunStatus,
  reason?: string,
  errorMessage?: string,
): Promise<void> {
  await prisma.fleetOptimizationRun.update({
    where: { id: runId },
    data: {
      status,
      statusReason: reason ?? null,
      errorMessage: errorMessage ?? null,
    },
  });
}

async function wasCancelled(runId: string): Promise<boolean> {
  const row = await prisma.fleetOptimizationRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  return row?.status === 'CANCELLED';
}

async function getRunInputSnapshot(runId: string): Promise<Record<string, unknown>> {
  const row = await prisma.fleetOptimizationRun.findUnique({
    where: { id: runId },
    select: { inputSnapshot: true },
  });
  return (row?.inputSnapshot as Record<string, unknown> | null) ?? {};
}
