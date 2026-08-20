/**
 * Zone-compatibility fallback-distance threshold resolver.
 *
 * zoneCompatibility() (zone-compat.ts) already prefers a shared
 * spatial.places id over distance whenever one exists — SAME_ZONE is
 * checked first and wins outright; the km threshold here only matters
 * for the fallback path when neither side has (or shares) a placeId.
 * This resolver doesn't change that precedence, it just makes the
 * fallback km values themselves tenant-editable instead of hardcoded.
 *
 * Two independent thresholds, since Case 1 has historically used a
 * tighter dropoff threshold than pickup (1.5km vs 3.0km — a dropoff
 * mismatch strands a rider further from their actual destination, so
 * it's held to a stricter bar). Case 2's single "dropoff of A vs pickup
 * of B" check reuses the pickup threshold — it's the more general
 * "is this a shared handoff point" question, not a dropoff-precision one.
 *
 * Precedence (each resolved independently): explicit override > enabled
 * PlanningConstraint row > hardcoded fallback (matches zone-compat.ts's
 * own DEFAULT_FALLBACK_KM).
 */

import type { PrismaClient } from '@prisma/client';
import { DEFAULT_FALLBACK_KM } from './zone-compat';

export const PICKUP_ZONE_FALLBACK_KM_KIND = 'PICKUP_ZONE_FALLBACK_KM';
export const DROPOFF_ZONE_FALLBACK_KM_KIND = 'DROPOFF_ZONE_FALLBACK_KM';

export interface ZoneFallbackKm {
  pickup: number;
  dropoff: number;
}

export interface ZoneFallbackKmOverrides {
  pickup?: number;
  dropoff?: number;
}

export async function resolveZoneFallbackKm(
  prisma: PrismaClient,
  tenantId: string,
  overrides: ZoneFallbackKmOverrides = {},
): Promise<ZoneFallbackKm> {
  if (overrides.pickup !== undefined && overrides.dropoff !== undefined) {
    return { pickup: overrides.pickup, dropoff: overrides.dropoff };
  }

  const rows = await prisma.planningConstraint.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isEnabled: true,
      kind: { in: [PICKUP_ZONE_FALLBACK_KM_KIND, DROPOFF_ZONE_FALLBACK_KM_KIND] },
    },
    orderBy: { createdAt: 'asc' },
  });

  const pickupRow = rows.find((r) => r.kind === PICKUP_ZONE_FALLBACK_KM_KIND);
  const dropoffRow = rows.find((r) => r.kind === DROPOFF_ZONE_FALLBACK_KM_KIND);

  return {
    pickup: overrides.pickup ?? readMaxKm(pickupRow?.params) ?? DEFAULT_FALLBACK_KM.PICKUP,
    dropoff: overrides.dropoff ?? readMaxKm(dropoffRow?.params) ?? DEFAULT_FALLBACK_KM.DROPOFF,
  };
}

function readMaxKm(params: unknown): number | null {
  if (!params || typeof params !== 'object') return null;
  const v = (params as Record<string, unknown>).maxKm;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
