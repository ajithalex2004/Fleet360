/**
 * GET  /api/school-bus/schedules?tenantId=X&routeId=X&weekType=MON_THU|FRI&status=ACTIVE
 *   Returns schedule records for routes.
 *
 * POST /api/school-bus/schedules
 *   Creates a new schedule with recurring day/session configuration.
 *
 * UAE school week: Sunday–Thursday (MON_THU cycle) + Friday optional (FRI cycle)
 * Ramadan and holiday periods handled via override_dates JSONB.
 *
 * Table: school_bus_schedules
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

async function ensureTable() {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});

  await exec(`
    CREATE TABLE IF NOT EXISTS school_bus_schedules (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT        NOT NULL DEFAULT 'default',
      schedule_name       TEXT        NOT NULL,
      route_id            UUID,
      route_name          TEXT,
      route_code          TEXT,
      vehicle_id          TEXT,
      vehicle_plate       TEXT,
      driver_id           TEXT,
      driver_name         TEXT,
      attendant_id        UUID,
      attendant_name      TEXT,

      -- Timing
      week_type           TEXT        NOT NULL DEFAULT 'MON_THU',
      -- MON_THU = Sunday–Thursday, FRI = Friday only, DAILY = all days, CUSTOM = see active_days
      active_days         JSONB       NOT NULL DEFAULT '["SUN","MON","TUE","WED","THU"]',
      -- e.g. ["SUN","MON","TUE","WED","THU"] for UAE school week
      session             TEXT        NOT NULL DEFAULT 'MORNING',
      -- MORNING | AFTERNOON | BOTH
      direction           TEXT        NOT NULL DEFAULT 'PICKUP',
      -- PICKUP | DROPOFF | BOTH
      departure_time      TIME        NOT NULL,
      arrival_time        TIME,

      -- Validity
      effective_from      DATE        NOT NULL DEFAULT CURRENT_DATE,
      effective_to        DATE,
      -- null = open-ended

      -- Exceptions: dates when schedule does NOT run (holidays, Eid, etc.)
      exception_dates     JSONB       NOT NULL DEFAULT '[]',
      -- e.g. ["2025-12-25","2026-01-01"]

      -- Override: different timing on specific dates (Ramadan, exam period)
      override_dates      JSONB       NOT NULL DEFAULT '[]',
      -- e.g. [{"date":"2025-03-10","departure_time":"09:00","arrival_time":"11:30"}]

      status              TEXT        NOT NULL DEFAULT 'ACTIVE',
      -- ACTIVE | SUSPENDED | EXPIRED | DRAFT
      notes               TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_sbsch_tenant ON school_bus_schedules(tenant_id, status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbsch_route  ON school_bus_schedules(route_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbsch_week   ON school_bus_schedules(week_type, session)`);
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
    await ensureTable();

    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId')  ?? 'default';
    const routeId  = sp.get('routeId')   ?? '';
    const weekType = sp.get('weekType')  ?? '';
    const session  = sp.get('session')   ?? '';
    const status   = sp.get('status')    ?? '';
    const search   = sp.get('search')    ?? '';

    const conds: string[] = ['tenant_id = $1'];
    const vals: unknown[] = [tenantId];
    const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };

    if (routeId)  add('route_id::text', routeId);
    if (weekType) add('week_type', weekType);
    if (session)  add('session', session);
    if (status)   add('status', status);
    else          conds.push("status != 'DELETED'");

    if (search) {
      vals.push(`%${search}%`);
      conds.push(`(schedule_name ILIKE $${vals.length} OR route_name ILIKE $${vals.length} OR driver_name ILIKE $${vals.length})`);
    }

    const where = `WHERE ${conds.join(' AND ')}`;

    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM school_bus_schedules
      ${where}
      ORDER BY departure_time ASC, schedule_name ASC
    `, ...vals).catch(() => [] as Row[]);

    return NextResponse.json({ data: serialize(rows), total: rows.length });
  } catch (err) {
    console.error('[school-bus/schedules GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();
    const {
      tenantId = 'default', scheduleName, routeId, routeName, routeCode,
      vehicleId, vehiclePlate, driverId, driverName, attendantId, attendantName,
      weekType = 'MON_THU', activeDays, session = 'MORNING', direction = 'PICKUP',
      departureTime, arrivalTime, effectiveFrom, effectiveTo,
      exceptionDates = [], overrideDates = [], status = 'ACTIVE', notes,
    } = body;

    if (!scheduleName?.trim()) return NextResponse.json({ error: 'scheduleName is required' }, { status: 400 });
    if (!departureTime)        return NextResponse.json({ error: 'departureTime is required' }, { status: 400 });

    // Default active days by week type
    const defaultDays: Record<string, string[]> = {
      MON_THU: ['SUN', 'MON', 'TUE', 'WED', 'THU'],
      FRI:     ['FRI'],
      DAILY:   ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
      CUSTOM:  activeDays ?? ['SUN', 'MON', 'TUE', 'WED', 'THU'],
    };
    const days = activeDays ?? defaultDays[weekType] ?? defaultDays['MON_THU'];

    const [row] = await prisma.$queryRawUnsafe<Row[]>(`
      INSERT INTO school_bus_schedules
        (tenant_id, schedule_name, route_id, route_name, route_code,
         vehicle_id, vehicle_plate, driver_id, driver_name, attendant_id, attendant_name,
         week_type, active_days, session, direction,
         departure_time, arrival_time, effective_from, effective_to,
         exception_dates, override_dates, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *
    `,
      tenantId, scheduleName.trim(),
      routeId ?? null, routeName ?? null, routeCode ?? null,
      vehicleId ?? null, vehiclePlate ?? null,
      driverId ?? null, driverName ?? null,
      attendantId ?? null, attendantName ?? null,
      weekType, JSON.stringify(days), session, direction,
      departureTime, arrivalTime ?? null,
      effectiveFrom ?? new Date().toISOString().slice(0, 10),
      effectiveTo ?? null,
      JSON.stringify(exceptionDates), JSON.stringify(overrideDates),
      status, notes ?? null,
    );

    return NextResponse.json({ ok: true, schedule: serialize([row])[0] }, { status: 201 });
  } catch (err) {
    console.error('[school-bus/schedules POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
