import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureHosSchema } from '@/lib/fleet/hos-schema';

type Row = Record<string, unknown>;

const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

function ser<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_, val) =>
      typeof val === 'bigint'
        ? Number(val)
        : val instanceof Date
          ? val.toISOString()
          : val,
    ),
  );
}

// HoS limits (UAE/GCC regulated transport)
const MAX_DRIVING_24H_MINS = 10 * 60;   // 600
const MAX_ON_DUTY_24H_MINS = 14 * 60;   // 840
const MAX_DRIVING_7D_MINS  = 56 * 60;   // 3360
const MAX_ON_DUTY_8D_MINS  = 70 * 60;   // 4200

function computeRiskLevel(
  drivingToday: number,
  onDutyToday: number,
  drivingWeek: number,
  onDutyWeek: number,
): 'GREEN' | 'AMBER' | 'RED' {
  if (
    drivingToday > MAX_DRIVING_24H_MINS ||
    onDutyToday  > MAX_ON_DUTY_24H_MINS ||
    drivingWeek  > MAX_DRIVING_7D_MINS  ||
    onDutyWeek   > MAX_ON_DUTY_8D_MINS
  ) {
    return 'RED';
  }
  if (
    drivingToday > MAX_DRIVING_24H_MINS * 0.8 ||
    onDutyToday  > MAX_ON_DUTY_24H_MINS * 0.8 ||
    drivingWeek  > MAX_DRIVING_7D_MINS  * 0.8 ||
    onDutyWeek   > MAX_ON_DUTY_8D_MINS  * 0.8
  ) {
    return 'AMBER';
  }
  return 'GREEN';
}

async function buildDriverSummary(driverId: string) {
  const [
    todayRows,
    weekRows,
    weekOnDutyRows,
    currentStatusRows,
    violationRows,
  ] = await Promise.all([
    // Today breakdown by duty_status
    query<{ duty_status: string; total_mins: unknown }>(
      `SELECT duty_status,
         COALESCE(SUM(
           CASE
             WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
             ELSE duration_mins
           END
         ), 0) AS total_mins
       FROM hos_logs
       WHERE driver_id = $1
         AND started_at >= DATE_TRUNC('day', NOW())
       GROUP BY duty_status`,
      driverId,
    ),
    // 7-day driving
    query<{ total_mins: unknown }>(
      `SELECT COALESCE(SUM(
         CASE
           WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
           ELSE duration_mins
         END
       ), 0) AS total_mins
       FROM hos_logs
       WHERE driver_id = $1
         AND duty_status = 'DRIVING'
         AND started_at >= NOW() - INTERVAL '168 hours'`,
      driverId,
    ),
    // 8-day on_duty (DRIVING + ON_DUTY)
    query<{ total_mins: unknown }>(
      `SELECT COALESCE(SUM(
         CASE
           WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
           ELSE duration_mins
         END
       ), 0) AS total_mins
       FROM hos_logs
       WHERE driver_id = $1
         AND duty_status IN ('DRIVING', 'ON_DUTY')
         AND started_at >= NOW() - INTERVAL '192 hours'`,
      driverId,
    ),
    // Current (latest) status
    query<{ duty_status: string; started_at: unknown; driver_name: string | null }>(
      `SELECT duty_status, started_at, driver_name
       FROM hos_logs
       WHERE driver_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      driverId,
    ),
    // Open violations count
    query<{ count: bigint }>(
      `SELECT COUNT(*) AS count
       FROM hos_violations
       WHERE driver_id = $1 AND status = 'OPEN'`,
      driverId,
    ),
  ]);

  // Aggregate today's minutes per status
  let drivingMins = 0;
  let onDutyMins = 0;
  let offDutyMins = 0;

  for (const row of todayRows) {
    const mins = Number(row.total_mins ?? 0);
    if (row.duty_status === 'DRIVING') drivingMins += mins;
    else if (row.duty_status === 'ON_DUTY') onDutyMins += mins;
    else if (row.duty_status === 'OFF_DUTY' || row.duty_status === 'SLEEPER_BERTH') offDutyMins += mins;
  }

  // On-duty total for 24h limit includes DRIVING
  const onDutyTotal = drivingMins + onDutyMins;

  const drivingWeekMins = Number(weekRows[0]?.total_mins ?? 0);
  const onDutyWeekMins  = Number(weekOnDutyRows[0]?.total_mins ?? 0);

  const currentStatus = currentStatusRows[0]?.duty_status ?? 'OFF_DUTY';
  const currentStatusSince = currentStatusRows[0]?.started_at
    ? new Date(currentStatusRows[0].started_at as string).toISOString()
    : null;
  const driverName = currentStatusRows[0]?.driver_name ?? null;
  const openViolations = Number(violationRows[0]?.count ?? 0);

  const riskLevel = computeRiskLevel(drivingMins, onDutyTotal, drivingWeekMins, onDutyWeekMins);

  return {
    driverId,
    driverName,
    today: {
      drivingMins: Math.round(drivingMins),
      onDutyMins: Math.round(onDutyMins),
      offDutyMins: Math.round(offDutyMins),
      drivingHours: Math.round(drivingMins) / 60,
      onDutyHours: Math.round(onDutyTotal) / 60,
      remainingDrivingHours: Math.max(0, (MAX_DRIVING_24H_MINS - drivingMins) / 60),
      remainingOnDutyHours: Math.max(0, (MAX_ON_DUTY_24H_MINS - onDutyTotal) / 60),
    },
    week: {
      drivingHours: drivingWeekMins / 60,
      onDutyHours: onDutyWeekMins / 60,
      remainingWeeklyDrivingHours: Math.max(0, (MAX_DRIVING_7D_MINS - drivingWeekMins) / 60),
      remainingWeeklyOnDutyHours: Math.max(0, (MAX_ON_DUTY_8D_MINS - onDutyWeekMins) / 60),
    },
    currentStatus,
    currentStatusSince,
    openViolations,
    riskLevel,
  };
}

export async function GET(req: NextRequest) {
  await ensureHosSchema();
  try {
    const sp = req.nextUrl.searchParams;
    const driverId = sp.get('driver_id');
    const days = parseInt(sp.get('days') ?? '7', 10);

    if (driverId) {
      const summary = await buildDriverSummary(driverId);
      return NextResponse.json(ser(summary));
    }

    // All drivers with activity in the past `days` days
    const driverRows = await query<{ driver_id: string }>(
      `SELECT DISTINCT driver_id
       FROM hos_logs
       WHERE started_at >= NOW() - ($1 || ' days')::INTERVAL
       ORDER BY driver_id`,
      String(days),
    );

    const summaries = await Promise.all(
      driverRows.map((r) => buildDriverSummary(r.driver_id)),
    );

    return NextResponse.json(ser(summaries));
  } catch (error) {
    console.error('Error fetching HoS summary:', error);
    return NextResponse.json({ error: 'Failed to fetch HoS summary' }, { status: 500 });
  }
}
