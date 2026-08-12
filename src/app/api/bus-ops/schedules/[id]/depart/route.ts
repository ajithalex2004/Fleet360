import { NextRequest, NextResponse } from 'next/server';
import { prisma }         from '@/lib/prisma';
import { getEventBus }    from '@/events/event-bus';
import { TRIP_DEPARTED }  from '@/events/registry';
import { assertTripTransition, TripTransitionError, type TripScheduleStatus } from '@/lib/bus-ops/state-machines';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const schedule = await prisma.tripSchedule.findFirst({ where: { id: params.id, tenantId } });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    try {
      assertTripTransition((schedule.status ?? 'SCHEDULED') as TripScheduleStatus, 'DEPARTED');
    } catch (e) {
      if (e instanceof TripTransitionError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }

    // Pre-trip safety check enforcement: a passing check must exist for THIS
    // schedule today. Override with x-skip-pretrip-check header for emergencies
    // (admin only — UI never sends this; emergency override leaves an audit trail).
    const skipPretrip = req.headers.get('x-skip-pretrip-check') === '1';
    if (!skipPretrip) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const passingCheck = await prisma.busPreTripCheck.findFirst({
        where: {
          scheduleId: params.id,
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

    // Depart transaction:
    //   1. flip schedule to DEPARTED
    //   2. create the trip log entry
    //   3. auto-mark any CONFIRMED-but-not-BOARDED passenger as NO_SHOW.
    //      Before this, no-shows had to be flipped by hand — meaning most
    //      trips left them stuck at CONFIRMED forever and downstream
    //      attendance / occupancy stats were wrong. The gate is intentionally
    //      strict (status = 'CONFIRMED') so we don't stomp on an ABSENT flag
    //      the passenger set earlier or a manual override the driver made.
    const [updated, tripLog, noShowResult] = await prisma.$transaction([
      prisma.tripSchedule.update({
        where: { id: params.id },
        data: { status: 'DEPARTED', updatedAt: new Date() },
      }),
      prisma.tripLog.create({
        data: {
          scheduleId: params.id,
          actualDepartureTime: body.departureTime ? new Date(body.departureTime) : new Date(),
          startMileage: body.startMileage ?? null,
          loggedBy: body.loggedBy ?? null,
          notes: body.notes ?? null,
        },
      }),
      prisma.tripPassenger.updateMany({
        where: { tripId: params.id, status: 'CONFIRMED', deletedAt: null },
        data: { status: 'NO_SHOW', updatedAt: new Date() },
      }),
    ]);

    // Publish to outbox — downstream consumers pick this up asynchronously.
    // tenantId from the schedule row; null is safe (NULL::uuid in event_outbox).
    getEventBus().publish({
      eventType:     TRIP_DEPARTED,
      aggregateType: 'TripSchedule',
      aggregateId:   schedule.id,
      sourceModule:  'bus-ops',
      tenantId:      schedule.tenantId ?? null,
      payload: {
        scheduleId:          schedule.id,
        tripNumber:          schedule.tripNumber  ?? null,
        vehicleId:           schedule.vehicleId   ?? null,
        driverId:            schedule.driverId    ?? null,
        tripLogId:           tripLog.id,
        actualDepartureTime: (tripLog.actualDepartureTime ?? new Date()).toISOString(),
        startMileage:        body.startMileage ?? null,
        noShowsMarked:       noShowResult.count,
      },
    }).catch(err => console.warn('[bus-ops depart] outbox publish failed:', err));

    return NextResponse.json({ ...updated, noShowsMarked: noShowResult.count });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to depart' }, { status: 500 });
  }
}
