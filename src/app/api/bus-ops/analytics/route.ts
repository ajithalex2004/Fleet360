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

    // ── On-time SLA ──────────────────────────────────────────────────────
    // On-time-departure: actual_departure_time within +5 min of scheduled
    // On-time-arrival: actual_arrival_time within +10 min of scheduled
    const ON_TIME_DEPART_TOLERANCE_MIN = 5;
    const ON_TIME_ARRIVE_TOLERANCE_MIN = 10;

    const slaTotals = await prisma.$queryRawUnsafe<Array<{
      total: bigint; depart_ontime: bigint; arrive_ontime: bigint;
      avg_departure_delay_min: number | null; avg_arrival_delay_min: number | null;
    }>>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE
           WHEN tl.actual_departure_time IS NOT NULL
             AND EXTRACT(EPOCH FROM (tl.actual_departure_time - ts.departure_time))/60 <= $2
           THEN 1 ELSE 0 END) AS depart_ontime,
         SUM(CASE
           WHEN tl.actual_arrival_time IS NOT NULL AND ts.arrival_time IS NOT NULL
             AND EXTRACT(EPOCH FROM (tl.actual_arrival_time - ts.arrival_time))/60 <= $3
           THEN 1 ELSE 0 END) AS arrive_ontime,
         AVG(CASE WHEN tl.actual_departure_time IS NOT NULL
           THEN EXTRACT(EPOCH FROM (tl.actual_departure_time - ts.departure_time))/60 END) AS avg_departure_delay_min,
         AVG(CASE WHEN tl.actual_arrival_time IS NOT NULL AND ts.arrival_time IS NOT NULL
           THEN EXTRACT(EPOCH FROM (tl.actual_arrival_time - ts.arrival_time))/60 END) AS avg_arrival_delay_min
       FROM trip_schedules ts
       LEFT JOIN trip_logs tl ON tl.schedule_id = ts.id
       WHERE ts.deleted_at IS NULL AND ts.departure_time >= $1 AND ts.status = 'COMPLETED'`,
      thirtyDaysAgo, ON_TIME_DEPART_TOLERANCE_MIN, ON_TIME_ARRIVE_TOLERANCE_MIN,
    ).catch(() => [{ total: BigInt(0), depart_ontime: BigInt(0), arrive_ontime: BigInt(0), avg_departure_delay_min: null, avg_arrival_delay_min: null }]);

    const slaRow = slaTotals[0];
    const slaTotal = Number(slaRow?.total ?? 0);
    const onTimeDeparturePct = slaTotal > 0 ? Math.round(Number(slaRow.depart_ontime) / slaTotal * 100) : 0;
    const onTimeArrivalPct = slaTotal > 0 ? Math.round(Number(slaRow.arrive_ontime) / slaTotal * 100) : 0;

    // Worst-performing routes by avg departure delay.
    const slaByRoute = await prisma.$queryRawUnsafe<Array<{
      name: string; trips: bigint; ontime: bigint; avg_delay_min: number | null;
    }>>(
      `SELECT r.name,
              COUNT(ts.id) AS trips,
              SUM(CASE WHEN tl.actual_departure_time IS NOT NULL
                AND EXTRACT(EPOCH FROM (tl.actual_departure_time - ts.departure_time))/60 <= $2
                THEN 1 ELSE 0 END) AS ontime,
              AVG(CASE WHEN tl.actual_departure_time IS NOT NULL
                THEN EXTRACT(EPOCH FROM (tl.actual_departure_time - ts.departure_time))/60 END) AS avg_delay_min
       FROM trip_schedules ts
       JOIN bus_routes r ON r.id = ts.route_id
       LEFT JOIN trip_logs tl ON tl.schedule_id = ts.id
       WHERE ts.deleted_at IS NULL AND ts.departure_time >= $1 AND ts.status = 'COMPLETED'
       GROUP BY r.name
       HAVING COUNT(ts.id) >= 3
       ORDER BY avg_delay_min DESC NULLS LAST
       LIMIT 5`,
      thirtyDaysAgo, ON_TIME_DEPART_TOLERANCE_MIN,
    ).catch(() => []);

    // ── Cost per trip / per passenger ────────────────────────────────────
    // Defaults are environment-tunable. STS will calibrate after pilot week.
    const FUEL_COST_AED_PER_LITRE = Number(process.env.BUS_FUEL_AED_PER_L ?? 2.95);
    const DRIVER_AED_PER_HOUR     = Number(process.env.BUS_DRIVER_AED_PER_HR ?? 30);
    const VEHICLE_AED_PER_KM      = Number(process.env.BUS_VEHICLE_AED_PER_KM ?? 0.50);

    const costAggregate = await prisma.$queryRawUnsafe<Array<{
      trips: bigint; total_pax: bigint;
      total_fuel_l: number | null; total_km: number | null;
      total_minutes: number | null;
    }>>(
      `SELECT
         COUNT(DISTINCT ts.id) AS trips,
         COALESCE(SUM(tl.passengers_boarded), 0) AS total_pax,
         COALESCE(SUM(tl.fuel_used), 0)::float AS total_fuel_l,
         COALESCE(SUM(GREATEST(tl.end_mileage - tl.start_mileage, 0)), 0)::float AS total_km,
         COALESCE(SUM(EXTRACT(EPOCH FROM (tl.actual_arrival_time - tl.actual_departure_time))/60), 0)::float AS total_minutes
       FROM trip_schedules ts
       JOIN trip_logs tl ON tl.schedule_id = ts.id
       WHERE ts.deleted_at IS NULL AND ts.departure_time >= $1
         AND ts.status = 'COMPLETED'
         AND tl.actual_departure_time IS NOT NULL
         AND tl.actual_arrival_time IS NOT NULL`,
      thirtyDaysAgo,
    ).catch(() => [{ trips: BigInt(0), total_pax: BigInt(0), total_fuel_l: 0, total_km: 0, total_minutes: 0 }]);

    const costRow = costAggregate[0];
    const tripsForCost = Number(costRow?.trips ?? 0);
    const totalFuelCost = (Number(costRow?.total_fuel_l ?? 0)) * FUEL_COST_AED_PER_LITRE;
    const totalDriverCost = (Number(costRow?.total_minutes ?? 0)) / 60 * DRIVER_AED_PER_HOUR;
    const totalVehicleCost = (Number(costRow?.total_km ?? 0)) * VEHICLE_AED_PER_KM;
    const totalCost = totalFuelCost + totalDriverCost + totalVehicleCost;
    const totalPaxForCost = Number(costRow?.total_pax ?? 0);
    const costPerTrip = tripsForCost > 0 ? totalCost / tripsForCost : 0;
    const costPerPassenger = totalPaxForCost > 0 ? totalCost / totalPaxForCost : 0;
    const costPerKm = (Number(costRow?.total_km ?? 0)) > 0 ? totalCost / Number(costRow.total_km) : 0;

    // Boarding-method mix (last 30 days).
    const methodMix = await prisma.$queryRawUnsafe<Array<{ method: string; count: bigint }>>(
      `SELECT method, COUNT(*) AS count
       FROM boarding_events
       WHERE created_at >= $1 AND direction = 'BOARD'
       GROUP BY method ORDER BY count DESC`,
      thirtyDaysAgo,
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
        onTimeDeparturePct,
        onTimeArrivalPct,
        avgDepartureDelayMin: slaRow?.avg_departure_delay_min ? Math.round(Number(slaRow.avg_departure_delay_min) * 10) / 10 : 0,
        avgArrivalDelayMin: slaRow?.avg_arrival_delay_min ? Math.round(Number(slaRow.avg_arrival_delay_min) * 10) / 10 : 0,
        costPerTrip:      Math.round(costPerTrip * 100) / 100,
        costPerPassenger: Math.round(costPerPassenger * 100) / 100,
        costPerKm:        Math.round(costPerKm * 100) / 100,
        totalCost:        Math.round(totalCost * 100) / 100,
        costBreakdown:    {
          fuel:    Math.round(totalFuelCost * 100) / 100,
          driver:  Math.round(totalDriverCost * 100) / 100,
          vehicle: Math.round(totalVehicleCost * 100) / 100,
        },
      },
      charts: {
        daily:    dailyChart,
        byShift:  byShift.map(s => ({ name: s.shift_type ?? 'Unknown', value: Number(s.count) })),
        byRoute:  byRoute.map(r => ({ name: r.name, trips: Number(r.count), passengers: Number(r.passengers) })),
        byHour:   byHour.map(h => ({ hour: `${String(h.hour).padStart(2,'0')}:00`, trips: Number(h.count) })),
        slaByRoute: slaByRoute.map(r => ({
          name: r.name,
          trips: Number(r.trips),
          ontimePct: Number(r.trips) > 0 ? Math.round(Number(r.ontime) / Number(r.trips) * 100) : 0,
          avgDelayMin: r.avg_delay_min != null ? Math.round(Number(r.avg_delay_min) * 10) / 10 : 0,
        })),
        boardingMethods: methodMix.map(m => ({ method: m.method, count: Number(m.count) })),
      },
    });
  } catch (err) {
    console.error('[bus-ops analytics]', err);
    return NextResponse.json({ kpis: {}, charts: {} });
  }
}
