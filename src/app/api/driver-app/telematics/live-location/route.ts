export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireDriverSessionForTenant } from '@/lib/driver-session';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * POST /api/driver-app/telematics/live-location
 *
 * Receives periodic high-accuracy GPS telemetry pings from the driver app
 * and updates vehicle position for live dispatch visibility.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const driver = await requireDriverSessionForTenant(req, tenantId);
  if (driver instanceof NextResponse) return driver;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rawBody = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(rawBody);

      const {
        lat,
        lng,
        speedKmh = 0,
        heading = 0,
        accuracy = 0,
        vehicleId,
        vehiclePlate,
        driverId,
      } = body;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return NextResponse.json(
          { error: 'Valid lat and lng numbers are required' },
          { status: 400 }
        );
      }

      // Vehicle has no currentLatitude/currentLongitude columns — those
      // never existed in the schema, so this used to silently no-op every
      // single ping (the .catch(() => {}) swallowed the Prisma validation
      // error). Live position is tracked in BusGpsPing instead — the same
      // table the telematics gateway and geofence evaluator read from —
      // keyed by vehicleId, so resolve vehiclePlate → vehicleId first when
      // the caller didn't supply the id directly.
      let resolvedVehicleId = vehicleId as string | undefined;
      if (!resolvedVehicleId && vehiclePlate) {
        const v = await tx.vehicle.findFirst({
          where: { licensePlate: vehiclePlate, tenantId, deletedAt: null },
          select: { id: true },
        });
        resolvedVehicleId = v?.id;
      }

      if (resolvedVehicleId) {
        await tx.busGpsPing
          .create({
            data: {
              tenantId,
              vehicleId: resolvedVehicleId,
              latitude: lat,
              longitude: lng,
              speedKmh,
              headingDeg: heading,
              accuracyM: accuracy,
              occurredAt: new Date(),
              source: 'DRIVER_APP',
            },
          })
          .catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        lat,
        lng,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[api/driver-app/telematics/live-location POST]', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to process location ping' },
        { status: 500 }
      );
    }
  });
}
