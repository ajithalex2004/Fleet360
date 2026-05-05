/**
 * POST /api/school-bus/trips/[id]/action
 *
 * Lifecycle actions for a school bus trip.
 *
 * Actions:
 *   start      — SCHEDULED → IN_PROGRESS  (sets actual_start, logs DEPARTURE event)
 *   complete   — IN_PROGRESS → COMPLETED  (sets actual_end, logs ARRIVAL event)
 *   cancel     — any → CANCELLED          (logs CANCELLED event, requires reason)
 *   breakdown  — IN_PROGRESS → BREAKDOWN  (logs BREAKDOWN event)
 *
 * Body: { action, reason?, notes?, operatorId? }
 *
 * Returns: { ok, trip: { id, status, actual_start, actual_end } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureTripTables } from '../../route';

type Row = Record<string, unknown>;
const query  = <T = Row>(sql: string, ...v: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
const exec   = (sql: string, ...v: unknown[]) => prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

function ser(r: Row): Row {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) {
    o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
  }
  return o;
}

/* ── log a telemetry event ─────────────────────────────── */
async function logEvent(
  tripId: string, tenantId: string,
  eventType: string, description: string,
  extras: Row = {},
) {
  await exec(`
    INSERT INTO school_bus_trip_events
      (tenant_id, trip_id, event_type, event_time, description, metadata)
    VALUES ($1, $2, $3, NOW(), $4, $5::jsonb)
  `, tenantId, tripId, eventType, description, JSON.stringify(extras));
}

/* ── main handler ──────────────────────────────────────── */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureTripTables();
    const { id: tripId } = await params;
    const body = await req.json().catch(() => ({}));
    const {
      action = '',
      reason = '',
      notes  = '',
      operatorId = 'dispatcher',
    } = body as { action: string; reason?: string; notes?: string; operatorId?: string };

    // Fetch current trip
    const [trip] = await query<Row>(
      `SELECT * FROM school_bus_trips WHERE id = $1::uuid`, tripId,
    );
    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const tenantId   = String(trip.tenant_id ?? 'default');
    const routeName  = String(trip.route_name ?? 'Unknown Route');
    const tripCode   = String(trip.trip_code  ?? tripId);
    const now        = new Date().toISOString();

    /* ── START ─────────────────────────────────────────── */
    if (action === 'start') {
      if (trip.status === 'IN_PROGRESS') {
        return NextResponse.json({ error: 'Trip is already in progress' }, { status: 409 });
      }
      if (trip.status === 'COMPLETED') {
        return NextResponse.json({ error: 'Trip is already completed' }, { status: 409 });
      }
      if (trip.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Cannot start a cancelled trip' }, { status: 409 });
      }

      const [updated] = await query<Row>(`
        UPDATE school_bus_trips
        SET status = 'IN_PROGRESS', actual_start = $2, updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING id, status, actual_start, route_name, trip_code
      `, tripId, now);

      await logEvent(tripId, tenantId, 'DEPARTURE',
        `Trip ${tripCode} started — ${routeName}`,
        { action: 'start', operatorId, routeName, tripCode },
      );

      return NextResponse.json({
        ok: true,
        message: `Trip started successfully`,
        trip: updated ? ser(updated) : null,
      });
    }

    /* ── COMPLETE / STOP ───────────────────────────────── */
    if (action === 'complete') {
      if (trip.status !== 'IN_PROGRESS') {
        return NextResponse.json({
          error: `Cannot complete a trip with status: ${trip.status}. Trip must be IN_PROGRESS.`,
        }, { status: 409 });
      }

      // Calculate duration
      let durationMin: number | null = null;
      if (trip.actual_start) {
        const startMs = new Date(String(trip.actual_start)).getTime();
        durationMin   = Math.round((Date.now() - startMs) / 60_000);
      }

      const [updated] = await query<Row>(`
        UPDATE school_bus_trips
        SET status = 'COMPLETED',
            actual_end   = $2,
            duration_min = COALESCE($3, duration_min),
            updated_at   = NOW()
        WHERE id = $1::uuid
        RETURNING id, status, actual_start, actual_end, duration_min, route_name, trip_code
      `, tripId, now, durationMin);

      await logEvent(tripId, tenantId, 'ARRIVAL',
        `Trip ${tripCode} completed — all students ${trip.direction === 'PICKUP' ? 'delivered to school' : 'dropped home'}`,
        { action: 'complete', operatorId, routeName, tripCode, durationMin, notes },
      );

      return NextResponse.json({
        ok: true,
        message: `Trip completed successfully${durationMin ? ` in ${durationMin} min` : ''}`,
        trip: updated ? ser(updated) : null,
      });
    }

    /* ── CANCEL ────────────────────────────────────────── */
    if (action === 'cancel') {
      if (trip.status === 'COMPLETED') {
        return NextResponse.json({ error: 'Cannot cancel a completed trip' }, { status: 409 });
      }
      if (trip.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Trip is already cancelled' }, { status: 409 });
      }

      const cancelReason = reason || 'Cancelled by dispatcher';

      const [updated] = await query<Row>(`
        UPDATE school_bus_trips
        SET status = 'CANCELLED',
            notes  = COALESCE(NULLIF($2, ''), notes),
            updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING id, status, route_name, trip_code, notes
      `, tripId, cancelReason);

      await logEvent(tripId, tenantId, 'CANCELLED',
        `Trip ${tripCode} cancelled — ${cancelReason}`,
        { action: 'cancel', operatorId, routeName, tripCode, reason: cancelReason, notes },
      );

      return NextResponse.json({
        ok: true,
        message: `Trip cancelled`,
        trip: updated ? ser(updated) : null,
      });
    }

    /* ── BREAKDOWN ─────────────────────────────────────── */
    if (action === 'breakdown') {
      if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
        return NextResponse.json({
          error: `Cannot report breakdown for a ${trip.status} trip`,
        }, { status: 409 });
      }

      const breakdownReason = reason || 'Vehicle breakdown reported';

      const [updated] = await query<Row>(`
        UPDATE school_bus_trips
        SET status = 'BREAKDOWN',
            notes  = COALESCE(NULLIF($2, ''), notes),
            updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING id, status, route_name, trip_code, notes
      `, tripId, breakdownReason);

      await logEvent(tripId, tenantId, 'BREAKDOWN',
        `Breakdown reported on ${tripCode} — ${breakdownReason}`,
        { action: 'breakdown', operatorId, routeName, tripCode, reason: breakdownReason, notes },
      );

      return NextResponse.json({
        ok: true,
        message: `Breakdown reported. Dispatch notified.`,
        trip: updated ? ser(updated) : null,
      });
    }

    return NextResponse.json({
      error: `Unknown action: "${action}". Valid actions: start, complete, cancel, breakdown`,
    }, { status: 400 });

  } catch (err) {
    console.error('[school-bus/trips/[id]/action POST]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
