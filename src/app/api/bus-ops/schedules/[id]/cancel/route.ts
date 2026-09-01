export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma }          from '@/lib/prisma';
import { getEventBus }     from '@/events/event-bus';
import { TRIP_CANCELLED }  from '@/events/registry';
import { assertTripTransition, normalizeTripStatus, TripTransitionError } from '@/lib/bus-ops/state-machines';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const schedule = await tx.tripSchedule.findFirst({ where: { id: params.id, tenantId } });
        if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        try {
          assertTripTransition(normalizeTripStatus(schedule.status), 'CANCELLED');
        } catch (e) {
          if (e instanceof TripTransitionError) return NextResponse.json({ error: e.message }, { status: 409 });
          throw e;
        }
        const updated = await tx.tripSchedule.update({
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
      } catch (e) {
        return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
      }
  });
}

