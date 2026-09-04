export const dynamic = 'force-dynamic';

/**
 * GET  /api/school-bus/trips?tenantId=X&date=YYYY-MM-DD&status=X&routeId=X
 *   Returns trip records (today's by default).
 *
 * POST /api/school-bus/trips
 *   Creates a new trip record (called when a route starts its daily journey).
 *
 * Companion endpoint: POST /api/school-bus/trips/[id]/events
 *   Appends telemetry events: DEPARTURE, STOP_ARRIVAL, BOARDING, ALIGHTING, GEOFENCE_EXIT, INCIDENT, ARRIVAL
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
        const date     = sp.get('date')     ?? new Date().toISOString().slice(0, 10);
        const status   = sp.get('status')   ?? '';
        const routeId  = sp.get('routeId')  ?? '';
        const search   = sp.get('search')   ?? '';

        const conds: string[] = ['t.tenant_id = $1', 't.scheduled_date = $2'];
        const vals: unknown[] = [tenantId, date];
        const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };

        if (status)  add('t.status', status);
        if (routeId) add('t.route_id::text', routeId);
        if (search) {
          vals.push(`%${search}%`);
          conds.push(`(t.route_name ILIKE $${vals.length} OR t.driver_name ILIKE $${vals.length} OR t.vehicle_plate ILIKE $${vals.length} OR t.trip_code ILIKE $${vals.length})`);
        }

        const rows = await tx.$queryRawUnsafe<Row[]>(`
          SELECT
            t.*,
            COUNT(e.id) AS event_count,
            MAX(CASE WHEN e.event_type = 'SPEEDING' THEN 1 ELSE 0 END) AS has_speeding
          FROM school_bus_trips t
          LEFT JOIN school_bus_trip_events e ON e.trip_id = t.id
          WHERE ${conds.join(' AND ')}
          GROUP BY t.id
          ORDER BY t.scheduled_start ASC NULLS LAST, t.created_at ASC
        `, ...vals).catch(() => [] as Row[]);

        const data = serialize(rows);
        const summary = {
          total:      data.length,
          scheduled:  data.filter(t => t.status === 'SCHEDULED').length,
          inProgress: data.filter(t => t.status === 'IN_PROGRESS').length,
          completed:  data.filter(t => t.status === 'COMPLETED').length,
          cancelled:  data.filter(t => t.status === 'CANCELLED').length,
          breakdown:  data.filter(t => t.status === 'BREAKDOWN').length,
        };

        return NextResponse.json({ trips: data, summary, date });
        } catch (err) {
        console.error('[school-bus/trips GET]', err);
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
          tenantId = 'default', routeId, routeName, routeCode,
          vehicleId, vehiclePlate, driverId, driverName, attendantId, attendantName,
          direction = 'PICKUP', session = 'MORNING',
          scheduledDate, scheduledStart,
          studentsTotal = 0, stopsTotal = 0,
          status = 'SCHEDULED', notes,
        } = body;

        // Auto trip code
        const today = scheduledDate ?? new Date().toISOString().slice(0, 10);
        const [countRow] = await tx.$queryRawUnsafe<{ cnt: bigint }[]>(
          `SELECT COUNT(*) AS cnt FROM school_bus_trips WHERE tenant_id = $1 AND scheduled_date = $2`, tenantId, today,
        );
        const seq = String(Number(countRow?.cnt ?? 0) + 1).padStart(3, '0');
        const tripCode = `TRIP-${today.replace(/-/g, '')}-${seq}`;

        const [row] = await tx.$queryRawUnsafe<Row[]>(`
          INSERT INTO school_bus_trips
            (tenant_id, trip_code, route_id, route_name, route_code,
             vehicle_id, vehicle_plate, driver_id, driver_name, attendant_id, attendant_name,
             direction, session, scheduled_date, scheduled_start,
             students_total, stops_total, status, notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          RETURNING *
        `,
          tenantId, tripCode,
          routeId ?? null, routeName ?? null, routeCode ?? null,
          vehicleId ?? null, vehiclePlate ?? null,
          driverId ?? null, driverName ?? null,
          attendantId ?? null, attendantName ?? null,
          direction, session, today, scheduledStart ?? null,
          studentsTotal, stopsTotal, status, notes ?? null,
        );

        return NextResponse.json({ ok: true, trip: serialize([row])[0] }, { status: 201 });
        } catch (err) {
        console.error('[school-bus/trips POST]', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
  });
}

