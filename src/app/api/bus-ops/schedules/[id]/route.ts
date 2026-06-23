import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertStatusTransition,
  entityBelongsToTenant,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_schedules', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const schedule = await prisma.tripSchedule.findUnique({
      where: { id },
      include: {
        route: { include: { stops: { orderBy: { sequence: 'asc' } } } },
        passengers: { orderBy: { createdAt: 'asc' } },
        tripLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(schedule);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_schedules', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const before = await prisma.tripSchedule.findUnique({ where: { id } });
    const transition = assertStatusTransition('busTrip', before?.status, body.status);
    if (transition) return transition;
    const data = { ...body };
    delete data.route;
    delete data.passengers;
    delete data.tripLogs;
    delete data.tenantId;
    const schedule = await prisma.tripSchedule.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
      include: { route: true },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusTrip',
      entityId: id,
      action: body.status !== undefined && body.status !== before?.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: schedule,
      summary: `Updated bus trip ${schedule.tripNumber ?? id}`,
    });
    return NextResponse.json(schedule);
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_schedules', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const before = await prisma.tripSchedule.findUnique({ where: { id } });
    const schedule = await prisma.tripSchedule.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusTrip',
      entityId: id,
      action: 'DELETE',
      before,
      after: schedule,
      summary: `Cancelled bus trip ${schedule.tripNumber ?? id}`,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
