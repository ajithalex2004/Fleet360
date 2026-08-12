import { NextRequest, NextResponse } from 'next/server';
import { prisma }          from '@/lib/prisma';
import { getEventBus }     from '@/events/event-bus';
import { TRIP_CANCELLED }  from '@/events/registry';
import { assertTripTransition, TripTransitionError, type TripScheduleStatus } from '@/lib/bus-ops/state-machines';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const schedule = await prisma.tripSchedule.findFirst({ where: { id: params.id, tenantId } });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    try {
      assertTripTransition((schedule.status ?? 'SCHEDULED') as TripScheduleStatus, 'CANCELLED');
    } catch (e) {
      if (e instanceof TripTransitionError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
    const updated = await prisma.tripSchedule.update({
      where: { id: params.id },
      data: {
        status: 'CANCELLED',
        notes: body.reason ? `CANCELLED: ${body.reason}` : schedule.notes,
        updatedAt: new Date(),
      },
    });

    // Publish to outbox — downstream consumers (notifications, reporting) pick
    // this up asynchronously. Best-effort: never fails the HTTP response.
    getEventBus().publish({
      eventType:     TRIP_CANCELLED,
      aggregateType: 'TripSchedule',
      aggregateId:   schedule.id,
      sourceModule:  'bus-ops',
      tenantId:      schedule.tenantId ?? null,
      payload: {
        scheduleId:  schedule.id,
        tripNumber:  schedule.tripNumber  ?? null,
        vehicleId:   schedule.vehicleId   ?? null,
        driverId:    schedule.driverId    ?? null,
        reason:      body.reason          ?? null,
        cancelledAt: new Date().toISOString(),
      },
    }).catch(err => console.warn('[bus-ops cancel] outbox publish failed:', err));

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
  }
}
