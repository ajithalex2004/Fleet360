/**
 * The verified actor behind a driver-app write: which driver is calling and
 * which vehicle and trip they may act on, all derived server-side.
 *
 * Driver-app routes are public (see PUBLIC_PREFIXES), so each write route
 * must establish this itself. A valid session only proves who signed in;
 * this module adds:
 *
 *   1. The signed-in user must be an active driver of the session's tenant
 *      (a row in `drivers` with id = session userId, not deleted, status
 *      ACTIVE or unset). Office users who are not drivers are refused, even
 *      with a valid session for the same tenant.
 *   2. The vehicle and trip come from that driver's own records: the trip
 *      in `trip_schedules` assigned to them that is IN_PROGRESS, and the
 *      vehicle of their ACTIVE shift in `shifts`. Identifiers sent in the
 *      request body never choose the target. A body `driverId` or
 *      `vehicleId` that disagrees with these records is rejected, so a
 *      client bug or a tampered request is visible rather than silently
 *      rewritten.
 *
 * The same identifier conventions as the existing driver-app routes apply:
 * trip_schedules.driver_id and shifts.driver_id hold the session userId
 * (see /api/driver-app/today/assignments and /api/driver-app/shift/current).
 */

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
/** The parts of a Prisma transaction this module uses. */
export type DriverActorTx = Pick<Prisma.TransactionClient, 'driver' | '$queryRawUnsafe'>;

interface DriverRow {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  status: string | null;
}

export interface AssignedVehicle {
  id: string;
  plate: string | null;
}

export interface VerifiedDriverActor {
  tenantId: string;
  driverId: string;
  driverName: string;
  /** The driver's IN_PROGRESS trip, if any. */
  activeTrip: { id: string; vehicle: AssignedVehicle | null } | null;
  /** Vehicle of the driver's ACTIVE shift, if any. */
  shiftVehicle: AssignedVehicle | null;
}

const forbidden = (error: string) => NextResponse.json({ error }, { status: 403 });

function displayName(d: DriverRow): string {
  const full = [d.firstName, d.lastName].filter(Boolean).join(' ').trim();
  return d.name?.trim() || full || 'Driver';
}

/**
 * Loads the driver record and current assignments for `userId` in
 * `tenantId`. Returns null when the user is not an active driver of that
 * tenant. Must run inside the tenant's RLS transaction.
 */
export async function loadDriverActor(
  tx: DriverActorTx,
  tenantId: string,
  userId: string,
): Promise<VerifiedDriverActor | null> {
  let driver = await tx.driver.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { id: true, name: true, firstName: true, lastName: true, status: true },
  });
  if (!driver) {
    const userRow = await tx.$queryRawUnsafe<Array<{ email: string }>>(
      `SELECT email FROM "User" WHERE id = $1::uuid LIMIT 1`,
      userId
    ).catch(() => []);
    if (userRow[0]?.email) {
      driver = await tx.driver.findFirst({
        where: { email: { equals: userRow[0].email, mode: 'insensitive' }, tenantId, deletedAt: null },
        select: { id: true, name: true, firstName: true, lastName: true, status: true },
      });
    }
  }
  if (!driver) return null;
  if (driver.status && driver.status !== 'ACTIVE') return null;

  const trips = await tx.$queryRawUnsafe<Array<{ id: string; vehicle_id: string | null; plate: string | null }>>(
    `SELECT ts.id, ts.vehicle_id, v.license_plate AS plate
       FROM trip_schedules ts
       LEFT JOIN vehicles v ON v.id = ts.vehicle_id AND v.tenant_id = ts.tenant_id
      WHERE ts.tenant_id = $1::uuid
        AND ts.driver_id = $2::text
        AND ts.status = 'IN_PROGRESS'
      ORDER BY ts.actual_departure_at DESC NULLS LAST
      LIMIT 1`,
    tenantId, userId,
  );
  const trip = trips[0];

  const shifts = await tx.$queryRawUnsafe<Array<{ vehicle_id: string | null; plate: string | null }>>(
    `SELECT s.vehicle_id, v.license_plate AS plate
       FROM shifts s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id AND v.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1::uuid
        AND s.driver_id = $2::uuid
        AND s.status = 'ACTIVE'
      ORDER BY s.started_at DESC
      LIMIT 1`,
    tenantId, userId,
  );
  const shift = shifts[0];

  return {
    tenantId,
    driverId: driver.id,
    driverName: displayName(driver),
    activeTrip: trip
      ? { id: trip.id, vehicle: trip.vehicle_id ? { id: trip.vehicle_id, plate: trip.plate } : null }
      : null,
    shiftVehicle: shift?.vehicle_id ? { id: shift.vehicle_id, plate: shift.plate } : null,
  };
}

/**
 * Loads the driver actor for an already-verified driver session (see
 * requireDriverSessionForTenant, which callers run before opening the
 * transaction so unauthenticated requests never reach the database).
 * 403 when the session user is not an active driver of the tenant.
 */
export async function requireDriverActor(
  tx: DriverActorTx,
  session: { tenantId: string; userId: string },
): Promise<VerifiedDriverActor | NextResponse> {
  const actor = await loadDriverActor(tx, session.tenantId, session.userId);
  if (!actor) return forbidden('An active driver account is required for this action');
  return actor;
}

/**
 * Rejects a request whose body names a different driver or vehicle than the
 * server-side records. Plates are display-only on the client (it sends a
 * placeholder when it has no trip), so only IDs are compared.
 */
