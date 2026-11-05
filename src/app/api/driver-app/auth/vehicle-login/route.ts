export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/auth/vehicle-login/route.ts
 *
 * Bind the signed-in driver to a vehicle by Vehicle Code or License Plate,
 * and return the tenant's available vehicles (prioritizing LOGISTICS usage
 * for Logistics drivers) with strict profile assignment matching.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { signSession, verifySession } from '@/lib/tenant-session';
import { residencyClaimForTenant } from '@/lib/db-router';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { getDriverTenantContext } from '@/lib/driver-session';
import { matchDriverProfileForUser } from '@/lib/drivers/driver-login-user';
import { recordDrayageDriverLocationPing } from '@/lib/logistics/drayage-domain';
import { emitDrayageEvent } from '@/lib/logistics/drayage-events';

const VEHICLE_SELECT = {
  id: true,
  vehicleCode: true,
  licensePlate: true,
  plateNumber: true,
  registrationNo: true,
  make: true,
  model: true,
  year: true,
  type: true,
  vehicleUsage: true,
  deviceId: true,
  odometerReading: true,
} as const;

type DriverRef = {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  driverType: string | null;
  assignedVehicleId?: string | null;
};

type CallerAuth = { ok: true; tenantId: string; userId: string } | { ok: false; status: number };

/**
 * The caller: a signed driver token (the APK sends it as a Bearer token or
 * the xl-driver-session cookie) first, else the request's verified identity.
 * Each handler passes in its own requireAuthorizedTenant() result.
 */
async function resolveCallerAuth(
  req: NextRequest,
  authz: ReturnType<typeof requireAuthorizedTenant>,
): Promise<CallerAuth> {
  const driverCtx = await getDriverTenantContext(req);
  if (driverCtx?.userId && driverCtx?.tenantId) {
    return { ok: true, tenantId: driverCtx.tenantId, userId: driverCtx.userId };
  }
  if (!authz.ok || !authz.userId) {
    return { ok: false, status: authz.ok ? 401 : authz.status };
  }
  return { ok: true, tenantId: authz.tenantId, userId: authz.userId };
}

/**
 * The caller's own driver profile, resolved in O(1) via `drivers.id = userId`
 * or the explicit `drivers.user_id = userId` foreign key, with fallback to
 * `matchDriverProfileForUser` (which self-heals `drivers.user_id`).
 */
async function callerDriver(userId: string, tenantId: string): Promise<DriverRef | null> {
  const fkRows = await prisma
    .$queryRawUnsafe<
      Array<{
        id: string;
        name: string | null;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        driverType: string | null;
        assignedVehicleId: string | null;
      }>
    >(
      `SELECT
          id::text AS id,
          name,
          first_name AS "firstName",
          last_name AS "lastName",
          email,
          driver_type AS "driverType",
          assigned_vehicle_id AS "assignedVehicleId"
         FROM drivers
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND (id::text = $2 OR user_id = $2)
        ORDER BY (id::text = $2) DESC
        LIMIT 1`,
      tenantId,
      userId,
    )
    .catch(() => []);
  if (fkRows[0]) return fkRows[0];

  // Fallback when the session carries User.id and `drivers.user_id` has not yet been backfilled:
  // matchDriverProfileForUser resolves safely and self-heals `drivers.user_id`.
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, employeeId: true, userType: true },
    });
    if (!user) return null;

    const matchedId = await matchDriverProfileForUser(prisma, tenantId, user);
    if (!matchedId) return null;

    return prisma.driver.findFirst({
      where: { id: matchedId, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        email: true,
        driverType: true,
        assignedVehicleId: true,
      },
    });
  } catch {
    return null;
  }
}

const displayName = (d: DriverRef) =>
  d.name || [d.firstName, d.lastName].filter(Boolean).join(' ') || 'Driver';

const effectivePlate = (v: {
  licensePlate: string | null;
  plateNumber?: string | null;
  registrationNo?: string | null;
  vehicleCode: string | null;
}) => v.licensePlate || v.plateNumber || v.registrationNo || v.vehicleCode || null;

