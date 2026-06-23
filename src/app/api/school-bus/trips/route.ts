/**
 * GET  /api/school-bus/trips?tenantId=X&date=YYYY-MM-DD&status=X&routeId=X
 *   Returns trip records (today's by default).
 *
 * POST /api/school-bus/trips
 *   Creates a new trip record (called when a route starts its daily journey).
 *
 * Companion endpoint: POST /api/school-bus/trips/[id]/events
 *   Appends telemetry events: DEPARTURE, STOP_ARRIVAL, BOARDING, ALIGHTING, GEOFENCE_EXIT, INCIDENT, ARRIVAL
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type Row = Record<string, unknown>;

export async function ensureTripTables() {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});

  // Trips table
  await exec(`
    CREATE TABLE IF NOT EXISTS school_bus_trips (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id        TEXT        NOT NULL DEFAULT 'default',
      trip_code        TEXT,
      route_id         UUID,
      route_name       TEXT,
      route_code       TEXT,
      vehicle_id       TEXT,
      vehicle_plate    TEXT,
      driver_id        TEXT,
      driver_name      TEXT,
      attendant_id     UUID,
      attendant_name   TEXT,
      direction        TEXT        NOT NULL DEFAULT 'PICKUP',
      session          TEXT        NOT NULL DEFAULT 'MORNING',
      scheduled_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
      scheduled_start  TIME,
      actual_start     TIMESTAMPTZ,
      actual_end       TIMESTAMPTZ,
      status           TEXT        NOT NULL DEFAULT 'SCHEDULED',
      -- SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED | BREAKDOWN
      students_total   INT         NOT NULL DEFAULT 0,
      students_boarded INT         NOT NULL DEFAULT 0,
      students_dropped INT         NOT NULL DEFAULT 0,
      stops_total      INT         NOT NULL DEFAULT 0,
      stops_completed  INT         NOT NULL DEFAULT 0,
      distance_km      DOUBLE PRECISION,
      duration_min     INT,
      avg_speed_kmh    DOUBLE PRECISION,
      max_speed_kmh    DOUBLE PRECISION,
      -- Safety flags
      speeding_events  INT         NOT NULL DEFAULT 0,
      harsh_braking    INT         NOT NULL DEFAULT 0,
      geofence_exits   INT         NOT NULL DEFAULT 0,
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbt2_tenant ON school_bus_trips(tenant_id, status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbt2_date   ON school_bus_trips(scheduled_date)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbt2_route  ON school_bus_trips(route_id)`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sbt2_code ON school_bus_trips(trip_code, tenant_id) WHERE trip_code IS NOT NULL`);

  // Trip events (telemetry log)
  await exec(`
    CREATE TABLE IF NOT EXISTS school_bus_trip_events (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     TEXT        NOT NULL DEFAULT 'default',
      trip_id       UUID        NOT NULL,
      event_type    TEXT        NOT NULL,
      -- DEPARTURE | STOP_ARRIVAL | STOP_DEPARTURE | BOARDING | ALIGHTING
      -- GEOFENCE_EXIT | SPEEDING | HARSH_BRAKING | INCIDENT | ARRIVAL | BREAKDOWN
      event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lat           DOUBLE PRECISION,
      lng           DOUBLE PRECISION,
      speed_kmh     DOUBLE PRECISION,
      stop_id       UUID,
      stop_name     TEXT,
      student_id    UUID,
      student_name  TEXT,
      students_count INT,
      -- snapshot count at event time
      description   TEXT,
      metadata      JSONB       NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbte_trip   ON school_bus_trip_events(trip_id, event_time)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbte_tenant ON school_bus_trip_events(tenant_id, event_time)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbte_type   ON school_bus_trip_events(event_type)`);
}

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureTripTables();
    const sp       = new URL(req.url).searchParams;
    const ctx = requireOperationalContext(req, 'bus_ops', { requestedTenantId: sp.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    const tenantId = ctx.tenantId;
    const date     = sp.get('date')     ?? new Date().toISOString().slice(0, 10);
    const status   = sp.get('status')   ?? '';
    const routeId  = sp.get('routeId')  ?? '';
    const search   = sp.get('search')   ?? '';

    const conds: string[] = ['t.tenant_id = $1', 't.scheduled_date = $2'];
    const vals: unknown[] = [tenantId, date];
    const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };

    if (status)  add('t.status', status);
    if (routeId) add('t.route_id::text', routeId);
    if (search) {
      vals.push(`%${search}%`);
      conds.push(`(t.route_name ILIKE $${vals.length} OR t.driver_name ILIKE $${vals.length} OR t.vehicle_plate ILIKE $${vals.length} OR t.trip_code ILIKE $${vals.length})`);
    }

    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        t.*,
        COUNT(e.id) AS event_count,
        MAX(CASE WHEN e.event_type = 'SPEEDING' THEN 1 ELSE 0 END) AS has_speeding
      FROM school_bus_trips t
      LEFT JOIN school_bus_trip_events e ON e.trip_id = t.id
      WHERE ${conds.join(' AND ')}
      GROUP BY t.id
      ORDER BY t.scheduled_start ASC NULLS LAST, t.created_at ASC
    `, ...vals).catch(() => [] as Row[]);

    const data = serialize(rows);
    const summary = {
      total:      data.length,
      scheduled:  data.filter(t => t.status === 'SCHEDULED').length,
      inProgress: data.filter(t => t.status === 'IN_PROGRESS').length,
      completed:  data.filter(t => t.status === 'COMPLETED').length,
      cancelled:  data.filter(t => t.status === 'CANCELLED').length,
      breakdown:  data.filter(t => t.status === 'BREAKDOWN').length,
    };

    return NextResponse.json({ trips: data, summary, date });
  } catch (err) {
    console.error('[school-bus/trips GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTripTables();
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const {
      routeId, routeName, routeCode,
      vehicleId, vehiclePlate, driverId, driverName, attendantId, attendantName,
      direction = 'PICKUP', session = 'MORNING',
      scheduledDate, scheduledStart,
      studentsTotal = 0, stopsTotal = 0,
      status = 'SCHEDULED', notes,
    } = body;

    // Auto trip code
    const today = scheduledDate ?? new Date().toISOString().slice(0, 10);
    const [countRow] = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
      `SELECT COUNT(*) AS cnt FROM school_bus_trips WHERE tenant_id = $1 AND scheduled_date = $2`, ctx.tenantId, today,
    );
    const seq = String(Number(countRow?.cnt ?? 0) + 1).padStart(3, '0');
    const tripCode = `TRIP-${today.replace(/-/g, '')}-${seq}`;

    const [row] = await prisma.$queryRawUnsafe<Row[]>(`
      INSERT INTO school_bus_trips
        (tenant_id, trip_code, route_id, route_name, route_code,
         vehicle_id, vehicle_plate, driver_id, driver_name, attendant_id, attendant_name,
         direction, session, scheduled_date, scheduled_start,
         students_total, stops_total, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
    `,
      ctx.tenantId, tripCode,
      routeId ?? null, routeName ?? null, routeCode ?? null,
      vehicleId ?? null, vehiclePlate ?? null,
      driverId ?? null, driverName ?? null,
      attendantId ?? null, attendantName ?? null,
      direction, session, today, scheduledStart ?? null,
      studentsTotal, stopsTotal, status, notes ?? null,
    );

    const trip = serialize([row])[0];
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'SchoolBusTrip',
      entityId: String(row.id ?? tripCode),
      action: 'CREATE',
      after: trip,
      summary: `Created school bus trip ${String(row.trip_code ?? tripCode)}.`,
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'SCHOOL_ROUTE_ALLOCATION',
      referenceType: 'SchoolBusTrip',
      referenceId: String(row.id ?? tripCode),
      referenceNumber: String(row.trip_code ?? tripCode),
      contextData: {
        routeId: routeId ?? null,
        routeName: routeName ?? null,
        vehicleId: vehicleId ?? null,
        driverId: driverId ?? null,
        direction,
        session,
        scheduledDate: today,
        status,
      },
    });

    return NextResponse.json({ ok: true, trip, workflow }, { status: 201 });
  } catch (err) {
    console.error('[school-bus/trips POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
