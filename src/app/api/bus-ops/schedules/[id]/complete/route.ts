import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls, runSequential } from '@/lib/rls';
import { prisma }          from '@/lib/prisma';
import { getEventBus }     from '@/events/event-bus';
import { TRIP_COMPLETED }  from '@/events/registry';
import { assertTripTransition, TripTransitionError, type TripScheduleStatus } from '@/lib/bus-ops/state-machines';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  // Tenant-scope the lookup. Without this, any authenticated caller could
  // complete a trip belonging to another tenant by supplying its id — the
  // handler then read schedule.tenantId off whatever row it found and
  // emitted TRIP_COMPLETED against that tenant. The sibling depart and
  // cancel routes already scope this way; complete was the outlier. A
  // cross-tenant id now returns 404 exactly as a non-existent one does,
  // so the response can't be used to probe for ids in other tenants.
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
          // State machine: only STARTED / EN_ROUTE can COMPLETE. Previously
          // allowed SCHEDULED too — that skipped no-show marking and audit
          // trail; blocked now (audit risk closed).
          assertTripTransition((schedule.status ?? 'SCHEDULED') as TripScheduleStatus, 'COMPLETED');
        } catch (e) {
          if (e instanceof TripTransitionError) return NextResponse.json({ error: e.message }, { status: 409 });
          throw e;
        }

        // Find the latest trip log and update it
        const latestLog = await tx.tripLog.findFirst({
          // Schedule already resolved within the tenant above; tenantId here
          // keeps that guarantee local to the statement.
          where: { scheduleId: params.id, tenantId },
          orderBy: { createdAt: 'desc' },
        });

        const ops: any[] = [
          tx.tripSchedule.update({
            where: { id: params.id },
            data: { status: 'COMPLETED', updatedAt: new Date() },
          }),
        ];

        if (latestLog) {
          ops.push(tx.tripLog.update({
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
          ops.push(tx.tripLog.create({
            data: {
              scheduleId: params.id,
              actualArrivalTime: new Date(),
              passengersBoarded: body.passengersBoarded ?? null,
              loggedBy: body.loggedBy ?? null,
            },
          }));
        }

        const results = await runSequential(ops);

        // Propagate end-mileage to the Vehicle so the existing Maintenance
        // alert engine (Maintenance/alert-config + ServiceSchedule) can see
        // accumulating km from staff bus operations. Best-effort — never
        // fails the trip completion.
        if (body.endMileage != null && schedule.vehicleId) {
          const km = Number(body.endMileage);
          if (Number.isFinite(km) && km > 0) {
            try {
              await tx.vehicle.update({
                where: { id: schedule.vehicleId },
                data: { currentMileage: BigInt(Math.round(km)), odometerReading: BigInt(Math.round(km)) },
              });
              } catch (err) {
              console.warn('[bus-ops complete] vehicle mileage propagation failed:', err);
            }
          }
        }

        // ── Finance lineage (best-effort — never fails the trip completion) ───
        // Resolve the final trip log state for the bridge (it may have just been
        // created/updated inside the transaction, so re-read from results).
        const completedLog = results[1] as {
          id: string; scheduleId: string; fuelUsed: number | null;
          passengersBoarded: number | null;
          actualDepartureTime: Date | null; actualArrivalTime: Date | null;
        } | undefined;

        if (completedLog) {
          const tenantId = schedule.tenantId ?? null;
          // Publish via outbox — Finance consumers pick this up asynchronously
          getEventBus().publish({
            eventType:     TRIP_COMPLETED,
            aggregateType: 'TripSchedule',
            aggregateId:   schedule.id,
            sourceModule:  'bus-ops',
            tenantId,
            payload: {
              scheduleId:          schedule.id,
              tripNumber:          schedule.tripNumber ?? null,
              vehicleId:           schedule.vehicleId  ?? null,
              driverId:            schedule.driverId   ?? null,
              tripLogId:           completedLog.id,
              fuelUsed:            completedLog.fuelUsed,
              passengersBoarded:   completedLog.passengersBoarded,
              farePerHead:         Number(body.farePerHead ?? 0),
              actualDepartureTime: completedLog.actualDepartureTime?.toISOString() ?? null,
              actualArrivalTime:   completedLog.actualArrivalTime?.toISOString()   ?? null,
              endMileage:          body.endMileage ?? null,
            },
          }).catch(err => console.warn('[bus-ops complete] outbox publish failed:', err));
        }

        return NextResponse.json({ schedule: results[0] });
      } catch (e) {
        return NextResponse.json({ error: 'Failed to complete' }, { status: 500 });
      }
  });
}

