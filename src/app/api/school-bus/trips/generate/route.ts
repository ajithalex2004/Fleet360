/**
 * POST /api/school-bus/trips/generate
 *
 * Bulk-generates trip records from active school bus routes for a given date.
 * Idempotent — skips routes that already have a trip on that date.
 *
 * Body:
 *   date      string   — YYYY-MM-DD (defaults to today)
 *   routeIds  string[] — optional filter; omit to generate for ALL active routes
 *   tenantId  string   — defaults to 'default'
 *
 * Returns:
 *   { ok, generated, skipped, trips: [{ id, tripCode, routeName, status }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureTripTables } from '../route';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

export async function POST(req: NextRequest) {
  try {
    await ensureTripTables();
    await ensureDispatchSchema();

    const body     = await req.json().catch(() => ({}));
    const tenantId = body.tenantId ?? 'default';
    const date     = body.date     ?? new Date().toISOString().slice(0, 10);
    const routeIds = Array.isArray(body.routeIds) && body.routeIds.length > 0
      ? body.routeIds as string[]
      : null;

    // Fetch active routes
    let routeQuery = `
      SELECT id, route_name, route_code, direction, session,
             departure_time, arrival_time,
             assigned_vehicle_id, vehicle_reg,
             assigned_driver_id, driver_name,
             assigned_attendant_id,
             COALESCE(seat_capacity, 40) AS seat_capacity,
             COALESCE(student_count, 0)  AS student_count,
             COALESCE(stop_sequence, '[]'::jsonb) AS stop_sequence
      FROM school_bus_routes
      WHERE tenant_id = $1
        AND status NOT IN ('DELETED','CANCELLED','INACTIVE')
        AND is_active = TRUE
    `;
    const routeVals: unknown[] = [tenantId];

    if (routeIds) {
      const placeholders = routeIds.map((_, i) => `$${i + 2}`).join(', ');
      routeQuery += ` AND id::text IN (${placeholders})`;
      routeVals.push(...routeIds);
    }
    routeQuery += ' ORDER BY departure_time ASC';

    const routes = await query<Row>(routeQuery, ...routeVals);

    if (routes.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No active routes found. Create and activate routes first.',
      }, { status: 404 });
    }

    const generated: Row[] = [];
    let skipped = 0;

    for (const route of routes) {
      // One trip per route per date — use a deterministic code as idempotency key
      const tripCode = `${String(route.route_code ?? route.id).slice(0, 10)}-${date}`;

      const [existing] = await query<{ id: string }>(
        `SELECT id FROM school_bus_trips WHERE trip_code = $1 AND tenant_id = $2`,
        tripCode, tenantId,
      );
      if (existing?.id) { skipped++; continue; }

      // Count stops from stop_sequence JSONB
      const stops = Array.isArray(route.stop_sequence) ? route.stop_sequence : [];

      const [row] = await query<Row>(`
        INSERT INTO school_bus_trips (
          tenant_id, trip_code, route_name, route_code,
          vehicle_plate, driver_name,
          direction, session, scheduled_date, scheduled_start,
          students_total, stops_total, status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::time,$11,$12,'SCHEDULED'
        )
        ON CONFLICT DO NOTHING
        RETURNING id, trip_code, route_name, status
      `,
        tenantId, tripCode,
        String(route.route_name ?? ''), String(route.route_code ?? ''),
        String(route.vehicle_reg ?? route.assigned_vehicle_id ?? ''),
        String(route.driver_name ?? ''),
        String(route.direction ?? 'PICKUP'), String(route.session ?? 'MORNING'),
        date, route.departure_time ? String(route.departure_time) : '07:00',
        Number(route.student_count ?? 0),
        stops.length,
      );

      if (row) generated.push(row);
    }

    return NextResponse.json({
      ok: true,
      generated: generated.length,
      skipped,
      total: routes.length,
      trips: generated,
      message: `Generated ${generated.length} trip(s) for ${date}. ${skipped} already existed.`,
    }, { status: 201 });
  } catch (err) {
    console.error('[school-bus/trips/generate POST]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
