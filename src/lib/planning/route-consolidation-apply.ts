/**
 * Route Consolidation Phase 2 — apply / preview / revert engine.
 *
 * Turns a Phase 1 recommendation into a committed consolidation:
 *   previewApply         — read-only dry-run of the full guard cascade
 *                          + enrollment stop mappings + PCE re-eval
 *   applyConsolidation   — single transactional apply with authoritative
 *                          guard re-run inside the transaction; produces
 *                          a merged BusRoute + retires sources + migrates
 *                          enrollments + writes lineage
 *   revertConsolidation  — undo within a bounded eligibility window;
 *                          drift-hash check + no-executed-trips +
 *                          no-downstream-consolidation + restored-state
 *                          PCE-passes; inverse transaction
 *
 * Guard cascade is shared between preview and apply. Preview reports
 * what would fail; apply refuses if any guard is still failing at
 * transaction-time. This is the TOCTOU protection: a preview that
 * passed 3 minutes ago doesn't authorise a write today.
 *
 * Not in this file:
 *   - Idempotency: enforced by DB UNIQUE(tenantId, idempotencyKey) as
 *     the last-resort barrier; a cheap pre-transaction lookup returns
 *     the prior result on retry
 *   - Concurrency: SELECT FOR UPDATE on source route rows at the start
 *     of the apply transaction; a second concurrent apply against the
 *     same sources blocks until the first commits, then re-checks
 *     "source routes still active" and refuses
 */

import { randomUUID } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { evaluatePlan, type PlanFacts, type PlanTripFacts, type PlanCheck } from './evaluate-plan';
import { allocateNextRouteCode } from '@/lib/bus-ops/allocate-route-code';
import {
  computeAppliedStateHash,
  resolveEnrollmentStopMapping,
  type EnrollmentStopMapping,
} from './route-consolidation-helpers';

// ─── Input / output shapes ──────────────────────────────────────────

export type EnrollmentKey = `RP:${string}` | `TE:${string}`;

export type OperatorStopResolution = {
  pickupStopId?: string | null;
  dropoffStopId?: string | null;
};

export type MergedRouteSpec = {
  name?: string;
  /** Ordered stop ids from the union of source routes; caller decides. */
  stopIds: string[];
  estimatedDurationMins?: number;
  capacity?: number;
  requiredVehicleGroup?: string | null;
  totalDistanceKm?: number | null;
  notes?: string | null;
};

export type PreviewApplyInput = {
  tenantId: string;
  recommendationId: string;
  sourceRouteIds: string[];
  mergedRoute: MergedRouteSpec;
  /**
   * Source route updated-at fingerprints from the analyze response
   * (or fresh fetch at modal-open time). If provided, staleness is
   * enforced. If absent, staleness guard reports UNKNOWN and DOES NOT
   * block — see `require_fingerprints` env flag to force enforcement.
   */
  sourceRouteFingerprints?: Record<string, string>;
  /** Operator-supplied stop resolutions keyed by "RP:<id>" or "TE:<id>". */
  operatorResolutions?: Record<EnrollmentKey, OperatorStopResolution>;
  /** For PCE re-eval — objective is optional (defaults to Phase 1's defaults). */
  objective?: Record<string, unknown>;
};

export type ApplyConsolidationInput = PreviewApplyInput & {
  idempotencyKey: string;
  appliedBy: string;
  recommendationSnapshot?: Record<string, unknown>;
};

export type RevertConsolidationInput = {
  tenantId: string;
  consolidationId: string;
  revertedBy: string;
  revertReason?: string;
};

// ─── Guard results ──────────────────────────────────────────────────

export type GuardCode =
  | 'GUARD_TENANT_MISMATCH'
  | 'GUARD_SOURCE_ROUTE_NOT_FOUND'
  | 'GUARD_SOURCE_ROUTE_INACTIVE'
  | 'GUARD_SOURCE_ROUTE_ALREADY_RETIRED'
  | 'GUARD_SOURCE_ROUTE_STALE_FINGERPRINT'
  | 'GUARD_SOURCE_ALREADY_CONSOLIDATED'
  | 'GUARD_FUTURE_TRIPS_EXIST'
  | 'GUARD_ACTIVE_SCHEDULE_TEMPLATES_EXIST'
  | 'GUARD_ENROLLMENT_UNRESOLVED'
  | 'GUARD_PCE_BLOCK'
  | 'GUARD_IDEMPOTENCY_KEY_EXISTS'
  | 'GUARD_CONSOLIDATION_NOT_FOUND'
  | 'GUARD_CONSOLIDATION_NOT_APPLIED'
  | 'GUARD_REVERT_WINDOW_ELAPSED'
  | 'GUARD_MERGED_ROUTE_HAS_EXECUTED_TRIPS'
  | 'GUARD_MERGED_ROUTE_HAS_DOWNSTREAM_CONSOLIDATION'
  | 'GUARD_APPLIED_STATE_HASH_DRIFT'
  | 'GUARD_RESTORED_STATE_PCE_BLOCK';

