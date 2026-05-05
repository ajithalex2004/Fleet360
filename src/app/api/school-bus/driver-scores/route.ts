/**
 * GET  /api/school-bus/driver-scores?tenantId=X&period=YYYY-MM
 *   Returns the RAG (Red/Amber/Green) safety scores for all school bus drivers
 *   for the given month. Aggregates from school_bus_trip_events.
 *
 * POST /api/school-bus/driver-scores
 *   Manually upserts a driver score record (for seeding or manual overrides).
 *
 * RAG thresholds (configurable, stored in DB):
 *   GREEN (safe)  : score >= 80
 *   AMBER (watch) : score 60–79
 *   RED (action)  : score < 60
 *
 * Score components (100 points total):
 *   Speeding events    : -5 per event  (max -25)
 *   Harsh braking      : -3 per event  (max -15)
 *   Geofence exits     : -10 per exit  (max -30)
 *   Incidents          : -15 per event (no cap)
 *   On-time departure  : +0 / -5 per late departure
 *   Trip completion    : +0 / -10 if trip not completed
 *   Base score         : 100
 *
 * Table: school_bus_driver_scores
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

async function ensureTable() {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});

  await exec(`
    CREATE TABLE IF NOT EXISTS school_bus_driver_scores (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT        NOT NULL DEFAULT 'default',
      driver_id           TEXT,
      driver_name         TEXT        NOT NULL,
      period              TEXT        NOT NULL,
      -- Format: YYYY-MM (e.g. 2025-03)

      -- Trip metrics
      trips_total         INT         NOT NULL DEFAULT 0,
      trips_completed     INT         NOT NULL DEFAULT 0,
      total_distance_km   DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_students      INT         NOT NULL DEFAULT 0,

      -- Safety deductions
      speeding_events     INT         NOT NULL DEFAULT 0,
      harsh_braking       INT         NOT NULL DEFAULT 0,
      geofence_exits      INT         NOT NULL DEFAULT 0,
      incidents           INT         NOT NULL DEFAULT 0,
      late_departures     INT         NOT NULL DEFAULT 0,

      -- Calculated score (0–100)
      raw_score           INT         NOT NULL DEFAULT 100,
      rag_status          TEXT        NOT NULL DEFAULT 'GREEN',
      -- RED | AMBER | GREEN

      -- Trend vs previous period
      prev_score          INT,
      score_delta         INT,
      -- positive = improved

      -- Manual override
      manual_override     BOOLEAN     NOT NULL DEFAULT false,
      override_reason     TEXT,
      override_by         TEXT,

      notes               TEXT,
      computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sbds_driver_period ON school_bus_driver_scores(driver_id, period, tenant_id) WHERE driver_id IS NOT NULL`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbds_tenant ON school_bus_driver_scores(tenant_id, period)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbds_rag ON school_bus_driver_scores(rag_status, period)`);
}

function calcRAG(score: number): string {
  if (score >= 80) return 'GREEN';
  if (score >= 60) return 'AMBER';
  return 'RED';
}

function calcScore(data: {
  speedingEvents: number; harshBraking: number; geofenceExits: number;
  incidents: number; lateDepartures: number; tripsTotal: number; tripsCompleted: number;
}): number {
  let score = 100;
  score -= Math.min(data.speedingEvents * 5, 25);
  score -= Math.min(data.harshBraking * 3, 15);
  score -= Math.min(data.geofenceExits * 10, 30);
  score -= data.incidents * 15;
  score -= data.lateDepartures * 5;
  const incompletionRate = data.tripsTotal > 0
    ? (data.tripsTotal - data.tripsCompleted) / data.tripsTotal : 0;
  score -= Math.round(incompletionRate * 10);
  return Math.max(0, Math.min(100, score));
}

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();

    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';
    const period   = sp.get('period')   ?? new Date().toISOString().slice(0, 7);
    const ragStatus= sp.get('ragStatus') ?? '';

    // Try to auto-compute from trip telemetry for this period
    const periodStart = `${period}-01`;
    const periodEnd   = new Date(Number(period.slice(0,4)), Number(period.slice(5,7)), 0).toISOString().slice(0,10);

    const tripAgg = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        t.driver_id,
        t.driver_name,
        COUNT(t.id)                                           AS trips_total,
        SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END) AS trips_completed,
        COALESCE(SUM(t.distance_km), 0)                       AS total_distance_km,
        COALESCE(SUM(t.students_total), 0)                    AS total_students,
        COALESCE(SUM(t.speeding_events), 0)                   AS speeding_events,
        COALESCE(SUM(t.harsh_braking), 0)                     AS harsh_braking,
        COALESCE(SUM(t.geofence_exits), 0)                    AS geofence_exits,
        COUNT(e.id)                                           AS incidents,
        0                                                     AS late_departures
      FROM school_bus_trips t
      LEFT JOIN school_bus_trip_events e
        ON e.trip_id = t.id AND e.event_type = 'INCIDENT'
      WHERE t.tenant_id = $1
        AND t.scheduled_date BETWEEN $2 AND $3
        AND t.driver_name IS NOT NULL
      GROUP BY t.driver_id, t.driver_name
    `, tenantId, periodStart, periodEnd).catch(() => [] as Row[]);

    // Upsert computed scores
    for (const row of tripAgg) {
      const data = {
        speedingEvents:  Number(row.speeding_events ?? 0),
        harshBraking:    Number(row.harsh_braking ?? 0),
        geofenceExits:   Number(row.geofence_exits ?? 0),
        incidents:       Number(row.incidents ?? 0),
        lateDepartures:  Number(row.late_departures ?? 0),
        tripsTotal:      Number(row.trips_total ?? 0),
        tripsCompleted:  Number(row.trips_completed ?? 0),
      };
      const score  = calcScore(data);
      const ragSt  = calcRAG(score);
      const driverId = row.driver_id ? String(row.driver_id) : null;

      await prisma.$executeRawUnsafe(`
        INSERT INTO school_bus_driver_scores
          (tenant_id, driver_id, driver_name, period,
           trips_total, trips_completed, total_distance_km, total_students,
           speeding_events, harsh_braking, geofence_exits, incidents, late_departures,
           raw_score, rag_status, computed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
        ON CONFLICT (driver_id, period, tenant_id) DO UPDATE SET
          trips_total      = EXCLUDED.trips_total,
          trips_completed  = EXCLUDED.trips_completed,
          total_distance_km= EXCLUDED.total_distance_km,
          total_students   = EXCLUDED.total_students,
          speeding_events  = EXCLUDED.speeding_events,
          harsh_braking    = EXCLUDED.harsh_braking,
          geofence_exits   = EXCLUDED.geofence_exits,
          incidents        = EXCLUDED.incidents,
          raw_score        = EXCLUDED.raw_score,
          rag_status       = EXCLUDED.rag_status,
          computed_at      = NOW(),
          updated_at       = NOW()
        WHERE NOT school_bus_driver_scores.manual_override
      `,
        tenantId, driverId, String(row.driver_name), period,
        Number(row.trips_total), Number(row.trips_completed),
        Number(row.total_distance_km), Number(row.total_students),
        data.speedingEvents, data.harshBraking, data.geofenceExits,
        data.incidents, data.lateDepartures, score, ragSt,
      ).catch(() => {});
    }

    // Fetch final records
    const conds: string[] = ['tenant_id = $1', 'period = $2'];
    const vals: unknown[] = [tenantId, period];
    if (ragStatus) { vals.push(ragStatus); conds.push(`rag_status = $${vals.length}`); }

    const scores = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM school_bus_driver_scores
      WHERE ${conds.join(' AND ')}
      ORDER BY raw_score ASC, driver_name ASC
    `, ...vals).catch(() => [] as Row[]);

    const data = serialize(scores);
    const summary = {
      total:  data.length,
      green:  data.filter(d => d.rag_status === 'GREEN').length,
      amber:  data.filter(d => d.rag_status === 'AMBER').length,
      red:    data.filter(d => d.rag_status === 'RED').length,
      avgScore: data.length > 0 ? Math.round(data.reduce((s, d) => s + Number(d.raw_score), 0) / data.length) : 0,
    };

    return NextResponse.json({ scores: data, summary, period });
  } catch (err) {
    console.error('[driver-scores GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const {
      tenantId = 'default', driverId, driverName, period,
      tripsTotal = 0, tripsCompleted = 0, totalDistanceKm = 0, totalStudents = 0,
      speedingEvents = 0, harshBraking = 0, geofenceExits = 0, incidents = 0, lateDepartures = 0,
      manualOverride = false, overrideReason, overrideBy, notes,
    } = body;

    if (!driverName?.trim()) return NextResponse.json({ error: 'driverName is required' }, { status: 400 });
    const p = period ?? new Date().toISOString().slice(0, 7);

    const score  = calcScore({ speedingEvents, harshBraking, geofenceExits, incidents, lateDepartures, tripsTotal, tripsCompleted });
    const ragSt  = calcRAG(score);

    const [row] = await prisma.$queryRawUnsafe<Row[]>(`
      INSERT INTO school_bus_driver_scores
        (tenant_id, driver_id, driver_name, period,
         trips_total, trips_completed, total_distance_km, total_students,
         speeding_events, harsh_braking, geofence_exits, incidents, late_departures,
         raw_score, rag_status, manual_override, override_reason, override_by, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (driver_id, period, tenant_id) DO UPDATE SET
        trips_total = EXCLUDED.trips_total, trips_completed = EXCLUDED.trips_completed,
        raw_score = EXCLUDED.raw_score, rag_status = EXCLUDED.rag_status,
        manual_override = EXCLUDED.manual_override, override_reason = EXCLUDED.override_reason,
        updated_at = NOW()
      RETURNING *
    `,
      tenantId, driverId ?? null, driverName.trim(), p,
      tripsTotal, tripsCompleted, totalDistanceKm, totalStudents,
      speedingEvents, harshBraking, geofenceExits, incidents, lateDepartures,
      score, ragSt, manualOverride, overrideReason ?? null, overrideBy ?? null, notes ?? null,
    );

    return NextResponse.json({ ok: true, score: serialize([row])[0] }, { status: 201 });
  } catch (err) {
    console.error('[driver-scores POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
