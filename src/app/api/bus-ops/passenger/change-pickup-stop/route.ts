export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/bus-ops/passenger/change-pickup-stop
 *
 * Allows a passenger/staff member to request a change in their pickup location
 * and optionally mark it as their permanent default stop point.
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
        staffMemberId,
        employeeId,
        newLocationAddress,
        latitude,
        longitude,
        markAsPermanentNewStop = false,
        tripPassengerId,
        reason,
        effectiveDate,
      } = body;

      if (!newLocationAddress || typeof newLocationAddress !== 'string') {
        return NextResponse.json(
          { error: 'newLocationAddress is required' },
          { status: 400 }
        );
      }

      // 1. Locate the staff member
      const staff = await tx.staffMember.findFirst({
        where: {
          tenantId,
          ...(staffMemberId ? { id: staffMemberId } : {}),
          ...(employeeId ? { employeeId } : {}),
        },
      });

      if (!staff) {
        return NextResponse.json({ error: 'Staff member record not found' }, { status: 404 });
      }

      const oldStopName = staff.defaultStopName;

      // 2. If marked as permanent new stop, update the employee record
      if (markAsPermanentNewStop) {
        await tx.staffMember.update({
          where: { id: staff.id },
          data: {
            defaultStopName: newLocationAddress.trim(),
            homeAddress: newLocationAddress.trim(),
            ...(typeof latitude === 'number' ? { homeLatitude: latitude } : {}),
            ...(typeof longitude === 'number' ? { homeLongitude: longitude } : {}),
          },
        });
      }

      // 3. If a specific trip passenger ID was provided or for today's pending trips, update the boarding stop
      if (tripPassengerId) {
        await tx.tripPassenger.updateMany({
          where: {
            id: tripPassengerId,
            staffMemberId: staff.id,
          },
          data: {
            boardingStop: newLocationAddress.trim(),
          },
        });
      }

      // 4. Log audit trail
      await logAudit(
        prisma,
        tenantId,
        'StaffMember',
        staff.id,
        'UPDATE',
        {
          action: 'PICKUP_STOP_CHANGED',
          oldStopName,
          newLocationAddress,
          markAsPermanentNewStop,
          reason: reason || 'Passenger self-service request',
          requestedBy: userId || staff.name,
        },
        userId || staff.name
      );

      return NextResponse.json({
        ok: true,
        message: markAsPermanentNewStop
          ? `Pickup location updated to "${newLocationAddress}" and set as your permanent new stop point.`
          : `Pickup location updated to "${newLocationAddress}" for your requested trip.`,
        staffMemberId: staff.id,
        defaultStopName: markAsPermanentNewStop ? newLocationAddress : oldStopName,
        markAsPermanentNewStop,
      });
    } catch (err) {
      console.error('[api/bus-ops/passenger/change-pickup-stop POST]', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to update pickup stop' },
        { status: 500 }
      );
    }
  });
}
