/**
 * /api/bus-ops/routes/[id]/stops — RouteStop CRUD for one route.
 *
 * Phase 3.5: every write dual-writes the linked spatial.places row via
 * syncStopPlace(). Reads are unchanged — consumers still read gps_lat/
 * gps_lng/geofence_radius_m from route_stops. The Place link is
 * available for cross-module queries.
 *
 * Also fixed a pre-existing gap: RouteStop.tenantId was never populated
 * on create/replace, leaving stops orphaned from tenant scoping. Now
 * derived from the BusRoute's tenantId on every write.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { syncStopPlace, syncStopPlaces } from '@/lib/places/sync-stop';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const stops = await tx.routeStop.findMany({
          where: { routeId: params.id },
          orderBy: { sequence: 'asc' },
        });
        return NextResponse.json(stops);
      } catch {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


// Replace all stops for a route (reorder/rebuild). Runs the delete +
// createMany inside a transaction; Place sync runs after — a Place-sync
// failure never rolls back the RouteStop write (the source model is
// authoritative, Place is a mirror).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stops = (body.stops ?? body) as any[];

        // Resolve the route's tenantId once so we can stamp it on every stop
        // (fixes the pre-existing bug where stops landed with null tenant).
        const route = await tx.busRoute.findUnique({ where: { id: params.id }, select: { tenantId: true } });
        const tenantId = route?.tenantId ?? null;

        await tx.$transaction([
          tx.routeStop.deleteMany({ where: { routeId: params.id } }),
          tx.routeStop.createMany({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: stops.map((s: any, i: number) => ({
              routeId: params.id,
              tenantId,
              stopName: s.stopName,
              sequence: s.sequence ?? i + 1,
              gpsLat: s.gpsLat ?? null,
              gpsLng: s.gpsLng ?? null,
              geofenceRadiusM: s.geofenceRadiusM ?? null,
              estimatedArrivalMins: s.estimatedArrivalMins ?? null,
              landmark: s.landmark ?? null,
            })),
          }),
        ]);

        // Reload with ids assigned by createMany, then dual-write Places.
        const newStops = await tx.routeStop.findMany({
          where: { routeId: params.id },
          orderBy: { sequence: 'asc' },
        });
        void syncStopPlaces(newStops, tenantId).catch(() => { /* best-effort */ });

        return NextResponse.json(newStops);
      } catch {
        return NextResponse.json({ error: 'Failed to update stops' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const [route, maxSeq] = await Promise.all([
          tx.busRoute.findUnique({ where: { id: params.id }, select: { tenantId: true } }),
          tx.routeStop.aggregate({ where: { routeId: params.id }, _max: { sequence: true } }),
        ]);
        const tenantId = route?.tenantId ?? null;

        const stop = await tx.routeStop.create({
          data: {
            routeId: params.id,
            tenantId,
            stopName: body.stopName,
            sequence: body.sequence ?? (maxSeq._max.sequence ?? 0) + 1,
            gpsLat: body.gpsLat ?? null,
            gpsLng: body.gpsLng ?? null,
            geofenceRadiusM: body.geofenceRadiusM ?? null,
            estimatedArrivalMins: body.estimatedArrivalMins ?? null,
            landmark: body.landmark ?? null,
          },
        });

        void syncStopPlace(stop, tenantId).catch(() => { /* best-effort */ });

        return NextResponse.json(stop, { status: 201 });
      } catch {
        return NextResponse.json({ error: 'Failed to add stop' }, { status: 500 });
      }
  });
}

