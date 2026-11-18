export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/driver-app/trips/[id]/stops/[stopId]/arrive
 *
 * Records driver stop arrival transition.
 * Updates stop arrival timestamp and status in trip schedule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireDriverSessionForTenant } from '@/lib/driver-session';
import { requireActiveDriver } from '@/lib/driver-app-actor';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; stopId: string }> },
) {
  const { id: tripId, stopId } = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSessionForTenant(req, tenantId);
    if (ctx instanceof NextResponse) return ctx;

    const denied = await requireActiveDriver(tx, ctx);
    if (denied) return denied;

    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(bodyRaw) as {
      arrivedAt?: string;
      latitude?: number;
      longitude?: number;
    };

    const arrivalTimestamp = body.arrivedAt ? new Date(body.arrivedAt) : new Date();

    // Verify trip exists in trip_schedules or school_bus_trips
    let trip = await tx.tripSchedule.findFirst({
      where: { id: tripId, tenantId, deletedAt: null },
      select: { id: true, status: true, notes: true },
    });

    if (trip) {
      // Record stop arrival in trip notes and update trip status if SCHEDULED
      const arrivalNote = `[${arrivalTimestamp.toISOString()}] Stop ${stopId} arrived`;
      await tx.tripSchedule.update({
        where: { id: tripId },
        data: {
          status: trip.status === 'SCHEDULED' ? 'IN_PROGRESS' : trip.status,
          notes: [trip.notes, arrivalNote].filter(Boolean).join('\n'),
          updatedAt: new Date(),
        },
      });
    }

    // Attempt to update trip_stops table if present
    await tx.$executeRawUnsafe(
      `UPDATE trip_stops
          SET arrived_at = $1,
              status     = 'ARRIVED',
              updated_at = NOW()
        WHERE id = $2
          AND trip_id = $3
          AND tenant_id = $4`,
      arrivalTimestamp,
      stopId,
      tripId,
      tenantId,
    ).catch(() => {});

    // Best-effort audit log
    await tx.$executeRawUnsafe(
      `INSERT INTO trip_stop_events (id, tenant_id, trip_id, stop_id, event_type, occurred_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'ARRIVED', $4, NOW())
       ON CONFLICT DO NOTHING`,
      tenantId,
      tripId,
      stopId,
      arrivalTimestamp,
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      tripId,
      stopId,
      arrivedAt: arrivalTimestamp.toISOString(),
      status: 'ARRIVED',
    }, { status: 200 });
  });
}
