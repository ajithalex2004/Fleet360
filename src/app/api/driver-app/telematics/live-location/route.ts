export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { rejectForeignIdentifiers, requireDriverActor } from '@/lib/driver-app-actor';
import { requireDriverSessionForTenant } from '@/lib/driver-session';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * POST /api/driver-app/telematics/live-location
 *
 * Receives periodic high-accuracy GPS telemetry pings from the driver app
 * and updates vehicle position for live dispatch visibility.
 *
 * Only an active driver of the session's tenant may send pings, and only
 * for the vehicle of their own IN_PROGRESS trip (src/lib/driver-app-actor.ts).
 * With no active trip the ping is acknowledged but not stored. A body
 * driverId/vehicleId naming anyone or anything else is rejected with 403.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  // Verify the credential before opening a transaction, so requests without
  // a valid driver session never touch the database.
  const session = await requireDriverSessionForTenant(req, tenantId);
  if (session instanceof NextResponse) return session;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const actor = await requireDriverActor(tx, session);
    if (actor instanceof NextResponse) return actor;

    try {
      const rawBody = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(rawBody);

      const {
        lat,
        lng,
        speedKmh = 0,
        heading = 0,
        accuracy = 0,
      } = body;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return NextResponse.json(
          { error: 'Valid lat and lng numbers are required' },
          { status: 400 }
        );
      }

      const vehicle = actor.activeTrip?.vehicle ?? null;
      const foreign = rejectForeignIdentifiers(actor, body, vehicle);
      if (foreign) return foreign;

      // Live position is tracked in BusGpsPing, the table the telematics
      // gateway and geofence evaluator read. The vehicle is the one on the
      // driver's own IN_PROGRESS trip; the client does not choose it.
      if (!vehicle) {
        return NextResponse.json({
          ok: true,
          recorded: false,
          reason: 'No trip in progress for this driver; location not recorded.',
          timestamp: new Date().toISOString(),
        });
      }

      await tx.busGpsPing.create({
        data: {
          tenantId,
          vehicleId: vehicle.id,
          latitude: lat,
          longitude: lng,
          speedKmh,
          headingDeg: heading,
          accuracyM: accuracy,
          occurredAt: new Date(),
          source: 'DRIVER_APP',
        },
      });

      return NextResponse.json({
        ok: true,
        recorded: true,
        vehicleId: vehicle.id,
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
