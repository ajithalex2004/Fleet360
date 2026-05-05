import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/vehicles/logistics
 * Returns logistics vehicles enriched with the most recent service schedule.
 */
export async function GET() {
  try {
    const vehicles = await prisma.$queryRawUnsafe<Array<{
      id: string;
      plate_number: string | null;
      registration_no: string | null;
      make: string | null;
      model: string | null;
      year: bigint | null;
      status: string | null;
      vehicle_usage: string | null;
      color: string | null;
      fuel_type: string | null;
      seating_capacity: number | null;
      current_mileage: bigint | null;
      registration_expiry: Date | null;
      insurance_expiry: Date | null;
      notes: string | null;
      next_service_date: Date | null;
      next_service_mileage: number | null;
    }>>(
      `SELECT
         v.id,
         COALESCE(v.plate_number, v.license_plate) AS plate_number,
         v.registration_no,
         v.make, v.model, v.year, v.status, v.vehicle_usage, v.color,
         v.fuel_type, v.seating_capacity, v.current_mileage,
         v.registration_expiry, v.insurance_expiry, v.notes,
         ss.next_service_date, ss.next_service_mileage
       FROM vehicles v
       LEFT JOIN LATERAL (
         SELECT next_service_date, next_service_mileage
         FROM service_schedules
         WHERE vehicle_id = v.id
         ORDER BY next_service_date ASC NULLS LAST
         LIMIT 1
       ) ss ON TRUE
       WHERE v.deleted_at IS NULL
         AND v.vehicle_usage = 'LOGISTICS'
       ORDER BY v.plate_number NULLS LAST, v.registration_no NULLS LAST`
    );

    return NextResponse.json(
      vehicles.map(v => ({
        ...v,
        year:                v.year != null ? Number(v.year) : null,
        current_mileage:     v.current_mileage != null ? Number(v.current_mileage) : null,
        registration_expiry: v.registration_expiry?.toISOString?.() ?? null,
        insurance_expiry:    v.insurance_expiry?.toISOString?.() ?? null,
        next_service_date:   v.next_service_date?.toISOString?.() ?? null,
      }))
    );
  } catch (err) {
    console.error('[vehicles/logistics]', err);
    // Graceful fallback — try generic query without service join
    try {
      const fallback = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id,
                COALESCE(plate_number, license_plate) AS plate_number,
                registration_no, make, model, year, status, vehicle_usage,
                color, fuel_type, seating_capacity, current_mileage,
                registration_expiry, insurance_expiry, notes
         FROM vehicles
         WHERE deleted_at IS NULL AND vehicle_usage = 'LOGISTICS'
         ORDER BY plate_number NULLS LAST`
      );
      return NextResponse.json(
        fallback.map(v => ({
          ...v,
          year:                v.year != null ? Number(v.year as bigint) : null,
          current_mileage:     v.current_mileage != null ? Number(v.current_mileage as bigint) : null,
          registration_expiry: v.registration_expiry instanceof Date ? v.registration_expiry.toISOString() : null,
          insurance_expiry:    v.insurance_expiry instanceof Date ? v.insurance_expiry.toISOString() : null,
          next_service_date:   null,
          next_service_mileage: null,
        }))
      );
    } catch (e2) {
      console.error('[vehicles/logistics fallback]', e2);
      return NextResponse.json([]);
    }
  }
}
