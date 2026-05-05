/**
 * GET    /api/school-bus/stops/[id]   — single stop detail
 * PATCH  /api/school-bus/stops/[id]   — update stop
 * DELETE /api/school-bus/stops/[id]   — soft delete (set is_active = false)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;
const serialize = (r: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
};

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [row] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM school_bus_stops WHERE id = $1::uuid`, id,
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(serialize(row));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const fields: string[] = [];
    const vals:  unknown[] = [];
    const add = (col: string, val: unknown) => { vals.push(val); fields.push(`${col} = $${vals.length}`); };

    if (body.stopName       !== undefined) add('stop_name',          body.stopName);
    if (body.emirate        !== undefined) add('emirate',            body.emirate);
    if (body.city           !== undefined) add('city',               body.city);
    if (body.area           !== undefined) add('area',               body.area);
    if (body.neighbourhood  !== undefined) add('neighbourhood',      body.neighbourhood);
    if (body.landmark       !== undefined) add('landmark',           body.landmark);
    if (body.lat            !== undefined) add('lat',                body.lat != null ? Number(body.lat)  : null);
    if (body.lng            !== undefined) add('lng',                body.lng != null ? Number(body.lng)  : null);
    if (body.geofenceRadiusM!== undefined) add('geofence_radius_m', Number(body.geofenceRadiusM));
    if (body.notes          !== undefined) add('notes',              body.notes);
    if (body.isActive       !== undefined) add('is_active',          body.isActive);

    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    add('updated_at', new Date().toISOString());
    vals.push(id);

    const [row] = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE school_bus_stops SET ${fields.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
      ...vals,
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, stop: serialize(row) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.$executeRawUnsafe(
      `UPDATE school_bus_stops SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`, id,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
