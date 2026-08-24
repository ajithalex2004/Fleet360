/**
 * src/app/api/driver-app/trips/[id]/end/route.ts
 *
 * POST /api/driver-app/trips/[id]/end
 *
 * Driver taps End. Only the driver assigned to the trip can end
 * it. The endpoint mirrors `/start`:
 *   1. Loads the trip (tenant + driver_id check)
 *   2. Evaluates the state machine (must be IN_PROGRESS or COMPLETED)
 *   3. Computes duration_minutes = actual_arrival - actual_departure
 *   4. In a single transaction:
 *      - Updates trip_schedules (status, actual_arrival_at,
 *        ended_by_driver_id, end_location, duration_minutes)
 *      - Inserts a row into trip_state_transitions
 *   5. Returns the updated trip with the timing summary.
 *
 * Idempotent: tapping End while the trip is already COMPLETED
 * is a 200 no-op.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { evaluateTransition, type TripStatus } from '@/lib/trip-state';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const BodySchema = z.object({
  at: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().nonnegative().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      const jsonRaw = await req.json().catch(() => ({}));
    const json = jsonRaw ? stripTenantOwnershipFields(jsonRaw) : null;
      const parsed = BodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'validation failed', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const body = parsed.data;

      // 1) Load the trip + its current actual_departure_at
      const trips = await tx.$queryRaw<
        Array<{
          id: string;
          status: TripStatus;
          departure_time: Date;
          arrival_time: Date;
          actual_departure_at: Date | null;
          driver_id: string;
        }>
      >`
        SELECT id, status, departure_time, arrival_time, actual_departure_at, driver_id
        FROM trip_schedules
        WHERE id = ${params.id}
          AND tenant_id = ${ctx.tenantId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (trips.length === 0) {
        return NextResponse.json({ error: 'trip not found' }, { status: 404 });
      }
      const trip = trips[0];

      if (trip.driver_id !== ctx.userId) {
        return NextResponse.json(
          { error: 'forbidden: this trip is assigned to a different driver' },
          { status: 403 },
        );
      }

      const decision = evaluateTransition({
        currentStatus: trip.status,
        transition: 'END',
      });
      if (!decision.allowed) {
        return NextResponse.json(
          { error: 'invalid state transition', reason: decision.reason, currentStatus: trip.status },
          { status: 409 },
        );
      }

      const now = body.at ?? new Date().toISOString();
      const location = body.lat != null && body.lng != null
        ? { lat: body.lat, lng: body.lng, accuracyM: body.accuracyM ?? null }
        : null;

      // Duration: actual_arrival - actual_departure (in minutes, rounded).
      // If the trip was already in progress, use the original
      // actual_departure_at. If it has no actual_departure_at (shouldn't
      // happen but be defensive), fall back to scheduled departure.
      const durationMinutes = (() => {
        const startIso = trip.actual_departure_at?.toISOString() ?? trip.departure_time.toISOString();
        const ms = new Date(now).getTime() - new Date(startIso).getTime();
        return Math.max(0, Math.round(ms / 60_000));
      })();

      await tx.$transaction(async (tx) => {
        if (trip.status === 'IN_PROGRESS') {
          await tx.$executeRaw`
            UPDATE trip_schedules
            SET status = 'COMPLETED',
                actual_arrival_at = ${now}::timestamptz,
                ended_by_driver_id = ${ctx.userId}::uuid,
                end_location = ${location ? JSON.stringify(location) : null}::jsonb,
                duration_minutes = ${durationMinutes},
                updated_at = NOW()
            WHERE id = ${params.id}
          `;
          await tx.$executeRaw`
            INSERT INTO trip_state_transitions (
              id, tenant_id, trip_id, driver_id, transition, at, location, source
            ) VALUES (
              gen_random_uuid(), ${ctx.tenantId}::uuid, ${params.id}, ${ctx.userId}::uuid,
              'COMPLETED', ${now}::timestamptz, ${location ? JSON.stringify(location) : null}::jsonb,
              'DRIVER_APP'
            )
          `;
        }
        // If status was already COMPLETED, idempotent re-tap. Don't
        // overwrite actual_arrival_at — the first one is the source of
        // truth.
      });

      return NextResponse.json({
        ok: true,
        tripId: params.id,
        status: decision.nextStatus,
        actualArrivalAt: now,
        scheduledArrivalAt: trip.arrival_time.toISOString(),
        durationMinutes,
        location,
        idempotent: trip.status === 'COMPLETED',
      });
  });
}

