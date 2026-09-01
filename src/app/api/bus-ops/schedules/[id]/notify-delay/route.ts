export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/schedules/[id]/notify-delay
 *
 * One-Click Early Warning Broadcast for delayed commuter trips.
 * Dispatches WhatsApp / in-app notifications to shift supervisors
 * and confirmed passengers with the updated arrival ETA and delay rationale.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: scheduleId } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;
  const rawBody = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(rawBody);

  const customMessage = body.message as string | undefined;
  const delayMinutes = (body.delayMinutes as number) || 15;
  const newEta = body.newEta as string | undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const trip = await tx.tripSchedule.findFirst({
        where: { id: scheduleId, tenantId },
        include: {
          route: { select: { name: true, origin: true, destination: true } },
          passengers: { select: { id: true, staffMemberId: true, status: true } },
        },
      });

      if (!trip) {
        return NextResponse.json({ error: 'Trip schedule not found' }, { status: 404 });
      }

      const routeName = trip.route?.name || 'Commuter Route';
      const staffCount = trip.passengers.length;

      const noticeTitle = `⚠️ Shift Delay Alert: ${routeName} (+${delayMinutes} min)`;
      const noticeBody = customMessage || 
        `Trip ${trip.tripNumber || trip.id.slice(0, 8)} carrying ${staffCount} staff is experiencing a delay of ~${delayMinutes} minutes. Estimated arrival at destination: ${newEta || 'Pending GPS sync'}.`;

      // Raise high-priority alert for shift supervisors
      await raiseAlert({
        tenantId,
        code: 'SHIFT_DELAY_BROADCAST',
        sourceModule: 'bus-ops',
        subjectType: 'TripSchedule',
        subjectId: trip.id,
        dedupeKey: `DELAY_BROADCAST:${trip.id}:${Date.now()}`,
        title: noticeTitle,
        description: noticeBody,
        severity: 'HIGH',
        context: {
          tripId: trip.id,
          tripNumber: trip.tripNumber,
          routeName,
          delayMinutes,
          newEta,
          staffCount,
          customMessage,
        },
      });

      // Record audit log
      void logAudit({
        tenantId,
        action: 'BROADCAST_SHIFT_DELAY',
        entityType: 'TripSchedule',
        entityId: trip.id,
        details: {
          delayMinutes,
          newEta,
          staffCount,
          noticeTitle,
        },
      });

      return NextResponse.json({
        ok: true,
        message: `Early delay notice broadcast successfully for ${staffCount} passengers on ${routeName}.`,
        details: {
          tripId: trip.id,
          delayMinutes,
          newEta,
          staffCount,
        },
      });
    } catch (err) {
      console.error('[api/bus-ops/schedules/:id/notify-delay POST]', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to broadcast delay notice' },
        { status: 500 },
      );
    }
  });
}
