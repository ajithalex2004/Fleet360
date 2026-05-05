import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureHosSchema } from '@/lib/fleet/hos-schema';

type Row = Record<string, unknown>;

const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

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
const LIMITS = {
  MAX_DRIVING_24H_MINS: 10 * 60,   // 600 mins
  MAX_ON_DUTY_24H_MINS: 14 * 60,   // 840 mins
  MAX_DRIVING_7D_MINS: 56 * 60,    // 3360 mins
  MAX_ON_DUTY_8D_MINS: 70 * 60,    // 4200 mins
};

async function runViolationCheck(driverId: string, driverName: string | null) {
  const now = new Date().toISOString();

  const [driving24h, onDuty24h, driving7d, onDuty8d] = await Promise.all([
    query<{ total_mins: unknown }>(
      `SELECT COALESCE(SUM(duration_mins), 0) AS total_mins
       FROM hos_logs
       WHERE driver_id = $1
         AND duty_status = 'DRIVING'
         AND started_at >= NOW() - INTERVAL '24 hours'
         AND duration_mins IS NOT NULL`,
      driverId,
    ),
    query<{ total_mins: unknown }>(
      `SELECT COALESCE(SUM(duration_mins), 0) AS total_mins
       FROM hos_logs
       WHERE driver_id = $1
         AND duty_status IN ('DRIVING', 'ON_DUTY')
         AND started_at >= NOW() - INTERVAL '24 hours'
         AND duration_mins IS NOT NULL`,
      driverId,
    ),
    query<{ total_mins: unknown }>(
      `SELECT COALESCE(SUM(duration_mins), 0) AS total_mins
       FROM hos_logs
       WHERE driver_id = $1
         AND duty_status = 'DRIVING'
         AND started_at >= NOW() - INTERVAL '168 hours'
         AND duration_mins IS NOT NULL`,
      driverId,
    ),
    query<{ total_mins: unknown }>(
      `SELECT COALESCE(SUM(duration_mins), 0) AS total_mins
       FROM hos_logs
       WHERE driver_id = $1
         AND duty_status IN ('DRIVING', 'ON_DUTY')
         AND started_at >= NOW() - INTERVAL '192 hours'
         AND duration_mins IS NOT NULL`,
      driverId,
    ),
  ]);

  const driv24 = Number(driving24h[0]?.total_mins ?? 0);
  const duty24 = Number(onDuty24h[0]?.total_mins ?? 0);
  const driv7d = Number(driving7d[0]?.total_mins ?? 0);
  const duty8d = Number(onDuty8d[0]?.total_mins ?? 0);

  const violations: Array<{
    type: string;
    severity: string;
    description: string;
    hoursExceeded: number;
  }> = [];

  if (driv24 > LIMITS.MAX_DRIVING_24H_MINS) {
    const exceeded = (driv24 - LIMITS.MAX_DRIVING_24H_MINS) / 60;
    violations.push({
      type: 'DAILY_DRIVING_LIMIT',
      severity: 'CRITICAL',
      description: `Driver exceeded 10-hour daily driving limit by ${exceeded.toFixed(2)} hours`,
      hoursExceeded: exceeded,
    });
  }

  if (duty24 > LIMITS.MAX_ON_DUTY_24H_MINS) {
    const exceeded = (duty24 - LIMITS.MAX_ON_DUTY_24H_MINS) / 60;
    violations.push({
      type: 'DAILY_ON_DUTY_LIMIT',
      severity: 'CRITICAL',
      description: `Driver exceeded 14-hour daily on-duty limit by ${exceeded.toFixed(2)} hours`,
      hoursExceeded: exceeded,
    });
  }

  if (driv7d > LIMITS.MAX_DRIVING_7D_MINS) {
    const exceeded = (driv7d - LIMITS.MAX_DRIVING_7D_MINS) / 60;
    violations.push({
      type: 'WEEKLY_DRIVING_LIMIT',
      severity: 'CRITICAL',
      description: `Driver exceeded 56-hour weekly driving limit by ${exceeded.toFixed(2)} hours`,
      hoursExceeded: exceeded,
    });
  }

  if (duty8d > LIMITS.MAX_ON_DUTY_8D_MINS) {
    const exceeded = (duty8d - LIMITS.MAX_ON_DUTY_8D_MINS) / 60;
    violations.push({
      type: 'WEEKLY_ON_DUTY_LIMIT',
      severity: 'CRITICAL',
      description: `Driver exceeded 70-hour 8-day on-duty limit by ${exceeded.toFixed(2)} hours`,
      hoursExceeded: exceeded,
    });
  }

  for (const v of violations) {
    // Use a unique constraint simulation: skip if same driver+type+date already open
    const existing = await query<{ id: string }>(
      `SELECT id FROM hos_violations
       WHERE driver_id = $1
         AND violation_type = $2
         AND DATE(occurred_at) = DATE($3::TIMESTAMPTZ)
         AND status = 'OPEN'
       LIMIT 1`,
      driverId,
      v.type,
      now,
    );

    if (existing.length === 0) {
      await exec(
        `INSERT INTO hos_violations (
           driver_id, driver_name, violation_type, occurred_at,
           severity, description, hours_exceeded, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN')`,
        driverId,
        driverName ?? null,
        v.type,
        now,
        v.severity,
        v.description,
        v.hoursExceeded,
      );
    }
  }
}

