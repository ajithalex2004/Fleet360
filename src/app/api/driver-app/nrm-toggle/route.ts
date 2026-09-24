export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { rejectForeignIdentifiers, requireDriverActor } from '@/lib/driver-app-actor';
import { requireDriverSessionForTenant } from '@/lib/driver-session';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/driver-app/nrm-toggle
 *
 * Allows drivers to toggle Non-Revenue Movement (NRM / Deadhead Run)
 * with an operational reason and dispatches a notification to the Operations Team.
 *
 * Only an active driver of the session's tenant may toggle it, and only for
 * their own vehicle: the one on their IN_PROGRESS trip, else their ACTIVE
 * shift (src/lib/driver-app-actor.ts). 409 when they have neither; 403 when
 * the body names a different driver or vehicle.
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
        action, // 'START' | 'END'
        reason = 'Depot Repositioning / Deadhead Run',
        startLocation = 'Current Location',
        destination = 'Depot / Garage',
        odometer,
        notes,
      } = body;

      if (action !== 'START' && action !== 'END') {
        return NextResponse.json(
          { error: "action must be 'START' or 'END'" },
          { status: 400 }
        );
      }

      const vehicle = actor.activeTrip?.vehicle ?? actor.shiftVehicle;
      const foreign = rejectForeignIdentifiers(actor, body, vehicle);
      if (foreign) return foreign;
      if (!vehicle) {
        return NextResponse.json(
          { error: 'No vehicle is assigned to your current trip or shift' },
          { status: 409 },
        );
      }

      const vehiclePlate = vehicle.plate;
      const driverName = actor.driverName;
      const userId = actor.driverId;
      const now = new Date();
      const subjectId = vehicle.id;

      // 1. Raise Operational Notification / Alert to Control Tower
      await raiseAlert({
        tenantId,
        code: action === 'START' ? 'DRIVER_NRM_STARTED' : 'DRIVER_NRM_ENDED',
        sourceModule: 'driver-app',
        subjectType: 'Vehicle',
        subjectId,
        title:
          action === 'START'
            ? `🚚 NRM Started: ${vehiclePlate || 'Vehicle'} (${reason})`
            : `🏁 NRM Completed: ${vehiclePlate || 'Vehicle'}`,
        description:
          action === 'START'
            ? `Driver ${driverName} initiated Non-Revenue Movement (${reason}). Route: ${startLocation} → ${destination}.`
            : `Driver ${driverName} completed Non-Revenue Movement run for vehicle ${vehiclePlate || 'Vehicle'}.`,
        severity: 'LOW',
        actor: userId,
        context: {
          action,
          driverId: actor.driverId,
          vehicleId: vehicle.id,
          tripId: actor.activeTrip?.id ?? null,
          reason,
          startLocation,
          destination,
          vehiclePlate,
          driverName,
          odometer,
          notes,
          timestamp: now.toISOString(),
        },
      });

      // 2. Log Audit Trail. logAudit takes a single AuditPayload object, not
      // positional args — this call was built against an old signature, so
      // at runtime `prisma` (a PrismaClient) would have been passed in as
      // the whole payload and the intended fields silently dropped.
      await logAudit({
        tenantId,
        entityType: 'Vehicle',
        entityId: subjectId,
        action: action === 'START' ? 'NRM_STARTED' : 'NRM_ENDED',
        userId,
        userName: driverName,
        details: `Driver ${driverName} ${action === 'START' ? 'started' : 'ended'} Non-Revenue Movement (${reason}). Route: ${startLocation} → ${destination}. Vehicle: ${vehiclePlate || 'unknown'}.${odometer ? ` Odometer: ${odometer}.` : ''}`,
      });

      return NextResponse.json({
        ok: true,
        action,
        message:
          action === 'START'
            ? `Non-Revenue Movement started (${reason}). Operations team notified.`
            : 'Non-Revenue Movement completed. Vehicle returned to standard operations.',
        timestamp: now.toISOString(),
      });
    } catch (err) {
      console.error('[api/driver-app/nrm-toggle POST]', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to toggle NRM state' },
        { status: 500 }
      );
    }
  });
}
