/**
 * Driver Availability API
 *
 * GET   /api/dispatch/availability            — list driver availability (with filters)
 * POST  /api/dispatch/availability            — driver checks in (start shift)
 * PATCH /api/dispatch/availability            — update status / shift info
 *
 * Query params (GET): tenantId, status, serviceType, zoneId, page, limit
 * Body (POST): { driverId, vehicleId, zoneId?, serviceTypes?, shiftStartsAt? }
 * Body (PATCH): { driverId, status?, vehicleId?, zoneId?, shiftEndsAt? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
      out[k] = v;
    }
    return out;
  });
}

/* ─────────────────────────────────────────────
   GET — List available drivers with vehicle &
   last-known location for dispatch dashboard
───────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const sp          = new URL(req.url).searchParams;
    const tenantId    = sp.get('tenantId')    ?? '';
    const status      = sp.get('status')      ?? '';       // AVAILABLE, BUSY, OFF_DUTY, BREAK
    const serviceType = sp.get('serviceType') ?? '';
    const zoneId      = sp.get('zoneId')      ?? '';
    const page        = Math.max(1, parseInt(sp.get('page')  ?? '1'));
    const limit       = Math.min(100, parseInt(sp.get('limit') ?? '50'));
    const offset      = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[]    = [];

    const add = (cond: string, val: unknown) => {
      values.push(val);
      conditions.push(`${cond} = $${values.length}`);
    };

    if (tenantId)    add('d.tenant_id',    tenantId);
    if (status)      add('da.status',      status);
    if (zoneId)      add('da.zone_id',     zoneId);
    if (serviceType) {
      values.push(`%${serviceType}%`);
      conditions.push(`da.service_types::text ILIKE $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<Row[]>(`
        SELECT
          da.*,
          d.first_name || ' ' || d.last_name  AS driver_name,
          d.phone                              AS driver_phone,
          d.rating                             AS driver_rating,
          v.registration_number                AS vehicle_reg,
          v.type                               AS vehicle_type,
          v.capacity                           AS vehicle_capacity,
          v.make                               AS vehicle_make,
          v.model                              AS vehicle_model,
          vl.lat                               AS last_lat,
          vl.lng                               AS last_lng,
          vl.heading                           AS last_heading,
          vl.speed_kmh                         AS last_speed_kmh,
          vl.recorded_at                       AS location_updated_at
        FROM driver_availability da
        JOIN drivers d  ON d.id::text = da.driver_id AND d.deleted_at IS NULL
        LEFT JOIN vehicles v  ON v.id::text = da.vehicle_id AND v.deleted_at IS NULL
        LEFT JOIN vehicle_locations vl ON vl.vehicle_id = da.vehicle_id
        ${where}
        ORDER BY da.status ASC, da.last_ping DESC NULLS LAST
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `, ...values, limit, offset),

      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count
         FROM driver_availability da
         JOIN drivers d ON d.id::text = da.driver_id AND d.deleted_at IS NULL
         ${where}`,
        ...values
      ),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

    return NextResponse.json({
      data:  serialize(rows),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[dispatch/availability GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─────────────────────────────────────────────
   POST — Driver checks in / starts shift
   Creates or upserts driver_availability row.
   Body: { driverId, vehicleId?, zoneId?, serviceTypes?, shiftStartsAt? }
───────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const body = await req.json();
    const {
      driverId,
      vehicleId,
      zoneId,
      serviceTypes = ['PASSENGER'],
      shiftStartsAt,
    } = body as {
      driverId?: string;
      vehicleId?: string;
      zoneId?: string;
      serviceTypes?: string[];
      shiftStartsAt?: string;
    };

    if (!driverId) {
      return NextResponse.json({ error: 'driverId is required' }, { status: 400 });
    }

    // Verify driver exists
    const [driver] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM drivers WHERE id = $1::uuid AND deleted_at IS NULL`,
      driverId,
    );
    if (!driver) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }

    const shiftStart = shiftStartsAt ? new Date(shiftStartsAt) : new Date();

    await prisma.$executeRawUnsafe(`
      INSERT INTO driver_availability
        (driver_id, vehicle_id, status, zone_id, service_types, shift_starts_at, last_ping, updated_at)
      VALUES
        ($1, $2, 'AVAILABLE', $3, $4::jsonb, $5, NOW(), NOW())
      ON CONFLICT (driver_id) DO UPDATE SET
        vehicle_id     = EXCLUDED.vehicle_id,
        status         = 'AVAILABLE',
        zone_id        = EXCLUDED.zone_id,
        service_types  = EXCLUDED.service_types,
        shift_starts_at = EXCLUDED.shift_starts_at,
        last_ping      = NOW(),
        updated_at     = NOW()
    `,
      driverId,
      vehicleId ?? null,
      zoneId ?? null,
      JSON.stringify(serviceTypes),
      shiftStart,
    );

    // Update vehicle status to AVAILABLE
    if (vehicleId) {
      await prisma.$executeRawUnsafe(`
        UPDATE vehicles SET status = 'AVAILABLE', updated_at = NOW()
        WHERE id = $1::uuid AND deleted_at IS NULL
      `, vehicleId).catch(() => {});
    }

    return NextResponse.json({ ok: true, driverId, status: 'AVAILABLE' }, { status: 201 });
  } catch (err) {
    console.error('[dispatch/availability POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─────────────────────────────────────────────
   PATCH — Update driver status / shift end
   Body: { driverId, status?, vehicleId?, zoneId?, shiftEndsAt? }
   Valid statuses: AVAILABLE, BUSY, BREAK, OFF_DUTY
───────────────────────────────────────────── */
export async function PATCH(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const body = await req.json();
    const { driverId, status, vehicleId, zoneId, shiftEndsAt } = body as {
      driverId?: string;
      status?: string;
      vehicleId?: string;
      zoneId?: string;
      shiftEndsAt?: string;
    };

    if (!driverId) {
      return NextResponse.json({ error: 'driverId is required' }, { status: 400 });
    }

    const VALID_STATUSES = ['AVAILABLE', 'BUSY', 'BREAK', 'OFF_DUTY'];
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({
        error: `status must be one of: ${VALID_STATUSES.join(', ')}`,
      }, { status: 400 });
    }

    const setClauses: string[] = ['last_ping = NOW()', 'updated_at = NOW()'];
    const values: unknown[]    = [driverId];

    if (status)      { values.push(status);      setClauses.push(`status = $${values.length}`); }
    if (vehicleId)   { values.push(vehicleId);   setClauses.push(`vehicle_id = $${values.length}`); }
    if (zoneId)      { values.push(zoneId);      setClauses.push(`zone_id = $${values.length}`); }
    if (shiftEndsAt) {
      values.push(new Date(shiftEndsAt));
      setClauses.push(`shift_ends_at = $${values.length}`);
    }
    // hours_worked_today: recalculate if ending shift
    if (status === 'OFF_DUTY') {
      setClauses.push(`hours_worked_today = EXTRACT(EPOCH FROM (NOW() - shift_starts_at)) / 3600.0`);
    }

    const [updated] = await prisma.$queryRawUnsafe<{ driver_id: string }[]>(`
      UPDATE driver_availability
      SET ${setClauses.join(', ')}
      WHERE driver_id = $1
      RETURNING driver_id
    `, ...values);

    if (!updated) {
      return NextResponse.json(
        { error: 'Driver availability record not found — driver must check in first' },
        { status: 404 }
      );
    }

    // Update vehicle status when driver goes OFF_DUTY or BREAK
    if (vehicleId && (status === 'OFF_DUTY' || status === 'BREAK')) {
      await prisma.$executeRawUnsafe(`
        UPDATE vehicles SET status = 'AVAILABLE', updated_at = NOW()
        WHERE id = $1::uuid AND deleted_at IS NULL
      `, vehicleId).catch(() => {});
    }

    return NextResponse.json({ ok: true, driverId: updated.driver_id, status });
  } catch (err) {
    console.error('[dispatch/availability PATCH]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