export async function GET(req: NextRequest) {
  await ensureHosSchema();
  try {
    const sp = req.nextUrl.searchParams;
    const driverId = sp.get('driver_id');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const status = sp.get('status'); // 'ongoing' filters to ended_at IS NULL
    const limit = Math.min(parseInt(sp.get('limit') ?? '50', 10), 200);
    const offset = parseInt(sp.get('offset') ?? '0', 10);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (driverId) {
      params.push(driverId);
      conditions.push(`driver_id = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`started_at >= $${params.length}::TIMESTAMPTZ`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`started_at <= $${params.length}::TIMESTAMPTZ`);
    }
    if (status === 'ongoing') {
      conditions.push(`ended_at IS NULL`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countParams = [...params];
    params.push(limit, offset);

    const [countRows, rows] = await Promise.all([
      query<{ count: bigint }>(
        `SELECT COUNT(*) AS count FROM hos_logs ${where}`,
        ...countParams,
      ),
      query<Row>(
        `SELECT *,
           CASE
             WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
             ELSE duration_mins
           END AS computed_duration_mins
         FROM hos_logs
         ${where}
         ORDER BY started_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ...params,
      ),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

    return NextResponse.json(
      ser({
        data: rows,
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      }),
    );
  } catch (error) {
    console.error('Error fetching HoS logs:', error);
    return NextResponse.json({ error: 'Failed to fetch HoS logs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureHosSchema();
  try {
    const body = await req.json();

    if (!body.driver_id || !body.duty_status || !body.started_at) {
      return NextResponse.json(
        { error: 'driver_id, duty_status, and started_at are required' },
        { status: 400 },
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const rows = await query<Row>(
      `INSERT INTO hos_logs (
         id, driver_id, driver_name, vehicle_id, vehicle_code,
         duty_status, started_at, ended_at, duration_mins,
         location, notes, source, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14
       ) RETURNING *`,
      id,
      body.driver_id,
      body.driver_name ?? null,
      body.vehicle_id ?? null,
      body.vehicle_code ?? null,
      body.duty_status,
      body.started_at,
      body.ended_at ?? null,
      body.duration_mins ?? null,
      body.location ?? null,
      body.notes ?? null,
      body.source ?? 'MANUAL',
      now,
      now,
    );

    // Run violation check asynchronously (best-effort)
    runViolationCheck(body.driver_id, body.driver_name ?? null).catch((e) =>
      console.error('Violation check error:', e),
    );

    return NextResponse.json(ser(rows[0]), { status: 201 });
  } catch (error) {
    console.error('Error creating HoS log:', error);
    return NextResponse.json({ error: 'Failed to create HoS log' }, { status: 500 });
  }
}
