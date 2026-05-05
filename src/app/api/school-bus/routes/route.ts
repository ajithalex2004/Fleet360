/**
 * School Bus Route Assignment Engine
 *
 * GET  /api/school-bus/routes           — list routes
 * POST /api/school-bus/routes           — create route
 * PATCH /api/school-bus/routes          — update route
 * DELETE /api/school-bus/routes         — soft delete
 *
 * Route Assignment: POST /api/school-bus/routes/[id]/assign
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
      out[k] = v;
    }
    return out;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const sp         = new URL(req.url).searchParams;
    const tenantId   = sp.get('tenantId')  ?? '';
    const status     = sp.get('status')    ?? '';
    const direction  = sp.get('direction') ?? '';

    const conditions: string[] = ['r.status != \'DELETED\''];
    const values: unknown[]    = [];

    if (tenantId)  { values.push(tenantId);  conditions.push(`r.tenant_id = $${values.length}`); }
    if (status)    { values.push(status);    conditions.push(`r.status    = $${values.length}`); }
    if (direction) { values.push(direction); conditions.push(`r.direction = $${values.length}`); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        r.*,
        v.registration_number AS vehicle_reg,
        v.type                AS vehicle_type,
        COALESCE(v.capacity, 0) AS vehicle_capacity,
        d.first_name || ' ' || d.last_name AS driver_name
      FROM school_bus_routes r
      LEFT JOIN vehicles v ON v.id::text = r.assigned_vehicle_id AND v.deleted_at IS NULL
      LEFT JOIN drivers  d ON d.id::text = r.assigned_driver_id  AND d.deleted_at IS NULL
      ${where}
      ORDER BY r.departure_time ASC, r.route_name ASC
    `, ...values);

    return NextResponse.json({ data: serialize(rows), total: rows.length });
  } catch (err) {
    console.error('[school-bus/routes GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const body = await req.json();
    const {
      tenantId       = 'default',
      routeName, routeCode,
      direction      = 'PICKUP',
      session        = 'MORNING',
      routeType      = 'STUDENT',
      departureTime, arrivalTime,
      assignedVehicleId, assignedDriverId, assignedAttendantId,
      seatCapacity   = 40,
      studentCount   = 0,
      waypoints      = [],
      stopSequence   = [],
      isActive       = true,
    } = body;

    if (!routeName)     return NextResponse.json({ error: 'routeName is required'     }, { status: 400 });
    if (!departureTime) return NextResponse.json({ error: 'departureTime is required' }, { status: 400 });

    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      INSERT INTO school_bus_routes
        (tenant_id, route_name, route_code, direction, session, route_type,
         departure_time, arrival_time,
         assigned_vehicle_id, assigned_driver_id, assigned_attendant_id,
         seat_capacity, student_count, waypoints, stop_sequence, is_active)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7::time,$8::time,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16)
      RETURNING id
    `,
      tenantId, routeName, routeCode ?? null, direction, session, routeType,
      departureTime, arrivalTime ?? null,
      assignedVehicleId ?? null, assignedDriverId ?? null, assignedAttendantId ?? null,
      Number(seatCapacity), Number(studentCount),
      JSON.stringify(waypoints), JSON.stringify(stopSequence), Boolean(isActive),
    );

    return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
  } catch (err) {
    console.error('[school-bus/routes POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const body = await req.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const fieldMap: Record<string, string> = {
      routeName:            'route_name',
      routeCode:            'route_code',
      direction:            'direction',
      session:              'session',
      routeType:            'route_type',
      departureTime:        'departure_time',
      arrivalTime:          'arrival_time',
      assignedVehicleId:    'assigned_vehicle_id',
      assignedDriverId:     'assigned_driver_id',
      assignedAttendantId:  'assigned_attendant_id',
      seatCapacity:         'seat_capacity',
      studentCount:         'student_count',
      waypoints:            'waypoints',
      stopSequence:         'stop_sequence',
      isActive:             'is_active',
      status:               'status',
    };

    const jsonbCols = new Set(['waypoints', 'stop_sequence']);
    const timeCols  = new Set(['departure_time', 'arrival_time']);

    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[]    = [];

    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      if (fields[jsKey] !== undefined) {
        const val = fields[jsKey];
        values.push(jsonbCols.has(dbCol) ? JSON.stringify(val) : val);
        const cast = jsonbCols.has(dbCol) ? '::jsonb' : timeCols.has(dbCol) ? '::time' : '';
        setClauses.push(`${dbCol} = $${values.length}${cast}`);
      }
    }

    if (setClauses.length === 1) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    values.push(id);
    const [updated] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      UPDATE school_bus_routes SET ${setClauses.join(', ')}
      WHERE id = $${values.length}::uuid
      RETURNING id
    `, ...values);

    if (!updated) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    console.error('[school-bus/routes PATCH]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureDispatchSchema();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      UPDATE school_bus_routes SET status = 'DELETED', updated_at = NOW()
      WHERE id = $1::uuid AND status != 'DELETED'
      RETURNING id
    `, id);

    if (!row) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[school-bus/routes DELETE]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
