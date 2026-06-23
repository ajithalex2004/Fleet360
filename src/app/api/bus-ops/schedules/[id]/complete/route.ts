import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { entityBelongsToTenant, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type Params = { params: Promise<{ id: string }> };

type PrismaOperation = ReturnType<typeof prisma.tripSchedule.update> | ReturnType<typeof prisma.tripLog.update> | ReturnType<typeof prisma.tripLog.create>;
type TripScheduleUpdateResult = Awaited<ReturnType<typeof prisma.tripSchedule.update>>;

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
    if (!['DEPARTED', 'IN_TRANSIT', 'SCHEDULED'].includes(schedule.status ?? '')) {
      return NextResponse.json({ error: `Cannot complete from status: ${schedule.status}` }, { status: 400 });
    }

    // Find the latest trip log and update it
    const latestLog = await prisma.tripLog.findFirst({
      where: { scheduleId: id },
      orderBy: { createdAt: 'desc' },
    });

    const ops: PrismaOperation[] = [
      prisma.tripSchedule.update({
        where: { id },
        data: { status: 'COMPLETED', updatedAt: new Date() },
      }),
    ];

    if (latestLog) {
      ops.push(prisma.tripLog.update({
        where: { id: latestLog.id },
        data: {
          actualArrivalTime: body.arrivalTime ? new Date(body.arrivalTime) : new Date(),
          endMileage: body.endMileage ?? null,
          fuelUsed: body.fuelUsed ?? null,
          passengersBoarded: body.passengersBoarded ?? null,
          driverNotes: body.driverNotes ?? null,
        },
      }));
    } else {
      ops.push(prisma.tripLog.create({
        data: {
          scheduleId: id,
          actualArrivalTime: new Date(),
          passengersBoarded: body.passengersBoarded ?? null,
          loggedBy: body.loggedBy ?? null,
        },
      }));
    }

    const results = await prisma.$transaction(ops);
    const updatedSchedule = results[0] as TripScheduleUpdateResult;

    // Propagate end-mileage to the Vehicle so the existing Maintenance
    // alert engine (Maintenance/alert-config + ServiceSchedule) can see
    // accumulating km from staff bus operations. Best-effort — never
    // fails the trip completion.
    if (body.endMileage != null && schedule.vehicleId) {
      const km = Number(body.endMileage);
      if (Number.isFinite(km) && km > 0) {
        try {
          await prisma.vehicle.update({
            where: { id: schedule.vehicleId },
            data: { currentMileage: BigInt(Math.round(km)), odometerReading: BigInt(Math.round(km)) },
          });
        } catch (err) {
          console.warn('[bus-ops complete] vehicle mileage propagation failed:', err);
        }
      }
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusTrip',
      entityId: id,
      action: 'STATUS_CHANGE',
      before: schedule,
      after: updatedSchedule,
      summary: `Completed bus trip ${updatedSchedule.tripNumber ?? id}`,
    });

    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_TRIP_SCHEDULING',
      referenceType: 'BusTrip',
      referenceId: id,
      referenceNumber: updatedSchedule.tripNumber ?? id,
      contextData: {
        previousStatus: schedule.status ?? null,
        status: updatedSchedule.status ?? null,
        passengersBoarded: body.passengersBoarded ?? null,
        vehicleId: schedule.vehicleId ?? null,
      },
      force: schedule.status === 'SCHEDULED',
    });

    return NextResponse.json({ schedule: updatedSchedule, workflow });
  } catch {
    return NextResponse.json({ error: 'Failed to complete' }, { status: 500 });
  }
}
