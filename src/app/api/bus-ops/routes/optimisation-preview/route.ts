export const dynamic = 'force-dynamic';

/**
 * GET /api/bus-ops/routes/optimisation-preview
 *
 * Scans every active staff bus route and reports how much driving distance
 * re-ordering its stops would save. Powers the "Routes worth re-optimising"
 * widget.
 *
 * DISTANCES ARE REAL DRIVING DISTANCE, NOT STRAIGHT-LINE
 *
 * This previously ran a local haversine TSP — free, but it reported
 * straight-line kilometres while the Route Planner one click away reported
 * road kilometres from the Routes API for the same route. The two disagreed
 * by ~54% on a real route (11.6 vs 17.9 km) with nothing on screen to say
 * why, and the "saving" an operator was asked to act on was a straight-line
 * figure. Both surfaces now measure the same thing.
 *
 * COST: PAID ONCE PER STOP-SET, NOT PER PAGE LOAD
 *
 * Road distance costs two Routes API calls per route — one for the current
 * stop order, one letting Google reorder. That is far too expensive to repeat
 * on every dashboard poll, so results persist in route_optimisation_results
 * keyed by a hash of the route's geocoded stops:
 *
 *   - hash matches a stored row  -> served from the table, zero API calls
 *   - no row, or the hash moved  -> compute once, store, serve
 *
 * The stops PUT does not bump bus_routes.updated_at, so a timestamp could not
 * answer "is this still valid?" — hence the explicit fingerprint. Editing a
 * route's stops changes the hash and buys exactly one recompute.
 *
 * Routes with fewer than three geocoded stops are skipped without any API
 * call: with two fixed points there is only one possible order, so the saving
 * is necessarily zero.
 *
 * THIS ENDPOINT WRITES. It is a GET that lazily populates its own cache — the
 * older "No writes, safe to call on any cadence" promise no longer holds, and
 * saying so mattered enough to put here rather than leave the stale claim.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { computeRoutes } from '@/lib/planning/fleet-routing/google-client';
import type { ComputeRoutesLocation } from '@/lib/planning/fleet-routing/types';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface GeoStop { id: string; name: string; lat: number; lng: number; sequence: number }

interface PreviewRow {
  routeId: string; routeName: string;
  /**
   * BusRoute.code (RT-0001 …). Nullable in the schema — routes created before
   * codes existed, and consolidation merge products, can have none. The UI
   * falls back to a truncated id in that case, so a row is always
   * identifiable.
   */
  routeCode: string | null;
  stopCount: number; geoStopCount: number;
  originalDistanceKm: number; optimisedDistanceKm: number;
  distanceSavedKm: number; distanceSavedPct: number;
  skipped: boolean; skipReason?: string;
  /** When these numbers were computed. Null for skipped rows. */
  computedAt: string | null;
  /** True when served from the stored result rather than freshly computed. */
  cached: boolean;
}

/**
 * Fingerprint of what the distance actually depends on: the ordered list of
 * coordinates. Deliberately excludes stop names and ids — renaming a stop
 * doesn't move it, and shouldn't cost a recompute. Coordinates are rounded to
 * ~1 m so that floating-point noise from a re-save doesn't invalidate a
 * perfectly good result.
 */
