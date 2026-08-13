/**
 * syncStopPlace — dual-write a RouteStop to spatial.places.
 *
 * Phase 3.5 of the shared-geospatial capability. Every writer that
 * touches route_stops must call this so the Place row stays in sync
 * with the source-model columns. That way when a reader migrates
 * from route_stops.gps_lat/gps_lng to Place.centerLat/centerLng
 * (or joins Place directly) it can trust the answer.
 *
 * Design:
 *   - Uses the RouteStop id AS the Place id (same as the backfill in
 *     add_place_refs_to_garage_routestop_vehicle.sql). This makes the
 *     mapping stable and lets us upsert by id without a lookup.
 *   - shape=CIRCLE if the stop has a geofenceRadiusM, else POINT.
 *     Matches driver-app expectations (an arrival zone is a circle).
 *   - Called AFTER the RouteStop write so the Place always mirrors the
 *     latest committed state.
 *   - No-op if the stop has no coords or no tenant — Place rows are
 *     tenant-scoped and RLS-guarded, so an untenant'd stop can't back
 *     one. In that case we also null out routeStop.placeId if it was
 *     previously set (the linked Place would be stale).
 *
 * Callers should treat the return value as best-effort telemetry only —
 * a sync failure never blocks the source-model write. The RouteStop is
 * the durable record; the Place is a cache.
 */

import type { RouteStop } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface SyncStopPlaceResult {
  action: 'created' | 'updated' | 'skipped' | 'orphaned';
  placeId: string | null;
  reason?: string;
}

/**
 * Sync a RouteStop's geospatial fields to spatial.places.
 *
 * Pass the freshly-persisted RouteStop (post-create/update). Tenant is
 * resolved from the stop itself; if the stop's tenantId is null, pass
 * the route's tenantId explicitly via the second arg.
 */
export async function syncStopPlace(
  stop: Pick<RouteStop, 'id' | 'stopName' | 'gpsLat' | 'gpsLng' | 'geofenceRadiusM' | 'tenantId' | 'placeId'>,
  fallbackTenantId?: string | null,
): Promise<SyncStopPlaceResult> {
  const tenantId = stop.tenantId ?? fallbackTenantId ?? null;

  // Skip when the stop can't be represented as a Place. Also clear any
  // previously-linked Place so a reader can't pick up stale data.
  if (!tenantId || stop.gpsLat == null || stop.gpsLng == null) {
    if (stop.placeId) {
      await prisma.routeStop.update({ where: { id: stop.id }, data: { placeId: null } }).catch(() => {});
    }
    return { action: 'skipped', placeId: null, reason: !tenantId ? 'no tenant' : 'no coords' };
  }

  const shape = stop.geofenceRadiusM && stop.geofenceRadiusM > 0 ? 'CIRCLE' : 'POINT';

  // Upsert against the stop's own id — the id space is shared with
  // spatial.places for backfilled + newly-linked stops.
  const place = await prisma.place.upsert({
    where: { id: stop.id },
    create: {
      id: stop.id,
      tenantId,
      name: stop.stopName,
      type: 'STOP',
      shape,
      centerLat: stop.gpsLat,
      centerLng: stop.gpsLng,
      radiusM: stop.geofenceRadiusM ?? null,
      active: true,
      sourceModule: 'bus-ops',
      sourceId: stop.id,
    },
    update: {
      name: stop.stopName,
      shape,
      centerLat: stop.gpsLat,
      centerLng: stop.gpsLng,
      radiusM: stop.geofenceRadiusM ?? null,
      // Don't touch tenantId / active / sourceModule on update — those
      // are set once at create time and rewriting them could reset an
      // operator's explicit change (e.g. deactivating a Place).
    },
  });

  // Link the RouteStop → Place if not already linked.
  if (stop.placeId !== place.id) {
    await prisma.routeStop.update({ where: { id: stop.id }, data: { placeId: place.id } });
  }

  return { action: stop.placeId ? 'updated' : 'created', placeId: place.id };
}

/**
 * Batch variant for the "replace all stops" pattern (routes UI's PUT).
 * Runs syncs in sequence rather than parallel to avoid hammering the
 * connection pool on large routes — most routes have <20 stops so
 * throughput isn't the concern.
 */
export async function syncStopPlaces(
  stops: Array<Parameters<typeof syncStopPlace>[0]>,
  fallbackTenantId?: string | null,
): Promise<SyncStopPlaceResult[]> {
  const out: SyncStopPlaceResult[] = [];
  for (const s of stops) {
    try {
      out.push(await syncStopPlace(s, fallbackTenantId));
    } catch (e) {
      out.push({ action: 'skipped', placeId: null, reason: e instanceof Error ? e.message : 'sync failed' });
    }
  }
  return out;
}
