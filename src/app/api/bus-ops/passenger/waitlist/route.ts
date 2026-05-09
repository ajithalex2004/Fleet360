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
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const staffMemberId = String(body?.staffMemberId ?? '').trim();
    const tripId = String(body?.tripId ?? '').trim();
    if (!staffMemberId || !tripId) {
      return NextResponse.json({ error: 'staffMemberId and tripId are required' }, { status: 400 });
    }

    const trip = await prisma.tripSchedule.findUnique({
      where: { id: tripId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!trip || trip.deletedAt) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    if (['COMPLETED', 'CANCELLED'].includes(trip.status ?? '')) {
      return NextResponse.json({ error: `Trip is ${trip.status}` }, { status: 409 });
    }

    const staff = await prisma.staffMember.findUnique({
      where: { id: staffMemberId },
      select: { id: true, name: true, employeeId: true, department: true, deletedAt: true },
    });
    if (!staff || staff.deletedAt) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });

    const existing = await prisma.tripPassenger.findFirst({
      where: { tripId, staffMemberId },
      select: { id: true, status: true },
    });
    if (existing) {
      return NextResponse.json({
        error: `Already on trip with status ${existing.status ?? 'CONFIRMED'}`,
      }, { status: 409 });
    }

    const passenger = await prisma.tripPassenger.create({
      data: {
        tripId,
        staffMemberId,
        employeeId: staff.employeeId,
        employeeName: staff.name,
        department: staff.department,
        boardingStopName: body?.boardingStopName ?? null,
        status: 'WAITLISTED',
      },
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'TripPassenger',
      entityId: passenger.id,
      action: 'CREATE',
      details: `Waitlist join: ${staff.name} (${staff.employeeId}) → trip ${tripId.slice(0, 8)}`,
    });

    return NextResponse.json({ ok: true, passengerId: passenger.id });
  } catch (err) {
    captureException(err, { context: 'bus-ops.passenger.waitlist' });
    return NextResponse.json({ error: 'Waitlist failed' }, { status: 500 });
  }
}
