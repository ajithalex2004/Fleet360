export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/auth/vehicle-login/route.ts
 *
 * Bind the signed-in driver to a vehicle by Vehicle Code or License Plate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { signSession } from '@/lib/tenant-session';
import { residencyClaimForTenant } from '@/lib/db-router';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

const VEHICLE_SELECT = {
  id: true,
  vehicleCode: true,
  licensePlate: true,
  make: true,
  model: true,
  year: true,
  deviceId: true,
  odometerReading: true,
} as const;

type DriverRef = {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  assignedVehicleId?: string | null;
};

async function callerDriver(userId: string, tenantId: string): Promise<DriverRef | null> {
  return prisma.driver.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { id: true, name: true, firstName: true, lastName: true, assignedVehicleId: true },
  });
}

const displayName = (d: DriverRef) =>
  d.name || [d.firstName, d.lastName].filter(Boolean).join(' ') || 'Driver';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok || !authz.userId) {
    return NextResponse.json(
      { error: 'Sign in first, then choose your vehicle.' },
      { status: authz.ok ? 401 : authz.status },
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
            ...(compact && compact !== vehicleIdentifier
              ? [{ licensePlate: { equals: compact, mode: 'insensitive' as const } }]
              : []),
          ],
        },
        select: { ...VEHICLE_SELECT, assignedDriverId: true },
      });

      if (!vehicle) {
        vehicle = await prisma.vehicle.findFirst({
          where: {
            tenantId,
            deletedAt: null,
            OR: [
              { vehicleCode: { contains: vehicleIdentifier, mode: 'insensitive' } },
              { licensePlate: { contains: vehicleIdentifier, mode: 'insensitive' } },
              ...(compact && compact.length >= 3
                ? [{ licensePlate: { contains: compact, mode: 'insensitive' as const } }]
                : []),
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

    const response = NextResponse.json({
      ok: true,
      sessionToken,
      vehicle: {
        id: vehicle.id,
        vehicleCode: vehicle.vehicleCode,
        licensePlate: vehicle.licensePlate,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year ? Number(vehicle.year) : null,
        deviceId: trimmedDeviceId,
        isDeviceBlank: canActivateMobileTracking,
        canActivateMobileTracking,
        odometerReading: effectiveOdometer,
      },
      driver: { id: driver.id, name: displayName(driver) },
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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok || !authz.userId) {
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
            assignedVehicleId: driver.assignedVehicleId ?? null,
          }
        : null;

      if (req.nextUrl.searchParams.get('list') === 'true') {
        const vehicles = await prisma.vehicle.findMany({
          where: { tenantId, deletedAt: null },
          select: { ...VEHICLE_SELECT, assignedDriverId: true },
          orderBy: [{ vehicleCode: 'asc' }, { licensePlate: 'asc' }],
          take: 150,
        });
        return NextResponse.json({
          hasSession: true,
          userId,
          driver: driverJson,
          vehicles: vehicles.map((v) => {
            const isBlank = (v.deviceId ?? '').trim() === '';
            const isAssignedToMe = Boolean(
              driver?.assignedVehicleId && driver.assignedVehicleId === v.id,
            );
            return {
              id: v.id,
              vehicleCode: v.vehicleCode,
              licensePlate: v.licensePlate,
              make: v.make,
              model: v.model,
              year: v.year ? Number(v.year) : null,
              deviceId: (v.deviceId ?? '').trim(),
              isDeviceBlank: isBlank,
              canActivateMobileTracking: isBlank,
              odometerReading: v.odometerReading != null ? Number(v.odometerReading) : null,
              isAssignedToMe,
            };
          }),
        });
      }

      const cookieVehicleId = req.cookies.get('xl-driver-vehicle-id')?.value;
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
        return NextResponse.json({ hasSession: true, userId, driver: driverJson, vehicle: null });
      }

      const trimmedDeviceId = (vehicle.deviceId ?? '').trim();
      const isDeviceBlank = trimmedDeviceId === '';
      return NextResponse.json({
        hasSession: true,
        userId,
        driver: driverJson,
        vehicle: {
          id: vehicle.id,
          vehicleCode: vehicle.vehicleCode,
          licensePlate: vehicle.licensePlate,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year ? Number(vehicle.year) : null,
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
