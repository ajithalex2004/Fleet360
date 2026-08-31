export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls, runSequential } from '@/lib/rls';
import { prisma }         from '@/lib/prisma';
import { getEventBus }    from '@/events/event-bus';
import { TRIP_DEPARTED }  from '@/events/registry';
import { assertTripTransition, TripTransitionError, type TripScheduleStatus } from '@/lib/bus-ops/state-machines';
import { raiseAlert }     from '@/lib/alerts/raise';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * How many minutes late is "late" — a soft tolerance so a 30-second slip
 * from the scheduled departure doesn't page ops. Configurable per tenant
 * via AlertRule.escalation_levels later (Phase 2b).
 */
const LATE_DEPARTURE_TOLERANCE_MIN = 5;

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
          assertTripTransition((schedule.status ?? 'SCHEDULED') as TripScheduleStatus, 'STARTED');
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
          const passingCheck = await tx.busPreTripCheck.findFirst({
            where: {
              // Schedule already resolved within the tenant above.
              tenantId,
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
        // `as const` so TypeScript infers a tuple rather than an array of the
        // union of the three result types — without it, destructuring gives
        // every binding `TripSchedule | TripLog | BatchPayload` and each
        // property access below fails.
        const [updated, tripLog, noShowResult] = await runSequential([
          tx.tripSchedule.update({
            where: { id: params.id },
            data: { status: 'STARTED', updatedAt: new Date() },
          }),
          tx.tripLog.create({
            data: {
              tenantId,
              scheduleId: params.id,
              actualDepartureTime: body.departureTime ? new Date(body.departureTime) : new Date(),
              startMileage: body.startMileage ?? null,
              loggedBy: body.loggedBy ?? null,
              notes: body.notes ?? null,
            },
          }),
          tx.tripPassenger.updateMany({
            where: { tripId: params.id, tenantId, status: 'CONFIRMED', deletedAt: null },
            data: { status: 'NO_SHOW', updatedAt: new Date() },
          }),
        ] as const);

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

        // Alert Engine Phase 2 — two conditions detectable at depart time.
        // Both raiseAlert calls are best-effort by default and don't block
        // the HTTP response.
        if (schedule.tenantId) {
          // PASSENGER_ABSENT — one alert per trip summarising how many
          // CONFIRMED passengers rolled over to NO_SHOW. The Alert Engine
          // dedups on scheduleId so a re-depart (unusual but possible)
          // doesn't spam.
          if (noShowResult.count > 0) {
            void raiseAlert({
              tenantId:     schedule.tenantId,
              code:         'PASSENGER_ABSENT',
              sourceModule: 'bus-ops',
              subjectType:  'TripSchedule',
              subjectId:    schedule.id,
              title:        `Trip ${schedule.tripNumber ?? schedule.id.slice(0, 8)} · ${noShowResult.count} no-show${noShowResult.count === 1 ? '' : 's'}`,
              description:  `${noShowResult.count} passenger${noShowResult.count === 1 ? '' : 's'} did not board and were auto-marked NO_SHOW at departure.`,
              context: {
                scheduleId:    schedule.id,
                tripNumber:    schedule.tripNumber,
                noShowsMarked: noShowResult.count,
              },
            });
          }

          // LATE_DEPARTURE — actual > scheduled + tolerance.
          const actualDeparture = tripLog.actualDepartureTime ?? new Date();
          const delayMin = Math.round((actualDeparture.getTime() - schedule.departureTime.getTime()) / 60_000);
          if (delayMin > LATE_DEPARTURE_TOLERANCE_MIN) {
            void raiseAlert({
              tenantId:     schedule.tenantId,
              code:         'LATE_DEPARTURE',
              sourceModule: 'bus-ops',
              subjectType:  'TripSchedule',
              subjectId:    schedule.id,
              title:        `Trip ${schedule.tripNumber ?? schedule.id.slice(0, 8)} · departed ${delayMin} min late`,
              description:  `Scheduled ${schedule.departureTime.toISOString()}, departed ${actualDeparture.toISOString()}.`,
              severity:     delayMin > 30 ? 'HIGH' : 'MEDIUM',
              context: {
                scheduleId:    schedule.id,
                tripNumber:    schedule.tripNumber,
                vehicleId:     schedule.vehicleId,
                driverId:      schedule.driverId,
                scheduledAt:   schedule.departureTime.toISOString(),
                actualAt:      actualDeparture.toISOString(),
                delayMinutes:  delayMin,
              },
            });
          }
        }

        return NextResponse.json({ ...updated, noShowsMarked: noShowResult.count });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to depart' }, { status: 500 });
      }
  });
}

