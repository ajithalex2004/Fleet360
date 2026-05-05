/**
 * GET    /api/school-bus/trips/[id]  — fetch single trip with events
 * PATCH  /api/school-bus/trips/[id]  — update trip (status, counters, etc.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureTripTables } from '../route';

type Row = Record<string, unknown>;
const ser = (r: Row): Row => {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) {
    o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
  }
  return o;
};

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureTripTables();
    const { id } = await params;

    const [trip] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM school_bus_trips WHERE id = $1::uuid`, id,
    );
    if (!trip) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const events = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM school_bus_trip_events WHERE trip_id = $1::uuid ORDER BY event_time ASC`, id,
    );

    return NextResponse.json({ trip: ser(trip), events: events.map(ser) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const fields: string[] = [];
    const vals:   unknown[] = [];
    const add = (col: string, val: unknown) => { vals.push(val); fields.push(`${col} = $${vals.length}`); };

    if (body.status          !== undefined) add('status',           body.status);
    if (body.actualStart     !== undefined) add('actual_start',     body.actualStart);
    if (body.actualEnd       !== undefined) add('actual_end',       body.actualEnd);
    if (body.studentsBoarded !== undefined) add('students_boarded', body.studentsBoarded);
    if (body.studentsDropped !== undefined) add('students_dropped', body.studentsDropped);
    if (body.stopsCompleted  !== undefined) add('stops_completed',  body.stopsCompleted);
    if (body.distanceKm      !== undefined) add('distance_km',      body.distanceKm);
    if (body.durationMin     !== undefined) add('duration_min',     body.durationMin);
    if (body.avgSpeedKmh     !== undefined) add('avg_speed_kmh',    body.avgSpeedKmh);
    if (body.maxSpeedKmh     !== undefined) add('max_speed_kmh',    body.maxSpeedKmh);
    if (body.speedingEvents  !== undefined) add('speeding_events',  body.speedingEvents);
    if (body.harshBraking    !== undefined) add('harsh_braking',    body.harshBraking);
    if (body.geofenceExits   !== undefined) add('geofence_exits',   body.geofenceExits);
    if (body.notes           !== undefined) add('notes',            body.notes);

    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    add('updated_at', new Date().toISOString());
    vals.push(id);

    const [row] = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE school_bus_trips SET ${fields.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
      ...vals,
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, trip: ser(row) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
