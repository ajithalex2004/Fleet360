/**
 * generate-schedule-template — pure(-ish) helper that materialises
 * TripSchedule instances from a BusOpsScheduleTemplate for a date
 * window. Extracted from POST /api/bus-ops/schedule-templates/[id]/generate
 * so a nightly cron can invoke it for every active template without
 * spinning up an internal HTTP call.
 *
 * Rules (per candidate date in [from, to]):
 *   - Skip if date < effectiveFrom or > effectiveTo
 *   - Skip if template.status !== 'ACTIVE'
 *   - Skip if activeDays doesn't include the day-of-week (0=Sun..6=Sat)
 *     unless a TransportCalendar WORKING_OVERRIDE forces that date
 *   - Skip if date matches per-template exceptionDates OR a
 *     TransportCalendar HOLIDAY entry
 *   - Skip if a TripSchedule already exists for (template_id, date)
 *   - Otherwise create a TripSchedule with the template's defaults
 *     and fire roster expansion
 *
 * Idempotent — safe to re-run for the same window. Returns per-day
 * counters so the caller can log or aggregate.
 */

import { prisma } from '@/lib/prisma';
import { expandRosterToTrip } from './expand-roster';

export interface GenerateStats {
  generated: number;
  skippedAlreadyExisted: number;
  skippedOutOfWindow: number;
  skippedInactiveOrException: number;
  errors: number;
}

export interface GenerateArgs {
  templateId: string;
  tenantId: string;
  from: Date;
  to: Date;
}

export async function generateScheduleTemplate({
  templateId, tenantId, from, to,
}: GenerateArgs): Promise<GenerateStats> {
  const stats: GenerateStats = {
    generated: 0, skippedAlreadyExisted: 0, skippedOutOfWindow: 0,
    skippedInactiveOrException: 0, errors: 0,
  };

  const tpl = await prisma.busOpsScheduleTemplate.findFirst({
    where: { id: templateId, tenantId, deletedAt: null },
  });
  if (!tpl) throw new Error(`Template ${templateId} not found for tenant ${tenantId}`);

  // Normalise date bounds to UTC midnight — day-of-week + comparisons
  // stay stable regardless of server timezone.
  const startUTC = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const endUTC   = new Date(Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate()));
  const daysSpan = Math.floor((endUTC.getTime() - startUTC.getTime()) / 86400000) + 1;

  if (tpl.status !== 'ACTIVE') {
    stats.skippedInactiveOrException = daysSpan;
    return stats;
  }

  const effFromUTC = new Date(Date.UTC(tpl.effectiveFrom.getUTCFullYear(), tpl.effectiveFrom.getUTCMonth(), tpl.effectiveFrom.getUTCDate()));
  const effToUTC   = tpl.effectiveTo
    ? new Date(Date.UTC(tpl.effectiveTo.getUTCFullYear(), tpl.effectiveTo.getUTCMonth(), tpl.effectiveTo.getUTCDate()))
    : null;

  const activeDaysSet = new Set(tpl.activeDays);
  const exceptionSet  = new Set(
    tpl.exceptionDates.map(d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10)),
  );

  // Layer active TransportCalendars — HOLIDAY entries add to skip set,
  // WORKING_OVERRIDE entries force-generate even off day-of-week.
  const holidaySet  = new Set<string>();
  const overrideSet = new Set<string>();
  const calendars = await prisma.transportCalendar.findMany({
    where: {
      tenantId, deletedAt: null, isActive: true,
      effectiveFrom: { lte: endUTC },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: startUTC } }],
    },
    include: { entries: { where: { entryDate: { gte: startUTC, lte: endUTC } } } },
  }).catch(() => [] as Array<{ entries: Array<{ entryDate: Date; kind: string }> }>);
  for (const cal of calendars) {
    for (const e of cal.entries) {
      const iso = new Date(Date.UTC(e.entryDate.getUTCFullYear(), e.entryDate.getUTCMonth(), e.entryDate.getUTCDate())).toISOString().slice(0, 10);
      if (e.kind === 'HOLIDAY')                overrideSet.has(iso) || holidaySet.add(iso);
      else if (e.kind === 'WORKING_OVERRIDE')  overrideSet.add(iso);
    }
  }

  const [hh, mm] = tpl.departureTime.split(':').map(n => parseInt(n, 10));
  const arrivalParts = tpl.arrivalTime ? tpl.arrivalTime.split(':').map(n => parseInt(n, 10)) : null;

  // Preload existing (template_id, date) pairs — idempotency without per-day
  // round-trips.
  const windowStart = new Date(startUTC); windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd   = new Date(endUTC);   windowEnd.setUTCHours(23, 59, 59, 999);
  const existing = await prisma.tripSchedule.findMany({
    where: {
      tenantId, templateId: tpl.id, deletedAt: null,
      departureTime: { gte: windowStart, lte: windowEnd },
    },
    select: { departureTime: true },
  });
  const existingDates = new Set(existing.map(e => e.departureTime.toISOString().slice(0, 10)));

  const cursor = new Date(startUTC);
  while (cursor <= endUTC) {
    const dow = cursor.getUTCDay();
    const isoDay = cursor.toISOString().slice(0, 10);

    const outOfWindow = cursor < effFromUTC || (effToUTC && cursor > effToUTC);
    const dayIsActive  = activeDaysSet.has(dow) || overrideSet.has(isoDay);
    const dayIsSkipped = exceptionSet.has(isoDay) || holidaySet.has(isoDay);

    if (outOfWindow) {
      stats.skippedOutOfWindow++;
    } else if (!dayIsActive || dayIsSkipped) {
      stats.skippedInactiveOrException++;
    } else if (existingDates.has(isoDay)) {
      stats.skippedAlreadyExisted++;
    } else {
      try {
        const departureTs = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hh, mm, 0));
        const arrivalTs = arrivalParts
          ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), arrivalParts[0], arrivalParts[1], 0))
          : null;
        const count = await prisma.tripSchedule.count();
        const tripNumber = `TRP-${String(count + 1).padStart(5, '0')}`;

        const trip = await prisma.tripSchedule.create({
          data: {
            tenantId,
            tripNumber,
            templateId:    tpl.id,
            routeId:       tpl.routeId,
            vehicleId:     tpl.vehicleId,
            driverId:      tpl.driverId,
            departureTime: departureTs,
            arrivalTime:   arrivalTs,
            shiftType:     tpl.session,
            direction:     tpl.direction,
            status:        'SCHEDULED',
          },
        });
        await expandRosterToTrip(tenantId, trip.id, tpl.routeId, departureTs)
          .catch(err => console.warn('[generateScheduleTemplate] roster expansion failed', { tripId: trip.id, err }));
        stats.generated++;
      } catch (err) {
        console.error('[generateScheduleTemplate] insert failed', {
          templateId: tpl.id, date: isoDay,
          err: err instanceof Error ? err.message : err,
        });
        stats.errors++;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return stats;
}