export async function POST(req: NextRequest) {
  const authz = await resolveCallerAuth(req, requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl }));
  if (!authz.ok) {
    return NextResponse.json(
      { error: 'Sign in first, then choose your vehicle.' },
      { status: authz.status },
    );
  }
  const { tenantId, userId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody as Record<string, unknown>);

    const vehicleIdentifier =
      typeof body.vehicleIdentifier === 'string' ? body.vehicleIdentifier.trim() : '';
    if (!vehicleIdentifier) {
      return NextResponse.json(
        { error: 'Vehicle ID / Code or Plate Number is required.' },
        { status: 400 },
      );
    }
    const compact = vehicleIdentifier.replace(/[^a-zA-Z0-9]/g, '');

    const outcome = await withTenantRls(prisma, tenantId, async () => {
      // Exact matches in the caller's own tenant only (a partial-match
      // fallback across every tenant's LOGISTICS vehicles was removed).
      const vehicle = await prisma.vehicle.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { vehicleCode: { equals: vehicleIdentifier, mode: 'insensitive' } },
            { licensePlate: { equals: vehicleIdentifier, mode: 'insensitive' } },
            { plateNumber: { equals: vehicleIdentifier, mode: 'insensitive' } },
            { registrationNo: { equals: vehicleIdentifier, mode: 'insensitive' } },
            ...(compact && compact !== vehicleIdentifier
              ? [
                  { licensePlate: { equals: compact, mode: 'insensitive' as const } },
                  { plateNumber: { equals: compact, mode: 'insensitive' as const } },
                  { vehicleCode: { equals: compact, mode: 'insensitive' as const } },
                ]
              : []),
          ],
        },
        select: { ...VEHICLE_SELECT, assignedDriverId: true },
      });

      if (!vehicle) return { kind: 'no-vehicle' as const };

      const driver = await callerDriver(userId, tenantId);
      if (!driver) return { kind: 'no-driver' as const };

      const trimmedDeviceId = (vehicle.deviceId ?? '').trim();
      const canActivateMobileTracking = trimmedDeviceId === '';

      const odoNum =
        body.odometerReading != null && body.odometerReading !== ''
          ? Number(body.odometerReading)
          : null;
      const validOdo =
        odoNum !== null && !Number.isNaN(odoNum) && odoNum > 0 ? odoNum : null;

      const rawLat = body.latitude != null ? Number(body.latitude) : (body.lat != null ? Number(body.lat) : NaN);
      const rawLng = body.longitude != null ? Number(body.longitude) : (body.lng != null ? Number(body.lng) : NaN);
      const hasLiveLoginCoords =
        !Number.isNaN(rawLat) &&
        !Number.isNaN(rawLng) &&
        (rawLat !== 0 || rawLng !== 0);
      const loginSpeedKmh =
        body.speedKmh != null && !Number.isNaN(Number(body.speedKmh)) && Number(body.speedKmh) >= 0
          ? Number(body.speedKmh)
          : 0;
      const loginHeading =
        body.heading != null && !Number.isNaN(Number(body.heading))
          ? Number(body.heading)
          : 0;

      // Clear this driver from any other vehicle they were previously logged into
      await prisma.vehicle
        .updateMany({
          where: { tenantId, assignedDriverId: driver.id, id: { not: vehicle.id } },
          data: { assignedDriverId: null },
        })
        .catch(() => {});

      // Bind the logged-in driver (and odometer reading if provided) to this vehicle
      await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          assignedDriverId: driver.id,
          ...(validOdo !== null ? { odometerReading: BigInt(Math.round(validOdo)) } : {}),
        },
      });

      if (hasLiveLoginCoords) {
        await recordDrayageDriverLocationPing(prisma, {
          tenantId,
          jobId: 'LOGIN_PING',
          latitude: rawLat,
          longitude: rawLng,
          speedKmh: loginSpeedKmh,
          heading: loginHeading,
          location: typeof body.location === 'string' ? body.location : null,
          actor: displayName(driver),
          driverId: driver.id,
          driverName: displayName(driver),
          vehicleId: vehicle.id,
          vehiclePlate: effectivePlate(vehicle),
        }).catch(() => {});
      }

      if (canActivateMobileTracking) {
        try {
          const lastKnown = await prisma.busGpsPing.findFirst({
            where: { vehicleId: vehicle.id, tenantId },
            orderBy: { occurredAt: 'desc' },
            select: { latitude: true, longitude: true, headingDeg: true },
          });
          await prisma.busGpsPing.create({
            data: {
              tenantId,
              vehicleId: vehicle.id,
              latitude: hasLiveLoginCoords ? rawLat : (lastKnown?.latitude ?? 25.0112),
              longitude: hasLiveLoginCoords ? rawLng : (lastKnown?.longitude ?? 55.0612),
              speedKmh: loginSpeedKmh,
              headingDeg: hasLiveLoginCoords ? loginHeading : (lastKnown?.headingDeg ?? 0),
              accuracyM: 5,
              occurredAt: new Date(),
              source: 'DRIVER_APP',
            },
          });
        } catch {
          // Ignore if bus_gps_pings table is not present
        }
      }

      return {
        kind: 'ok' as const,
        vehicle,
        driver,
        trimmedDeviceId,
        canActivateMobileTracking,
        validOdo,
        hasLiveLoginCoords,
        rawLat,
        rawLng,
      };
    });

    if (outcome.kind === 'no-vehicle') {
      return NextResponse.json(
        {
          error: `No vehicle found matching "${vehicleIdentifier}". Please check your Plate Number or Vehicle Code.`,
        },
        { status: 404 },
      );
    }
    if (outcome.kind === 'no-driver') {
      return NextResponse.json(
        { error: 'Your account is not linked to a driver profile in this organisation.' },
        { status: 403 },
      );
    }

    const { vehicle, driver, trimmedDeviceId, canActivateMobileTracking, validOdo, hasLiveLoginCoords, rawLat, rawLng } = outcome;

    if (hasLiveLoginCoords) {
      emitDrayageEvent(tenantId, {
        type: 'telemetry_ping',
        action: 'driver_login_location',
        vehicleId: vehicle.id,
        lat: rawLat,
        lng: rawLng,
      });
    }

    const sessionToken = await signSession({
      userId: driver.id,
      tenantId,
      plan: 'DRIVER',
      role: 'DRIVER',
      permissions: [],
      ttlMs: 24 * 60 * 60 * 1000,
      ...(await residencyClaimForTenant(tenantId)),
    });

    const effectiveOdometer =
      validOdo ?? (vehicle.odometerReading != null ? Number(vehicle.odometerReading) : null);
    const resolvedPlate = effectivePlate(vehicle);

    const response = NextResponse.json({
      ok: true,
      sessionToken,
      vehicle: {
        id: vehicle.id,
        vehicleCode: vehicle.vehicleCode || resolvedPlate,
        licensePlate: resolvedPlate,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year ? Number(vehicle.year) : null,
        vehicleUsage: vehicle.vehicleUsage || 'LOGISTICS',
        deviceId: trimmedDeviceId,
        isDeviceBlank: canActivateMobileTracking,
        canActivateMobileTracking,
        odometerReading: effectiveOdometer,
      },
      driver: {
        id: driver.id,
        name: displayName(driver),
        assignedVehicleId: driver.assignedVehicleId ?? null,
      },
      message: canActivateMobileTracking
        ? 'Signed in successfully. Hardware Device ID is blank — Mobile GPS tracking is available.'
        : `Signed in successfully. Vehicle has hardware GPS device (${trimmedDeviceId}) — Mobile tracking is disabled.`,
    });

    const cookieOpts = {
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 24 * 60 * 60,
    };
    response.cookies.set('xl-driver-session', sessionToken, { ...cookieOpts, httpOnly: true });
    response.cookies.set('xl-driver-vehicle-id', vehicle.id, { ...cookieOpts, httpOnly: false });
    return response;
  } catch (err) {
    console.error('[api/driver-app/auth/vehicle-login POST]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const authz = await resolveCallerAuth(req, requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl }));
  if (!authz.ok) {
    return NextResponse.json({ hasSession: false });
  }
  const { tenantId, userId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async () => {
      const driver = await callerDriver(userId, tenantId);
      const driverJson = driver
        ? {
            id: driver.id,
            name: displayName(driver),
            driverType: driver.driverType ?? null,
            assignedVehicleId: driver.assignedVehicleId ?? null,
          }
        : null;

      if (req.nextUrl.searchParams.get('list') === 'true') {
        const isLogisticsDriver = driver?.driverType?.toUpperCase() === 'LOGISTICS';

        // The caller's own tenant only: the list used to include every
        // tenant's LOGISTICS vehicles.
        let vehicles = await prisma.vehicle.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...(isLogisticsDriver
              ? {
                  OR: [
                    { vehicleUsage: 'LOGISTICS' },
                    ...(driver
                      ? [
                          { assignedDriverId: driver.id },
                          ...(driver.assignedVehicleId ? [{ id: driver.assignedVehicleId }] : []),
                        ]
                      : []),
                  ],
                }
              : {}),
          },
          select: { ...VEHICLE_SELECT, assignedDriverId: true },
          orderBy: [{ vehicleCode: 'asc' }, { licensePlate: 'asc' }],
          take: 150,
        });

        // Fallback if tenant has vehicles whose vehicleUsage column was not set yet
        if (vehicles.length === 0) {
          vehicles = await prisma.vehicle.findMany({
            where: { tenantId, deletedAt: null },
            select: { ...VEHICLE_SELECT, assignedDriverId: true },
            orderBy: [{ vehicleCode: 'asc' }, { licensePlate: 'asc' }],
            take: 150,
          });
        }

        const assignedVehicleRow =
          vehicles.find(
            (v) =>
              Boolean(driver?.assignedVehicleId && v.id === driver.assignedVehicleId) ||
              Boolean(driver && v.assignedDriverId === driver.id) ||
              v.assignedDriverId === userId,
          ) || null;

        const effectiveAssignedVehicleId =
          driver?.assignedVehicleId ?? assignedVehicleRow?.id ?? null;

        const resolvedDriverJson = driverJson
          ? { ...driverJson, assignedVehicleId: effectiveAssignedVehicleId }
          : assignedVehicleRow
            ? { id: userId, name: 'Driver', driverType: null, assignedVehicleId: assignedVehicleRow.id }
            : null;

        const mappedVehicles = vehicles.map((v) => {
          const isBlank = (v.deviceId ?? '').trim() === '';
          const isAssignedToMe = Boolean(
            (effectiveAssignedVehicleId && effectiveAssignedVehicleId === v.id) ||
              (driver && v.assignedDriverId === driver.id) ||
              v.assignedDriverId === userId,
          );
          const plate = effectivePlate(v);
          return {
            id: v.id,
            vehicleCode: v.vehicleCode || plate,
            licensePlate: plate,
            make: v.make,
            model: v.model,
            year: v.year ? Number(v.year) : null,
            vehicleUsage: v.vehicleUsage || (isLogisticsDriver ? 'LOGISTICS' : null),
            deviceId: (v.deviceId ?? '').trim(),
            isDeviceBlank: isBlank,
            canActivateMobileTracking: isBlank,
            odometerReading: v.odometerReading != null ? Number(v.odometerReading) : null,
            isAssignedToMe,
          };
        });

        const assignedOnly = mappedVehicles.filter((v) => v.isAssignedToMe);

        return NextResponse.json({
          hasSession: true,
          userId,
          tenantId,
          driver: resolvedDriverJson,
          vehicles: assignedOnly.length > 0 ? assignedOnly : mappedVehicles,
        });
      }

      // Only trust xl-driver-vehicle-id cookie if xl-driver-session cookie matches the active caller
      const rawDriverCookie = req.cookies.get('xl-driver-session')?.value;
      const verifiedDriverCookie = rawDriverCookie
        ? await verifySession(rawDriverCookie).catch(() => null)
        : null;
      const isDriverCookieForCaller = Boolean(
        verifiedDriverCookie &&
          verifiedDriverCookie.tenantId === tenantId &&
          (verifiedDriverCookie.userId === userId ||
            (driver && verifiedDriverCookie.userId === driver.id)),
      );

      const cookieVehicleId = isDriverCookieForCaller
        ? req.cookies.get('xl-driver-vehicle-id')?.value
        : undefined;

      let vehicle = cookieVehicleId
        ? await prisma.vehicle.findFirst({
            where: { id: cookieVehicleId, tenantId, deletedAt: null },
            select: VEHICLE_SELECT,
          })
        : null;
      if (!vehicle && driver) {
        vehicle = await prisma.vehicle.findFirst({
          where: {
            tenantId,
            deletedAt: null,
            OR: [
              ...(driver.assignedVehicleId ? [{ id: driver.assignedVehicleId }] : []),
              { assignedDriverId: driver.id },
            ],
          },
          select: VEHICLE_SELECT,
        });
      }

      if (!vehicle) {
        return NextResponse.json({ hasSession: true, userId, tenantId, driver: driverJson, vehicle: null });
      }

      const trimmedDeviceId = (vehicle.deviceId ?? '').trim();
      const isDeviceBlank = trimmedDeviceId === '';
      const plate = effectivePlate(vehicle);
      return NextResponse.json({
        hasSession: true,
        userId,
        tenantId,
        driver: driverJson,
        vehicle: {
          id: vehicle.id,
          vehicleCode: vehicle.vehicleCode || plate,
          licensePlate: plate,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year ? Number(vehicle.year) : null,
          vehicleUsage: vehicle.vehicleUsage,
          deviceId: trimmedDeviceId,
          isDeviceBlank,
          canActivateMobileTracking: isDeviceBlank,
          odometerReading: vehicle.odometerReading != null ? Number(vehicle.odometerReading) : null,
        },
      });
    });
  } catch (err) {
    console.error('[api/driver-app/auth/vehicle-login GET]', err);
    return NextResponse.json({ hasSession: false, error: 'Could not load the driver session.' });
  }
}
