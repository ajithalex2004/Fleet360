/**
 * POST /api/bus-ops/schedule-templates/[id]/generate
 *
 * Materialise TripSchedule instances from a template for a date window.
 * Body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *
 * Rules (per candidate date in [from, to]):
 *   - Skip if date < effectiveFrom or > effectiveTo
 *   - Skip if template.status !== 'ACTIVE'
 *   - Skip if activeDays doesn't include the day-of-week (0=Sun..6=Sat)
 *   - Skip if date matches any exceptionDates entry
 *   - Skip if a TripSchedule already exists for (template_id, date) — idempotent
 *   - Otherwise create a TripSchedule with the template's vehicle/driver/route
 *     defaults and a computed departureTime (date + template.departureTime)
 *
 * Idempotency: safe to re-run for the same window. Passenger roster
 * expansion is handled by the existing hook in POST /api/bus-ops/schedules
 * — but we bypass that endpoint here (we create rows directly), so we call
 * the same expandRosterToTrip helper per generated instance to keep
 * behaviour consistent.
 *
 * Response: { generated, skippedAlreadyExisted, skippedOutOfWindow, skippedInactiveOrException, errors }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expandRosterToTrip } from '@/lib/bus-ops/expand-roster';

interface GenBody { from?: string; to?: string }

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;

  const tpl = await prisma.busOpsScheduleTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  let body: GenBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body.from || !body.to) return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });

  const from = new Date(body.from);
  const to   = new Date(body.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ error: 'from/to must be valid dates and to must be >= from' }, { status: 400 });
  }
  // Cap the window to prevent accidental N-year generations that create
  // thousands of trips in a single call.
  const daysSpan = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  if (daysSpan > 366) {
    return NextResponse.json({ error: 'Generation window cannot exceed 366 days' }, { status: 400 });
  }

  // Normalise all bounds to UTC midnight so day-of-week and comparisons are
  // stable regardless of the server's local timezone.
  const startUTC = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const endUTC   = new Date(Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate()));
  const effFromUTC = new Date(Date.UTC(tpl.effectiveFrom.getUTCFullYear(), tpl.effectiveFrom.getUTCMonth(), tpl.effectiveFrom.getUTCDate()));
  const effToUTC   = tpl.effectiveTo
    ? new Date(Date.UTC(tpl.effectiveTo.getUTCFullYear(), tpl.effectiveTo.getUTCMonth(), tpl.effectiveTo.getUTCDate()))
    : null;

  const activeDaysSet = new Set(tpl.activeDays);
  const exceptionSet  = new Set(
    tpl.exceptionDates.map(d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10)),
  );

  // Tenant-active TransportCalendar layered on top of per-template
  // exception dates. HOLIDAY entries add to the skip set; WORKING_OVERRIDE
  // entries force-generate even if the day-of-week isn't in activeDays.
  // If multiple active calendars exist (shouldn't in MVP), later ones
  // override earlier ones for the same date.
  const holidaySet  = new Set<string>();
  const overrideSet = new Set<string>();
  const calendars = await prisma.transportCalendar.findMany({
    where: {
      tenantId, deletedAt: null, isActive: true,
      effectiveFrom: { lte: endUTC },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: startUTC } }],
    },
    include: {
      entries: { where: { entryDate: { gte: startUTC, lte: endUTC } } },
    },
  }).catch(() => [] as Array<{ entries: Array<{ entryDate: Date; kind: string }> }>);
  for (const cal of calendars) {
    for (const e of cal.entries) {
      const iso = new Date(Date.UTC(e.entryDate.getUTCFullYear(), e.entryDate.getUTCMonth(), e.entryDate.getUTCDate())).toISOString().slice(0, 10);
      if (e.kind === 'HOLIDAY')           holidaySet.add(iso);
      else if (e.kind === 'WORKING_OVERRIDE') overrideSet.add(iso);
    }
  }

  // Parse the template's HH:MM time-of-day so we can slap it onto each candidate day.
  const [hh, mm] = tpl.departureTime.split(':').map(n => parseInt(n, 10));
  // Arrival time (also HH:MM) — kept as null if absent; timestamp version
  // materialised only when present so the trip's arrivalTime column stays
  // faithful to the template's intent.
  const arrivalParts = tpl.arrivalTime ? tpl.arrivalTime.split(':').map(n => parseInt(n, 10)) : null;

  const stats = {
    generated: 0,
    skippedAlreadyExisted: 0,
    skippedOutOfWindow: 0,
    skippedInactiveOrException: 0,
    errors: 0,
  };

  if (tpl.status !== 'ACTIVE') {
    stats.skippedInactiveOrException = daysSpan;
    return NextResponse.json({ ok: true, ...stats });
  }

  // Preload the existing (template_id, date) pairs in the window so we can
  // check idempotency without per-day round-trips. departureTime is a
  // timestamp — narrow the window with a bounded range.
  const windowStart = new Date(startUTC); windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd   = new Date(endUTC);   windowEnd.setUTCHours(23, 59, 59, 999);
  const existing = await prisma.tripSchedule.findMany({
    where: {
      tenantId,
      templateId: tpl.id,
      deletedAt: null,
      departureTime: { gte: windowStart, lte: windowEnd },
    },
    select: { departureTime: true },
  });
  const existingDates = new Set(
    existing.map(e => e.departureTime.toISOString().slice(0, 10)),
  );

  // Iterate day-by-day.
  const cursor = new Date(startUTC);
  while (cursor <= endUTC) {
    const dow = cursor.getUTCDay(); // 0..6
    const isoDay = cursor.toISOString().slice(0, 10);

    const outOfWindow = cursor < effFromUTC || (effToUTC && cursor > effToUTC);
    // WORKING_OVERRIDE beats the activeDays filter (weekend work day).
    // HOLIDAY beats everything short of override (per-template exception
    // still takes precedence — operator's explicit intent wins).
    const dayIsActive = activeDaysSet.has(dow) || overrideSet.has(isoDay);
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
        // trip_number generation is best-effort unique — matches the pattern
        // used in POST /api/bus-ops/schedules (count-based, works for demo /
        // low-volume tenants; upgrade to a sequence if you go multi-thousand).
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
            shiftType:     tpl.session,       // MORNING|EVENING|NIGHT|SPLIT
            direction:     tpl.direction,     // PICKUP|DROPOFF
            status:        'SCHEDULED',
          },
        });
        // Fire the roster expansion. Same helper the standalone POST uses so
        // behaviour stays consistent regardless of who created the trip.
        await expandRosterToTrip(tenantId, trip.id, tpl.routeId, departureTs)
          .catch(err => console.warn('[generate] roster expansion failed', { tripId: trip.id, err }));
        stats.generated++;
      } catch (err) {
        console.error('[generate] insert failed', { date: isoDay, err: err instanceof Error ? err.message : err });
        stats.errors++;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return NextResponse.json({ ok: true, ...stats });
}
