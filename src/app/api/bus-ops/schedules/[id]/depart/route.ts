export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusOpsRequest } from '@/lib/bus-ops/access';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { hasUnrecoveredDisruption } from '@/lib/bus-ops/disruptions';
import { inspectionAllowsDeparture } from '@/lib/bus-ops/safety';
import { getEventBus } from '@/events/event-bus';
import { TRIP_DEPARTED } from '@/events/registry';
import { writeRequiredAudit } from '@/lib/audit';
import { revalidateCache } from '@/lib/server-cache';
import { raiseAlert } from '@/lib/alerts/raise';
const LATE_DEPARTURE_TOLERANCE_MIN = 5;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const refusal = await requireBusOpsRequest(req);
  if (refusal) return refusal;
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // No implicit emergency bypass. A future approved override must be a separate audited command.
  if (req.headers.get('x-skip-pretrip-check') === '1') return NextResponse.json({ error: 'Safety override is not permitted' }, { status: 403 });
  const bodyRaw = await req.json().catch(() => null);
  const parsed = z.object({ startMileage: z.number().nonnegative().optional(), notes: z.string().max(10000).optional() }).strict().safeParse(bodyRaw && typeof bodyRaw === 'object' && !Array.isArray(bodyRaw) ? stripTenantOwnershipFields(bodyRaw) : bodyRaw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid departure request' }, { status: 400 });
  const { id } = await props.params;
  const afterCommit: { run?: () => Promise<void> } = {};
  try {
    const response = await withTenantRls(prisma, auth.tenantId, async tx => {
      await tx.$queryRawUnsafe(`SELECT id FROM trip_schedules WHERE id::text = $1 AND tenant_id::text = $2 FOR UPDATE`, id, auth.tenantId);
      const schedule = await tx.tripSchedule.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (schedule.status !== 'SCHEDULED') return NextResponse.json({ error: 'Trip is not scheduled' }, { status: 409 });
      if (await hasUnrecoveredDisruption(tx, auth.tenantId, id)) return NextResponse.json({error:'Resolve the reported disruption with an inspected substitute before departure'},{status:409});
      const skew = Date.now() - schedule.departureTime.getTime();
      if (skew > 24 * 60 * 60_000 || skew < -2 * 60 * 60_000) return NextResponse.json({ error: 'Trip is outside the departure window' }, { status: 409 });
      const latest = await tx.busPreTripCheck.findFirst({ where: { tenantId: auth.tenantId, scheduleId: id, deletedAt: null }, orderBy: [{ performedAt: 'desc' }, { id: 'desc' }] });
      if (!inspectionAllowsDeparture(latest, schedule)) return NextResponse.json({ error: 'A complete, current, passing inspection for this vehicle and driver is required' }, { status: 412 });
      const now = new Date();
      const updated = await tx.tripSchedule.update({ where: { id }, data: { status: 'STARTED', updatedAt: now } });
      const log = await tx.tripLog.create({ data: { tenantId: auth.tenantId, scheduleId: id, actualDepartureTime: now, startMileage: parsed.data.startMileage ?? null, notes: parsed.data.notes ?? null, loggedBy: auth.userId } });
      // Riders assigned to a later boarding stop must remain CONFIRMED until
      // that stop is passed. Only unassigned-stop riders are due at departure.
      const noShows = await tx.tripPassenger.updateMany({ where: { tenantId: auth.tenantId, tripId: id, status: 'CONFIRMED', deletedAt: null, boardingStopId: null }, data: { status: 'NO_SHOW', updatedAt: now } });
      await getEventBus().publish({ eventType: TRIP_DEPARTED, aggregateType: 'TripSchedule', aggregateId: id, sourceModule: 'bus-ops', tenantId: auth.tenantId, actor: auth.userId,
        payload: { scheduleId: id, tripNumber: schedule.tripNumber, vehicleId: schedule.vehicleId, driverId: schedule.driverId, tripLogId: log.id, actualDepartureTime: now.toISOString(), startMileage: parsed.data.startMileage ?? null, noShowsMarked: noShows.count } }, tx);
      await writeRequiredAudit({ tenantId: auth.tenantId, userId: auth.userId ?? undefined, entityType: 'TripSchedule', entityId: id, action: 'DEPART', details: `Inspection ${latest!.id}; ${noShows.count} no-shows` }, tx);
      afterCommit.run = async () => {
        if (schedule.tenantId) {
          // PASSENGER_ABSENT — one alert per trip summarising how many
          // CONFIRMED passengers rolled over to NO_SHOW. The Alert Engine
          // dedups on scheduleId so a re-depart (unusual but possible)
          // doesn't spam.
          if (noShows.count > 0) {
            await raiseAlert({
              tenantId:     schedule.tenantId,
              code:         'PASSENGER_ABSENT',
              sourceModule: 'bus-ops',
              subjectType:  'TripSchedule',
              subjectId:    schedule.id,
              title:        `Trip ${schedule.tripNumber ?? schedule.id.slice(0, 8)} · ${noShows.count} no-show${noShows.count === 1 ? '' : 's'}`,
              description:  `${noShows.count} passenger${noShows.count === 1 ? '' : 's'} did not board and were auto-marked NO_SHOW at departure.`,
              context: {
                scheduleId:    schedule.id,
                tripNumber:    schedule.tripNumber,
                noShowsMarked: noShows.count,
              },
            });
          }

          // LATE_DEPARTURE — actual > scheduled + tolerance.
          const actualDeparture = log.actualDepartureTime ?? new Date();
          const delayMin = Math.round((actualDeparture.getTime() - schedule.departureTime.getTime()) / 60_000);
          if (delayMin > LATE_DEPARTURE_TOLERANCE_MIN) {
            await raiseAlert({
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

      };
      return NextResponse.json({ ...updated, noShowsMarked: noShows.count });
    });
    if (response.ok) await revalidateCache(['bus-ops:schedules']).catch(() => console.warn('[bus-ops depart] cache invalidation failed'));
    if (response.ok && afterCommit.run) await afterCommit.run().catch(() => console.warn('[bus-ops depart] alert delivery failed'));
    return response;
  } catch (error) {
    console.error('[bus-ops depart] transaction failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'Failed to depart' }, { status: 500 });
  }
}
