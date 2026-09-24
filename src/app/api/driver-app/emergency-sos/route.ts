export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireDriverActor } from '@/lib/driver-app-actor';
import { requireDriverSessionForTenant } from '@/lib/driver-session';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/driver-app/emergency-sos
 *
 * Dispatches a CRITICAL severity SOS / Panic alert to the 24/7 Operations Control Room
 *
 * Only an active driver of the session's tenant may raise it (see
 * src/lib/driver-app-actor.ts). The driver, name and vehicle on the alert
 * come from server-side records: the driver row, their IN_PROGRESS trip,
 * else their ACTIVE shift. Identifiers in the body are ignored rather than
 * rejected, so an SOS is never blocked by a stale client value.
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
        emergencyType = 'GENERAL_EMERGENCY',
        notes,
      } = body;

      const vehicle = actor.activeTrip?.vehicle ?? actor.shiftVehicle;
      const vehiclePlate = vehicle?.plate ?? null;
      const driverName = actor.driverName;
      const userId = actor.driverId;
      const now = new Date();
      const subjectType = vehicle ? 'Vehicle' : 'Driver';
      const subjectId = vehicle?.id ?? actor.driverId;

      // 1. Raise CRITICAL Alert into Outbox
      await raiseAlert({
        tenantId,
        code: 'SOS_PANIC_TRIGGERED',
        sourceModule: 'driver-app',
        subjectType,
        subjectId,
        title: `🚨 DRIVER EMERGENCY SOS — ${vehiclePlate || 'Vehicle'}`,
        description: `Driver ${driverName} triggered emergency panic switch. Coords: (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}). Speed: ${Number(speedKmh).toFixed(0)} km/h. Type: ${emergencyType}. Notes: ${notes || 'Immediate assistance requested'}.`,
        severity: 'CRITICAL',
        dedupeKey: `SOS_PANIC:${subjectId}:${Math.floor(now.getTime() / 60000)}`,
        actor: userId,
        context: {
          lat,
          lng,
          speedKmh,
          driverId: actor.driverId,
          vehicleId: vehicle?.id ?? null,
          tripId: actor.activeTrip?.id ?? null,
          vehiclePlate,
          driverName,
          emergencyType,
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
        entityType: subjectType,
        entityId: subjectId,
        action: 'DRIVER_SOS_TRIGGERED',
        userId,
        userName: driverName,
        details: `Driver ${driverName} triggered emergency panic switch (${emergencyType}). Coords: (${lat}, ${lng}). Speed: ${speedKmh} km/h. Vehicle: ${vehiclePlate || 'unknown'}.`,
      });

      return NextResponse.json({
        ok: true,
        message: '🚨 Emergency SOS alert dispatched to Operations Control Tower. Standby for contact.',
        timestamp: now.toISOString(),
      });
    } catch (err) {
      console.error('[api/driver-app/emergency-sos POST]', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to dispatch SOS alert' },
        { status: 500 }
      );
    }
  });
}
