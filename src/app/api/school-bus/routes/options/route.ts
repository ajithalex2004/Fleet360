/**
 * GET /api/school-bus/routes/options
 *
 * Returns dropdown options for route assignment forms:
 *   vehicles   — school bus / minibus / bus vehicles with reg, type, capacity
 *   drivers    — all active drivers with name, phone
 *   attendants — all active female attendants (nannies) with name, employee_id
 *
 * Used by the Routes New/Edit modal and the Reassignment panel.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
  });
}

export async function GET() {
  try {
    const [vehicles, drivers, attendants] = await Promise.all([
      // Vehicles suitable for school bus routes
      prisma.$queryRawUnsafe<Row[]>(`
        SELECT
          id::text                         AS id,
          COALESCE(registration_number, plate_number, id::text) AS reg,
          type,
          make,
          model,
          COALESCE(capacity, seat_capacity, 0) AS capacity,
          status,
          COALESCE(color, '')              AS color
        FROM vehicles
        WHERE deleted_at IS NULL
          AND type IN ('SCHOOL_BUS','MINIBUS','BUS','VAN','COASTER')
        ORDER BY registration_number ASC NULLS LAST
        LIMIT 200
      `).catch(() => [] as Row[]),

      // All active drivers
      prisma.$queryRawUnsafe<Row[]>(`
        SELECT
          id::text                                           AS id,
          first_name || ' ' || last_name                    AS full_name,
          COALESCE(phone, mobile, '')                        AS phone,
          COALESCE(licence_number, license_number, '')       AS licence,
          COALESCE(status, 'ACTIVE')                         AS status,
          COALESCE(employee_id, id::text)                    AS employee_id
        FROM drivers
        WHERE deleted_at IS NULL
        ORDER BY first_name ASC, last_name ASC
        LIMIT 200
      `).catch(() => [] as Row[]),

      // School bus attendants (nannies)
      prisma.$queryRawUnsafe<Row[]>(`
        SELECT
          id::text                                       AS id,
          first_name || ' ' || last_name                AS full_name,
          employee_id,
          COALESCE(phone, '')                            AS phone,
          status,
          COALESCE(route_name, '')                       AS current_route
        FROM school_bus_attendants
        WHERE is_active = TRUE
        ORDER BY first_name ASC, last_name ASC
        LIMIT 200
      `).catch(() => [] as Row[]),
    ]);

    return NextResponse.json({
      vehicles:   serialize(vehicles),
      drivers:    serialize(drivers),
      attendants: serialize(attendants),
    });
  } catch (err) {
    console.error('[school-bus/routes/options GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
