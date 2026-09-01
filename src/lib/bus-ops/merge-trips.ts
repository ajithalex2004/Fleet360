/**
 * Staff Transport trip-merge consumer.
 *
 * A merge takes 2+ source TripSchedule rows and produces a single new
 * "merged" trip that carries their passengers on one vehicle+driver.
 * Sources are marked status='MERGED' with mergedIntoTripId pointing at
 * the new row so the audit trail remains queryable — you can still ask
 * "who rode trip A on this date?" after A has been merged into M.
 *
 * The consumer has two entry points:
 *   previewMerge — evaluates the plan through PCE and returns
 *                  {verdict, checks, preview} without writing.
 *   applyMerge   — same evaluation, then a single transaction that
 *                  (a) creates the merged trip, (b) reassigns
 *                  passengers, (c) marks sources MERGED. BLOCK
 *                  verdicts abort before any write.
 *
 * Business rules enforced here (before PCE runs):
 *   - >= 2 distinct source trip IDs
 *   - All sources exist, share the caller's tenant, are SCHEDULED
 *     (not DEPARTED / IN_TRANSIT / COMPLETED / CANCELLED / MERGED)
 *   - Merged trip's departureTime is not before the earliest source's
 *     (a merge can't reach back in time)
 *
 * Constraint compliance (V4-style capacity, zone rules, arrival SLA,
 * detour, etc.) is delegated to PCE — the consumer builds the correct
 * `existing` / `proposed` shape and reads back the verdict.
 */

import type { PrismaClient } from '@prisma/client';
import { loadPlanFacts, type ProposedTripInput } from '@/lib/planning/facts';
import { evaluatePlan, type PlanCheck, type PlanVerdict } from '@/lib/planning/evaluate-plan';

export type MergedTripInput = {
  routeId: string;
  vehicleId: string;
  driverId: string;
  departureTime: Date;
  arrivalTime: Date;
  latestArrivalTime?: Date | null;
  stops: Array<{ placeId: string; lat: number; lng: number; sequence: number }>;
  notes?: string | null;
};

export type MergeInput = {
  tenantId: string;
  tenantTimezone?: string;
  sourceTripIds: string[];
  merged: MergedTripInput;
};

export type MergePreviewResult = {
  verdict: PlanVerdict;
  checks: PlanCheck[];
  totalPenalty: number;
  preview: {
    sourceTripIds: string[];
    passengerCount: number;
    /** Vehicle seating capacity, or null if the vehicle row wasn't found. */
    capacity: number | null;
  };
};

export type MergeApplyResult = MergePreviewResult & {
  mergedTripId: string;
  /** Number of TripPassenger rows reassigned to the merged trip. */
  passengersReassigned: number;
};

export type MergeError = {
  code:
    | 'MERGE_TOO_FEW_SOURCES'
    | 'MERGE_DUPLICATE_SOURCE_IDS'
    | 'MERGE_SOURCE_NOT_FOUND'
    | 'MERGE_SOURCE_WRONG_TENANT'
    | 'MERGE_SOURCE_NOT_SCHEDULED'
    | 'MERGE_SOURCE_ALREADY_MERGED'
    | 'MERGE_DEPARTURE_BEFORE_SOURCE'
    | 'MERGE_BLOCKED_BY_CONSTRAINTS';
  message: string;
  details?: Record<string, unknown>;
};

const TERMINAL_SOURCE_STATUSES = new Set([
  'STARTED',
  'EN_ROUTE',
  'DEPARTED',
  'IN_TRANSIT',
  'COMPLETED',
  'CANCELLED',
  'MERGED',
]);

/**
 * previewMerge — evaluates the merge plan through PCE and reports the
 * verdict without touching the DB. Use before showing a confirmation
 * dialog; call applyMerge with the same input to commit.
 */
export async function previewMerge(
  prisma: PrismaClient,
  input: MergeInput
): Promise<MergePreviewResult | MergeError> {
  const guard = validateStructural(input);
  if (guard) return guard;

  const sources = await prisma.tripSchedule.findMany({
    where: {
      id: { in: input.sourceTripIds },
      tenantId: input.tenantId,
      deletedAt: null,
    },
    select: {
      id: true, tenantId: true, status: true, mergedIntoTripId: true,
      departureTime: true, confirmedCount: true,
    },
  });
  const sourceGuard = validateSources(input.sourceTripIds, sources, input.merged.departureTime);
  if (sourceGuard) return sourceGuard;

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: input.merged.vehicleId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, seatingCapacity: true, vehicleGroup: true },
  });

  const passengerCount = sources.reduce((sum, s) => sum + (s.confirmedCount ?? 0), 0);
  const proposed = buildProposedMergedTrip(input, passengerCount, vehicle);

  const facts = await loadPlanFacts(
    {
      tenantId: input.tenantId,
      tenantTimezone: input.tenantTimezone,
      existing: input.sourceTripIds.map((id) => ({ tripId: id, role: 'source' as const })),
      proposed: [proposed],
    },
    prisma
  );
  const evalResult = evaluatePlan(facts);

  return {
    verdict: evalResult.verdict,
    checks: evalResult.checks,
    totalPenalty: evalResult.totalPenalty,
    preview: {
      sourceTripIds: input.sourceTripIds,
      passengerCount,
      capacity: vehicle?.seatingCapacity ?? null,
    },
  };
}

/**
 * applyMerge — evaluates, and if not BLOCKed, commits the merge in a
 * single transaction: creates the merged trip, reassigns passengers,
 * marks sources MERGED. Returns the preview result plus the new trip's
 * id and the reassignment count.
 */
