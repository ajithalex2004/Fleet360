import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl } from '@/lib/server-cache';

const CACHE_TAG = 'school-bus:stats';

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

// 8 raw SQL queries on every page load. The page also auto-refreshes
// every 30s — the server cache means the auto-refresh hits the Data
// Cache instead of Neon. Per-tenant key keeps responses isolated.
const getSchoolBusStats = cacheRead(
  async (_tenantId: string) => {
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

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bus_routes WHERE route_type = 'SCHOOL' AND is_active = true`,
      ).catch(zero),

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

    return {
      totalVehicles:    Number(totalVehicles[0]?.count    ?? 0),
      availableVehicles: Number(availableVehicles[0]?.count ?? 0),
      inMaintenance:    Number(inMaintenance[0]?.count    ?? 0),
      activeRoutes:     Number(activeRoutes[0]?.count     ?? 0),
      todaySchedules:   Number(todaySchedules[0]?.count   ?? 0),
      inTransit:        Number(inTransit[0]?.count        ?? 0),
      drivers:          Number(driversResult[0]?.count    ?? 0),
      todayTrips,
    };
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id') ?? 'unknown';
    const data = await getSchoolBusStats(tenantId);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (err) {
    console.error('[school-bus/stats]', err);
    return NextResponse.json({
      totalVehicles: 0, availableVehicles: 0, inMaintenance: 0,
      activeRoutes: 0, todaySchedules: 0, inTransit: 0, drivers: 0, todayTrips: [],
    });
  }
}
