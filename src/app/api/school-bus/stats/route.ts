import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

export async function GET() {
  try {
    const [
      totalVehicles,
      availableVehicles,
      inMaintenance,
      activeRoutes,
      todaySchedules,
      inTransit,
      driversResult,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'SCHOOL_BUS'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'SCHOOL_BUS' AND status = 'AVAILABLE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'SCHOOL_BUS' AND status = 'MAINTENANCE'`,
      ).catch(zero),

      // Routes from bus_routes table (from bus-ops schema)
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bus_routes WHERE route_type = 'SCHOOL' AND is_active = true`,
      ).catch(zero),

      // Schedules today from trip_schedules table
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM trip_schedules WHERE DATE(departure_time) = CURRENT_DATE`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM trip_schedules WHERE status IN ('DEPARTED','IN_TRANSIT') AND DATE(departure_time) = CURRENT_DATE`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM drivers WHERE deleted_at IS NULL AND assignment_type = 'SCHOOL_BUS'`,
      ).catch(zero),
    ]);

    // Today's schedules — from school_bus_schedules (departure_time is TIME, not TIMESTAMPTZ)
    const todayTrips = await prisma.$queryRawUnsafe<Array<{
      id: string; trip_no: string | null; status: string; departure_time: string | null;
      arrival_time: string | null; route_name: string | null; vehicle_plate: string | null;
    }>>(
      `SELECT sbs.id, sbs.schedule_name AS trip_no, sbs.status,
              sbs.departure_time::text AS departure_time,
              sbs.arrival_time::text   AS arrival_time,
              sbs.route_name,
              sbs.vehicle_plate
       FROM school_bus_schedules sbs
       WHERE sbs.status IN ('ACTIVE')
       ORDER BY sbs.departure_time ASC
       LIMIT 15`,
    ).catch(() => [] as Array<{
      id: string; trip_no: string | null; status: string; departure_time: string | null;
      arrival_time: string | null; route_name: string | null; vehicle_plate: string | null;
    }>);

    return NextResponse.json({
      totalVehicles:    Number(totalVehicles[0]?.count    ?? 0),
      availableVehicles: Number(availableVehicles[0]?.count ?? 0),
      inMaintenance:    Number(inMaintenance[0]?.count    ?? 0),
      activeRoutes:     Number(activeRoutes[0]?.count     ?? 0),
      todaySchedules:   Number(todaySchedules[0]?.count   ?? 0),
      inTransit:        Number(inTransit[0]?.count        ?? 0),
      drivers:          Number(driversResult[0]?.count    ?? 0),
      todayTrips,
    });
  } catch (err) {
    console.error('[school-bus/stats]', err);
    return NextResponse.json({
      totalVehicles: 0, availableVehicles: 0, inMaintenance: 0,
      activeRoutes: 0, todaySchedules: 0, inTransit: 0, drivers: 0, todayTrips: [],
    });
  }
}
