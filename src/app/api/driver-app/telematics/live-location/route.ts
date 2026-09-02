export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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

      // 1. Update Vehicle if linked
      if (vehicleId) {
        await tx.vehicle
          .update({
            where: { id: vehicleId, tenantId },
            data: {
              currentLatitude: lat,
              currentLongitude: lng,
              updatedAt: new Date(),
            },
          })
          .catch(() => {});
      } else if (vehiclePlate) {
        await tx.vehicle
          .updateMany({
            where: { licensePlate: vehiclePlate, tenantId, deletedAt: null },
            data: {
              currentLatitude: lat,
              currentLongitude: lng,
              updatedAt: new Date(),
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
