import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { entityBelongsToTenant, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_schedules', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const schedule = await prisma.tripSchedule.findUnique({ where: { id } });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (['COMPLETED', 'CANCELLED'].includes(schedule.status ?? '')) {
      return NextResponse.json({ error: `Cannot cancel from status: ${schedule.status}` }, { status: 400 });
    }
    const updated = await prisma.tripSchedule.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: body.reason ? `CANCELLED: ${body.reason}` : schedule.notes,
        updatedAt: new Date(),
      },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusTrip',
      entityId: id,
      action: 'STATUS_CHANGE',
      before: schedule,
      after: updated,
      summary: `Cancelled bus trip ${updated.tripNumber ?? id}`,
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_ATTENDANCE_EXCEPTION',
      referenceType: 'BusTrip',
      referenceId: id,
      referenceNumber: updated.tripNumber ?? id,
      contextData: {
        previousStatus: schedule.status ?? null,
        status: updated.status ?? null,
        routeId: updated.routeId ?? null,
        reason: body.reason ?? null,
        action: 'cancel',
      },
      force: true,
    });
    return NextResponse.json({ ...updated, workflow });
  } catch {
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
  }
}
