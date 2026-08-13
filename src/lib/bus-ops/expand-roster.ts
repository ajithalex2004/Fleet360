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

  // Route versioning Phase 2 — if the trip has a snapshotted variant
  // version, load that version's stops in advance so a roster row that
  // references a stop from an OLDER version can still be resolved (by
  // name) to the corresponding stop in the trip's version. Without this
  // a passenger registered when v1 was live would end up on a v2 trip
  // pointing at a v1 stopId that's not part of what the bus actually
  // runs today.
  const trip = await prisma.tripSchedule.findFirst({
    where: { id: tripId },
    select: { routeVariantVersionId: true },
  });
  const versionStops = trip?.routeVariantVersionId
    ? await prisma.routeStop.findMany({
        where: { variantVersionId: trip.routeVariantVersionId },
        select: { id: true, stopName: true },
      })
    : [];
  const versionStopById   = new Map(versionStops.map(s => [s.id, s]));
  const versionStopByName = new Map(versionStops.map(s => [s.stopName.toLowerCase(), s]));

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

  /**
   * Resolve a roster's stopId → the stop the trip *actually* runs.
   * Priority:
   *   1. Match id within the version's stops (roster already references a
   *      stop from the current version — most common case).
   *   2. Match by name within the version's stops (roster references an
   *      older-version stop; find the same-named stop on the trip).
   *   3. Fall back to the unfiltered lookup (versionless trip, or the
   *      roster's stop was never re-emitted in the trip's version).
   * Returns { id, name } — both are snapshotted onto TripPassenger.
   */
  const resolveStop = (stopId: string | null): { id: string | null; name: string | null } => {
    if (!stopId) return { id: null, name: null };
    // 1. version id match
    const inVersion = versionStopById.get(stopId);
    if (inVersion) return { id: inVersion.id, name: inVersion.stopName };
    // 2. name match within version (only if we have a version at all)
    if (versionStops.length > 0) {
      const legacyStop = stopById.get(stopId);
      if (legacyStop) {
        const match = versionStopByName.get(legacyStop.stopName.toLowerCase());
        if (match) return { id: match.id, name: match.stopName };
        // Log — the passenger's stop isn't in the trip's version. Not
        // fatal; snapshot the legacy name so ops can see and reconcile.
        console.warn(`[expandRosterToTrip] roster stop "${legacyStop.stopName}" not present in trip version ${trip?.routeVariantVersionId}`);
      }
    }
    // 3. legacy fallback (versionless or unmatched)
    const legacyStop = stopById.get(stopId);
    return { id: stopId, name: legacyStop?.stopName ?? null };
  };

  for (const rp of roster) {
    if (alreadyThere.has(rp.staffMemberId)) {
      result.skipped++;
      continue;
    }
    const emp    = staffById.get(rp.staffMemberId);
    const pickup = resolveStop(rp.pickupStopId  ?? null);
    const drop   = resolveStop(rp.dropoffStopId ?? null);

    try {
      await prisma.tripPassenger.create({
        data: {
          tenantId,
          tripId,
          staffMemberId:    rp.staffMemberId,
          employeeId:       emp?.employeeId  ?? null,
          employeeName:     emp?.name        ?? null,
          department:       emp?.department  ?? null,
          boardingStopId:   pickup.id,
          boardingStopName: pickup.name,
          alightingStopId:  drop.id,
          alightingStopName: drop.name,
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
