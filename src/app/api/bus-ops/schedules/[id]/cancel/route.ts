import { writeRequiredAudit } from '@/lib/audit';
import { requireBusOpsRequest } from '@/lib/bus-ops/access';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma }          from '@/lib/prisma';
import { getEventBus }     from '@/events/event-bus';
import { TRIP_CANCELLED }  from '@/events/registry';
import { assertTripTransition, normalizeTripStatus, TripTransitionError } from '@/lib/bus-ops/state-machines';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        await tx.$queryRawUnsafe(`SELECT id FROM trip_schedules WHERE id::text = $1 AND tenant_id = $2 FOR UPDATE`, params.id, tenantId);
        const schedule = await tx.tripSchedule.findFirst({ where: { id: params.id, tenantId, deletedAt: null } });
        if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if (schedule.status === 'CANCELLED') return NextResponse.json({ error: 'Trip already cancelled' }, { status: 409 });
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
        // this up asynchronously after the command and outbox commit together.
        await getEventBus().publish({
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
        }, tx);

        await writeRequiredAudit({ tenantId, userId: authz.userId ?? undefined, entityType: 'TripSchedule', entityId: params.id, action: 'CANCEL', details: 'Trip cancel command committed' }, tx);
        return NextResponse.json(updated);
    });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
  }
}

