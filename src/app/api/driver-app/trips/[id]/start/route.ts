/**
 * src/app/api/driver-app/trips/[id]/start/route.ts
 *
 * POST /api/driver-app/trips/[id]/start
 *
 * Driver taps Start. Only the driver assigned to the trip can start
 * it. The endpoint:
 *   1. Loads the trip (tenant + driver_id check)
 *   2. Evaluates the state machine (must be SCHEDULED or IN_PROGRESS)
 *   3. Computes late_minutes = actual - scheduled (rounded)
 *   4. In a single transaction:
 *      - Updates trip_schedules (status, actual_departure_at,
 *        started_by_driver_id, start_location, late_minutes)
 *      - Inserts a row into trip_state_transitions (the audit log)
 *   5. Returns the updated trip.
 *
 * Idempotent: tapping Start while the trip is already IN_PROGRESS
 * is a 200 no-op (returns the existing actual_departure_at).
 *
 * Body shape (all optional except at least one of `at` or `now`):
 *   { at?: string (ISO), lat?: number, lng?: number, accuracyM?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { evaluateTransition, classifyTiming, type TripStatus } from '@/lib/trip-state';

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

      // 1) Load the trip, scoped to the tenant + this driver.
      const trips = await tx.$queryRaw<
        Array<{
          id: string;
          status: TripStatus;
          departure_time: Date;
          driver_id: string;
        }>
      >`
        SELECT id, status, departure_time, driver_id
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

      // Driver-only enforcement: the trip's driver_id must match the
      // session user. trip_schedules.driver_id is text but session
      // userId is uuid — cast both for the comparison.
      if (trip.driver_id !== ctx.userId) {
        return NextResponse.json(
          { error: 'forbidden: this trip is assigned to a different driver' },
          { status: 403 },
        );
      }

      // 2) State machine
      const decision = evaluateTransition({
        currentStatus: trip.status,
        transition: 'START',
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

      // 3) Late / early / on-time
      const timing = classifyTiming(trip.departure_time.toISOString(), now);
      const lateMinutes = timing.deltaMinutes > 0 ? timing.deltaMinutes : null;

      // 4) Persist in a single transaction
      await tx.$transaction(async (tx) => {
        if (trip.status === 'SCHEDULED') {
          await tx.$executeRaw`
            UPDATE trip_schedules
            SET status = 'IN_PROGRESS',
                actual_departure_at = ${now}::timestamptz,
                started_by_driver_id = ${ctx.userId}::uuid,
                start_location = ${location ? JSON.stringify(location) : null}::jsonb,
                late_minutes = ${lateMinutes},
                updated_at = NOW()
            WHERE id = ${params.id}
          `;
          await tx.$executeRaw`
            INSERT INTO trip_state_transitions (
              id, tenant_id, trip_id, driver_id, transition, at, location, source
            ) VALUES (
              gen_random_uuid(), ${ctx.tenantId}::uuid, ${params.id}, ${ctx.userId}::uuid,
              'STARTED', ${now}::timestamptz, ${location ? JSON.stringify(location) : null}::jsonb,
              'DRIVER_APP'
            )
          `;
        }
        // If status was already IN_PROGRESS, this is the idempotent
        // re-tap. Don't write a new transition or overwrite the original
        // actual_departure_at — the first one is the source of truth.
      });

      return NextResponse.json({
        ok: true,
        tripId: params.id,
        status: decision.nextStatus,
        actualDepartureAt: now,
        scheduledDepartureAt: trip.departure_time.toISOString(),
        timing: { type: timing.timing, label: timing.label, deltaMinutes: timing.deltaMinutes },
        location,
        idempotent: trip.status === 'IN_PROGRESS',
      });
  });
}

