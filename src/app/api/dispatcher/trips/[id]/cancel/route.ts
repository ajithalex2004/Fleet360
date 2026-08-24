/**
 * src/app/api/dispatcher/trips/[id]/cancel/route.ts
 *
 * POST /api/dispatcher/trips/[id]/cancel
 *
 * The dispatcher's kill switch. Cancels a trip in any non-terminal
 * state (SCHEDULED or IN_PROGRESS) — leaves COMPLETED trips alone
 * (you can't "uncomplete" a trip; the driver did the work, audit
 * log proves it).
 *
 * Body (all optional):
 *   { reason?: string, at?: ISO timestamp, lat?: number, lng?: number }
 *
 * Auth: dispatcher or tenant admin (NOT a driver — drivers have
 * their own "End" flow which is the *successful* end, not a cancel).
 * The session role check rejects drivers with 403.
 *
 * Effect:
 *   - status           → 'CANCELLED'
 *   - actual_arrival_at → NOW() (the cancel moment) — for IN_PROGRESS,
 *                         this is also used for duration_minutes
 *   - ended_by_driver_id → NULL (dispatcher cancelled, not driver)
 *   - end_location     → {lat, lng} from body, if provided
 *   - audit log row    → source='DISPATCHER', transition='CANCELLED',
 *                         notes=reason || "Cancelled by dispatcher"
 *
 * The audit log is the source of truth for "who cancelled this
 * trip and why" — the dispatcher cancel row is the only place
 * that explains a trip ending without driver End.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/tenant-session';
import { withTenantRls } from '@/lib/rls';
import { evaluateTransition, type TripStatus } from '@/lib/trip-state';

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
  { params }: { params: { id: string } },
) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // 1) Auth — read + verify the session cookie
  const driverToken = req.cookies.get('xl-driver-session')?.value;
  const adminToken = req.cookies.get('xl-session')?.value;
  const token = driverToken || adminToken;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const session = await verifySession(token).catch(() => null);
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

  // Body is optional — when no body is sent (Content-Length: 0),
  // skip the schema and use defaults. When a body is present,
  // validate it. Note: clients that send a literal `null` body
  // (e.g. some fetch helpers serialise undefined as "null") should
  // also be treated as "no body".
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
    // Malformed body (e.g. invalid JSON) — fall back to empty
  }

  // 3) Load the trip (raw, scoped to the dispatcher's tenant via
  //    the `app.tenant_id` GUC set by withTenantRls).
  const trips = await prisma.$queryRaw<Array<{
    id: string;
    status: TripStatus;
    driver_id: string;
    actual_departure_at: Date | null;
    tenant_id: string;
  }>>`
    SELECT id, status, driver_id, actual_departure_at, tenant_id
    FROM trip_schedules
    WHERE id = ${params.id}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (trips.length === 0) {
    return NextResponse.json({ error: 'trip not found' }, { status: 404 });
  }
  const trip = trips[0];

  // Tenant guard — the trip must belong to the dispatcher's tenant
  if (trip.tenant_id !== session.tenantId) {
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

  // For IN_PROGRESS trips, compute duration_minutes against
  // actual_departure_at. For SCHEDULED trips, no duration yet.
  const durationMin = (() => {
    if (trip.status !== 'IN_PROGRESS' || !trip.actual_departure_at) return null;
    return Math.max(0, Math.round(
      (new Date(now).getTime() - trip.actual_departure_at.getTime()) / 60_000,
    ));
  })();

  // 5) Persist — wrap in a single transaction (UPDATE + audit log)
  await withTenantRls(prisma, session.tenantId, async (tx) => {
    await tx.$executeRaw`
      UPDATE trip_schedules
      SET status = 'CANCELLED',
          actual_arrival_at = ${now}::timestamptz,
          duration_minutes = ${durationMin},
          end_location = ${location ? JSON.stringify(location) : null}::jsonb,
          updated_at = NOW()
      WHERE id = ${trip.id}
    `;
    await tx.$executeRaw`
      INSERT INTO trip_state_transitions (
        id, tenant_id, trip_id, driver_id, transition, at, location, source, notes
      ) VALUES (
        gen_random_uuid(), ${trip.tenant_id}::uuid, ${trip.id}, ${trip.driver_id}::text::uuid,
        'CANCELLED', ${now}::timestamptz,
        ${location ? JSON.stringify(location) : null}::jsonb,
        'DISPATCHER', ${notes}
      )
    `;
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