function hashStops(geo: GeoStop[]): string {
  const canonical = geo.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

const asLoc = (s: GeoStop): ComputeRoutesLocation => ({
  location: { latLng: { latitude: s.lat, longitude: s.lng } },
});

/** Road distance in km for a fixed stop order — Google does not reorder. */
async function drivingKmInOrder(geo: GeoStop[]): Promise<number> {
  const res = await computeRoutes({
    origin: asLoc(geo[0]),
    destination: asLoc(geo[geo.length - 1]),
    intermediates: geo.slice(1, -1).map(asLoc),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    optimizeWaypointOrder: false,
  });
  const m = res.routes?.[0]?.distanceMeters;
  if (typeof m !== 'number') throw new Error('Routes API returned no distance');
  return m / 1000;
}

/**
 * Road distance with Google free to reorder the intermediates, plus the order
 * it chose. Origin and destination stay fixed.
 *
 * Google optimises against road distance directly, which is what we are
 * reporting — using the old local TSP to propose an order and then measuring
 * it would optimise for one metric and report another.
 */
async function drivingKmOptimised(geo: GeoStop[]): Promise<{ km: number; order: string[] }> {
  const intermediates = geo.slice(1, -1);
  const res = await computeRoutes({
    origin: asLoc(geo[0]),
    destination: asLoc(geo[geo.length - 1]),
    intermediates: intermediates.map(asLoc),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    optimizeWaypointOrder: intermediates.length > 1,
  });
  const route = res.routes?.[0];
  const m = route?.distanceMeters;
  if (typeof m !== 'number') throw new Error('Routes API returned no distance');
  const idx = route?.optimizedIntermediateWaypointIndex;
  const middle = Array.isArray(idx) && idx.length === intermediates.length
    ? idx.map(i => intermediates[i].id)
    : intermediates.map(s => s.id);
  return { km: m / 1000, order: [geo[0].id, ...middle, geo[geo.length - 1].id] };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const routes = await tx.busRoute.findMany({
      // tenantId is explicit and load-bearing, not belt-and-braces on top of
      // RLS. Without it this returned every tenant's active staff routes: 45
      // rows across 32 tenants for a tenant that owns 14. withTenantRls sets
      // app.tenant_id and the policy is correct, but the database role holds
      // BYPASSRLS, so the policy never filters anything and the query's own
      // WHERE clause is the only thing standing between tenants.
      where: { tenantId, deletedAt: null, isActive: true, routeType: { in: ['STAFF', 'BOTH'] } },
      select: {
        id: true, name: true, code: true, totalDistanceKm: true,
        stops: { select: { id: true, stopName: true, sequence: true, gpsLat: true, gpsLng: true } },
      },
    });

    const rows: PreviewRow[] = [];
    let computed = 0;
    let apiCalls = 0;

    for (const r of routes) {
      const sorted = [...r.stops].sort((a, b) => a.sequence - b.sequence);
      const geo: GeoStop[] = sorted
        .filter(s => s.gpsLat != null && s.gpsLng != null)
        .map(s => ({ id: s.id, name: s.stopName, lat: s.gpsLat!, lng: s.gpsLng!, sequence: s.sequence }));

      if (geo.length < 3) {
        rows.push({
          routeId: r.id, routeName: r.name, routeCode: r.code,
          stopCount: sorted.length, geoStopCount: geo.length,
          originalDistanceKm: 0, optimisedDistanceKm: 0, distanceSavedKm: 0, distanceSavedPct: 0,
          skipped: true, skipReason: `Only ${geo.length} stops geocoded`,
          computedAt: null, cached: false,
        });
        continue;
      }

      const hash = hashStops(geo);
      const stored = await tx.$queryRawUnsafe<Array<{
        original_distance_km: unknown; optimised_distance_km: unknown;
        distance_saved_km: unknown; distance_saved_pct: unknown; updated_at: Date;
      }>>(
        `SELECT original_distance_km, optimised_distance_km, distance_saved_km,
                distance_saved_pct, updated_at
           FROM route_optimisation_results
          WHERE tenant_id = $1 AND route_id = $2 AND stops_hash = $3
          LIMIT 1`,
        tenantId, r.id, hash,
      );

      if (stored.length > 0) {
        const s = stored[0];
        rows.push({
          routeId: r.id, routeName: r.name, routeCode: r.code,
          stopCount: sorted.length, geoStopCount: geo.length,
          originalDistanceKm: round2(Number(s.original_distance_km)),
          optimisedDistanceKm: round2(Number(s.optimised_distance_km)),
          distanceSavedKm: round2(Number(s.distance_saved_km)),
          distanceSavedPct: round2(Number(s.distance_saved_pct)),
          skipped: false,
          computedAt: s.updated_at.toISOString(),
          cached: true,
        });
        continue;
      }

      // Cache miss — the only path that spends money.
      try {
        const currentKm = await drivingKmInOrder(geo);
        const best = await drivingKmOptimised(geo);
        apiCalls += 2;

        // Google can return a marginally longer "optimised" route than the
        // current order (traffic-unaware rounding, or the current order is
        // already optimal). Clamp rather than advertise a negative saving.
        const optimisedKm = Math.min(currentKm, best.km);
        const savedKm = currentKm - optimisedKm;
        const savedPct = currentKm > 0 ? (savedKm / currentKm) * 100 : 0;

        await tx.$executeRawUnsafe(
          // `id` is deliberately omitted: it is uuid with a
          // gen_random_uuid() default. Binding a JS string into it fails with
          // 42804 ("column id is of type uuid but expression is of type
          // text") because Postgres will not implicitly cast text to uuid in
          // a parameter position. Letting the column default fire avoids both
          // the cast and a redundant client-side id.
          `INSERT INTO route_optimisation_results
             (tenant_id, route_id, route_name, route_number, stops_hash,
              original_stop_count, matched_stop_count,
              original_distance_km, optimised_distance_km,
              distance_saved_km, distance_saved_pct,
              iterations_2opt, solver_duration_ms,
              original_sequence, optimised_sequence, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0,$12::jsonb,$13::jsonb,'PENDING',NOW(),NOW())
           ON CONFLICT (route_id) DO UPDATE SET
             tenant_id             = EXCLUDED.tenant_id,
             route_name            = EXCLUDED.route_name,
             route_number          = EXCLUDED.route_number,
             stops_hash            = EXCLUDED.stops_hash,
             original_stop_count   = EXCLUDED.original_stop_count,
             matched_stop_count    = EXCLUDED.matched_stop_count,
             original_distance_km  = EXCLUDED.original_distance_km,
             optimised_distance_km = EXCLUDED.optimised_distance_km,
             distance_saved_km     = EXCLUDED.distance_saved_km,
             distance_saved_pct    = EXCLUDED.distance_saved_pct,
             original_sequence     = EXCLUDED.original_sequence,
             optimised_sequence    = EXCLUDED.optimised_sequence,
             updated_at            = NOW()`,
          tenantId, r.id, r.name, r.code, hash,
          sorted.length, geo.length,
          round2(currentKm), round2(optimisedKm), round2(savedKm), round2(savedPct),
          JSON.stringify(geo.map(s => s.id)), JSON.stringify(best.order),
        );
        computed++;

        rows.push({
          routeId: r.id, routeName: r.name, routeCode: r.code,
          stopCount: sorted.length, geoStopCount: geo.length,
          originalDistanceKm: round2(currentKm),
          optimisedDistanceKm: round2(optimisedKm),
          distanceSavedKm: round2(savedKm),
          distanceSavedPct: round2(savedPct),
          skipped: false,
          computedAt: new Date().toISOString(),
          cached: false,
        });
      } catch (e) {
        // One route failing must not blank the whole widget. Report it as
        // skipped with the reason rather than showing a fabricated 0 km that
        // looks like "nothing to save here".
        console.error('[optimisation-preview] road distance failed for', r.id, e);
        rows.push({
          routeId: r.id, routeName: r.name, routeCode: r.code,
          stopCount: sorted.length, geoStopCount: geo.length,
          originalDistanceKm: 0, optimisedDistanceKm: 0, distanceSavedKm: 0, distanceSavedPct: 0,
          skipped: true,
          skipReason: e instanceof Error ? `Routing unavailable — ${e.message}` : 'Routing unavailable',
          computedAt: null, cached: false,
        });
      }
    }

    rows.sort((a, b) => b.distanceSavedKm - a.distanceSavedKm);
    const totalSavingsKm = round2(rows.reduce((s, r) => s + r.distanceSavedKm, 0));
    const meaningful = rows.filter(r => !r.skipped && r.distanceSavedPct >= 5);

    return NextResponse.json({
      runAt: new Date().toISOString(),
      routesScanned: routes.length,
      totalPotentialSavingsKm: totalSavingsKm,
      routesWithMeaningfulSavings: meaningful.length,
      /** Distances are road distance from the Routes API, not straight-line. */
      distanceBasis: 'driving',
      routesComputedThisRequest: computed,
      routesApiCallsThisRequest: apiCalls,
      rows,
    });
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
