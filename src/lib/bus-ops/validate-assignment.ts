/**
 * validate-assignment.ts — Resource Validation Engine (Phase 1)
 *
 * Runs a battery of checks against a *proposed* vehicle+driver+time
 * assignment for a bus-ops trip schedule and returns a structured
 * verdict. Callers use the verdict to decide whether to write (PASS/
 * WARN) or refuse (BLOCK).
 *
 * ── Design invariants ────────────────────────────────────────────────
 *
 * 1. READ-ONLY.
 *    The engine performs no writes. Callers wrap validate + write in
 *    a transaction (see `withAssignmentLocks()` in ./assignment-txn.ts)
 *    to close the check-then-write race.
 *
 * 2. TENANT-SCOPED.
 *    Every DB query filters by tenantId. A vehicle or driver that
 *    exists but belongs to another tenant is treated identically to
 *    "not found" — never leaks existence across tenant boundaries.
 *
 * 3. RUNS EVERY CHECK.
 *    Never first-fail short-circuits. The UI needs the whole list so
 *    the operator can fix all issues at once. The one exception:
 *    when the vehicle or driver row itself isn't found, the
 *    remaining V*/D* checks for that entity are skipped because they
 *    can't run without the row (marked SKIPPED with a reason).
 *
 * 4. DETERMINISTIC RULE EVALUATION.
 *    Fact-fetching is async and parallel; rule evaluation is a pure
 *    function over the fetched facts. Straightforward to unit-test
 *    against canned facts.
 *
 * 5. PHASE 1 ONLY.
 *    - Registration / insurance / mulkiya expiry           → Phase 2
 *    - Driver license validity / category                  → Phase 2
 *    - Driver leave calendar                               → Phase 2
 *    - HOS / rest-break rules                              → Phase 2
 *    - Per-tenant policy (BLOCK/WARN/OFF per check)        → Phase 3
 *    - Deterministic vehicle-type match (V5 in review)     → deferred
 *      to Phase 2 once BusRoute.requiredVehicleGroup exists.
 *
 * ── Check catalog (Phase 1 — 9 checks) ───────────────────────────────
 *
 *   V0 VEHICLE_NOT_FOUND              BLOCK
 *   V1 VEHICLE_INACTIVE               BLOCK  (permanent: INACTIVE|SOLD|RETIRED|isActive=false)
 *   V2 VEHICLE_UNAVAILABLE            BLOCK  (temporary: MAINTENANCE|BREAKDOWN|OUT_OF_SERVICE|RESERVED|RENTED|ALLOCATED|IMPOUNDED)
 *   V3 VEHICLE_ALREADY_ASSIGNED       BLOCK  (overlap with another active trip)
 *   V4 VEHICLE_CAPACITY_EXCEEDED      WARN   (roster > seats)
 *   V6 VEHICLE_GPS_STALE              WARN   (only when departureTime is within GPS_HORIZON_MIN of now)
 *
 *   D0 DRIVER_NOT_FOUND               BLOCK
 *   D1 DRIVER_INACTIVE                BLOCK  (Driver.status not ACTIVE)
 *   D2 DRIVER_ALREADY_ASSIGNED        BLOCK  (overlap with another active trip)
 *   D3 DRIVER_NO_SHIFT                WARN   (no scheduled/active shift for the tenant-local date)
 *
 * ── Concurrency ──────────────────────────────────────────────────────
 *
 * Validation alone cannot guarantee assignment integrity. Two
 * dispatchers assigning the same vehicle simultaneously will both
 * pass V3/D2 unless the write is serialized. Callers MUST wrap
 *
 *     validateResourceAssignment(input, tx) → verdict
 *     if verdict !== BLOCK: prisma.tripSchedule.create({...})
 *
 * inside `withAssignmentLocks()` from ./assignment-txn.ts, which
 * acquires advisory locks per (tenantId, vehicleId) and per
 * (tenantId, driverId) for the duration of the transaction. Any
 * second writer competing for the same vehicle waits, then sees the
 * committed schedule in its overlap check.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

// ── Types ────────────────────────────────────────────────────────────

