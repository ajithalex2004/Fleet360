import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/bus-ops/analytics
 * Staff Transport KPIs and chart data for the analytics dashboard.
 */

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

export async function GET() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);

    const [
      totalTrips,
      completedTrips,
      cancelledTrips,
      inTransitTrips,
      totalPassengers,
      totalRoutes,
      totalStaff,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<[{count:bigint}]>(`SELECT COUNT(*) as count FROM trip_schedules WHERE deleted_at IS NULL AND departure_time >= $1`, thirtyDaysAgo).catch(zero),
      prisma.$queryRawUnsafe<[{count:bigint}]>(`SELECT COUNT(*) as count FROM trip_schedules WHERE deleted_at IS NULL AND status = 'COMPLETED' AND departure_time >= $1`, thirtyDaysAgo).catch(zero),
      prisma.$queryRawUnsafe<[{count:bigint}]>(`SELECT COUNT(*) as count FROM trip_schedules WHERE deleted_at IS NULL AND status = 'CANCELLED' AND departure_time >= $1`, thirtyDaysAgo).catch(zero),
      prisma.$queryRawUnsafe<[{count:bigint}]>(`SELECT COUNT(*) as count FROM trip_schedules WHERE deleted_at IS NULL AND status IN ('DEPARTED','IN_TRANSIT')`).catch(zero),
      prisma.$queryRawUnsafe<[{count:bigint}]>(`SELECT COUNT(*) as count FROM trip_passengers tp JOIN trip_schedules ts ON ts.id = tp.trip_id WHERE ts.departure_time >= $1 AND ts.deleted_at IS NULL`, thirtyDaysAgo).catch(zero),
      prisma.$queryRawUnsafe<[{count:bigint}]>(`SELECT COUNT(*) as count FROM bus_routes WHERE deleted_at IS NULL AND is_active = true`).catch(zero),
      prisma.$queryRawUnsafe<[{count:bigint}]>(`SELECT COUNT(*) as count FROM staff_members WHERE deleted_at IS NULL AND is_active = true`).catch(zero),
    ]);

    const total     = Number(totalTrips[0]?.count     ?? 0);
    const completed = Number(completedTrips[0]?.count  ?? 0);
    const cancelled = Number(cancelledTrips[0]?.count  ?? 0);
    const inTransit = Number(inTransitTrips[0]?.count  ?? 0);
    const pax       = Number(totalPassengers[0]?.count ?? 0);

    const completionRate   = total > 0 ? Math.round((completed / total) * 100) : 0;
    const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

    // Daily completed trips over 14 days
    const daily = await prisma.$queryRawUnsafe<Array<{ day: string; trips: bigint; passengers: bigint }>>(
      `SELECT
         DATE(departure_time) AS day,
         COUNT(*) AS trips,
         COALESCE(SUM(confirmed_count), 0) AS passengers
       FROM trip_schedules
       WHERE deleted_at IS NULL
         AND departure_time >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(departure_time)
       ORDER BY day ASC`
    ).catch(() => []);

    const dailyChart = daily.map(d => ({
      day: new Date(d.day).toLocaleDateString('en-AE', { day: '2-digit', month: 'short' }),
      trips:      Number(d.trips),
      passengers: Number(d.passengers),
    }));

    // Trips by shift type
    const byShift = await prisma.$queryRawUnsafe<Array<{ shift_type: string | null; count: bigint }>>(
      `SELECT shift_type, COUNT(*) as count
       FROM trip_schedules
       WHERE deleted_at IS NULL AND departure_time >= $1
       GROUP BY shift_type ORDER BY count DESC`,
      thirtyDaysAgo
    ).catch(() => []);

    // Trips by route
    const byRoute = await prisma.$queryRawUnsafe<Array<{ name: string; count: bigint; passengers: bigint }>>(
      `SELECT r.name, COUNT(ts.id) AS count, COALESCE(SUM(ts.confirmed_count), 0) AS passengers
       FROM trip_schedules ts
       JOIN bus_routes r ON r.id = ts.route_id
       WHERE ts.deleted_at IS NULL AND ts.departure_time >= $1
       GROUP BY r.name
       ORDER BY count DESC
       LIMIT 8`,
      thirtyDaysAgo
    ).catch(() => []);

    // Average occupancy rate
    const occupancy = await prisma.$queryRawUnsafe<Array<{ avg_rate: number }>>(
      `SELECT AVG(CASE WHEN capacity > 0 THEN confirmed_count::float / capacity * 100 ELSE 0 END) AS avg_rate
       FROM trip_schedules
       WHERE deleted_at IS NULL AND departure_time >= $1 AND capacity > 0`,
      thirtyDaysAgo
    ).catch(() => [{ avg_rate: 0 }]);

    // Peak hours (trips by hour)
    const byHour = await prisma.$queryRawUnsafe<Array<{ hour: number; count: bigint }>>(
      `SELECT EXTRACT(HOUR FROM departure_time)::int AS hour, COUNT(*) as count
       FROM trip_schedules
       WHERE deleted_at IS NULL AND departure_time >= $1
       GROUP BY hour ORDER BY hour ASC`,
      thirtyDaysAgo
    ).catch(() => []);

    return NextResponse.json({
      kpis: {
        totalTrips:      total,
        completedTrips:  completed,
        cancelledTrips:  cancelled,
        inTransitTrips:  inTransit,
        completionRate,
        cancellationRate,
        totalPassengers: pax,
        totalRoutes:     Number(totalRoutes[0]?.count ?? 0),
        totalStaff:      Number(totalStaff[0]?.count  ?? 0),
        avgOccupancy:    Math.round(Number(occupancy[0]?.avg_rate ?? 0)),
      },
      charts: {
        daily:    dailyChart,
        byShift:  byShift.map(s => ({ name: s.shift_type ?? 'Unknown', value: Number(s.count) })),
        byRoute:  byRoute.map(r => ({ name: r.name, trips: Number(r.count), passengers: Number(r.passengers) })),
        byHour:   byHour.map(h => ({ hour: `${String(h.hour).padStart(2,'0')}:00`, trips: Number(h.count) })),
      },
    });
  } catch (err) {
    console.error('[bus-ops analytics]', err);
    return NextResponse.json({ kpis: {}, charts: {} });
  }
}
