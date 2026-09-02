export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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
        action, // 'START' | 'END'
        reason = 'Depot Repositioning / Deadhead Run',
        startLocation = 'Current Location',
        destination = 'Depot / Garage',
        vehiclePlate,
        vehicleId,
        driverId,
        driverName = 'Driver',
        odometer,
        notes,
      } = body;

      if (action !== 'START' && action !== 'END') {
        return NextResponse.json(
          { error: "action must be 'START' or 'END'" },
          { status: 400 }
        );
      }

      const now = new Date();
      const subjectId = vehicleId || driverId || userId || 'NRM_RUN';

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
        actor: userId || driverName,
        context: {
          action,
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

      // 2. Log Audit Trail
      await logAudit(
        prisma,
        tenantId,
        'Vehicle',
        subjectId,
        'UPDATE',
        {
          action: action === 'START' ? 'NRM_STARTED' : 'NRM_ENDED',
          reason,
          startLocation,
          destination,
          vehiclePlate,
          driverName,
          odometer,
        },
        userId || driverName
      );

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
