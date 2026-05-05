/**
 * POST /api/school-bus/trips/[id]/events
 *   Appends a telemetry event to a trip's log.
 *   Called by the on-board device or dispatcher.
 *
 * GET /api/school-bus/trips/[id]/events
 *   Returns the event log for a specific trip.
 *
 * Event types:
 *   DEPARTURE       — bus leaves depot / school
 *   STOP_ARRIVAL    — arrives at a stop
 *   STOP_DEPARTURE  — departs a stop
 *   BOARDING        — student boards the bus
 *   ALIGHTING       — student exits the bus
 *   GEOFENCE_EXIT   — bus exits its designated route corridor
 *   SPEEDING        — speed exceeded threshold (>80 km/h in school zone)
 *   HARSH_BRAKING   — deceleration > 0.5g detected
 *   INCIDENT        — manual incident report by driver/attendant
 *   ARRIVAL         — bus arrives at destination (school or depot)
 *   BREAKDOWN       — vehicle breakdown reported
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureTripTables } from '../../route';

type Row = Record<string, unknown>;
const ser = (r: Row): Row => {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) {
    o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
  }
  return o;
};

const SAFETY_EVENTS = ['SPEEDING', 'HARSH_BRAKING', 'GEOFENCE_EXIT', 'INCIDENT', 'BREAKDOWN'];

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureTripTables();
    const { id } = await params;

    const events = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM school_bus_trip_events WHERE trip_id = $1::uuid ORDER BY event_time ASC`, id,
    );
    return NextResponse.json({ events: events.map(ser), total: events.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureTripTables();
    const { id: tripId } = await params;
    const body = await req.json();

    const {
      tenantId = 'default', eventType,
      lat, lng, speedKmh,
      stopId, stopName,
      studentId, studentName,
      studentsCount,
      description,
      metadata = {},
      eventTime,
    } = body;

    if (!eventType) return NextResponse.json({ error: 'eventType is required' }, { status: 400 });

    // Validate trip exists
    const [trip] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, status FROM school_bus_trips WHERE id = $1::uuid AND tenant_id = $2`, tripId, tenantId,
    );
    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    // Insert the event
    const [event] = await prisma.$queryRawUnsafe<Row[]>(`
      INSERT INTO school_bus_trip_events
        (tenant_id, trip_id, event_type, event_time, lat, lng, speed_kmh,
         stop_id, stop_name, student_id, student_name, students_count, description, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `,
      tenantId, tripId, eventType,
      eventTime ?? new Date().toISOString(),
      lat ?? null, lng ?? null, speedKmh ?? null,
      stopId ?? null, stopName ?? null,
      studentId ?? null, studentName ?? null,
      studentsCount ?? null, description ?? null,
      JSON.stringify(metadata),
    );

    // Side-effects: update trip counters based on event type
    const updates: string[] = [];
    if (eventType === 'DEPARTURE')    updates.push(`status = 'IN_PROGRESS', actual_start = NOW()`);
    if (eventType === 'ARRIVAL')      updates.push(`status = 'COMPLETED', actual_end = NOW()`);
    if (eventType === 'BREAKDOWN')    updates.push(`status = 'BREAKDOWN'`);
    if (eventType === 'BOARDING')     updates.push(`students_boarded = students_boarded + 1`);
    if (eventType === 'ALIGHTING')    updates.push(`students_dropped = students_dropped + 1`);
    if (eventType === 'STOP_DEPARTURE') updates.push(`stops_completed = stops_completed + 1`);
    if (eventType === 'SPEEDING')     updates.push(`speeding_events = speeding_events + 1`);
    if (eventType === 'HARSH_BRAKING') updates.push(`harsh_braking = harsh_braking + 1`);
    if (eventType === 'GEOFENCE_EXIT') updates.push(`geofence_exits = geofence_exits + 1`);

    if (updates.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE school_bus_trips SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1::uuid`,
        tripId,
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      event: ser(event),
      isSafetyAlert: SAFETY_EVENTS.includes(eventType),
    }, { status: 201 });
  } catch (err) {
    console.error('[trip-events POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
