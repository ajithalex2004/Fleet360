/**
 * src/app/api/driver-app/trips/history/route.ts
 *
 * GET /api/driver-app/trips/history?limit=20
 *
 * Returns the driver's recent trips with per-trip summaries: trip
 * number, departure/arrival times, vehicle plate, and counts of DVIR /
 * fuel / expense entries attached to each trip.
 *
 * The page UI handles status filtering client-side. We tried server-
 * side status filtering but ran into two issues:
 *   1. trip_schedules.driver_id is text, tenant_id is uuid — comparing
 *      either to a uuid parameter requires explicit `::uuid` casts
 *      that Prisma's $queryRaw template literal parser doesn't always
 *      handle cleanly.
 *   2. trip_schedules.status is text but COALESCE between text and
 *      text for the "optional filter" pattern produced type-inference
 *      errors.
 *
 * For a typical driver with tens of trips (not thousands), client-side
 * filtering on the returned list is fine. We can revisit when this
 * becomes a real problem.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

interface TripRow {
  id: string;
  trip_number: string | null;
  departure_time: Date;
  arrival_time: Date;
  status: string;
  shift_type: string | null;
  direction: string | null;
  capacity: number | null;
  confirmed_count: number | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  dvir_count: number;
  fuel_count: number;
  expense_count: number;
  expense_total_minor: number;
  expense_currency: string | null;
}

const SQL = `
  SELECT
    ts.id,
    ts.trip_number,
    ts.departure_time,
    ts.arrival_time,
    ts.status,
    ts.shift_type,
    ts.direction,
    ts.capacity,
    ts.confirmed_count,
    ts.vehicle_id,
    (SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', v.plate_code, v.plate_number)), ''), v.license_plate, v.registration_no)
     FROM vehicles v WHERE v.id::text = ts.vehicle_id LIMIT 1) AS vehicle_plate,
    COALESCE((SELECT count(*)::int FROM dvir d
              WHERE d.trip_id = ts.id::uuid
                AND d.tenant_id = ts.tenant_id::uuid
                AND d.driver_id = ts.driver_id::uuid), 0) AS dvir_count,
    COALESCE((SELECT count(*)::int FROM fuel_entries fe
              WHERE fe.trip_id = ts.id::uuid
                AND fe.tenant_id = ts.tenant_id::uuid
                AND fe.driver_id = ts.driver_id::uuid), 0) AS fuel_count,
    COALESCE((SELECT count(*)::int FROM expense_entries ee
              WHERE ee.trip_id = ts.id::uuid
                AND ee.tenant_id = ts.tenant_id::uuid
                AND ee.driver_id = ts.driver_id::uuid), 0) AS expense_count,
    COALESCE((SELECT sum(amount_minor)::bigint FROM expense_entries ee
              WHERE ee.trip_id = ts.id::uuid
                AND ee.tenant_id = ts.tenant_id::uuid
                AND ee.driver_id = ts.driver_id::uuid), 0)::bigint AS expense_total_minor,
    COALESCE((SELECT currency FROM expense_entries ee
              WHERE ee.trip_id = ts.id::uuid
                AND ee.tenant_id = ts.tenant_id::uuid
                AND ee.driver_id = ts.driver_id::uuid
              LIMIT 1), 'AED') AS expense_currency
  FROM trip_schedules ts
  WHERE ts.tenant_id = $1::uuid
    AND ts.driver_id::uuid = $2::uuid
  ORDER BY ts.departure_time DESC
  LIMIT $3::int
`;

export async function GET(req: NextRequest) {
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20'), 1), 100);

  const rows = await prisma.$queryRawUnsafe<TripRow[]>(SQL, ctx.tenantId, ctx.userId, limit);

  return NextResponse.json({
    trips: rows.map((r) => ({
      id: r.id,
      tripNumber: r.trip_number,
      departureTime: r.departure_time.toISOString(),
      arrivalTime: r.arrival_time.toISOString(),
      status: r.status,
      shiftType: r.shift_type,
      direction: r.direction,
      capacity: r.capacity,
      confirmedCount: r.confirmed_count,
      vehicleId: r.vehicle_id,
      vehiclePlate: r.vehicle_plate,
      dvirCount: r.dvir_count,
      fuelCount: r.fuel_count,
      expenseCount: r.expense_count,
      expenseTotalMinor: Number(r.expense_total_minor),
      expenseCurrency: r.expense_currency ?? 'AED',
    })),
  });
}
