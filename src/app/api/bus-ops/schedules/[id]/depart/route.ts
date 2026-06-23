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
    if (!['SCHEDULED'].includes(schedule.status ?? '')) {
      return NextResponse.json({ error: `Cannot depart from status: ${schedule.status}` }, { status: 400 });
    }

    // Pre-trip safety check enforcement: a passing check must exist for THIS
    // schedule today. Override with x-skip-pretrip-check header for emergencies
    // (admin only — UI never sends this; emergency override leaves an audit trail).
    const skipPretrip = req.headers.get('x-skip-pretrip-check') === '1';
    if (!skipPretrip) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const passingCheck = await prisma.busPreTripCheck.findFirst({
        where: {
          scheduleId: id,
          performedAt: { gte: todayStart },
          overallPass: true,
        },
        orderBy: { performedAt: 'desc' },
      });
      if (!passingCheck) {
        return NextResponse.json(
          { error: 'Pre-trip safety check required (or did not pass). Complete the checklist before departing.' },
          { status: 412 },
        );
      }
    }

    const [updated] = await prisma.$transaction([
      prisma.tripSchedule.update({
        where: { id },
        data: { status: 'DEPARTED', updatedAt: new Date() },
      }),
      prisma.tripLog.create({
        data: {
          scheduleId: id,
          actualDepartureTime: body.departureTime ? new Date(body.departureTime) : new Date(),
          startMileage: body.startMileage ?? null,
          loggedBy: body.loggedBy ?? null,
          notes: body.notes ?? null,
        },
      }),
    ]);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusTrip',
      entityId: id,
      action: 'STATUS_CHANGE',
      before: schedule,
      after: updated,
      summary: `Departed bus trip ${updated.tripNumber ?? id}`,
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_TRIP_SCHEDULING',
      referenceType: 'BusTrip',
      referenceId: id,
      referenceNumber: updated.tripNumber ?? id,
      contextData: {
        previousStatus: schedule.status ?? null,
        status: updated.status ?? null,
        vehicleId: updated.vehicleId ?? null,
        routeId: updated.routeId ?? null,
      },
    });
    return NextResponse.json({ ...updated, workflow });
  } catch {
    return NextResponse.json({ error: 'Failed to depart' }, { status: 500 });
  }
}