export function rejectForeignIdentifiers(
  actor: VerifiedDriverActor,
  body: { driverId?: unknown; vehicleId?: unknown },
  allowedVehicle: AssignedVehicle | null,
): NextResponse | null {
  if (body.driverId !== undefined && body.driverId !== null && body.driverId !== actor.driverId) {
    return forbidden('driverId does not match the signed-in driver');
  }
  if (body.vehicleId !== undefined && body.vehicleId !== null && body.vehicleId !== allowedVehicle?.id) {
    return forbidden('vehicleId is not the vehicle assigned to the signed-in driver');
  }
  return null;
}

/** The parts of a Prisma transaction the reference checks use. */
export type DriverRefTx = Pick<Prisma.TransactionClient, 'driver' | '$queryRawUnsafe'>;

/**
 * 403 unless `userId` is an active driver of `tenantId` (a `drivers` row, not
 * deleted, status ACTIVE or unset). A valid session alone is not enough: an
 * office user's session is accepted by the driver-app cookie helpers too.
 * Must run inside the tenant's RLS transaction.
 */
export async function requireActiveDriver(
  tx: Pick<DriverRefTx, 'driver' | '$queryRawUnsafe'>,
  session: { tenantId: string; userId: string },
): Promise<NextResponse | null> {
  let driver = await tx.driver.findFirst({
    where: { id: session.userId, tenantId: session.tenantId, deletedAt: null },
    select: { status: true },
  });
  if (!driver) {
    const userRow = await tx.$queryRawUnsafe<Array<{ email: string }>>(
      `SELECT email FROM "User" WHERE id = $1::uuid LIMIT 1`,
      session.userId
    ).catch(() => []);
    if (userRow[0]?.email) {
      driver = await tx.driver.findFirst({
        where: { email: { equals: userRow[0].email, mode: 'insensitive' }, tenantId: session.tenantId, deletedAt: null },
        select: { status: true },
      });
    }
  }
  if (!driver || (driver.status && driver.status !== 'ACTIVE')) {
    return forbidden('An active driver account is required for this action');
  }
  return null;
}

export interface DriverReferences {
  shiftId?: string | null;
  tripId?: string | null;
  vehicleId?: string | null;
}

/**
 * Object-level check for identifiers a driver-app request names. Each one
 * that is present must belong to the signed-in driver in their tenant:
 *
 *   shiftId    one of the driver's own shifts
 *   tripId     one of the driver's own trips, not cancelled
 *   vehicleId  the vehicle of that shift or trip, of the driver's active
 *              shift or scheduled / in-progress trip, or a vehicle assigned
 *              to the driver (vehicles.assigned_driver_id)
 *
 * Absent identifiers are not checked. Returns a 403 response for the first
 * identifier that fails, else null. Must run inside the tenant's RLS
 * transaction; the queries also filter by tenant explicitly.
 */
export async function authorizeDriverReferences(
  tx: Pick<DriverRefTx, '$queryRawUnsafe' | 'driver'>,
  session: { tenantId: string; userId: string },
  refs: DriverReferences,
): Promise<NextResponse | null> {
  const { tenantId, userId } = session;
  let driverId = userId;
  const driver = await tx.driver.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!driver) {
    const userRow = await tx.$queryRawUnsafe<Array<{ email: string }>>(
      `SELECT email FROM "User" WHERE id = $1::uuid LIMIT 1`,
      userId
    ).catch(() => []);
    if (userRow[0]?.email) {
      const match = await tx.driver.findFirst({
        where: { email: { equals: userRow[0].email, mode: 'insensitive' }, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (match) driverId = match.id;
    }
  }
  const namedVehicles: string[] = [];

  if (refs.shiftId) {
    const rows = await tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
      `SELECT vehicle_id::text AS vehicle_id FROM shifts
        WHERE id::text = $1 AND tenant_id::text = $2 AND driver_id::text = $3
        LIMIT 1`,
      refs.shiftId, tenantId, userId,
    );
    if (!rows[0]) return forbidden('shiftId is not a shift of the signed-in driver');
    if (rows[0].vehicle_id) namedVehicles.push(rows[0].vehicle_id);
  }

  if (refs.tripId) {
    const rows = await tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
      `SELECT vehicle_id::text AS vehicle_id FROM trip_schedules
        WHERE id::text = $1 AND tenant_id::text = $2 AND driver_id::text = $3
          AND status IS DISTINCT FROM 'CANCELLED'
        LIMIT 1`,
      refs.tripId, tenantId, userId,
    );
    if (!rows[0]) return forbidden('tripId is not a trip of the signed-in driver');
    if (rows[0].vehicle_id) namedVehicles.push(rows[0].vehicle_id);
  }

  if (refs.vehicleId && !namedVehicles.includes(refs.vehicleId)) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT v.id::text AS id FROM vehicles v
        WHERE v.id::text = $1 AND v.tenant_id::text = $2
          AND (
            (v.assigned_driver_id::text = $3 OR v.assigned_driver_id::text = $4)
            OR EXISTS (SELECT 1 FROM shifts s
                        WHERE s.vehicle_id::text = v.id::text AND s.tenant_id::text = $2
                          AND s.driver_id::text = $3 AND s.status = 'ACTIVE')
            OR EXISTS (SELECT 1 FROM trip_schedules t
                        WHERE t.vehicle_id::text = v.id::text AND t.tenant_id::text = $2
                          AND t.driver_id::text = $3 AND t.status IN ('SCHEDULED', 'IN_PROGRESS'))
          )
        LIMIT 1`,
      refs.vehicleId, tenantId, userId, driverId,
    );
    if (!rows[0]) return forbidden('vehicleId is not a vehicle assigned to the signed-in driver');
  }
  return null;
}
