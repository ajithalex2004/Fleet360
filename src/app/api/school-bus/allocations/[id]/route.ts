/**
 * GET    /api/school-bus/allocations/[id]
 * PATCH  /api/school-bus/allocations/[id]  — update, suspend, or withdraw
 * DELETE /api/school-bus/allocations/[id]  — soft delete (status = WITHDRAWN)
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

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [row] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM school_bus_allocations WHERE id = $1::uuid`, id,
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ allocation: ser(row) });
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

    if (body.studentName        !== undefined) add('student_name',         body.studentName);
    if (body.studentGrade       !== undefined) add('student_grade',        body.studentGrade);
    if (body.studentSection     !== undefined) add('student_section',      body.studentSection);
    if (body.parentName         !== undefined) add('parent_name',          body.parentName);
    if (body.parentPhone        !== undefined) add('parent_phone',         body.parentPhone);
    if (body.parentEmail        !== undefined) add('parent_email',         body.parentEmail);
    if (body.routeId            !== undefined) add('route_id',             body.routeId);
    if (body.routeName          !== undefined) add('route_name',           body.routeName);
    if (body.pickupStopName     !== undefined) add('pickup_stop_name',     body.pickupStopName);
    if (body.pickupStopTime     !== undefined) add('pickup_stop_time',     body.pickupStopTime);
    if (body.dropStopName       !== undefined) add('drop_stop_name',       body.dropStopName);
    if (body.dropStopTime       !== undefined) add('drop_stop_time',       body.dropStopTime);
    if (body.busMode            !== undefined) add('bus_mode',             body.busMode);
    if (body.seatNumber         !== undefined) add('seat_number',          body.seatNumber);
    if (body.effectiveFrom      !== undefined) add('effective_from',       body.effectiveFrom);
    if (body.effectiveTo        !== undefined) add('effective_to',         body.effectiveTo);
    if (body.status             !== undefined) add('status',               body.status);
    if (body.suspensionReason   !== undefined) add('suspension_reason',    body.suspensionReason);
    if (body.withdrawalReason   !== undefined) add('withdrawal_reason',    body.withdrawalReason);
    if (body.notes              !== undefined) add('notes',                body.notes);

    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    add('updated_at', new Date().toISOString());
    vals.push(id);

    const [row] = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE school_bus_allocations SET ${fields.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
      ...vals,
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, allocation: ser(row) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.$executeRawUnsafe(
      `UPDATE school_bus_allocations SET status = 'WITHDRAWN', effective_to = CURRENT_DATE, updated_at = NOW() WHERE id = $1::uuid`, id,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
