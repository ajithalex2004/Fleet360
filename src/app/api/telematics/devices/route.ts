export const dynamic = 'force-dynamic';

/**
 * /api/telematics/devices — List and pair telematics devices to fleet vehicles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const vehicles = await tx.vehicle.findMany({
        where: { tenantId },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          make: true,
          model: true,
          type: true,
          status: true,
          deviceId: true,
          simCardNo: true,
          odometerReading: true,
          fuelLevel: true,
          updatedAt: true,
        },
        orderBy: { vehicleCode: 'asc' },
      });

      // Get latest GPS ping for each vehicle to determine live connection status
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const vehicleIds = vehicles.map((v) => v.id);
      const pings = await tx.busGpsPing.findMany({
        where: {
          tenantId,
          vehicleId: { in: vehicleIds },
        },
        orderBy: { occurredAt: 'desc' },
        distinct: ['vehicleId'],
        select: {
          vehicleId: true,
          latitude: true,
          longitude: true,
          speedKmh: true,
          headingDeg: true,
          occurredAt: true,
        },
      });

      const pingMap = new Map(pings.map((p) => [p.vehicleId, p]));

      const devices = vehicles.map((v) => {
        const ping = pingMap.get(v.id);
        let connectionStatus: 'ONLINE' | 'IDLE' | 'OFFLINE' | 'UNPAIRED' = 'UNPAIRED';

        if (v.deviceId) {
          if (!ping || ping.occurredAt < twoHoursAgo) {
            connectionStatus = 'OFFLINE';
          } else if (ping.occurredAt < tenMinutesAgo || (ping.speedKmh ?? 0) < 1) {
            connectionStatus = 'IDLE';
          } else {
            connectionStatus = 'ONLINE';
          }
        }

        return {
          vehicleId: v.id,
          vehicleCode: v.vehicleCode,
          licensePlate: v.licensePlate,
          make: v.make,
          model: v.model,
          type: v.type,
          deviceId: v.deviceId,
          simCardNo: v.simCardNo,
          odometerKm: v.odometerReading ? Number(v.odometerReading) : 0,
          fuelLevelPercent: v.fuelLevel ?? null,
          connectionStatus,
          lastPing: ping
            ? {
                latitude: ping.latitude,
                longitude: ping.longitude,
                speedKmh: ping.speedKmh ?? 0,
                headingDeg: ping.headingDeg ?? 0,
                occurredAt: ping.occurredAt.toISOString(),
              }
            : null,
        };
      });

      return NextResponse.json({
        totalVehicles: vehicles.length,
        pairedDevices: devices.filter((d) => d.deviceId).length,
        onlineCount: devices.filter((d) => d.connectionStatus === 'ONLINE').length,
        devices,
      });
    } catch (err) {
      console.error('[telematics-devices] GET failed:', err);
      return NextResponse.json({ error: 'Failed to fetch telematics devices' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json().catch(() => null);
    const body = stripTenantOwnershipFields(bodyRaw || {});

    const { vehicleId, deviceId, simCardNo } = body;

    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
    }

    return withTenantRls(prisma, tenantId, async (tx) => {
      // Check if IMEI is already assigned to another vehicle in this tenant
      if (deviceId) {
        const existing = await tx.vehicle.findFirst({
          where: {
            tenantId,
            deviceId,
            id: { not: vehicleId },
          },
          select: { id: true, vehicleCode: true, licensePlate: true },
        });

        if (existing) {
          return NextResponse.json(
            { error: `Device IMEI ${deviceId} is already paired with vehicle ${existing.vehicleCode || existing.licensePlate}` },
            { status: 409 },
          );
        }
      }

      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          deviceId: deviceId || null,
          simCardNo: simCardNo || null,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        vehicleId: updated.id,
        deviceId: updated.deviceId,
        simCardNo: updated.simCardNo,
      });
    });
  } catch (err) {
    console.error('[telematics-devices] POST failed:', err);
    return NextResponse.json({ error: 'Failed to update telematics device pairing' }, { status: 500 });
  }
}