export type GuardCheck = {
  code: GuardCode;
  status: 'PASS' | 'WARN' | 'BLOCK';
  message: string;
  details?: Record<string, unknown>;
};

export type EnrollmentMigrationPlan = {
  key: EnrollmentKey;
  enrollmentType: 'ROUTE_PASSENGER' | 'TRANSPORT_ENROLLMENT';
  enrollmentId: string;
  sourceRouteId: string;
  oldPickupStopId: string | null;
  newPickupStopId: string | null;
  pickupMapping: EnrollmentStopMapping;
  oldDropoffStopId: string | null;
  newDropoffStopId: string | null;
  dropoffMapping: EnrollmentStopMapping;
  requiresOperatorResolution: boolean;
};

export type PreviewApplyResult = {
  overallVerdict: 'READY' | 'BLOCKED';
  guards: GuardCheck[];
  enrollmentMigrations: EnrollmentMigrationPlan[];
  pce: { verdict: 'PASS' | 'WARN' | 'BLOCK'; checks: PlanCheck[]; totalPenalty: number };
};

export type ApplyConsolidationResult =
  | {
      status: 'APPLIED';
      consolidationId: string;
      mergedRouteId: string;
      enrollmentMigrationCount: number;
      appliedStateHash: string;
    }
  | {
      status: 'BLOCKED';
      guards: GuardCheck[];
      enrollmentMigrations: EnrollmentMigrationPlan[];
      pce: { verdict: 'PASS' | 'WARN' | 'BLOCK'; checks: PlanCheck[]; totalPenalty: number };
    }
  | {
      status: 'ALREADY_APPLIED';
      consolidationId: string;
      mergedRouteId: string | null;
      priorStatus: string;
    };

export type RevertConsolidationResult =
  | { status: 'REVERTED'; consolidationId: string; sourcesReactivated: number; enrollmentsRestored: number }
  | { status: 'BLOCKED'; guards: GuardCheck[] };

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Read-only. Runs the full guard cascade + enrollment stop mapping +
 * PCE re-eval. Nothing is written; caller uses the result to decide
 * whether to invoke applyConsolidation with the same input.
 */
export async function previewApply(
  prisma: PrismaClient,
  input: PreviewApplyInput
): Promise<PreviewApplyResult> {
  return runPreviewOrApplyCheckPhase(prisma, input);
}

/**
 * Committed apply. Runs the guard cascade inside a Serializable
 * transaction with SELECT FOR UPDATE on the source routes. Idempotent
 * across retries via the DB UNIQUE(tenantId, idempotencyKey) barrier.
 */
