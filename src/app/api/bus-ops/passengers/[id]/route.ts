import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertStatusTransition,
  entityBelongsToTenant,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_passengers', id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const before = await prisma.tripPassenger.findUnique({ where: { id } });
    const transition = assertStatusTransition('tripPassenger', before?.status, body.status);
    if (transition) return transition;
    const data = { ...body };
    delete data.trip;
    delete data.tenantId;
    // If marking as BOARDED, set boardedAt
    if (data.status === 'BOARDED' && !data.boardedAt) data.boardedAt = new Date();
    const passenger = await prisma.tripPassenger.update({ where: { id }, data });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TripPassenger',
      entityId: id,
      action: body.status !== undefined && body.status !== before?.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: passenger,
      summary: `Updated trip passenger ${id}`,
    });
    return NextResponse.json(passenger);
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_passengers', id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const before = await prisma.tripPassenger.findUnique({ where: { id } });
    await prisma.tripPassenger.delete({ where: { id } });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TripPassenger',
      entityId: id,
      action: 'DELETE',
      before,
      after: null,
      summary: `Removed trip passenger ${id}`,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
