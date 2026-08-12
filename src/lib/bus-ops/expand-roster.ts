/**
 * expand-roster — materialise a Route's standing passenger roster into
 * per-trip attendance rows.
 *
 * Called on trip creation (POST /api/bus-ops/schedules) and optionally
 * re-run manually via POST /api/bus-ops/schedules/[id]/expand-roster.
 *
 * Idempotent: skips (tripId × staffMemberId) pairs that already exist as
 * TripPassenger rows. Safe to re-run after roster changes to backfill a
 * scheduled trip (e.g. a new hire was added to the roster after the trip
 * was already on the board).
 *
 * Snapshot semantics: employee name / department / stop name are copied
 * onto TripPassenger at expansion time. Later edits to the roster or the
 * StaffMember do NOT retroactively update past trips — that preserves
 * attendance history and audit accuracy. See design note in the phase-2
 * discussion.
 */

import { prisma } from '@/lib/prisma';

export interface ExpandRosterResult {
  scanned: number;   // roster rows matching route+validity+active
  skipped: number;   // already had a TripPassenger row for this trip
  inserted: number;  // rows we just wrote
  errors: number;    // per-row insert failures (best-effort — never throws)
}

/**
 * Expand a route's active roster (valid on `tripDate`) into TripPassenger
 * rows for the given trip. Sets TripSchedule.confirmedCount to the
 * post-expansion attendance count (existing + inserted).
 *
 * @param tenantId - stamped by the caller from x-tenant-id
 * @param tripId   - the newly-created TripSchedule.id
 * @param routeId  - the route the trip runs on
 * @param tripDate - the trip's departure date; used against the roster
 *                   effectiveFrom/effectiveTo window
 */
export async function expandRosterToTrip(
  tenantId: string,
  tripId: string,
  routeId: string,
  tripDate: Date,
): Promise<ExpandRosterResult> {
  const result: ExpandRosterResult = { scanned: 0, skipped: 0, inserted: 0, errors: 0 };

  // Normalise trip date to a plain-date comparison window (roster columns
  // are DATE, not timestamptz — a stray time-of-day would push the trip
  // just past a same-day effectiveTo).
  const day = new Date(tripDate);
  day.setUTCHours(0, 0, 0, 0);

  // Roster rows valid for this trip.
  const roster = await prisma.routePassenger.findMany({
    where: {
      tenantId,
      routeId,
      deletedAt: null,
      status: 'ACTIVE',
      effectiveFrom: { lte: day },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: day } },
      ],
    },
  });
  result.scanned = roster.length;
  if (roster.length === 0) return result;

  // Load reference data in parallel for snapshotting.
  const staffIds = Array.from(new Set(roster.map(r => r.staffMemberId)));
  const stopIds  = Array.from(new Set(
    roster.flatMap(r => [r.pickupStopId, r.dropoffStopId]).filter((x): x is string => !!x),
  ));

  const [staffRows, stopRows, existing] = await Promise.all([
    prisma.staffMember.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, employeeId: true, name: true, department: true },
    }),
    stopIds.length
      ? prisma.routeStop.findMany({
          where: { id: { in: stopIds } },
          select: { id: true, stopName: true },
        })
      : Promise.resolve([] as Array<{ id: string; stopName: string }>),
    // Existing attendance for this trip — idempotency gate.
    prisma.tripPassenger.findMany({
      where: { tripId, deletedAt: null },
      select: { staffMemberId: true },
    }),
  ]);

  const staffById = new Map(staffRows.map(s => [s.id, s]));
  const stopById  = new Map(stopRows.map(s  => [s.id, s]));
  const alreadyThere = new Set(existing.map(e => e.staffMemberId).filter((x): x is string => !!x));

  for (const rp of roster) {
    if (alreadyThere.has(rp.staffMemberId)) {
      result.skipped++;
      continue;
    }
    const emp    = staffById.get(rp.staffMemberId);
    const pickup = rp.pickupStopId  ? stopById.get(rp.pickupStopId)  : null;
    const drop   = rp.dropoffStopId ? stopById.get(rp.dropoffStopId) : null;

    try {
      await prisma.tripPassenger.create({
        data: {
          tenantId,
          tripId,
          staffMemberId:    rp.staffMemberId,
          employeeId:       emp?.employeeId  ?? null,
          employeeName:     emp?.name        ?? null,
          department:       emp?.department  ?? null,
          boardingStopId:   rp.pickupStopId  ?? null,
          boardingStopName: pickup?.stopName ?? null,
          alightingStopId:  rp.dropoffStopId ?? null,
          alightingStopName: drop?.stopName  ?? null,
          status: 'CONFIRMED',
        },
      });
      result.inserted++;
    } catch (err) {
      // Never fail the whole expansion for one bad row — the schedule is
      // already created; a per-row error just means one passenger didn't
      // materialise and can be added manually.
      console.error('[expandRosterToTrip] insert failed', {
        tripId, staffMemberId: rp.staffMemberId, err: err instanceof Error ? err.message : err,
      });
      result.errors++;
    }
  }

  // Refresh confirmedCount to reflect the post-expansion attendance total.
  // Includes both existing and just-inserted rows — never trust our own
  // counter, always re-count the truth.
  const total = await prisma.tripPassenger.count({
    where: { tripId, deletedAt: null },
  });
  await prisma.tripSchedule.update({
    where: { id: tripId },
    data: { confirmedCount: total },
  }).catch(err => console.warn('[expandRosterToTrip] confirmedCount update failed', err));

  return result;
}