export async function applyConsolidation(
  prisma: PrismaClient,
  input: ApplyConsolidationInput
): Promise<ApplyConsolidationResult> {
  // Cheap pre-transaction idempotency lookup — returns the prior
  // successful result on a retry, avoiding the DB round-trip through
  // the transaction body.
  const existing = await prisma.routeConsolidation.findFirst({
    where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
    select: { id: true, mergedRouteId: true, status: true },
  });
  if (existing) {
    return {
      status: 'ALREADY_APPLIED',
      consolidationId: existing.id,
      mergedRouteId: existing.mergedRouteId,
      priorStatus: existing.status,
    };
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Lock source routes — concurrent applies against the same
        //    sources will block here until this transaction commits.
        await tx.$queryRawUnsafe(
          `SELECT id FROM public.bus_routes WHERE tenant_id = $1 AND id = ANY($2::text[]) FOR UPDATE`,
          input.tenantId,
          input.sourceRouteIds
        );

        // 2. Authoritative guard re-run inside the transaction (TOCTOU
        //    protection — the state read here is what the write sees).
        const checkPhase = await runPreviewOrApplyCheckPhase(tx as unknown as PrismaClient, input);
        if (checkPhase.overallVerdict === 'BLOCKED') {
          return {
            status: 'BLOCKED' as const,
            guards: checkPhase.guards,
            enrollmentMigrations: checkPhase.enrollmentMigrations,
            pce: checkPhase.pce,
          };
        }

        // 3. Fetch source route data for stop copying + fingerprint
        const sourceRoutes = await tx.busRoute.findMany({
          where: { id: { in: input.sourceRouteIds }, tenantId: input.tenantId },
          include: {
            stops: {
              select: { id: true, placeId: true, gpsLat: true, gpsLng: true, sequence: true, stopName: true, geofenceRadiusM: true, estimatedArrivalMins: true },
            },
          },
        });

        // 4. Create merged BusRoute
        const mergedName = input.mergedRoute.name
          ?? `Consolidated: ${sourceRoutes.map((r) => r.name).join(' + ')}`;
        const mergedOrigin = sourceRoutes[0]?.origin ?? 'Consolidated';
        const mergedDestination = sourceRoutes[0]?.destination ?? 'Consolidated';

        // A consolidated route is still a first-class BusRoute — ops need
        // to find it the same way as any manually- or bulk-created one.
        // Was previously left null here (this create had no `code` field
        // at all), the only one of the three route-creation paths that
        // doesn't allocate one; bulk-import always has, manual create
        // never has. Allocated inside this transaction, at Serializable
        // isolation, so a same-tenant collision with a concurrent apply
        // surfaces as a transaction failure rather than a silently wrong
        // duplicate — same non-retry-and-surface handling the rest of
        // this function already applies to every failure except the one
        // specifically-expected idempotency-key race above.
        const mergedRouteCode = await allocateNextRouteCode(tx, input.tenantId, sourceRoutes[0]?.routeType);

        const mergedRoute = await tx.busRoute.create({
          data: {
            tenantId: input.tenantId,
            name: mergedName,
            code: mergedRouteCode,
            origin: mergedOrigin,
            destination: mergedDestination,
            routeType: sourceRoutes[0]?.routeType,
            requiredVehicleGroup: input.mergedRoute.requiredVehicleGroup ?? sourceRoutes[0]?.requiredVehicleGroup,
            totalDistanceKm: input.mergedRoute.totalDistanceKm,
            estimatedDurationMins: input.mergedRoute.estimatedDurationMins,
            capacity: input.mergedRoute.capacity ?? sourceRoutes[0]?.capacity,
            isActive: true,
            notes: input.mergedRoute.notes,
          },
          select: { id: true },
        });

        // 5. Copy stops onto merged route in caller-specified order
        const sourceStopsById = new Map<string, (typeof sourceRoutes)[number]['stops'][number]>();
        for (const r of sourceRoutes) for (const s of r.stops) sourceStopsById.set(s.id, s);

        for (let i = 0; i < input.mergedRoute.stopIds.length; i++) {
          const srcStop = sourceStopsById.get(input.mergedRoute.stopIds[i]);
          if (!srcStop) {
            throw new Error(`stop ${input.mergedRoute.stopIds[i]} not found on any source route`);
          }
          await tx.routeStop.create({
            data: {
              tenantId: input.tenantId,
              routeId: mergedRoute.id,
              stopName: srcStop.stopName,
              sequence: i + 1,
              gpsLat: srcStop.gpsLat,
              gpsLng: srcStop.gpsLng,
              geofenceRadiusM: srcStop.geofenceRadiusM,
              estimatedArrivalMins: srcStop.estimatedArrivalMins,
              placeId: srcStop.placeId,
            },
          });
        }

        // 6. Pre-generate the consolidation.id so every child row we
        //    write next can reference it — cleaner than a placeholder
        //    id + retargeting pattern, and avoids the FK violation
        //    entirely.
        const consolidationId = randomUUID();
        const now = new Date();

        // 6a. Create the RouteConsolidation parent row first with a
        //     provisional appliedStateHash placeholder. We recompute
        //     and update it after all the writes so the hash reflects
        //     the final committed state.
        await tx.routeConsolidation.create({
          data: {
            id: consolidationId,
            tenantId: input.tenantId,
            recommendationId: input.recommendationId,
            idempotencyKey: input.idempotencyKey,
            mergedRouteId: mergedRoute.id,
            status: 'APPLIED',
            objectiveSnapshot: (input.objective ?? {}) as Prisma.InputJsonValue,
            recommendationSnapshot: (input.recommendationSnapshot ?? {}) as Prisma.InputJsonValue,
            appliedStateHash: 'pending',
            appliedAt: now,
            appliedBy: input.appliedBy,
          },
        });

        // 6b. Source lineage rows
        for (let i = 0; i < sourceRoutes.length; i++) {
          const r = sourceRoutes[i];
          await tx.routeConsolidationSource.create({
            data: {
              tenantId: input.tenantId,
              consolidationId,
              sourceRouteId: r.id,
              sourceRouteUpdatedAt: r.updatedAt,
              sequence: i,
            },
          });
        }

        // 7. Migrate enrollments. The check-phase plan carries
        //    newPickupStopId / newDropoffStopId values computed from
        //    the source-route stops we just copied onto the merged
        //    route, so we don't need to re-lookup — the ids are
        //    already correct.
        let migrationCount = 0;
        for (const plan of checkPhase.enrollmentMigrations) {
          if (plan.enrollmentType === 'ROUTE_PASSENGER') {
            await tx.routePassenger.update({
              where: { id: plan.enrollmentId },
              data: {
                routeId: mergedRoute.id,
                pickupStopId: plan.newPickupStopId,
                dropoffStopId: plan.newDropoffStopId,
              },
            });
          } else {
            await tx.transportEnrollment.update({
              where: { id: plan.enrollmentId },
              data: {
                defaultRouteId: mergedRoute.id,
                defaultStopId: plan.newPickupStopId,
              },
            });
          }
          await tx.routeConsolidationEnrollmentMigration.create({
            data: {
              tenantId: input.tenantId,
              consolidationId,
              routePassengerId: plan.enrollmentType === 'ROUTE_PASSENGER' ? plan.enrollmentId : null,
              transportEnrollmentId: plan.enrollmentType === 'TRANSPORT_ENROLLMENT' ? plan.enrollmentId : null,
              sourceRouteId: plan.sourceRouteId,
              targetRouteId: mergedRoute.id,
              oldPickupStopId: plan.oldPickupStopId,
              newPickupStopId: plan.newPickupStopId,
              oldDropoffStopId: plan.oldDropoffStopId,
              newDropoffStopId: plan.newDropoffStopId,
              // Report the pickup mapping method as the row's overall
              // method. Per-side mapping detail lives in the check-phase
              // plan; if we later need it per-side, add columns for
              // dropoffMappingMethod.
              mappingMethod: plan.pickupMapping.method,
            },
          });
          migrationCount++;
        }

        // 8. Retire source routes
        await tx.busRoute.updateMany({
          where: { id: { in: input.sourceRouteIds }, tenantId: input.tenantId },
          data: {
            isActive: false,
            retiredReason: 'CONSOLIDATED_SOURCE',
            retiredAt: new Date(),
            retiredBy: input.appliedBy,
          },
        });

        // 9. Recompute the state hash now that all writes are done and
        //    stamp it back onto the consolidation row.
        const appliedStateHash = await computeAppliedStateHash(tx as unknown as PrismaClient, mergedRoute.id);
        await tx.routeConsolidation.update({
          where: { id: consolidationId },
          data: { appliedStateHash },
        });

        const consolidation = { id: consolidationId };

        return {
          status: 'APPLIED' as const,
          consolidationId: consolidation.id,
          mergedRouteId: mergedRoute.id,
          enrollmentMigrationCount: migrationCount,
          appliedStateHash,
        };
      },
      { isolationLevel: 'Serializable', timeout: 30_000 }
    );
  } catch (e) {
    // If the UNIQUE(tenantId, idempotencyKey) barrier fires (two
    // parallel first-time applies with the same key), one wins and
    // one bounces off the DB. Re-lookup and return ALREADY_APPLIED
    // rather than propagating the constraint error.
    if (isUniqueViolation(e, 'uniq_route_consolidations_tenant_idem')) {
      const winner = await prisma.routeConsolidation.findFirst({
        where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
        select: { id: true, mergedRouteId: true, status: true },
      });
      if (winner) {
        return {
          status: 'ALREADY_APPLIED',
          consolidationId: winner.id,
          mergedRouteId: winner.mergedRouteId,
          priorStatus: winner.status,
        };
      }
    }
    throw e;
  }
}

