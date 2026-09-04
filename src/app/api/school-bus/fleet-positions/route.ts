export const dynamic = 'force-dynamic';

/**
 * GET  /api/school-bus/fleet-positions?tenantId=X
 *   Returns the latest GPS position for every active school bus vehicle,
 *   joined with trip and route context for the live map.
 *
 * POST /api/school-bus/fleet-positions
 *   Upserts a vehicle's current GPS position (called by the on-board telematics unit).
 *   Body: { tenantId, vehicleId, lat, lng, speedKmh, headingDeg, tripId?, routeId?, status? }
 *
 * Tables:
 *   school_bus_vehicle_positions — one row per vehicle (upserted on each telemetry ping)
 *   school_bus_trips             — active trip context
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
  });
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const sp       = new URL(req.url).searchParams;
        const tenantId = sp.get('tenantId') ?? 'default';
        const routeId  = sp.get('routeId')  ?? '';
        const status   = sp.get('status')   ?? '';

        const conds: string[] = ['p.tenant_id = $1'];
        const vals: unknown[] = [tenantId];
        const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };

        if (routeId) add('p.route_id::text', routeId);
        if (status)  add('p.status',  status);

        // Vehicles are "online" if last ping within 5 minutes
        const positions = await tx.$queryRawUnsafe<Row[]>(`
          SELECT
            p.*,
            CASE WHEN p.last_ping_at > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online,
            EXTRACT(EPOCH FROM (NOW() - p.last_ping_at))::int AS seconds_since_ping,
            t.status       AS trip_status,
            t.students_boarded,
            t.stops_completed,
            t.stops_total
          FROM school_bus_vehicle_positions p
          LEFT JOIN school_bus_trips t ON t.id = p.trip_id
          WHERE ${conds.join(' AND ')}
          ORDER BY p.last_ping_at DESC
        `, ...vals).catch(() => [] as Row[]);

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
        console.error('[fleet-positions GET]', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const {
          tenantId = 'default', vehicleId, vehiclePlate,
          routeId, routeName, tripId,
          driverId, driverName, attendantId, attendantName,
          lat, lng, speedKmh = 0, headingDeg = 0,
          status = 'EN_ROUTE',
          nextStopName, nextStopEta,
          studentsOnboard = 0,
        } = body;

        if (!vehicleId) return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
        if (lat === undefined || lng === undefined) return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });

        const [row] = await tx.$queryRawUnsafe<Row[]>(`
          INSERT INTO school_bus_vehicle_positions
            (tenant_id, vehicle_id, vehicle_plate, route_id, route_name, trip_id,
             driver_id, driver_name, attendant_id, attendant_name,
             lat, lng, speed_kmh, heading_deg, status,
             next_stop_name, next_stop_eta, students_onboard, last_ping_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
          ON CONFLICT (vehicle_id, tenant_id) DO UPDATE SET
            vehicle_plate    = EXCLUDED.vehicle_plate,
            route_id         = EXCLUDED.route_id,
            route_name       = EXCLUDED.route_name,
            trip_id          = EXCLUDED.trip_id,
            driver_id        = EXCLUDED.driver_id,
            driver_name      = EXCLUDED.driver_name,
            attendant_id     = EXCLUDED.attendant_id,
            attendant_name   = EXCLUDED.attendant_name,
            lat              = EXCLUDED.lat,
            lng              = EXCLUDED.lng,
            speed_kmh        = EXCLUDED.speed_kmh,
            heading_deg      = EXCLUDED.heading_deg,
            status           = EXCLUDED.status,
            next_stop_name   = EXCLUDED.next_stop_name,
            next_stop_eta    = EXCLUDED.next_stop_eta,
            students_onboard = EXCLUDED.students_onboard,
            last_ping_at     = NOW(),
            updated_at       = NOW()
          RETURNING *
        `,
          tenantId, vehicleId, vehiclePlate ?? null,
          routeId ?? null, routeName ?? null, tripId ?? null,
          driverId ?? null, driverName ?? null, attendantId ?? null, attendantName ?? null,
          lat, lng, speedKmh, headingDeg, status,
          nextStopName ?? null, nextStopEta ?? null, studentsOnboard,
        );

        return NextResponse.json({ ok: true, position: serialize([row])[0] }, { status: 200 });
        } catch (err) {
        console.error('[fleet-positions POST]', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
  });
}

