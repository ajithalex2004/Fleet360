/**
 * PATCH  /api/school-bus/attendants/[id]  — update attendant
 * DELETE /api/school-bus/attendants/[id]  — soft delete
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;
const ser = (r: Row): Row => {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
  return o;
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const fields: string[] = [];
    const vals:   unknown[] = [];
    const add = (col: string, val: unknown) => { vals.push(val); fields.push(`${col} = $${vals.length}`); };

    if (body.firstName          !== undefined) add('first_name',           body.firstName);
    if (body.lastName           !== undefined) add('last_name',            body.lastName);
    if (body.gender             !== undefined) add('gender',               body.gender);
    if (body.nationality        !== undefined) add('nationality',          body.nationality);
    if (body.phone              !== undefined) add('phone',                body.phone);
    if (body.email              !== undefined) add('email',                body.email);
    if (body.emiratesId         !== undefined) add('emirates_id',          body.emiratesId);
    if (body.emiratesIdExpiry   !== undefined) add('emirates_id_expiry',   body.emiratesIdExpiry);
    if (body.certificationNo    !== undefined) add('certification_no',     body.certificationNo);
    if (body.certificationExpiry!== undefined) add('certification_expiry', body.certificationExpiry);
    if (body.routeId            !== undefined) add('route_id',             body.routeId);
    if (body.routeName          !== undefined) add('route_name',           body.routeName);
    if (body.assignedVehicleId  !== undefined) add('assigned_vehicle_id',  body.assignedVehicleId);
    if (body.status             !== undefined) add('status',               body.status);
    if (body.joiningDate        !== undefined) add('joining_date',         body.joiningDate);
    if (body.notes              !== undefined) add('notes',                body.notes);
    if (body.isActive           !== undefined) add('is_active',            body.isActive);

    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    add('updated_at', new Date().toISOString());
    vals.push(id);

    const [row] = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE school_bus_attendants SET ${fields.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
      ...vals,
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, attendant: ser(row) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.$executeRawUnsafe(
      `UPDATE school_bus_attendants SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`, id,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
