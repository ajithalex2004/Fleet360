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

      // 2. If marked as permanent new stop, update the employee record.
      // StaffMember has no home-address or lat/lng columns — the only
      // real field for "the passenger's permanent stop" is defaultStopName.
      if (markAsPermanentNewStop) {
        await tx.staffMember.update({
          where: { id: staff.id },
          data: {
            defaultStopName: newLocationAddress.trim(),
          },
        });
      }

      // 3. If a specific trip passenger ID was provided or for today's pending trips, update the boarding stop.
      // TripPassenger has no `boardingStop` column — `boardingStopId` holds a
      // stop's id, while the free-text address entered here belongs in the
      // display-name column, `boardingStopName`.
      if (tripPassengerId) {
        await tx.tripPassenger.updateMany({
          where: {
            id: tripPassengerId,
            staffMemberId: staff.id,
          },
          data: {
            boardingStopName: newLocationAddress.trim(),
          },
        });
      }

      // 4. Log audit trail — logAudit takes a single AuditPayload object
      // (see src/lib/audit.ts), not the positional-args form used here before.
      await logAudit({
        tenantId,
        userId: userId || staff.name,
        entityType: 'StaffMember',
        entityId: staff.id,
        entityName: staff.name,
        action: 'UPDATE',
        details: `Pickup stop changed from "${oldStopName ?? 'none'}" to "${newLocationAddress}"` +
          `${markAsPermanentNewStop ? ' (set as permanent default stop)' : ''}. ` +
          `Reason: ${reason || 'Passenger self-service request'}`,
      });

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
