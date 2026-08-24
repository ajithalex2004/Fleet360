/**
 * POST /api/bus-ops/schedules/[id]/expand-roster
 *
 * Re-run the roster→TripPassenger expansion for a schedule that was
 * created BEFORE a roster entry was added, or when ops added a new
 * passenger to the standing roster and needs the change reflected on an
 * already-scheduled trip.
 *
 * Idempotent — see expandRosterToTrip's contract: existing TripPassenger
 * rows for (tripId × staffMemberId) are skipped. Returns the counts so ops
 * can see whether the run actually did anything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { expandRosterToTrip } from '@/lib/bus-ops/expand-roster';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const { id } = await ctx.params;

      const schedule = await tx.tripSchedule.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, routeId: true, departureTime: true, tenantId: true },
      });
      if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      // Extra tenant guard: TripSchedule.tenantId is nullable in schema so we
      // accept a match OR a null value (legacy rows) — never a foreign tenant.
      if (schedule.tenantId && schedule.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      try {
        const result = await expandRosterToTrip(
          tenantId,
          schedule.id,
          schedule.routeId,
          new Date(schedule.departureTime),
        );
        return NextResponse.json({ ok: true, ...result });
        } catch (e) {
        console.error('[schedules/expand-roster.POST]', e);
        return NextResponse.json({ error: 'Failed to expand roster' }, { status: 500 });
      }
  });
}

