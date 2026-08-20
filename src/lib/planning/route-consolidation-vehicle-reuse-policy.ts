/**
 * Route Consolidation — vehicle turnaround threshold resolver.
 *
 * vehicleTurnaroundMinutes is the minimum gap analyzeVehicleReuse() (in
 * route-consolidation.ts) requires between a consolidated trip's arrival
 * and a candidate return trip's departure before treating the same
 * vehicle as reusable. It's a genuine tenant business rule ("how much
 * turnaround does a driver/vehicle realistically need"), so it's sourced
 * from PlanningConstraint the same way the Stage 1 proximity thresholds
 * are (see route-consolidation-eligibility-policy.ts) — kept in its own
 * file rather than folded into that one because it isn't an eligibility
 * filter: it doesn't gate which pairs reach scoring, it only shapes the
 * vehicle-reuse detail on an already-recommended pair.
 *
 * Precedence: explicit request override > enabled PlanningConstraint row >
 * hardcoded fallback.
 */

import type { PrismaClient } from '@prisma/client';

export const VEHICLE_MIN_TURNAROUND_KIND = 'VEHICLE_MIN_TURNAROUND';

/** Hardcoded fallback when no PlanningConstraint row exists for the tenant — matches the pre-existing default in route-consolidation.ts's analyzeVehicleReuse(). */
const FALLBACK_VEHICLE_MIN_TURNAROUND_MINUTES = 30;

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

function readMinBufferMinutes(params: unknown): number | null {
  if (!params || typeof params !== 'object') return null;
  const v = (params as Record<string, unknown>).minBufferMin;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