/**
 * Revert a previously-applied consolidation. Runs its own guard
 * cascade + drift-hash + restored-state PCE check inside a
 * Serializable transaction.
 */
export async function revertConsolidation(
  prisma: PrismaClient,
  input: RevertConsolidationInput
): Promise<RevertConsolidationResult> {
  return await prisma.$transaction(
    async (tx) => {
      const guards: GuardCheck[] = [];

      // Load the consolidation + its lineage. If not found or not
      // APPLIED, block early.
      const consolidation = await tx.routeConsolidation.findFirst({
        where: { id: input.consolidationId, tenantId: input.tenantId },
        include: { sources: true, enrollmentMigrations: true },
      });
      if (!consolidation) {
        return {
          status: 'BLOCKED',
          guards: [{ code: 'GUARD_CONSOLIDATION_NOT_FOUND', status: 'BLOCK', message: `consolidation ${input.consolidationId} not found in this tenant` }],
        };
      }
      if (consolidation.status !== 'APPLIED') {
        return {
          status: 'BLOCKED',
          guards: [{ code: 'GUARD_CONSOLIDATION_NOT_APPLIED', status: 'BLOCK', message: `consolidation is ${consolidation.status}; only APPLIED can be reverted` }],
        };
      }

      // Lock the merged route for the duration of this transaction.
      if (consolidation.mergedRouteId) {
        await tx.$queryRawUnsafe(
          `SELECT id FROM public.bus_routes WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          input.tenantId,
          consolidation.mergedRouteId
        );
      }

      // Guard: window
      const windowMs = readRevertWindowMs();
      const elapsedMs = Date.now() - consolidation.appliedAt.getTime();
      if (elapsedMs > windowMs) {
        guards.push({
          code: 'GUARD_REVERT_WINDOW_ELAPSED',
          status: 'BLOCK',
          message: `Revert window elapsed (${Math.round(elapsedMs / 3600_000)}h since apply; window ${Math.round(windowMs / 3600_000)}h)`,
        });
      } else {
        guards.push({ code: 'GUARD_REVERT_WINDOW_ELAPSED', status: 'PASS', message: 'within revert window' });
      }

      // Guard: no executed / in-progress trips on merged route
      if (consolidation.mergedRouteId) {
        const executedCount = await tx.tripSchedule.count({
          where: {
            routeId: consolidation.mergedRouteId,
            tenantId: input.tenantId,
            status: { in: ['STARTED', 'EN_ROUTE', 'DEPARTED', 'IN_TRANSIT', 'COMPLETED'] },
          },
        });
        if (executedCount > 0) {
          guards.push({
            code: 'GUARD_MERGED_ROUTE_HAS_EXECUTED_TRIPS',
            status: 'BLOCK',
            message: `${executedCount} executed/in-progress trip(s) exist on merged route — revert would strand history`,
          });
        } else {
          guards.push({ code: 'GUARD_MERGED_ROUTE_HAS_EXECUTED_TRIPS', status: 'PASS', message: 'no executed trips on merged route' });
        }

        // Guard: merged route hasn't been folded into a downstream consolidation
        const downstream = await tx.routeConsolidationSource.findFirst({
          where: {
            tenantId: input.tenantId,
            sourceRouteId: consolidation.mergedRouteId,
            consolidation: { status: 'APPLIED' },
          },
          select: { consolidationId: true },
        });
        if (downstream) {
          guards.push({
            code: 'GUARD_MERGED_ROUTE_HAS_DOWNSTREAM_CONSOLIDATION',
            status: 'BLOCK',
            message: `merged route has been consolidated further into ${downstream.consolidationId}; revert that first`,
          });
        } else {
          guards.push({ code: 'GUARD_MERGED_ROUTE_HAS_DOWNSTREAM_CONSOLIDATION', status: 'PASS', message: 'no downstream consolidation' });
        }

        // Guard: drift hash matches
        const currentHash = await computeAppliedStateHash(tx as unknown as PrismaClient, consolidation.mergedRouteId);
        if (currentHash !== consolidation.appliedStateHash) {
          guards.push({
            code: 'GUARD_APPLIED_STATE_HASH_DRIFT',
            status: 'BLOCK',
            message: 'merged route or its stops have been edited since apply; revert would produce inconsistent state',
            details: { appliedHash: consolidation.appliedStateHash, currentHash },
          });
        } else {
          guards.push({ code: 'GUARD_APPLIED_STATE_HASH_DRIFT', status: 'PASS', message: 'applied-state hash matches' });
        }
      }

      // Guard: restored state PCE — evaluate the sources as-if reactivated
      const pceCheck = await pceEvaluateRestoredSources(tx as unknown as PrismaClient, input.tenantId, consolidation.sources.map((s) => s.sourceRouteId));
      if (pceCheck.verdict === 'BLOCK') {
        guards.push({
          code: 'GUARD_RESTORED_STATE_PCE_BLOCK',
          status: 'BLOCK',
          message: 'restored source routes would fail current Planning Constraints',
          details: { checks: pceCheck.checks as unknown as Record<string, unknown> },
        });
      } else {
        guards.push({ code: 'GUARD_RESTORED_STATE_PCE_BLOCK', status: 'PASS', message: `restored state PCE verdict: ${pceCheck.verdict}` });
      }

      const blocked = guards.filter((g) => g.status === 'BLOCK');
      if (blocked.length > 0) {
        return { status: 'BLOCKED', guards };
      }

      // Apply the inverse transaction
      // 1. Restore each RoutePassenger / TransportEnrollment to its source route + old stops
      let restoredEnrollments = 0;
      for (const mig of consolidation.enrollmentMigrations) {
        if (mig.routePassengerId) {
          await tx.routePassenger.update({
            where: { id: mig.routePassengerId },
            data: {
              routeId: mig.sourceRouteId,
              pickupStopId: mig.oldPickupStopId,
              dropoffStopId: mig.oldDropoffStopId,
            },
          });
        } else if (mig.transportEnrollmentId) {
          await tx.transportEnrollment.update({
            where: { id: mig.transportEnrollmentId },
            data: {
              defaultRouteId: mig.sourceRouteId,
              defaultStopId: mig.oldPickupStopId,
            },
          });
        }
        restoredEnrollments++;
      }

      // 2. Reactivate source routes
      await tx.busRoute.updateMany({
        where: { id: { in: consolidation.sources.map((s) => s.sourceRouteId) }, tenantId: input.tenantId },
        data: {
          isActive: true,
          retiredReason: null,
          retiredAt: null,
          retiredBy: null,
        },
      });

      // 3. Archive merged route (never delete — preserves lineage FKs + operational history)
      if (consolidation.mergedRouteId) {
        await tx.busRoute.update({
          where: { id: consolidation.mergedRouteId },
          data: {
            isActive: false,
            retiredReason: 'CONSOLIDATED_ARCHIVED',
            retiredAt: new Date(),
            retiredBy: input.revertedBy,
          },
        });
      }

      // 4. Update consolidation row to REVERTED
      await tx.routeConsolidation.update({
        where: { id: consolidation.id },
        data: {
          status: 'REVERTED',
          revertedAt: new Date(),
          revertedBy: input.revertedBy,
          revertReason: input.revertReason ?? null,
        },
      });

      return {
        status: 'REVERTED',
        consolidationId: consolidation.id,
        sourcesReactivated: consolidation.sources.length,
        enrollmentsRestored: restoredEnrollments,
      };
    },
    { isolationLevel: 'Serializable', timeout: 30_000 }
  );
}

// ─── Shared check phase (used by preview and apply) ─────────────────

async function runPreviewOrApplyCheckPhase(
  prismaOrTx: PrismaClient,
  input: PreviewApplyInput
): Promise<PreviewApplyResult> {
  const guards: GuardCheck[] = [];

  // Load source routes
  const sources = await prismaOrTx.busRoute.findMany({
    where: { id: { in: input.sourceRouteIds }, tenantId: input.tenantId },
    select: {
      id: true, name: true, isActive: true, retiredReason: true, retiredAt: true, updatedAt: true,
    },
  });

  const foundIds = new Set(sources.map((s) => s.id));
  const missing = input.sourceRouteIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    guards.push({
      code: 'GUARD_SOURCE_ROUTE_NOT_FOUND',
      status: 'BLOCK',
      message: `Source routes missing or wrong tenant: ${missing.join(', ')}`,
      details: { missingRouteIds: missing },
    });
  } else {
    guards.push({ code: 'GUARD_SOURCE_ROUTE_NOT_FOUND', status: 'PASS', message: 'all source routes found in tenant' });
  }

  for (const r of sources) {
    if (r.isActive === false) {
      guards.push({
        code: 'GUARD_SOURCE_ROUTE_INACTIVE',
        status: 'BLOCK',
        message: `source route ${r.id} is not active`,
        details: { routeId: r.id },
      });
    }
    if (r.retiredAt) {
      guards.push({
        code: 'GUARD_SOURCE_ROUTE_ALREADY_RETIRED',
        status: 'BLOCK',
        message: `source route ${r.id} already retired (${r.retiredReason})`,
        details: { routeId: r.id, retiredReason: r.retiredReason },
      });
    }
    if (input.sourceRouteFingerprints?.[r.id]) {
      const expected = input.sourceRouteFingerprints[r.id];
      const actual = r.updatedAt?.toISOString() ?? '';
      if (expected !== actual) {
        guards.push({
          code: 'GUARD_SOURCE_ROUTE_STALE_FINGERPRINT',
          status: 'BLOCK',
          message: `source route ${r.id} has been edited since the recommendation was generated`,
          details: { routeId: r.id, expected, actual },
        });
      }
    }
  }

  // Guard: source not already consumed by another APPLIED consolidation
  const alreadyConsolidated = await prismaOrTx.routeConsolidationSource.findMany({
    where: {
      tenantId: input.tenantId,
      sourceRouteId: { in: input.sourceRouteIds },
      consolidation: { status: 'APPLIED' },
    },
    select: { sourceRouteId: true, consolidationId: true },
  });
  if (alreadyConsolidated.length > 0) {
    guards.push({
      code: 'GUARD_SOURCE_ALREADY_CONSOLIDATED',
      status: 'BLOCK',
      message: `source route(s) already consolidated: ${alreadyConsolidated.map((a) => a.sourceRouteId).join(', ')}`,
      details: { rows: alreadyConsolidated as unknown as Record<string, unknown>[] },
    });
  } else {
    guards.push({ code: 'GUARD_SOURCE_ALREADY_CONSOLIDATED', status: 'PASS', message: 'no source is part of an active consolidation' });
  }

  // Guard: no future active trips
  const futureTripCount = await prismaOrTx.tripSchedule.count({
    where: {
      tenantId: input.tenantId,
      routeId: { in: input.sourceRouteIds },
      status: { in: ['SCHEDULED'] },
      departureTime: { gt: new Date() },
    },
  });
  if (futureTripCount > 0) {
    guards.push({
      code: 'GUARD_FUTURE_TRIPS_EXIST',
      status: 'BLOCK',
      message: `${futureTripCount} future scheduled trip(s) exist on source routes; cancel or complete them before consolidating`,
    });
  } else {
    guards.push({ code: 'GUARD_FUTURE_TRIPS_EXIST', status: 'PASS', message: 'no future scheduled trips on source routes' });
  }

  // Guard: no active schedule templates
  const activeTemplateCount = await prismaOrTx.busOpsScheduleTemplate.count({
    where: {
      tenantId: input.tenantId,
      routeId: { in: input.sourceRouteIds },
      status: 'ACTIVE',
      deletedAt: null,
    },
  });
  if (activeTemplateCount > 0) {
    guards.push({
      code: 'GUARD_ACTIVE_SCHEDULE_TEMPLATES_EXIST',
      status: 'BLOCK',
      message: `${activeTemplateCount} active schedule template(s) reference source routes; deactivate them before consolidating`,
    });
  } else {
    guards.push({ code: 'GUARD_ACTIVE_SCHEDULE_TEMPLATES_EXIST', status: 'PASS', message: 'no active schedule templates on source routes' });
  }

  // Build enrolment migration plan (needs the proposed merged stops)
  const enrollmentMigrations = await buildEnrollmentMigrationPlan(prismaOrTx, input);
  const unresolved = enrollmentMigrations.filter((p) => p.requiresOperatorResolution);
  if (unresolved.length > 0) {
    guards.push({
      code: 'GUARD_ENROLLMENT_UNRESOLVED',
      status: 'BLOCK',
      message: `${unresolved.length} enrollment(s) cannot be auto-mapped and need operator resolution`,
      details: { unresolvedKeys: unresolved.map((u) => u.key) as unknown as Record<string, unknown> },
    });
  } else {
    guards.push({ code: 'GUARD_ENROLLMENT_UNRESOLVED', status: 'PASS', message: 'all enrollments auto-mapped' });
  }

  // PCE re-eval on the proposed merged route
  const pce = await pceEvaluateProposedMerged(prismaOrTx, input, sources);
  if (pce.verdict === 'BLOCK') {
    guards.push({
      code: 'GUARD_PCE_BLOCK',
      status: 'BLOCK',
      message: 'Planning Constraints refuse the consolidated route as configured',
    });
  } else {
    guards.push({ code: 'GUARD_PCE_BLOCK', status: 'PASS', message: `PCE verdict: ${pce.verdict}` });
  }

  const overallVerdict = guards.some((g) => g.status === 'BLOCK') ? 'BLOCKED' : 'READY';

  return { overallVerdict, guards, enrollmentMigrations, pce };
}

// ─── Enrollment migration planning ──────────────────────────────────

async function buildEnrollmentMigrationPlan(
  prismaOrTx: PrismaClient,
  input: PreviewApplyInput
): Promise<EnrollmentMigrationPlan[]> {
  // Load merged-route stops (proposed) — pick them from source routes
  const sourceStops = await prismaOrTx.routeStop.findMany({
    where: { routeId: { in: input.sourceRouteIds } },
    select: { id: true, placeId: true, gpsLat: true, gpsLng: true, routeId: true },
  });
  const mergedStops = input.mergedRoute.stopIds
    .map((sid) => sourceStops.find((s) => s.id === sid))
    .filter((s): s is (typeof sourceStops)[number] => Boolean(s));

  const routePassengers = await prismaOrTx.routePassenger.findMany({
    where: {
      tenantId: input.tenantId,
      routeId: { in: input.sourceRouteIds },
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: { id: true, routeId: true, pickupStopId: true, dropoffStopId: true },
  });

  const transportEnrollments = await prismaOrTx.transportEnrollment.findMany({
    where: {
      tenantId: input.tenantId,
      defaultRouteId: { in: input.sourceRouteIds },
      deletedAt: null,
      isActive: true,
    },
    select: { id: true, defaultRouteId: true, defaultStopId: true },
  });

  const stopById = new Map(sourceStops.map((s) => [s.id, s]));

  const plans: EnrollmentMigrationPlan[] = [];

  for (const rp of routePassengers) {
    const key: EnrollmentKey = `RP:${rp.id}`;
    const oldPickup = rp.pickupStopId;
    const oldDrop = rp.dropoffStopId;
    const pickupPlaceId = oldPickup ? stopById.get(oldPickup)?.placeId ?? null : null;
    const dropoffPlaceId = oldDrop ? stopById.get(oldDrop)?.placeId ?? null : null;
    const suppliedPickup = input.operatorResolutions?.[key]?.pickupStopId;
    const suppliedDrop = input.operatorResolutions?.[key]?.dropoffStopId;

    const pickupMapping = resolveEnrollmentStopMapping(oldPickup, pickupPlaceId, mergedStops, suppliedPickup);
    const dropoffMapping = resolveEnrollmentStopMapping(oldDrop, dropoffPlaceId, mergedStops, suppliedDrop);

    plans.push({
      key,
      enrollmentType: 'ROUTE_PASSENGER',
      enrollmentId: rp.id,
      sourceRouteId: rp.routeId,
      oldPickupStopId: oldPickup,
      newPickupStopId: pickupMapping.newStopId,
      pickupMapping,
      oldDropoffStopId: oldDrop,
      newDropoffStopId: dropoffMapping.newStopId,
      dropoffMapping,
      requiresOperatorResolution:
        (pickupMapping.method === 'OPERATOR_RESOLVED' && oldPickup !== null && pickupMapping.newStopId === null)
        || (dropoffMapping.method === 'OPERATOR_RESOLVED' && oldDrop !== null && dropoffMapping.newStopId === null),
    });
  }

  for (const te of transportEnrollments) {
    const key: EnrollmentKey = `TE:${te.id}`;
    const oldPickup = te.defaultStopId;
    const pickupPlaceId = oldPickup ? stopById.get(oldPickup)?.placeId ?? null : null;
    const suppliedPickup = input.operatorResolutions?.[key]?.pickupStopId;
    const pickupMapping = resolveEnrollmentStopMapping(oldPickup, pickupPlaceId, mergedStops, suppliedPickup);

    plans.push({
      key,
      enrollmentType: 'TRANSPORT_ENROLLMENT',
      enrollmentId: te.id,
      sourceRouteId: te.defaultRouteId!,
      oldPickupStopId: oldPickup,
      newPickupStopId: pickupMapping.newStopId,
      pickupMapping,
      oldDropoffStopId: null,
      newDropoffStopId: null,
      dropoffMapping: { method: 'OPERATOR_RESOLVED', newStopId: null },
      requiresOperatorResolution:
        pickupMapping.method === 'OPERATOR_RESOLVED' && oldPickup !== null && pickupMapping.newStopId === null,
    });
  }

  return plans;
}

// ─── PCE evaluation for apply + revert ─────────────────────────────

async function pceEvaluateProposedMerged(
  prismaOrTx: PrismaClient,
  input: PreviewApplyInput,
  sources: Array<{ id: string; name: string }>
): Promise<PreviewApplyResult['pce']> {
  const facts = await buildPlanFactsForProposedMerged(prismaOrTx, input, sources);
  const r = evaluatePlan(facts);
  return { verdict: r.verdict, checks: r.checks, totalPenalty: r.totalPenalty };
}

async function buildPlanFactsForProposedMerged(
  prismaOrTx: PrismaClient,
  input: PreviewApplyInput,
  sources: Array<{ id: string; name: string }>
): Promise<PlanFacts> {
  const constraints = await prismaOrTx.planningConstraint.findMany({
    where: { tenantId: input.tenantId, deletedAt: null, isEnabled: true },
  });

  const trips: PlanTripFacts[] = [];
  const anchor = new Date();

  // Source trips
  for (const s of sources) {
    trips.push(makeSyntheticTrip(s.id, 'source', anchor, 60));
  }
  // Merged trip
  const mergedDurationMin = input.mergedRoute.estimatedDurationMins ?? 90;
  trips.push({
    id: 'proposed-merged',
    role: 'merged',
    routeId: 'proposed-merged-routeId',
    vehicleId: null,
    driverId: null,
    departureTime: anchor,
    arrivalTime: new Date(anchor.getTime() + mergedDurationMin * 60_000),
    latestArrivalTime: null,
    confirmedCount: 0,
    stops: [],
    vehicle: null,
  });

  return {
    trips,
    constraints: constraints.map((c) => ({
      id: c.id, name: c.name, kind: c.kind,
      action: (c.action === 'WARN' || c.action === 'PENALTY' ? c.action : 'BLOCK') as 'BLOCK' | 'WARN' | 'PENALTY',
      penaltyScore: c.penaltyScore ? Number(c.penaltyScore) : null,
      params: (c.params ?? {}) as Record<string, unknown>,
      effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo,
      reason: c.reason, isEnabled: c.isEnabled,
    })),
    zones: new Map(),
    tenantTimezone: 'Asia/Dubai',
  };
}

async function pceEvaluateRestoredSources(
  prismaOrTx: PrismaClient,
  tenantId: string,
  sourceRouteIds: string[]
): Promise<{ verdict: 'PASS' | 'WARN' | 'BLOCK'; checks: PlanCheck[]; totalPenalty: number }> {
  const constraints = await prismaOrTx.planningConstraint.findMany({
    where: { tenantId, deletedAt: null, isEnabled: true },
  });

  const anchor = new Date();
  const trips: PlanTripFacts[] = sourceRouteIds.map((id) => makeSyntheticTrip(id, 'standalone', anchor, 60));

  const facts: PlanFacts = {
    trips,
    constraints: constraints.map((c) => ({
      id: c.id, name: c.name, kind: c.kind,
      action: (c.action === 'WARN' || c.action === 'PENALTY' ? c.action : 'BLOCK') as 'BLOCK' | 'WARN' | 'PENALTY',
      penaltyScore: c.penaltyScore ? Number(c.penaltyScore) : null,
      params: (c.params ?? {}) as Record<string, unknown>,
      effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo,
      reason: c.reason, isEnabled: c.isEnabled,
    })),
    zones: new Map(),
    tenantTimezone: 'Asia/Dubai',
  };
  const r = evaluatePlan(facts);
  return { verdict: r.verdict, checks: r.checks, totalPenalty: r.totalPenalty };
}

function makeSyntheticTrip(
  routeId: string,
  role: PlanTripFacts['role'],
  anchor: Date,
  durationMin: number
): PlanTripFacts {
  return {
    id: `synth-${routeId}`,
    role,
    routeId,
    vehicleId: null,
    driverId: null,
    departureTime: anchor,
    arrivalTime: new Date(anchor.getTime() + durationMin * 60_000),
    latestArrivalTime: null,
    confirmedCount: 0,
    stops: [],
    vehicle: null,
  };
}

// ─── Utilities ─────────────────────────────────────────────────────

function readRevertWindowMs(): number {
  const hrs = Number(process.env.RC_REVERT_WINDOW_HOURS);
  return (Number.isFinite(hrs) && hrs > 0 ? hrs : 24) * 3600_000;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isUniqueViolation(e: any, constraintName: string): boolean {
  return e?.code === 'P2002' || (e?.meta?.target ?? []).includes(constraintName)
    || String(e?.message ?? '').includes(constraintName);
}
