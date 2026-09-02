export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/driver-app/emergency-sos
 *
 * Dispatches a CRITICAL severity SOS / Panic alert to the 24/7 Operations Control Room
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rawBody = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(rawBody);

      const {
        lat,
        lng,
        speedKmh = 0,
        vehiclePlate,
        vehicleId,
        driverId,
        driverName = 'Driver',
        emergencyType = 'GENERAL_EMERGENCY',
        notes,
      } = body;

      const now = new Date();
      const subjectId = vehicleId || driverId || userId || 'EMERGENCY_SOS';

      // 1. Raise CRITICAL Alert into Outbox
      await raiseAlert({
        tenantId,
        code: 'SOS_PANIC_TRIGGERED',
        sourceModule: 'driver-app',
        subjectType: 'Vehicle',
        subjectId,
        title: `🚨 DRIVER EMERGENCY SOS — ${vehiclePlate || 'Vehicle'}`,
        description: `Driver ${driverName} triggered emergency panic switch. Coords: (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}). Speed: ${Number(speedKmh).toFixed(0)} km/h. Type: ${emergencyType}. Notes: ${notes || 'Immediate assistance requested'}.`,
        severity: 'CRITICAL',
        dedupeKey: `SOS_PANIC:${subjectId}:${Math.floor(now.getTime() / 60000)}`,
        actor: userId || driverName,
        context: {
          lat,
          lng,
          speedKmh,
          vehiclePlate,
          driverName,
          emergencyType,
          notes,
          timestamp: now.toISOString(),
        },
      });

      // 2. Log Audit Trail
      await logAudit(
        prisma,
        tenantId,
        'Vehicle',
        subjectId,
        'CREATE',
        {
          action: 'DRIVER_SOS_TRIGGERED',
          lat,
          lng,
          speedKmh,
          vehiclePlate,
          driverName,
          emergencyType,
        },
        userId || driverName
      );

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
