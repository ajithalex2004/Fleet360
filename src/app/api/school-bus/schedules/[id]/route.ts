/**
 * PATCH  /api/school-bus/schedules/[id]  — update schedule fields
 * DELETE /api/school-bus/schedules/[id]  — soft delete (set status=DELETED)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;
const ser = (r: Row): Row => {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) {
    o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
  }
  return o;
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const fields: string[] = [];
    const vals:   unknown[] = [];
    const add = (col: string, val: unknown) => { vals.push(val); fields.push(`${col} = $${vals.length}`); };

    if (body.scheduleName    !== undefined) add('schedule_name',    body.scheduleName);
    if (body.routeId         !== undefined) add('route_id',         body.routeId);
    if (body.routeName       !== undefined) add('route_name',       body.routeName);
    if (body.vehicleId       !== undefined) add('vehicle_id',       body.vehicleId);
    if (body.vehiclePlate    !== undefined) add('vehicle_plate',    body.vehiclePlate);
    if (body.driverId        !== undefined) add('driver_id',        body.driverId);
    if (body.driverName      !== undefined) add('driver_name',      body.driverName);
    if (body.attendantId     !== undefined) add('attendant_id',     body.attendantId);
    if (body.attendantName   !== undefined) add('attendant_name',   body.attendantName);
    if (body.weekType        !== undefined) add('week_type',        body.weekType);
    if (body.activeDays      !== undefined) add('active_days',      JSON.stringify(body.activeDays));
    if (body.session         !== undefined) add('session',          body.session);
    if (body.direction       !== undefined) add('direction',        body.direction);
    if (body.departureTime   !== undefined) add('departure_time',   body.departureTime);
    if (body.arrivalTime     !== undefined) add('arrival_time',     body.arrivalTime);
    if (body.effectiveFrom   !== undefined) add('effective_from',   body.effectiveFrom);
    if (body.effectiveTo     !== undefined) add('effective_to',     body.effectiveTo);
    if (body.exceptionDates  !== undefined) add('exception_dates',  JSON.stringify(body.exceptionDates));
    if (body.overrideDates   !== undefined) add('override_dates',   JSON.stringify(body.overrideDates));
    if (body.status          !== undefined) add('status',           body.status);
    if (body.notes           !== undefined) add('notes',            body.notes);

    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    add('updated_at', new Date().toISOString());
    vals.push(id);

    const [row] = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE school_bus_schedules SET ${fields.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
      ...vals,
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, schedule: ser(row) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.$executeRawUnsafe(
      `UPDATE school_bus_schedules SET status = 'DELETED', updated_at = NOW() WHERE id = $1::uuid`, id,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
