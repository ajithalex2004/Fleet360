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

async function resolveCallerAuth(req: NextRequest): Promise<{ ok: true; tenantId: string; userId: string } | { ok: false; status: number }> {
  // Prefer explicit Bearer token / driver session via getDriverTenantContext first
  const driverCtx = await getDriverTenantContext(req);
  if (driverCtx?.userId && driverCtx?.tenantId) {
    return { ok: true, tenantId: driverCtx.tenantId, userId: driverCtx.userId };
  }
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok || !authz.userId) {
    return { ok: false, status: authz.ok ? 401 : authz.status };
  }
  return { ok: true, tenantId: authz.tenantId, userId: authz.userId };
}

async function callerDriver(userId: string, tenantId: string): Promise<DriverRef | null> {
  const direct = await prisma.driver.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
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
  if (direct) return direct;

  // Fallback: if Driver and User were created with distinct UUIDs, match by User email / mobileNumber
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, mobileNumber: true },
  });
  if (!user) return null;

  const orConditions: Array<Record<string, unknown>> = [];
  if (user.email) {
    orConditions.push({ email: { equals: user.email, mode: 'insensitive' } });
  }
  if (user.mobileNumber) {
    orConditions.push({ contactNumber: user.mobileNumber });
  }
  if (orConditions.length === 0) return null;

  return prisma.driver.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      OR: orConditions,
    },
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
  const authz = await resolveCallerAuth(req);
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
      let vehicle = await prisma.vehicle.findFirst({
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

      if (!vehicle) {
        vehicle = await prisma.vehicle.findFirst({
          where: {
            deletedAt: null,
            OR: [{ tenantId }, { vehicleUsage: 'LOGISTICS' }],
            AND: [
              {
                OR: [
                  { vehicleCode: { contains: vehicleIdentifier, mode: 'insensitive' } },
                  { licensePlate: { contains: vehicleIdentifier, mode: 'insensitive' } },
                  { plateNumber: { contains: vehicleIdentifier, mode: 'insensitive' } },
                  { registrationNo: { contains: vehicleIdentifier, mode: 'insensitive' } },
                  ...(compact && compact.length >= 3
                    ? [
                        { licensePlate: { contains: compact, mode: 'insensitive' as const } },
                        { plateNumber: { contains: compact, mode: 'insensitive' as const } },
                        { vehicleCode: { contains: compact, mode: 'insensitive' as const } },
                      ]
                    : []),
                ],
              },
            ],
          },
          select: { ...VEHICLE_SELECT, assignedDriverId: true },
        });
      }

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
      if (validOdo !== null) {
        await prisma.vehicle.update({
          where: { id: vehicle.id },
          data: { odometerReading: BigInt(Math.round(validOdo)) },
        });
      }

      if (canActivateMobileTracking) {
        const lastKnown = await prisma.busGpsPing.findFirst({
          where: { vehicleId: vehicle.id, tenantId },
          orderBy: { occurredAt: 'desc' },
          select: { latitude: true, longitude: true, headingDeg: true },
        });
        await prisma.busGpsPing.create({
          data: {
            tenantId,
            vehicleId: vehicle.id,
            latitude: lastKnown?.latitude ?? 25.2048,
            longitude: lastKnown?.longitude ?? 55.2708,
            speedKmh: 0,
            headingDeg: lastKnown?.headingDeg ?? 0,
            accuracyM: 5,
            occurredAt: new Date(),
            source: 'DRIVER_APP',
          },
        });
      }

      return {
        kind: 'ok' as const,
        vehicle,
        driver,
        trimmedDeviceId,
        canActivateMobileTracking,
        validOdo,
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

    const { vehicle, driver, trimmedDeviceId, canActivateMobileTracking, validOdo } = outcome;

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
  const authz = await resolveCallerAuth(req);
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
        const isLogisticsDriver =
          driver?.driverType?.toUpperCase() === 'LOGISTICS' ||
          tenantId === '767aaca7-a588-4b2f-ae32-5111b09db0ce';

        let vehicles = await prisma.vehicle.findMany({
          where: {
            deletedAt: null,
            ...(isLogisticsDriver
              ? {
                  OR: [
                    { tenantId, vehicleUsage: 'LOGISTICS' },
                    { vehicleUsage: 'LOGISTICS' },
                  ],
                }
              : { tenantId }),
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

        return NextResponse.json({
          hasSession: true,
          userId,
          tenantId,
          driver: driverJson,
          vehicles: vehicles.map((v) => {
            const isBlank = (v.deviceId ?? '').trim() === '';
            const isAssignedToMe = Boolean(
              driver?.assignedVehicleId && driver.assignedVehicleId === v.id,
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
          }),
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
      if (!vehicle && driver?.assignedVehicleId) {
        vehicle = await prisma.vehicle.findFirst({
          where: { id: driver.assignedVehicleId, tenantId, deletedAt: null },
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
