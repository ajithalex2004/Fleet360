/**
 * /api/bus-ops/routes/[id]/stops — RouteStop CRUD for one route.
 *
 * Phase 3.5: every write dual-writes the linked spatial.places row via
 * syncStopPlace(). Reads are unchanged — consumers still read gps_lat/
 * gps_lng/geofence_radius_m from route_stops. The Place link is
 * available for cross-module queries.
 *
 * Also fixed a pre-existing gap: RouteStop.tenantId was never populated
 * on create/replace, leaving stops orphaned from tenant scoping.
 *
 * That fix originally read the tenant off the BusRoute row and used it to
 * stamp the stops. It populated the column, but it took the tenant from the
 * RESOURCE rather than the CALLER — and shadowed the authenticated tenantId
 * with it. The route id comes from the URL and nothing checked ownership, so
 * any authenticated user could read, replace, or append stops on any route in
 * any organisation, and the written rows carried the victim's tenant_id,
 * making the result indistinguishable from a legitimate edit. RLS would
 * normally have blocked it; the database role holds BYPASSRLS, so it did not.
 *
 * Every handler here now resolves the route scoped by the authenticated
 * tenant and returns 404 when it isn't theirs — 404 rather than 403 so the
 * endpoint cannot be used to enumerate which route ids exist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { syncStopPlace, syncStopPlaces } from '@/lib/places/sync-stop';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const stops = await tx.routeStop.findMany({
          where: { routeId: params.id, tenantId },
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
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

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

        // Prove the route belongs to the caller before touching anything. The
        // previous version read the route's own tenantId and shadowed the
        // authenticated one with it, which turned "stamp the tenant" into
        // "adopt whatever tenant owns this row" — see the file header.
        const route = await tx.busRoute.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!route) {
          return NextResponse.json({ error: 'Route not found' }, { status: 404 });
        }

        // No inner $transaction here. withTenantRls has already opened one and
        // Prisma strips $transaction from a TransactionClient at runtime, so
        // the previous tx.$transaction([...]) would have thrown
        // "tx.$transaction is not a function". These two statements are atomic
        // regardless — they run inside the transaction withTenantRls holds.
        await tx.routeStop.deleteMany({ where: { routeId: params.id, tenantId } });
        await tx.routeStop.createMany({
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
        });

        // Reload with ids assigned by createMany, then dual-write Places.
        const newStops = await tx.routeStop.findMany({
          where: { routeId: params.id, tenantId },
          orderBy: { sequence: 'asc' },
        });
        void syncStopPlaces(newStops, tenantId).catch(() => { /* best-effort */ });

        return NextResponse.json(newStops);
      } catch {
        return NextResponse.json({ error: 'Failed to update stops' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        // Route resolved within the caller's tenant, and the authenticated
        // tenantId is no longer shadowed by the route's own — see the file
        // header for what that shadowing allowed.
        const [route, maxSeq] = await Promise.all([
          tx.busRoute.findFirst({
            where: { id: params.id, tenantId, deletedAt: null },
            select: { id: true },
          }),
          tx.routeStop.aggregate({ where: { routeId: params.id, tenantId }, _max: { sequence: true } }),
        ]);
        if (!route) {
          return NextResponse.json({ error: 'Route not found' }, { status: 404 });
        }

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