export type CheckSeverity = 'BLOCK' | 'WARN' | 'PASS' | 'SKIPPED';
export type CheckSubject  = 'vehicle' | 'driver' | 'assignment';

/**
 * Stable machine codes. Additions are cheap; renames break UIs.
 * Keep in sync with the file header check catalog.
 */
export type AssignmentCheckCode =
  | 'VEHICLE_NOT_FOUND'
  | 'VEHICLE_INACTIVE'
  | 'VEHICLE_UNAVAILABLE'
  | 'VEHICLE_ALREADY_ASSIGNED'
  | 'VEHICLE_CAPACITY_EXCEEDED'
  | 'VEHICLE_GPS_STALE'
  | 'DRIVER_NOT_FOUND'
  | 'DRIVER_INACTIVE'
  | 'DRIVER_ALREADY_ASSIGNED'
  | 'DRIVER_NO_SHIFT';

export interface AssignmentCheck {
  code:     AssignmentCheckCode;
  severity: CheckSeverity;
  subject:  CheckSubject;
  title:    string;
  detail?:  string;
  /**
   * Structured payload for the UI to render — ids of conflicting
   * trips, actual vs required counts, last-seen timestamps, etc.
   * Callers must not depend on specific keys; consult per-code.
   */
  context?: Record<string, unknown>;
}

export interface AssignmentValidationResult {
  verdict:  'PASS' | 'WARN' | 'BLOCK';
  checks:   AssignmentCheck[];
}

export interface ValidateAssignmentInput {
  tenantId:      string;
  /** Present on PATCH — excluded from overlap queries so the schedule
   *  doesn't detect itself as a conflict. */
  scheduleId?:   string;
  vehicleId:     string | null;
  driverId:      string | null;
  departureTime: Date;
  arrivalTime:   Date | null;
  routeId:       string | null;
  /**
   * Optional passenger count override. Callers may pass a canonical
   * value (e.g. body.confirmedCount on PATCH, or an estimated roster
   * size on POST via {@link estimateRosterCountForTrip}). When absent,
   * the engine counts TripPassenger rows already attached to the
   * schedule — meaningful only for updates.
   */
  confirmedCount?: number;
  /**
   * IANA timezone used for D3 (per-tenant-local shift date). Defaults
   * to Asia/Dubai — Fleet360's primary operational zone. Same choice
   * as the R3 headway service default.
   */
  timezone?: string;
}

// ── Constants ────────────────────────────────────────────────────────

/** Statuses that mean the vehicle is permanently unavailable. */
const VEHICLE_INACTIVE_STATUSES = new Set(['INACTIVE', 'SOLD', 'RETIRED']);

/** Statuses that mean the vehicle is temporarily reserved / out of service. */
const VEHICLE_UNAVAILABLE_STATUSES = new Set([
  'MAINTENANCE',
  'BREAKDOWN',
  'OUT_OF_SERVICE',
  'IMPOUNDED',
  'RESERVED',
  'RENTED',
  'ALLOCATED',
]);

/** TripSchedule statuses that count as "still holds the resource". */
const ACTIVE_SCHEDULE_STATUSES = ['SCHEDULED', 'DEPARTED', 'IN_TRANSIT'] as const;

/** V6 GPS_STALE only fires when departure is within this many minutes of now.
 *  Long-lead scheduling ("next week's trip") shouldn't warn on today's
 *  offline gap. */
const GPS_OPERATIONAL_HORIZON_MIN = 120;

/** V6 threshold — a vehicle whose latest ping is older than this is "stale". */
const GPS_STALE_THRESHOLD_MIN = 30;

/** Default fallback for effective end when arrivalTime is null and no route. */
const DEFAULT_TRIP_DURATION_MIN = 12 * 60;

/** Default IANA timezone (matches R3 headway service default). */
const DEFAULT_TZ = 'Asia/Dubai';

// ── Public API ───────────────────────────────────────────────────────

