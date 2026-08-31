export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/passenger/waitlist
 *
 * Staff member joins the waitlist for a specific trip. Reuses TripPassenger
 * with status='WAITLISTED' (no schema change — just a new value in the
 * existing status string column). Position is implicit by createdAt order.
 *
 * Body: { staffMemberId, tripId, boardingStopName? }
 *
 * Refuses if:
 *   - Staff already has any TripPassenger row on this trip (CONFIRMED,
 *     WAITLISTED, BOARDED, etc.) — duplicate guard.
 *   - Trip is COMPLETED or CANCELLED.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {

  // Audit risk #13 — tenant scoping. Both the trip and the staff member must
  // be resolved *inside the caller's tenant* so an authenticated user for one
  // tenant can't enroll another tenant's employee onto another tenant's trip.
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  // Built inside the transaction, written after it commits — auditing from
  // inside one either loses the entry (fire-and-forget promise abandoned on
  // return) or holds this transaction's connection while logAudit checks out
  // a second one from the same pool.
  let audit: Parameters<typeof logAudit>[0] | null = null;
  const response = await withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const staffMemberId = String(body?.staffMemberId ?? '').trim();
        const tripId = String(body?.tripId ?? '').trim();
        if (!staffMemberId || !tripId) {
          return NextResponse.json({ error: 'staffMemberId and tripId are required' }, { status: 400 });
        }

        const trip = await tx.tripSchedule.findFirst({
          where: { id: tripId, tenantId },
          select: { id: true, status: true, deletedAt: true },
        });
        if (!trip || trip.deletedAt) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
        if (['COMPLETED', 'CANCELLED'].includes(trip.status ?? '')) {
          return NextResponse.json({ error: `Trip is ${trip.status}` }, { status: 409 });
        }

        const staff = await tx.staffMember.findFirst({
          where: { id: staffMemberId, tenantId },
          select: { id: true, name: true, employeeId: true, department: true, deletedAt: true },
        });
        if (!staff || staff.deletedAt) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });

        // staffMemberId is resolved within the tenant above, but tripId comes
        // from the request body unchecked.
        const existing = await tx.tripPassenger.findFirst({
          where: { tripId, staffMemberId, tenantId },
          select: { id: true, status: true },
        });
        if (existing) {
          return NextResponse.json({
            error: `Already on trip with status ${existing.status ?? 'CONFIRMED'}`,
          }, { status: 409 });
        }

        const passenger = await tx.tripPassenger.create({
          data: {
            tripId,
            tenantId,
            staffMemberId,
            employeeId: staff.employeeId,
            employeeName: staff.name,
            department: staff.department,
            boardingStopName: body?.boardingStopName ?? null,
            status: 'WAITLISTED',
          },
        });

        audit = {
          tenantId,
          userId: req.headers.get('x-user-id') ?? 'system',
          userRole: req.headers.get('x-user-role') ?? 'STAFF',
          entityType: 'TripPassenger',
          entityId: passenger.id,
          action: 'CREATE',
          details: `Waitlist join: ${staff.name} (${staff.employeeId}) → trip ${tripId.slice(0, 8)}`,
        };

        return NextResponse.json({ ok: true, passengerId: passenger.id });
        } catch (err) {
        captureException(err, { context: 'bus-ops.passenger.waitlist' });
        return NextResponse.json({ error: 'Waitlist failed' }, { status: 500 });
      }
  });
  if (audit) await logAudit(audit);
  return response;

}

