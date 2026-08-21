/**
 * Route Consolidation — eligibility threshold resolver.
 *
 * Departure/arrival time-proximity thresholds are genuine tenant business
 * rules ("how close is close enough"), the same kind of decision Fleet
 * Planner's window resolver cares about — so they're sourced from
 * `PlanningConstraint` (shared, tenant-editable via the existing "Edit PCE
 * rules" page — `kind` is free-text there, no schema change needed for new
 * constraint kinds) rather than hardcoded in route-consolidation.ts.
 *
 * Execution stays cheap: this resolver runs once per analysis call (not
 * per pair), normalizes into a small plain object, and the Stage 1 filters
 * do ordinary in-memory comparisons against it — no PCE synthesis, no
 * per-pair DB access.
 *
 * Precedence: explicit request override > enabled PlanningConstraint row >
 * hardcoded fallback.
 */

import type { PrismaClient } from '@prisma/client';

export const DEPARTURE_TIME_PROXIMITY_KIND = 'DEPARTURE_TIME_PROXIMITY';
export const ARRIVAL_TIME_PROXIMITY_KIND = 'ARRIVAL_TIME_PROXIMITY';

/** Hardcoded fallback when no PlanningConstraint row exists for the tenant. */
const FALLBACK_MAX_DEPARTURE_DIFF_MINUTES = 60;
/** Placeholder default, same status as the Stage 4 scoring references — not yet tuned against real usage. */
const FALLBACK_MAX_ARRIVAL_DIFF_MINUTES = 45;

export interface EligibilityPolicy {
  maxDepartureTimeDiffMinutes: number;
  maxArrivalTimeDiffMinutes: number;
}

export interface EligibilityPolicyOverrides {
  maxDepartureTimeDiffMinutes?: number;
  maxArrivalTimeDiffMinutes?: number;
}

/**
 * Resolve both proximity thresholds in a single query. Reads only enabled,
 * non-deleted PlanningConstraint rows of the relevant kinds; the first
 * matching row per kind wins if a tenant has somehow created more than one
 * (the "Edit PCE rules" UI doesn't prevent duplicates, same as any other
 * constraint kind).
 */
export async function resolveEligibilityPolicy(
  prisma: PrismaClient,
  tenantId: string,
  overrides: EligibilityPolicyOverrides = {},
): Promise<EligibilityPolicy> {
  if (overrides.maxDepartureTimeDiffMinutes !== undefined && overrides.maxArrivalTimeDiffMinutes !== undefined) {
    // Both explicitly overridden — no need to touch the DB at all.
    return {
      maxDepartureTimeDiffMinutes: overrides.maxDepartureTimeDiffMinutes,
      maxArrivalTimeDiffMinutes: overrides.maxArrivalTimeDiffMinutes,
    };
  }

  const rows = await prisma.planningConstraint.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isEnabled: true,
      kind: { in: [DEPARTURE_TIME_PROXIMITY_KIND, ARRIVAL_TIME_PROXIMITY_KIND] },
    },
    orderBy: { createdAt: 'asc' },
  });

  const departureRow = rows.find(r => r.kind === DEPARTURE_TIME_PROXIMITY_KIND);
  const arrivalRow = rows.find(r => r.kind === ARRIVAL_TIME_PROXIMITY_KIND);

  const departureFromConstraint = readMaxMinutes(departureRow?.params);
  const arrivalFromConstraint = readMaxMinutes(arrivalRow?.params);

  return {
    maxDepartureTimeDiffMinutes:
      overrides.maxDepartureTimeDiffMinutes ?? departureFromConstraint ?? FALLBACK_MAX_DEPARTURE_DIFF_MINUTES,
    maxArrivalTimeDiffMinutes:
      overrides.maxArrivalTimeDiffMinutes ?? arrivalFromConstraint ?? FALLBACK_MAX_ARRIVAL_DIFF_MINUTES,
  };
}

function readMaxMinutes(params: unknown): number | null {
  if (!params || typeof params !== 'object') return null;
  const v = (params as Record<string, unknown>).maxMinutes;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