export async function applyMerge(
  prisma: PrismaClient,
  input: MergeInput,
  userId: string | null
): Promise<MergeApplyResult | MergeError> {
  const preview = await previewMerge(prisma, input);
  if ('code' in preview) return preview;
  if (preview.verdict === 'BLOCK') {
    return {
      code: 'MERGE_BLOCKED_BY_CONSTRAINTS',
      message: 'Merge refused by planning constraints.',
      details: { checks: preview.checks },
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const merged = await tx.tripSchedule.create({
      data: {
        tenantId: input.tenantId,
        routeId: input.merged.routeId,
        vehicleId: input.merged.vehicleId,
        driverId: input.merged.driverId,
        departureTime: input.merged.departureTime,
        arrivalTime: input.merged.arrivalTime,
        latestArrivalTime: input.merged.latestArrivalTime ?? null,
        confirmedCount: preview.preview.passengerCount,
        capacity: preview.preview.capacity ?? undefined,
        status: 'SCHEDULED',
        notes: input.merged.notes ?? `Merged from ${input.sourceTripIds.length} trips`,
      },
      select: { id: true },
    });

    const reassign = await tx.tripPassenger.updateMany({
      where: { tripId: { in: input.sourceTripIds }, tenantId: input.tenantId, deletedAt: null },
      data: { tripId: merged.id },
    });

    await tx.tripSchedule.updateMany({
      where: { id: { in: input.sourceTripIds }, tenantId: input.tenantId },
      data: { status: 'MERGED', mergedIntoTripId: merged.id },
    });

    // Log book-entry (kept minimal — TripLog carries denormalised metadata
    // for the ops audit view). One row per source is verbose but explicit;
    // if this becomes noisy we can promote to a purpose-built table.
    for (const sourceId of input.sourceTripIds) {
      await tx.tripLog.create({
        data: {
          tenantId: input.tenantId,
          scheduleId: sourceId,
          loggedBy: userId,
          notes: `MERGED_INTO ${merged.id}`,
        },
      });
    }

    return { mergedTripId: merged.id, passengersReassigned: reassign.count };
  });

  return {
    ...preview,
    mergedTripId: result.mergedTripId,
    passengersReassigned: result.passengersReassigned,
  };
}

// ─── Guards ─────────────────────────────────────────────────────────

function validateStructural(input: MergeInput): MergeError | null {
  if (input.sourceTripIds.length < 2) {
    return {
      code: 'MERGE_TOO_FEW_SOURCES',
      message: 'A merge requires at least 2 source trips.',
    };
  }
  const seen = new Set(input.sourceTripIds);
  if (seen.size !== input.sourceTripIds.length) {
    return {
      code: 'MERGE_DUPLICATE_SOURCE_IDS',
      message: 'sourceTripIds must be distinct.',
    };
  }
  return null;
}

function validateSources(
  requested: string[],
  rows: Array<{
    id: string;
    tenantId: string | null;
    status: string | null;
    mergedIntoTripId: string | null;
    departureTime: Date;
  }>,
  mergedDeparture: Date
): MergeError | null {
  if (rows.length !== requested.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = requested.filter((id) => !found.has(id));
    return {
      code: 'MERGE_SOURCE_NOT_FOUND',
      message: `Source trips not found (or not in this tenant): ${missing.join(', ')}`,
      details: { missing },
    };
  }
  for (const r of rows) {
    if (r.status && TERMINAL_SOURCE_STATUSES.has(r.status)) {
      return {
        code: r.status === 'MERGED' ? 'MERGE_SOURCE_ALREADY_MERGED' : 'MERGE_SOURCE_NOT_SCHEDULED',
        message: `Source trip ${r.id} has status ${r.status}; only SCHEDULED trips can be merged.`,
        details: { tripId: r.id, status: r.status, mergedIntoTripId: r.mergedIntoTripId },
      };
    }
  }
  const earliest = rows.reduce(
    (min, r) => (r.departureTime.getTime() < min ? r.departureTime.getTime() : min),
    Number.POSITIVE_INFINITY
  );
  if (mergedDeparture.getTime() < earliest) {
    return {
      code: 'MERGE_DEPARTURE_BEFORE_SOURCE',
      message: 'Merged trip departure cannot precede the earliest source trip.',
      details: {
        mergedDeparture: mergedDeparture.toISOString(),
        earliestSource: new Date(earliest).toISOString(),
      },
    };
  }
  return null;
}

// ─── Proposed-trip builder ──────────────────────────────────────────

function buildProposedMergedTrip(
  input: MergeInput,
  passengerCount: number,
  vehicle: { id: string; seatingCapacity: number | null; vehicleGroup: string | null } | null
): ProposedTripInput {
  return {
    id: 'proposed-merged',
    role: 'merged',
    routeId: input.merged.routeId,
    vehicleId: input.merged.vehicleId,
    driverId: input.merged.driverId,
    departureTime: input.merged.departureTime,
    arrivalTime: input.merged.arrivalTime,
    latestArrivalTime: input.merged.latestArrivalTime ?? null,
    confirmedCount: passengerCount,
    stops: input.merged.stops,
    // Pre-supply vehicle facts when we already loaded the row so the
    // loader doesn't re-fetch (and so an unknown vehicleGroup doesn't
    // silently become null downstream).
    vehicleOverride: vehicle
      ? { seatingCapacity: vehicle.seatingCapacity, vehicleGroup: vehicle.vehicleGroup }
      : undefined,
  };
}
