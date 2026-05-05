/**
 * GET /api/school-bus/capacity-check?tenantId=X
 *
 * Returns capacity guard status for all active school bus routes.
 * Cross-references:
 *   - school_bus_students.route_id → enrolled student count per route
 *   - school_bus_routes.assigned_vehicle_id → vehicle seat capacity
 *   - vehicles.seat_capacity (or school_bus_routes.student_count fallback)
 *
 * Returns per-route: enrolled, capacity, utilisation%, status (OK/WARNING/OVERLOAD)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

async function ensureRoutesTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS school_bus_routes (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT        NOT NULL DEFAULT 'default',
      route_name          TEXT        NOT NULL,
      route_code          TEXT,
      direction           TEXT        NOT NULL DEFAULT 'PICKUP',
      session             TEXT        NOT NULL DEFAULT 'MORNING',
      route_type          TEXT        NOT NULL DEFAULT 'STUDENT',
      departure_time      TIME        NOT NULL,
      arrival_time        TIME,
      assigned_vehicle_id TEXT,
      assigned_driver_id  TEXT,
      assigned_attendant_id TEXT,
      seat_capacity       INT         NOT NULL DEFAULT 40,
      student_count       INT         NOT NULL DEFAULT 0,
      waypoints           JSONB       NOT NULL DEFAULT '[]',
      stop_sequence       JSONB       NOT NULL DEFAULT '[]',
      status              TEXT        NOT NULL DEFAULT 'ACTIVE',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    await ensureRoutesTable();

    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';

    type CapRow = Row & { route_id: string; route_name: string; seat_capacity: number; enrolled: bigint };

    const rows = await prisma.$queryRawUnsafe<CapRow[]>(`
      SELECT
        r.id                                          AS route_id,
        r.route_name,
        r.route_code,
        r.session,
        r.direction,
        r.assigned_vehicle_id,
        r.assigned_attendant_id,
        COALESCE(r.seat_capacity, 40)                 AS seat_capacity,
        COUNT(s.id)                                   AS enrolled,
        r.status
      FROM   school_bus_routes r
      LEFT   JOIN school_bus_students s
             ON  s.route_id = r.id
             AND s.is_active = true
             AND s.deleted_at IS NULL
      WHERE  r.tenant_id = $1
        AND  r.status != 'DELETED'
      GROUP  BY r.id, r.route_name, r.route_code, r.session, r.direction,
                r.assigned_vehicle_id, r.assigned_attendant_id, r.seat_capacity, r.status
      ORDER  BY r.route_name
    `, tenantId).catch(() => [] as CapRow[]);

    const data = rows.map(r => {
      const enrolled   = Number(r.enrolled ?? 0);
      const capacity   = Number(r.seat_capacity ?? 40);
      const pct        = capacity > 0 ? Math.round((enrolled / capacity) * 100) : 0;
      const status     = enrolled > capacity ? 'OVERLOAD' : pct >= 90 ? 'WARNING' : 'OK';
      const hasAttendant = !!r.assigned_attendant_id;

      return {
        routeId:            String(r.route_id),
        routeName:          String(r.route_name),
        routeCode:          r.route_code ? String(r.route_code) : null,
        session:            String(r.session),
        direction:          String(r.direction),
        assignedVehicleId:  r.assigned_vehicle_id  ? String(r.assigned_vehicle_id)  : null,
        hasAttendant,
        seatCapacity:       capacity,
        enrolledStudents:   enrolled,
        availableSeats:     Math.max(0, capacity - enrolled),
        utilisationPct:     pct,
        capacityStatus:     status,   // OK | WARNING | OVERLOAD
        complianceStatus:   !hasAttendant ? 'NO_ATTENDANT' : 'OK',
      };
    });

    const summary = {
      total:    data.length,
      ok:       data.filter(d => d.capacityStatus === 'OK').length,
      warning:  data.filter(d => d.capacityStatus === 'WARNING').length,
      overload: data.filter(d => d.capacityStatus === 'OVERLOAD').length,
      noAttendant: data.filter(d => d.complianceStatus === 'NO_ATTENDANT').length,
    };

    return NextResponse.json({ routes: data, summary });
  } catch (err) {
    console.error('[school-bus/capacity-check GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
