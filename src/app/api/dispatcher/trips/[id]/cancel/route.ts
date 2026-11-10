export const dynamic = 'force-dynamic';

/**
 * src/app/api/dispatcher/trips/[id]/cancel/route.ts
 *
 * POST /api/dispatcher/trips/[id]/cancel
 *
 * The dispatcher's kill switch. Cancels a trip in any non-terminal
 * state (SCHEDULED or IN_PROGRESS) — leaves COMPLETED trips alone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/tenant-session';
import { withTenantRls } from '@/lib/rls';
import { evaluateTransition, type TripStatus } from '@/lib/trip-state';
import { isTripInFlight } from '@/lib/trip-status';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const BodySchema = z.object({
  reason: z.string().max(500).optional(),
  at: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const ALLOWED_ROLES = new Set(['DISPATCHER', 'TENANT_ADMIN', 'SUPER_ADMIN']);

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // 1) Auth — read + verify the session cookie (or explicit header role fallback)
  const driverToken = req.cookies.get('xl-driver-session')?.value;
  const adminToken = req.cookies.get('xl-session')?.value;
  const token = driverToken || adminToken;
  const headerRole = req.headers.get('x-user-role');

  if (!token && !headerRole) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const session = token
    ? await verifySession(token).catch(() => null)
    : {
        userId: req.headers.get('x-user-id') ?? '00000000-0000-0000-0000-000000000000',
        tenantId,
        role: headerRole ?? '',
        plan: 'ENTERPRISE',
      };

  if (!session) {
    return NextResponse.json({ error: 'invalid session' }, { status: 401 });
  }

  // 2) Role check — drivers cannot use the dispatcher endpoint
  if (!ALLOWED_ROLES.has(session.role ?? '')) {
    return NextResponse.json(
      { error: 'forbidden: only dispatcher / tenant admin can cancel trips' },
      { status: 403 },
    );
  }

  let input: z.infer<typeof BodySchema> = {};
  try {
    const text = await req.text();
    const trimmed = text.trim();
    if (trimmed.length > 0 && trimmed !== 'null') {
      const json = JSON.parse(text);
      const parsed = BodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'validation failed', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      input = parsed.data;
    }
  } catch {
    // Malformed body — fall back to empty
  }

  const effectiveTenantId = session.tenantId || tenantId;

  // 3) Load the trip inside RLS (with fallback if actual_departure_at is not yet migrated)
  type TripRow = {
    id: string;
    status: TripStatus;
    driver_id: string;
    actual_departure_at: Date | null;
    tenant_id: string;
  };

  const trips = await withTenantRls(prisma, effectiveTenantId, async (tx) => {
    try {
      return await tx.$queryRaw<TripRow[]>`
        SELECT id, status, driver_id, actual_departure_at, tenant_id
        FROM trip_schedules
        WHERE id = ${params.id}
          AND deleted_at IS NULL
        LIMIT 1
      `;
    } catch {
      return await tx.$queryRaw<TripRow[]>`
        SELECT id, status, driver_id, departure_time AS actual_departure_at, tenant_id::text AS tenant_id
        FROM trip_schedules
        WHERE id::text = ${params.id}
          AND deleted_at IS NULL
        LIMIT 1
      `;
    }
  });

  if (trips.length === 0) {
    return NextResponse.json({ error: 'trip not found' }, { status: 404 });
  }
  const trip = trips[0];

  // Tenant guard — the trip must belong to the dispatcher's tenant
  if (trip.tenant_id !== effectiveTenantId) {
    return NextResponse.json(
      { error: 'forbidden: trip is in a different tenant' },
      { status: 403 },
    );
  }

  // 4) State machine + business rules
  const decision = evaluateTransition({
    currentStatus: trip.status,
    transition: 'CANCEL',
  });
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'cannot cancel', reason: decision.reason, currentStatus: trip.status },
      { status: 409 },
    );
  }

  // Idempotent: already cancelled → 200 with current state
  if (trip.status === 'CANCELLED') {
    return NextResponse.json({
      ok: true,
      tripId: trip.id,
      status: 'CANCELLED',
      idempotent: true,
    });
  }

  // Reject COMPLETED — the driver already finished, we can't "uncomplete"
  if (trip.status === 'COMPLETED') {
    return NextResponse.json(
      {
        error: 'cannot cancel a completed trip',
        reason: 'The driver already completed this trip. The audit log is the source of truth.',
        currentStatus: 'COMPLETED',
      },
      { status: 409 },
    );
  }

  const now = input.at ?? new Date().toISOString();
  const location = input.lat != null && input.lng != null
    ? { lat: input.lat, lng: input.lng }
    : null;
  const notes = input.reason
    ? `Cancelled by dispatcher: ${input.reason}`
    : 'Cancelled by dispatcher';

  const durationMin = (() => {
    if (!isTripInFlight(trip.status) || !trip.actual_departure_at) return null;
    return Math.max(0, Math.round(
      (new Date(now).getTime() - new Date(trip.actual_departure_at).getTime()) / 60_000,
    ));
  })();

  // 5) Persist — wrap in a single transaction (UPDATE + audit log)
  await withTenantRls(prisma, effectiveTenantId, async (tx) => {
    try {
      await tx.$executeRaw`
        UPDATE trip_schedules
        SET status = 'CANCELLED',
            actual_arrival_at = ${now}::timestamptz,
            duration_minutes = ${durationMin},
            end_location = ${location ? JSON.stringify(location) : null}::jsonb,
            updated_at = NOW()
        WHERE id = ${trip.id} AND tenant_id::text = ${effectiveTenantId}
      `;
    } catch {
      await tx.$executeRaw`
        UPDATE trip_schedules
        SET status = 'CANCELLED',
            arrival_time = ${now}::timestamptz,
            updated_at = NOW()
        WHERE id::text = ${trip.id} AND tenant_id::text = ${effectiveTenantId}
      `;
    }

    await tx.$executeRaw`
      INSERT INTO trip_state_transitions (
        id, tenant_id, trip_id, driver_id, transition, at, location, source, notes
      ) VALUES (
        gen_random_uuid(), ${trip.tenant_id}::uuid, ${trip.id}, ${trip.driver_id}::text::uuid,
        'CANCELLED', ${now}::timestamptz,
        ${location ? JSON.stringify(location) : null}::jsonb,
        'DISPATCHER', ${notes}
      )
    `.catch(() => {});
  });

  return NextResponse.json({
    ok: true,
    tripId: trip.id,
    status: 'CANCELLED',
    cancelledAt: now,
    durationMinutes: durationMin,
    idempotent: false,
    notes,
  });
}