export async function validateResourceAssignment(
  input: ValidateAssignmentInput,
  prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<AssignmentValidationResult> {
  if (!input.tenantId) {
    throw new Error('validateResourceAssignment: tenantId is required');
  }
  const facts = await fetchFacts(input, prisma);
  const checks = evaluateChecks(input, facts);
  const verdict = aggregateVerdict(checks);
  return { verdict, checks };
}

// ── Fact fetching (async, all parallel, tenant-scoped) ───────────────

interface Facts {
  vehicle:          { id: string; isActive: boolean | null; status: string | null; seatingCapacity: number | null; vehicleGroup: string | null } | null;
  driver:           { id: string; status: string | null } | null;
  overlappingTrips: Array<{ id: string; vehicleId: string | null; driverId: string | null; tripNumber: string | null; departureTime: Date; arrivalTime: Date | null; status: string | null }>;
  latestGpsPingAt:  Date | null;
  hasShiftForDate:  boolean;
  route:            { id: string; estimatedDurationMins: number | null } | null;
  scheduleRoster:   number | null;   // TripPassenger count for the schedule being edited (PATCH); null on POST
}

async function fetchFacts(
  input: ValidateAssignmentInput,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<Facts> {
  const proposedEnd = effectiveEndTime(input.departureTime, input.arrivalTime, null);

  const [vehicle, driver, overlapping, latestPing, shift, route, scheduleRoster] = await Promise.all([
    input.vehicleId
      ? prisma.vehicle.findFirst({
          where:  { id: input.vehicleId, tenantId: input.tenantId },
          select: { id: true, isActive: true, status: true, seatingCapacity: true, vehicleGroup: true },
        })
      : Promise.resolve(null),

    input.driverId
      ? prisma.driver.findFirst({
          where:  { id: input.driverId, tenantId: input.tenantId },
          select: { id: true, status: true },
        })
      : Promise.resolve(null),

    fetchOverlappingSchedules(input, proposedEnd, prisma),

    input.vehicleId
      ? fetchLatestGpsPingAt(input.tenantId, input.vehicleId, prisma)
      : Promise.resolve(null),

    input.driverId
      ? fetchHasShiftForDate(input.tenantId, input.driverId, input.departureTime, input.timezone ?? DEFAULT_TZ, prisma)
      : Promise.resolve(false),

    input.routeId
      ? prisma.busRoute.findFirst({
          where:  { id: input.routeId, tenantId: input.tenantId },
          select: { id: true, estimatedDurationMins: true },
        })
      : Promise.resolve(null),

    input.scheduleId
      ? prisma.tripPassenger.count({
          where: { tripId: input.scheduleId, deletedAt: null },
        })
      : Promise.resolve(null),
  ]);

  return {
    vehicle,
    driver,
    overlappingTrips: overlapping,
    latestGpsPingAt:  latestPing,
    hasShiftForDate:  shift,
    route,
    scheduleRoster,
  };
}

/**
 * Overlap query. Half-open intervals — trips touching at endpoints
 * (A ends 09:00, B starts 09:00) don't conflict. Fallback for null
 * arrivalTime uses route.estimatedDurationMins first, then 12h.
 *
 * Uses raw SQL because the overlap predicate is easier to express
 * than through Prisma's filter DSL and this is a hot check-path.
 */
async function fetchOverlappingSchedules(
  input:       ValidateAssignmentInput,
  proposedEnd: Date,
  prisma:      PrismaClient | Prisma.TransactionClient,
): Promise<Facts['overlappingTrips']> {
  if (!input.vehicleId && !input.driverId) return [];

  // Prisma's typed API expresses this well enough — no raw SQL needed.
  const rows = await prisma.tripSchedule.findMany({
    where: {
      tenantId:  input.tenantId,
      deletedAt: null,
      status:    { in: [...ACTIVE_SCHEDULE_STATUSES] },
      // Exclude self on PATCH
      ...(input.scheduleId ? { id: { not: input.scheduleId } } : {}),
      OR: [
        input.vehicleId ? { vehicleId: input.vehicleId } : { id: '__never__' },
        input.driverId  ? { driverId:  input.driverId  } : { id: '__never__' },
      ],
      // Existing.departureTime < proposedEnd — the "before end" side.
      // We can filter this in SQL; the "after start" side (with the
      // per-row effective-end fallback) is applied in memory below
      // because it depends on the row's route.estimatedDurationMins.
      departureTime: { lt: proposedEnd },
    },
    include: {
      route: { select: { estimatedDurationMins: true } },
    },
    orderBy: { departureTime: 'asc' },
    take: 50,
  });

  return rows
    .filter(r => {
      const existingEnd = effectiveEndTime(
        r.departureTime,
        r.arrivalTime,
        r.route?.estimatedDurationMins ?? null,
      );
      // Half-open: `existingEnd > input.departureTime` means they overlap.
      return existingEnd.getTime() > input.departureTime.getTime();
    })
    .map(r => ({
      id:            r.id,
      vehicleId:     r.vehicleId,
      driverId:      r.driverId,
      tripNumber:    r.tripNumber,
      departureTime: r.departureTime,
      arrivalTime:   r.arrivalTime,
      status:        r.status,
    }));
}

async function fetchLatestGpsPingAt(
  tenantId:  string,
  vehicleId: string,
  prisma:    PrismaClient | Prisma.TransactionClient,
): Promise<Date | null> {
  const row = await prisma.busGpsPing.findFirst({
    where:   { tenantId, vehicleId },
    select:  { occurredAt: true },
    orderBy: { occurredAt: 'desc' },
  });
  return row?.occurredAt ?? null;
}

async function fetchHasShiftForDate(
  tenantId:  string,
  driverId:  string,
  departure: Date,
  tz:        string,
  prisma:    PrismaClient | Prisma.TransactionClient,
): Promise<boolean> {
  const localDate = toTenantLocalDateBoundary(departure, tz);
  const nextDay   = new Date(localDate.getTime() + 24 * 60 * 60 * 1000);
  const count = await prisma.driverShift.count({
    where: {
      driverId,
      shiftDate: { gte: localDate, lt: nextDay },
      status:    { in: ['SCHEDULED', 'ACTIVE'] },
    },
  });
  return count > 0;
}

// ── Rule evaluation (pure over facts) ────────────────────────────────

function evaluateChecks(input: ValidateAssignmentInput, facts: Facts): AssignmentCheck[] {
  const checks: AssignmentCheck[] = [];

  // ── VEHICLE ────────────────────────────────────────────────────────
  if (input.vehicleId) {
    if (!facts.vehicle) {
      checks.push({
        code:     'VEHICLE_NOT_FOUND',
        severity: 'BLOCK',
        subject:  'vehicle',
        title:    'Vehicle not found',
        detail:   'The selected vehicle does not exist in this tenant.',
        context:  { vehicleId: input.vehicleId },
      });
      // Remaining vehicle checks can't run without the row.
      pushSkipped(checks, 'vehicle', ['VEHICLE_INACTIVE', 'VEHICLE_UNAVAILABLE', 'VEHICLE_ALREADY_ASSIGNED', 'VEHICLE_CAPACITY_EXCEEDED', 'VEHICLE_GPS_STALE'], 'vehicle not found');
    } else {
      // V1 permanent-unavailable
      const permanentlyInactive =
        facts.vehicle.isActive === false ||
        (facts.vehicle.status != null && VEHICLE_INACTIVE_STATUSES.has(facts.vehicle.status));
      checks.push(pf('VEHICLE_INACTIVE', 'vehicle', permanentlyInactive, {
        title: 'Vehicle is inactive',
        detail: `Status: ${facts.vehicle.status ?? 'null'}, isActive: ${facts.vehicle.isActive}.`,
        context: { status: facts.vehicle.status, isActive: facts.vehicle.isActive },
        severity: 'BLOCK',
      }));

      // V2 temporary-unavailable
      const temporarilyUnavailable =
        facts.vehicle.status != null && VEHICLE_UNAVAILABLE_STATUSES.has(facts.vehicle.status);
      checks.push(pf('VEHICLE_UNAVAILABLE', 'vehicle', temporarilyUnavailable, {
        title: `Vehicle is ${facts.vehicle.status?.toLowerCase()}`,
        detail: `Vehicle status "${facts.vehicle.status}" means it can't be assigned to a new trip.`,
        context: { status: facts.vehicle.status },
        severity: 'BLOCK',
      }));

      // V3 already-assigned
      const vehicleConflicts = facts.overlappingTrips.filter(t => t.vehicleId === input.vehicleId);
      checks.push(pf('VEHICLE_ALREADY_ASSIGNED', 'vehicle', vehicleConflicts.length > 0, {
        title: 'Vehicle already assigned to an overlapping trip',
        detail: vehicleConflicts.length === 1
          ? `Conflicts with trip ${vehicleConflicts[0].tripNumber ?? vehicleConflicts[0].id}.`
          : `Conflicts with ${vehicleConflicts.length} other trips.`,
        context: { conflicts: vehicleConflicts.map(t => ({ id: t.id, tripNumber: t.tripNumber, departureTime: t.departureTime, arrivalTime: t.arrivalTime, status: t.status })) },
        severity: 'BLOCK',
      }));

      // V4 capacity
      const rosterCount = input.confirmedCount ?? facts.scheduleRoster ?? 0;
      const capacityExceeded =
        facts.vehicle.seatingCapacity != null &&
        rosterCount > facts.vehicle.seatingCapacity;
      checks.push(pf('VEHICLE_CAPACITY_EXCEEDED', 'vehicle', capacityExceeded, {
        title: `Roster exceeds capacity (${rosterCount}/${facts.vehicle.seatingCapacity})`,
        detail: 'Trip has more confirmed passengers than the assigned vehicle can seat.',
        context: { rosterCount, seatingCapacity: facts.vehicle.seatingCapacity },
        severity: 'WARN',
      }));

      // V6 GPS-stale (only meaningful near the departure horizon)
      const withinHorizon =
        input.departureTime.getTime() - Date.now() <= GPS_OPERATIONAL_HORIZON_MIN * 60_000;
      if (!withinHorizon) {
        checks.push(pf('VEHICLE_GPS_STALE', 'vehicle', false, {
          title: 'GPS not applicable',
          detail: `Trip departs > ${GPS_OPERATIONAL_HORIZON_MIN}m from now; GPS freshness not evaluated.`,
          context: { departureTime: input.departureTime, horizonMin: GPS_OPERATIONAL_HORIZON_MIN },
          severity: 'WARN',
        }));
      } else {
        const ageMin = facts.latestGpsPingAt
          ? Math.floor((Date.now() - facts.latestGpsPingAt.getTime()) / 60_000)
          : Number.POSITIVE_INFINITY;
        const stale = ageMin > GPS_STALE_THRESHOLD_MIN;
        checks.push(pf('VEHICLE_GPS_STALE', 'vehicle', stale, {
          title: facts.latestGpsPingAt
            ? `Vehicle GPS is ${ageMin} min stale`
            : 'Vehicle has never reported GPS',
          detail: 'Consider verifying the device is powered on before the trip departs.',
          context: { latestPingAt: facts.latestGpsPingAt, ageMin: Number.isFinite(ageMin) ? ageMin : null, thresholdMin: GPS_STALE_THRESHOLD_MIN },
          severity: 'WARN',
        }));
      }
    }
  }

  // ── DRIVER ─────────────────────────────────────────────────────────
  if (input.driverId) {
    if (!facts.driver) {
      checks.push({
        code:     'DRIVER_NOT_FOUND',
        severity: 'BLOCK',
        subject:  'driver',
        title:    'Driver not found',
        detail:   'The selected driver does not exist in this tenant.',
        context:  { driverId: input.driverId },
      });
      pushSkipped(checks, 'driver', ['DRIVER_INACTIVE', 'DRIVER_ALREADY_ASSIGNED', 'DRIVER_NO_SHIFT'], 'driver not found');
    } else {
      // D1 inactive
      const notActive = facts.driver.status !== 'ACTIVE';
      checks.push(pf('DRIVER_INACTIVE', 'driver', notActive, {
        title: `Driver status is ${facts.driver.status ?? 'unknown'}`,
        detail: 'Only drivers with status ACTIVE can be assigned to a trip.',
        context: { status: facts.driver.status },
        severity: 'BLOCK',
      }));

      // D2 already-assigned
      const driverConflicts = facts.overlappingTrips.filter(t => t.driverId === input.driverId);
      checks.push(pf('DRIVER_ALREADY_ASSIGNED', 'driver', driverConflicts.length > 0, {
        title: 'Driver already assigned to an overlapping trip',
        detail: driverConflicts.length === 1
          ? `Conflicts with trip ${driverConflicts[0].tripNumber ?? driverConflicts[0].id}.`
          : `Conflicts with ${driverConflicts.length} other trips.`,
        context: { conflicts: driverConflicts.map(t => ({ id: t.id, tripNumber: t.tripNumber, departureTime: t.departureTime, arrivalTime: t.arrivalTime, status: t.status })) },
        severity: 'BLOCK',
      }));

      // D3 shift (tenant-local date)
      checks.push(pf('DRIVER_NO_SHIFT', 'driver', !facts.hasShiftForDate, {
        title: 'No scheduled shift for departure date',
        detail: `Driver has no SCHEDULED or ACTIVE shift on ${toTenantLocalDateBoundary(input.departureTime, input.timezone ?? DEFAULT_TZ).toISOString().slice(0, 10)} (${input.timezone ?? DEFAULT_TZ}).`,
        context: { departureTime: input.departureTime, tz: input.timezone ?? DEFAULT_TZ },
        severity: 'WARN',
      }));
    }
  }

  return checks;
}

/**
 * Build a check row. When `failed=true` the severity is the one we
 * configured for the code; when `failed=false` it's PASS. Keeps rule
 * code compact.
 */
function pf(
  code:     AssignmentCheckCode,
  subject:  CheckSubject,
  failed:   boolean,
  opts:     { title: string; detail?: string; context?: Record<string, unknown>; severity: Exclude<CheckSeverity, 'PASS' | 'SKIPPED'> },
): AssignmentCheck {
  return {
    code,
    subject,
    severity: failed ? opts.severity : 'PASS',
    title:    failed ? opts.title : `${code} — OK`,
    detail:   failed ? opts.detail : undefined,
    context:  failed ? opts.context : undefined,
  };
}

function pushSkipped(
  out:      AssignmentCheck[],
  subject:  CheckSubject,
  codes:    AssignmentCheckCode[],
  reason:   string,
): void {
  for (const code of codes) {
    out.push({ code, subject, severity: 'SKIPPED', title: `${code} — skipped`, detail: reason });
  }
}

function aggregateVerdict(checks: AssignmentCheck[]): AssignmentValidationResult['verdict'] {
  if (checks.some(c => c.severity === 'BLOCK')) return 'BLOCK';
  if (checks.some(c => c.severity === 'WARN')) return 'WARN';
  return 'PASS';
}

// ── Time helpers ─────────────────────────────────────────────────────

/**
 * Compute the effective end of a trip window for overlap purposes.
 * Priority: explicit arrivalTime → route.estimatedDurationMins → 12h.
 * Same formula applied to both the proposed and existing trips so
 * overlap comparison is symmetric.
 */
function effectiveEndTime(
  departureTime: Date,
  arrivalTime:   Date | null,
  routeMins:     number | null,
): Date {
  if (arrivalTime) return arrivalTime;
  const mins = routeMins ?? DEFAULT_TRIP_DURATION_MIN;
  return new Date(departureTime.getTime() + mins * 60_000);
}

/**
 * Convert a UTC instant to the UTC-midnight boundary of that day in
 * the tenant's IANA timezone. Used to bracket driver_shifts lookups
 * so a 01:00 Dubai trip lands on the correct shift date, not the
 * previous day's UTC date.
 */
function toTenantLocalDateBoundary(instant: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  // Local-midnight instant expressed as if it were UTC — bounds the
  // driver_shifts query. driver_shifts.shift_date is stored as
  // Timestamptz; a UTC-midnight range [local-day-start-as-UTC,
  // +24h) selects the row for that local calendar day regardless of
  // the row's exact wall time.
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}
