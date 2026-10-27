export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/auth/vehicle-login/route.ts
 *
 * Driver login via Vehicle Code or License Plate Number.
 *
 * Flow:
 *  1. Driver inputs Vehicle Code (e.g. VEH-000247) or Plate Number (e.g. 96448).
 *  2. Backend matches vehicle in the fleet master.
 *  3. Checks whether hardware telematics `deviceId` is blank.
 *     - If deviceId is blank: mobile tracking CAN be activated by the driver.
 *     - If deviceId is NOT blank: hardware GPS is already installed; mobile tracking is disabled.
 *  4. Accepts optional `odometerReading` to update starting vehicle odometer.
 *  5. Mints `xl-driver-session` and `xl-driver-vehicle-id` cookies and returns vehicle state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signSession, verifySession } from '@/lib/tenant-session';
import { residencyClaimForTenant } from '@/lib/db-router';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);

    const vehicleIdentifier = typeof body.vehicleIdentifier === 'string'
      ? body.vehicleIdentifier.trim()
      : '';

    if (!vehicleIdentifier) {
      return NextResponse.json(
        { error: 'Vehicle ID / Code or Plate Number is required.' },
        { status: 400 }
      );
    }

    // Normalized search query
    const cleanQuery = vehicleIdentifier.replace(/[^a-zA-Z0-9]/g, '');

    // Search by vehicleCode, licensePlate, or id
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { vehicleCode: { equals: vehicleIdentifier, mode: 'insensitive' } },
          { licensePlate: { equals: vehicleIdentifier, mode: 'insensitive' } },
          { licensePlate: { contains: vehicleIdentifier, mode: 'insensitive' } },
          { vehicleCode: { contains: vehicleIdentifier, mode: 'insensitive' } },
          ...(cleanQuery.length >= 3 ? [
            { licensePlate: { contains: cleanQuery, mode: 'insensitive' } },
          ] : []),
        ],
      },
      select: {
        id: true,
        vehicleCode: true,
        licensePlate: true,
        make: true,
        model: true,
        year: true,
        deviceId: true,
        tenantId: true,
        assignedDriverId: true,
        odometerReading: true,
      },
    });

    if (!vehicle) {
      return NextResponse.json(
        {
          error: `No vehicle found matching "${vehicleIdentifier}". Please check your Plate Number or Vehicle Code.`,
        },
        { status: 404 }
      );
    }

    // Determine if hardware deviceId is blank
    const trimmedDeviceId = (vehicle.deviceId ?? '').trim();
    const isDeviceBlank = trimmedDeviceId === '';
    const canActivateMobileTracking = isDeviceBlank;

    // Optional odometer update
    const odoNum = body.odometerReading != null && body.odometerReading !== ''
      ? Number(body.odometerReading)
      : null;
    if (odoNum !== null && !isNaN(odoNum) && odoNum > 0) {
      await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: { odometerReading: BigInt(Math.round(odoNum)) },
      }).catch((e) => console.warn('[vehicle-login] Could not update odometerReading:', e));
    }

    // Resolve or link active driver
    // 1. Check existing session if already logged in via password/biometric
    const incomingToken = req.cookies.get('xl-driver-session')?.value || req.cookies.get('xl-session')?.value;
    let signedInUserId: string | null = null;
    let signedInEmail: string | null = null;
    if (incomingToken) {
      const s = await verifySession(incomingToken).catch(() => null);
      if (s?.userId) {
        signedInUserId = s.userId;
        const u = await prisma.user.findUnique({
          where: { id: s.userId },
          select: { email: true },
        }).catch(() => null);
        if (u?.email) signedInEmail = u.email;
      }
    }

    let driver = null;
    if (signedInUserId) {
      driver = await prisma.driver.findFirst({
        where: { id: signedInUserId, tenantId: vehicle.tenantId, deletedAt: null },
        select: { id: true, name: true, firstName: true, lastName: true },
      });
    }
    if (!driver && (signedInEmail || body.driverEmail)) {
      const emailToMatch = body.driverEmail || signedInEmail;
      driver = await prisma.driver.findFirst({
        where: { email: { equals: emailToMatch, mode: 'insensitive' }, tenantId: vehicle.tenantId, deletedAt: null },
        select: { id: true, name: true, firstName: true, lastName: true },
      });
    }

    if (!driver && vehicle.assignedDriverId) {
      driver = await prisma.driver.findFirst({
        where: { id: vehicle.assignedDriverId, tenantId: vehicle.tenantId, deletedAt: null },
        select: { id: true, name: true, firstName: true, lastName: true },
      });
    }

    if (!driver) {
      driver = await prisma.driver.findFirst({
        where: { tenantId: vehicle.tenantId, status: 'ACTIVE', deletedAt: null },
        select: { id: true, name: true, firstName: true, lastName: true },
      });
    }

    // If no driver exists in this tenant, create a driver record for this vehicle
    if (!driver) {
      driver = await prisma.driver.create({
        data: {
          tenantId: vehicle.tenantId,
          name: `Driver (${vehicle.licensePlate || vehicle.vehicleCode || 'Fleet'})`,
          status: 'ACTIVE',
        },
        select: { id: true, name: true, firstName: true, lastName: true },
      });
    }

    // If vehicle had no assigned driver or was assigned to another, bind this driver
    if (driver) {
      await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: { assignedDriverId: driver.id },
      }).catch((e) => console.warn('[vehicle-login] Could not bind assignedDriverId:', e));
    }

    // If mobile tracking is active (blank deviceId), record an initial on-duty ping on vehicle login
    if (canActivateMobileTracking) {
      const lastKnown = await prisma.busGpsPing.findFirst({
        where: { vehicleId: vehicle.id, tenantId: vehicle.tenantId },
        orderBy: { occurredAt: 'desc' },
        select: { latitude: true, longitude: true, headingDeg: true },
      });

      const lat = lastKnown?.latitude ?? 25.2048;
      const lng = lastKnown?.longitude ?? 55.2708;
      const heading = lastKnown?.headingDeg ?? 0;

      await prisma.busGpsPing.create({
        data: {
          tenantId: vehicle.tenantId,
          vehicleId: vehicle.id,
          latitude: lat,
          longitude: lng,
          speedKmh: 0,
          headingDeg: heading,
          accuracyM: 5,
          occurredAt: new Date(),
          source: 'DRIVER_APP',
        },
      }).catch((e) => console.warn('[vehicle-login] Could not record initial ping:', e));
    }

    // Mint driver session cookie (24h TTL)
    const sessionToken = await signSession({
      userId: driver.id,
      tenantId: vehicle.tenantId,
      plan: 'DRIVER',
      role: 'DRIVER',
      permissions: [],
      ttlMs: 24 * 60 * 60 * 1000,
      ...(await residencyClaimForTenant(vehicle.tenantId)),
    });

    const driverDisplayName = driver.name || [driver.firstName, driver.lastName].filter(Boolean).join(' ') || 'Driver';

    const effectiveOdometer = odoNum !== null && !isNaN(odoNum) && odoNum > 0
      ? odoNum
      : (vehicle.odometerReading != null ? Number(vehicle.odometerReading) : null);

    const response = NextResponse.json({
      ok: true,
      vehicle: {
        id: vehicle.id,
        vehicleCode: vehicle.vehicleCode,
        licensePlate: vehicle.licensePlate,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year ? Number(vehicle.year) : null,
        deviceId: trimmedDeviceId,
        isDeviceBlank,
        canActivateMobileTracking,
        odometerReading: effectiveOdometer,
      },
      driver: {
        id: driver.id,
        name: driverDisplayName,
      },
      message: canActivateMobileTracking
        ? 'Signed in successfully. Hardware Device ID is blank — Mobile GPS tracking is available.'
        : `Signed in successfully. Vehicle has hardware GPS device (${trimmedDeviceId}) — Mobile tracking is disabled.`,
    });

    response.cookies.set('xl-driver-session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 24 * 60 * 60,
    });

    // Also set a client-readable cookie or header with vehicle ID for convenience
    response.cookies.set('xl-driver-vehicle-id', vehicle.id, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error('[api/driver-app/auth/vehicle-login POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Login failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/driver-app/auth/vehicle-login
 * Returns active vehicle session info and optionally fleet vehicles list.
 */
export async function GET(req: NextRequest) {
  try {
    const driverToken = req.cookies.get('xl-driver-session')?.value;
    const adminToken = req.cookies.get('xl-session')?.value;
    const token = driverToken || adminToken;

    if (!token) {
      return NextResponse.json({ hasSession: false });
    }

    const session = await verifySession(token).catch(() => null);
    if (!session) {
      return NextResponse.json({ hasSession: false });
    }

    // Resolve driver profile if exists
    let driver = await prisma.driver.findFirst({
      where: { id: session.userId, tenantId: session.tenantId, deletedAt: null },
      select: { id: true, name: true, firstName: true, lastName: true, assignedVehicleId: true, email: true },
    });
    if (!driver) {
      const user = await prisma.user.findFirst({
        where: { id: session.userId },
        select: { email: true, firstName: true, lastName: true },
      });
      if (user?.email) {
        driver = await prisma.driver.findFirst({
          where: { email: { equals: user.email, mode: 'insensitive' }, tenantId: session.tenantId, deletedAt: null },
          select: { id: true, name: true, firstName: true, lastName: true, assignedVehicleId: true, email: true },
        });
      }
    }

    const driverName = driver
      ? (driver.name || [driver.firstName, driver.lastName].filter(Boolean).join(' ') || 'Driver')
      : null;

    // Support listing vehicles if ?list=true
    const isListRequested = req.nextUrl.searchParams.get('list') === 'true';
    if (isListRequested) {
      const vehicles = await prisma.vehicle.findMany({
        where: { tenantId: session.tenantId, deletedAt: null },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          year: true,
          deviceId: true,
          odometerReading: true,
          assignedDriverId: true,
        },
        orderBy: [{ vehicleCode: 'asc' }, { licensePlate: 'asc' }],
        take: 150,
      });

      return NextResponse.json({
        hasSession: true,
        userId: session.userId,
        driver: driver ? { id: driver.id, name: driverName, assignedVehicleId: driver.assignedVehicleId } : null,
        vehicles: vehicles.map((v) => {
          const isBlank = (v.deviceId ?? '').trim() === '';
          const isAssignedToMe = Boolean(
            (driver?.id && v.assignedDriverId === driver.id) ||
            (driver?.assignedVehicleId && driver.assignedVehicleId === v.id) ||
            v.assignedDriverId === session.userId
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

    const vehicleId = req.cookies.get('xl-driver-vehicle-id')?.value;

    let vehicle = null;
    if (vehicleId) {
      vehicle = await prisma.vehicle.findFirst({
        where: { id: vehicleId, tenantId: session.tenantId, deletedAt: null },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          year: true,
          deviceId: true,
          odometerReading: true,
        },
      });
    }

    // Fallback 1: vehicle assigned to driver record
    if (!vehicle && driver?.assignedVehicleId) {
      vehicle = await prisma.vehicle.findFirst({
        where: { id: driver.assignedVehicleId, tenantId: session.tenantId, deletedAt: null },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          year: true,
          deviceId: true,
          odometerReading: true,
        },
      });
    }

    // Fallback 2: vehicle having assignedDriverId = driver.id or session.userId
    if (!vehicle) {
      vehicle = await prisma.vehicle.findFirst({
        where: {
          tenantId: session.tenantId,
          deletedAt: null,
          OR: [
            ...(driver?.id ? [{ assignedDriverId: driver.id }] : []),
            { assignedDriverId: session.userId },
          ],
        },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          year: true,
          deviceId: true,
          odometerReading: true,
        },
      });
    }

    if (!vehicle) {
      return NextResponse.json({
        hasSession: true,
        userId: session.userId,
        driver: driver ? { id: driver.id, name: driverName, assignedVehicleId: driver.assignedVehicleId } : null,
        vehicle: null,
      });
    }

    const trimmedDeviceId = (vehicle.deviceId ?? '').trim();
    const isDeviceBlank = trimmedDeviceId === '';

    return NextResponse.json({
      hasSession: true,
      userId: session.userId,
      driver: driver ? { id: driver.id, name: driverName, assignedVehicleId: driver.assignedVehicleId } : null,
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
  } catch (err) {
    return NextResponse.json({ hasSession: false, error: String(err) });
  }
}
