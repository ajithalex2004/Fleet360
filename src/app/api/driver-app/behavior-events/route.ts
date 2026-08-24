/**
 * src/app/api/driver-app/behavior-events/route.ts
 *
 * POST /api/driver-app/behavior-events — bulk insert harsh events
 *                                       captured by the GPS watcher.
 *
 * The body carries an array of events with client-generated UUIDs.
 * Idempotent: re-posting the same id is a no-op (the watcher fires
 * events at 1-5 Hz during a trip, and the offline sync queue may
 * retry — we don't want duplicates to double-count in the score).
 *
 * GET  /api/driver-app/behavior-events?tripId=... — list events for
 *                                        a trip (or all events for the
 *                                        driver when no tripId is
 *                                        passed). Returns the events
 *                                        ordered by time, plus a
 *                                        computed score summary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { applyDriverTelemetryLimit } from '@/lib/rate-limit-scope';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const EventSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  // HARSH_BRAKE | HARSH_ACCEL | SPEEDING | IDLE_START | IDLE_END
  type: z.enum(['HARSH_BRAKE', 'HARSH_ACCEL', 'SPEEDING', 'IDLE_START', 'IDLE_END']),
  value: z.number().nullable().optional(),
  speedKmh: z.number().nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  occurredAt: z.string().datetime(),
});

const PostBodySchema = z.object({
  events: z.array(EventSchema).min(1).max(500),
});

const SCORE_DEDUCTIONS = {
  HARSH_BRAKE: 5,
  HARSH_ACCEL: 5,
  IDLE_PER_MIN: 2,
  SPEEDING_PER_KMH_OVER: 0.5,
};

function computeScoreFromRows(rows: Array<{ type: string; occurred_at: Date; value: number | null }>): {
  score: number;
  harshBrake: number;
  harshAccel: number;
  speeding: number;
  idleMinutes: number;
} {
  let harshBrake = 0;
  let harshAccel = 0;
  let speedingSeconds = 0;
  let idleMs = 0;
  let openIdle: number | null = null;
  for (const e of rows) {
    if (e.type === 'HARSH_BRAKE') harshBrake++;
    else if (e.type === 'HARSH_ACCEL') harshAccel++;
    else if (e.type === 'SPEEDING') speedingSeconds += 1; // each event = ~1s of overspeed (rough)
    else if (e.type === 'IDLE_START') openIdle = e.occurred_at.getTime();
    else if (e.type === 'IDLE_END' && openIdle != null) {
      idleMs += e.occurred_at.getTime() - openIdle;
      openIdle = null;
    }
  }
  if (openIdle != null && rows.length > 0) {
    idleMs += rows[rows.length - 1].occurred_at.getTime() - openIdle;
  }
  const idleMinutes = Math.round(idleMs / 60_000);
  const score = Math.max(
    0,
    100
      - SCORE_DEDUCTIONS.HARSH_BRAKE * harshBrake
      - SCORE_DEDUCTIONS.HARSH_ACCEL * harshAccel
      - SCORE_DEDUCTIONS.IDLE_PER_MIN * idleMinutes
      - SCORE_DEDUCTIONS.SPEEDING_PER_KMH_OVER * speedingSeconds,
  );
  return { score, harshBrake, harshAccel, speeding: speedingSeconds, idleMinutes };
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      // R2: per-driver telemetry rate limit. See src/lib/rate-limit-scope.ts
      // for the design rationale — one driver's flood of events can't block
      // any other driver, other categories, or the tenant's normal API traffic.
      const rl = await applyDriverTelemetryLimit(
        req.nextUrl.pathname,
        { tenantId: ctx.tenantId, userId: ctx.userId },
      );
      if (rl) return rl;

      const jsonRaw = await req.json().catch(() => null);
    const json = jsonRaw ? stripTenantOwnershipFields(jsonRaw) : null;
      const parsed = PostBodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
      }
      const body = parsed.data;

      // Idempotency: skip events that already exist (same id).
      const ids = body.events.map((e) => e.id);
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM behavior_events
        WHERE id = ANY(${ids}::uuid[])
          AND tenant_id = ${ctx.tenantId}::uuid
      `;
      const existingIds = new Set(existing.map((r) => r.id));
      const newEvents = body.events.filter((e) => !existingIds.has(e.id));

      let inserted = 0;
      for (const e of newEvents) {
        await tx.$executeRaw`
          INSERT INTO behavior_events (
            id, tenant_id, driver_id, shift_id, trip_id, type,
            value, speed_kph, location_lat, location_lng, note, occurred_at, created_at
          ) VALUES (
            ${e.id}::uuid,
            ${ctx.tenantId}::uuid,
            ${ctx.userId}::uuid,
            ${e.shiftId ?? null}::uuid,
            ${e.tripId ?? null}::uuid,
            ${e.type},
            ${e.value ?? null},
            ${e.speedKmh ?? null},
            ${e.lat ?? null},
            ${e.lng ?? null},
            ${e.note ?? null},
            ${e.occurredAt}::timestamptz,
            NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `;
        inserted++;
      }

      return NextResponse.json({
        ok: true,
        received: body.events.length,
        inserted,
        deduped: body.events.length - inserted,
      }, { status: 201 });
  });
}


export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      const url = new URL(req.url);
      const tripId = url.searchParams.get('tripId');
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '200'), 1), 1000);

      const rows = tripId
        ? await tx.$queryRaw<Array<{
            id: string; type: string; value: number | null; speed_kph: number | null;
            location_lat: number | null; location_lng: number | null; note: string | null;
            occurred_at: Date; shift_id: string | null; trip_id: string | null;
          }>>`
            SELECT id, type, value, speed_kph, location_lat, location_lng, note,
                   occurred_at, shift_id, trip_id
            FROM behavior_events
            WHERE tenant_id = ${ctx.tenantId}::uuid
              AND driver_id = ${ctx.userId}::uuid
              AND trip_id = ${tripId}::uuid
            ORDER BY occurred_at ASC
            LIMIT ${limit}
          `
        : await tx.$queryRaw<Array<{
            id: string; type: string; value: number | null; speed_kph: number | null;
            location_lat: number | null; location_lng: number | null; note: string | null;
            occurred_at: Date; shift_id: string | null; trip_id: string | null;
          }>>`
            SELECT id, type, value, speed_kph, location_lat, location_lng, note,
                   occurred_at, shift_id, trip_id
            FROM behavior_events
            WHERE tenant_id = ${ctx.tenantId}::uuid
              AND driver_id = ${ctx.userId}::uuid
              AND occurred_at > NOW() - INTERVAL '7 days'
            ORDER BY occurred_at DESC
            LIMIT ${limit}
          `;

      return NextResponse.json({
        events: rows.map((r) => ({
          id: r.id,
          type: r.type,
          value: r.value != null ? Number(r.value) : null,
          speedKmh: r.speed_kph != null ? Number(r.speed_kph) : null,
          lat: r.location_lat != null ? Number(r.location_lat) : null,
          lng: r.location_lng != null ? Number(r.location_lng) : null,
          note: r.note,
          occurredAt: r.occurred_at.toISOString(),
          shiftId: r.shift_id,
          tripId: r.trip_id,
        })),
        score: computeScoreFromRows(rows),
      });
  });
}

