/**
 * POST /api/bus-ops/driver-performance/recompute
 *
 * Periodic cron: rebuilds DriverPerformance rows for a given month from
 * source-of-truth raw data (TripSchedule + TripLog + TripIncident).
 * Idempotent — upserts by (driverId, periodMonth, periodYear).
 *
 * Run nightly for the current month + first day of next month for the
 * previous month, so the score stabilises within 24h of a period closing.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?month=YYYY-MM (default: current), ?dryRun=1 to preview.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scoreDriverPeriod, type DriverPeriodMetrics } from '@/lib/bus-driver-scoring';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const ON_TIME_TOLERANCE_MIN = 5;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !req.headers.get('x-tenant-id')) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    const sp = req.nextUrl.searchParams;
    const dryRun = sp.get('dryRun') === '1';
    const monthArg = sp.get('month');
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (monthArg && /^\d{4}-\d{2}$/.test(monthArg)) {
      year = parseInt(monthArg.slice(0, 4), 10);
      month = parseInt(monthArg.slice(5, 7), 10);
    }
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59);

    // Per-driver aggregate from TripSchedule + TripLog (left-joined).
    const tripAgg = await prisma.$queryRawUnsafe<Array<{
      driver_id: string; total: bigint; completed: bigint; ontime: bigint;
      total_km: number | null; total_fuel: number | null; pax: bigint;
    }>>(
      `SELECT ts.driver_id,
              COUNT(*) AS total,
              SUM(CASE WHEN ts.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE
                WHEN tl.actual_departure_time IS NOT NULL
                  AND EXTRACT(EPOCH FROM (tl.actual_departure_time - ts.departure_time))/60 <= $3
                THEN 1 ELSE 0 END) AS ontime,
              COALESCE(SUM(GREATEST(tl.end_mileage - tl.start_mileage, 0)), 0)::float AS total_km,
              COALESCE(SUM(tl.fuel_used), 0)::float AS total_fuel,
              COALESCE(SUM(tl.passengers_boarded), 0) AS pax
       FROM trip_schedules ts
       LEFT JOIN trip_logs tl ON tl.schedule_id = ts.id
       WHERE ts.deleted_at IS NULL
         AND ts.driver_id IS NOT NULL
         AND ts.departure_time >= $1
         AND ts.departure_time <= $2
       GROUP BY ts.driver_id`,
      periodStart, periodEnd, ON_TIME_TOLERANCE_MIN,
    ).catch(() => []);

    // Incidents per driver in period.
    const incidentAgg = await prisma.$queryRawUnsafe<Array<{ driver_id: string; incidents: bigint }>>(
      `SELECT driver_id, COUNT(*) AS incidents
       FROM trip_incidents
       WHERE driver_id IS NOT NULL
         AND incident_date >= $1 AND incident_date <= $2
       GROUP BY driver_id`,
      periodStart, periodEnd,
    ).catch(() => []);
    const incidentByDriver = new Map(incidentAgg.map(r => [r.driver_id, Number(r.incidents)]));

    const metrics: DriverPeriodMetrics[] = tripAgg.map(r => ({
      driverId: r.driver_id,
      totalTrips: Number(r.total),
      completedTrips: Number(r.completed),
      onTimeDepartures: Number(r.ontime),
      totalKm: Number(r.total_km ?? 0),
      totalFuelL: Number(r.total_fuel ?? 0),
      incidents: incidentByDriver.get(r.driver_id) ?? 0,
      passengersBoarded: Number(r.pax),
    }));

    const scores = metrics.map(scoreDriverPeriod);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, period: { year, month },
        driversAssessed: scores.length, scores,
      });
    }

    let upserted = 0;
    let errors = 0;
    for (const s of scores) {
      try {
        const existing = await prisma.driverPerformance.findFirst({
          where: { driverId: s.driverId, periodYear: year, periodMonth: month },
          select: { id: true },
        });
        const data = {
          driverId: s.driverId,
          periodYear: year,
          periodMonth: month,
          onTimePct: s.components.onTimePct,
          incidentCount: metrics.find(m => m.driverId === s.driverId)?.incidents ?? 0,
          fuelEfficiency: s.components.fuelEfficiency,
          totalTrips: s.totalTrips,
          totalKm: s.totalKm,
          score: s.score,
        };
        if (existing) {
          await prisma.driverPerformance.update({ where: { id: existing.id }, data });
        } else {
          await prisma.driverPerformance.create({ data });
        }
        upserted += 1;
      } catch (err) {
        errors += 1;
        captureException(err, { context: 'bus-ops.driver-perf.upsert', tags: { driverId: s.driverId } });
      }
    }

    if (upserted > 0) {
      void logAudit({
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'DriverPerformance',
        action: 'UPDATE',
        details: `Driver performance recomputed for ${year}-${String(month).padStart(2, '0')}: ${upserted} drivers scored, ${errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false, period: { year, month },
      driversAssessed: scores.length, upserted, errors,
    });
  } catch (err) {
    captureException(err, { context: 'bus-ops.driver-perf.recompute' });
    return NextResponse.json({ error: 'Recompute failed' }, { status: 500 });
  }
}
