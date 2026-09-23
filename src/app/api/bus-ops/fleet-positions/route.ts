export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/fleet-positions — powers the /bus-ops/live-map page.
 *
 * GET  — latest position per vehicle for this tenant, with an is_online /
 *        seconds_since_ping derivation and a fleet-wide status summary.
 *        Optional ?status= / ?routeId= filters.
 *
 * POST — upsert one vehicle's position. Called by the driver-app GPS ingest
 *        (POST /api/bus-ops/vehicles/[id]/location — see upsertFleetPosition
 *        in @/lib/bus-ops/fleet-positions), and by the demo seeder on the
 *        live-map page for empty tenants. tenantId always comes from the
 *        x-tenant-id header — never from the body — even when accepted
 *        from the browser seeder.
 *
 * Table lives in bus_ops_vehicle_positions (created via
 * prisma/raw/add_bus_ops_vehicle_positions.sql).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { serialize, upsertFleetPosition, type Row } from '@/lib/bus-ops/fleet-positions';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const sp      = req.nextUrl.searchParams;
        const routeId = sp.get('routeId') ?? '';
        const status  = sp.get('status')  ?? '';

        // Column refs use the `p.` alias since we now LEFT JOIN trip_schedules
        // to surface trip_status. The alias makes the join unambiguous and
        // future-proofs adding more joined tables.
        const conds: string[] = ['p.tenant_id = $1'];
        const vals: unknown[] = [tenantId];
        const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };
        if (routeId) add('p.route_id::text', routeId);
        if (status)  add('p.status', status);

        const positions = await tx.$queryRawUnsafe<Row[]>(`
          SELECT
            p.id, p.tenant_id, p.vehicle_id, p.vehicle_plate, p.route_id, p.route_name, p.trip_id,
            p.driver_id, p.driver_name,
            p.lat, p.lng, p.speed_kmh, p.heading_deg, p.status,
            p.next_stop_name, p.next_stop_eta, p.passengers_onboard,
            p.last_ping_at,
            (p.last_ping_at > NOW() - INTERVAL '5 minutes')                     AS is_online,
            EXTRACT(EPOCH FROM (NOW() - p.last_ping_at))::int                   AS seconds_since_ping,
            ts.status                                                           AS trip_status,
            ts.trip_number                                                      AS trip_number
          FROM bus_ops_vehicle_positions p
          LEFT JOIN trip_schedules ts ON ts.id = p.trip_id
          WHERE ${conds.join(' AND ')}
          ORDER BY p.last_ping_at DESC
        `, ...vals);

        const data = serialize(positions);
        const summary = {
          total:    data.length,
          online:   data.filter(d => d.is_online).length,
          enRoute:  data.filter(d => d.status === 'EN_ROUTE').length,
          atStop:   data.filter(d => d.status === 'AT_STOP').length,
          idle:     data.filter(d => d.status === 'IDLE').length,
          offline:  data.filter(d => !d.is_online || d.status === 'OFFLINE').length,
          breakdown:data.filter(d => d.status === 'BREAKDOWN').length,
        };
        return NextResponse.json({ positions: data, summary });
        } catch (err) {
        console.error('[fleet-positions.GET]', err);
        return NextResponse.json({ error: 'Failed to load fleet positions' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  try {
    const b = await req.json();
    if (!b.vehicleId) return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number') {
      return NextResponse.json({ error: 'lat and lng are required numbers' }, { status: 400 });
    }
    const row = await upsertFleetPosition({
      tenantId, // stamped from header — never trust body
      vehicleId: String(b.vehicleId),
      vehiclePlate: b.vehiclePlate ?? null,
      routeId: b.routeId ?? null,
      routeName: b.routeName ?? null,
      tripId: b.tripId ?? null,
      driverId: b.driverId ?? null,
      driverName: b.driverName ?? null,
      lat: b.lat,
      lng: b.lng,
      speedKmh: Number(b.speedKmh ?? 0),
      headingDeg: Number(b.headingDeg ?? 0),
      status: b.status ?? 'EN_ROUTE',
      nextStopName: b.nextStopName ?? null,
      nextStopEta: b.nextStopEta ?? null,
      passengersOnboard: Number(b.passengersOnboard ?? 0),
    });
    return NextResponse.json({ ok: true, position: row }, { status: 200 });
    } catch (err) {
    console.error('[fleet-positions.POST]', err);
    return NextResponse.json({ error: 'Failed to upsert position' }, { status: 500 });
  }
}
