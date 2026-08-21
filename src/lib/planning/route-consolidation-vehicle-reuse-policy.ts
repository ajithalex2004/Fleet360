/**
 * Route Consolidation — vehicle-reuse threshold resolvers ("Case 2").
 *
 * Two tenant-editable thresholds shape whether the same vehicle can be
 * treated as reusable across two sequential (not simultaneous) trips —
 * see route-consolidation-vehicle-reuse.ts for the analysis itself:
 *
 *   - VEHICLE_MIN_TURNAROUND (minBufferMin, fallback 30): the minimum
 *     gap required between the first trip's arrival and the second
 *     trip's departure, before accounting for real reposition travel
 *     time. Answers "is there enough time at all?"
 *   - MAX_VEHICLE_REUSE_WINDOW (maxMinutes, fallback 180): the ceiling
 *     on that same gap, past which two trips are simply unrelated rather
 *     than a meaningful back-to-back reuse opportunity (an 08:00 arrival
 *     and a 16:00 departure isn't "infeasible," it's just not a
 *     candidate). Answers "are these trips close enough in sequence to
 *     be worth surfacing?"
 *
 * Both are genuine tenant business rules, sourced from PlanningConstraint
 * the same way the Stage 1 eligibility thresholds are (see
 * route-consolidation-eligibility-policy.ts) — kept in their own file
 * rather than folded into that one because neither is a Case 1
 * eligibility filter: they don't gate which route PAIRS reach Case 1
 * scoring, they shape the separate Case 2 vehicle-reuse analysis.
 *
 * Precedence (each resolver independently): explicit override > enabled
 * PlanningConstraint row > hardcoded fallback.
 */

import type { PrismaClient } from '@prisma/client';

export const VEHICLE_MIN_TURNAROUND_KIND = 'VEHICLE_MIN_TURNAROUND';
export const MAX_VEHICLE_REUSE_WINDOW_KIND = 'MAX_VEHICLE_REUSE_WINDOW';

/** Hardcoded fallback when no PlanningConstraint row exists for the tenant. */
const FALLBACK_VEHICLE_MIN_TURNAROUND_MINUTES = 30;
/** Hardcoded fallback — matches the pre-existing 3-hour ceiling from the old Case-1-attached vehicle reuse check. */
const FALLBACK_MAX_VEHICLE_REUSE_WINDOW_MINUTES = 180;

export async function resolveVehicleTurnaroundMinutes(
  prisma: PrismaClient,
  tenantId: string,
  override?: number,
): Promise<number> {
  if (override !== undefined) return override;

  const row = await prisma.planningConstraint.findFirst({
    where: { tenantId, deletedAt: null, isEnabled: true, kind: VEHICLE_MIN_TURNAROUND_KIND },
    orderBy: { createdAt: 'asc' },
  });

  const fromConstraint = readMinBufferMinutes(row?.params);
  return fromConstraint ?? FALLBACK_VEHICLE_MIN_TURNAROUND_MINUTES;
}

export async function resolveMaxVehicleReuseWindowMinutes(
  prisma: PrismaClient,
  tenantId: string,
  override?: number,
): Promise<number> {
  if (override !== undefined) return override;

  const row = await prisma.planningConstraint.findFirst({
    where: { tenantId, deletedAt: null, isEnabled: true, kind: MAX_VEHICLE_REUSE_WINDOW_KIND },
    orderBy: { createdAt: 'asc' },
  });

  const fromConstraint = readMaxMinutes(row?.params);
  return fromConstraint ?? FALLBACK_MAX_VEHICLE_REUSE_WINDOW_MINUTES;
}

function readMinBufferMinutes(params: unknown): number | null {
  if (!params || typeof params !== 'object') return null;
  const v = (params as Record<string, unknown>).minBufferMin;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function readMaxMinutes(params: unknown): number | null {
  if (!params || typeof params !== 'object') return null;
  const v = (params as Record<string, unknown>).maxMinutes;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
