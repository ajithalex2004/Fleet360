/**
 * POST /api/school-bus/trips/seed
 *
 * Seeds realistic demo school bus trips + telemetry events.
 * Covers today, yesterday, and 2–3 days ago.
 * Safe to re-run — uses trip_code as idempotency key (ON CONFLICT DO NOTHING).
 *
 * Statuses: COMPLETED · IN_PROGRESS · SCHEDULED · CANCELLED
 * Includes: speeding events, harsh braking, geofence exits, stop arrivals, boarding events
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;
const exec  = (sql: string, ...v: unknown[]) => prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);
const query = <T = Row>(sql: string, ...v: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

/* ── helpers ─────────────────────────────────────────────── */
function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function ts(date: string, time: string) {
  return new Date(`${date}T${time}:00+04:00`).toISOString();
}
function rnd(a: number, b: number) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

/* ── ensure tables ───────────────────────────────────────── */
async function ensureTables() {
  await exec(`CREATE TABLE IF NOT EXISTS school_bus_trips (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        TEXT        NOT NULL DEFAULT 'default',
    trip_code        TEXT,
    route_id         UUID,
    route_name       TEXT,
    route_code       TEXT,
    vehicle_id       TEXT,
    vehicle_plate    TEXT,
    driver_id        TEXT,
    driver_name      TEXT,
    attendant_id     UUID,
    attendant_name   TEXT,
    direction        TEXT        NOT NULL DEFAULT 'PICKUP',
    session          TEXT        NOT NULL DEFAULT 'MORNING',
    scheduled_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
    scheduled_start  TIME,
    actual_start     TIMESTAMPTZ,
    actual_end       TIMESTAMPTZ,
    status           TEXT        NOT NULL DEFAULT 'SCHEDULED',
    students_total   INT         NOT NULL DEFAULT 0,
    students_boarded INT         NOT NULL DEFAULT 0,
    students_dropped INT         NOT NULL DEFAULT 0,
    stops_total      INT         NOT NULL DEFAULT 0,
    stops_completed  INT         NOT NULL DEFAULT 0,
    distance_km      DOUBLE PRECISION,
    duration_min     INT,
    avg_speed_kmh    DOUBLE PRECISION,
    max_speed_kmh    DOUBLE PRECISION,
    speeding_events  INT         NOT NULL DEFAULT 0,
    harsh_braking    INT         NOT NULL DEFAULT 0,
    geofence_exits   INT         NOT NULL DEFAULT 0,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sbt2_code ON school_bus_trips(trip_code, tenant_id) WHERE trip_code IS NOT NULL`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbt2_tenant ON school_bus_trips(tenant_id, status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbt2_date   ON school_bus_trips(scheduled_date)`);

  await exec(`CREATE TABLE IF NOT EXISTS school_bus_trip_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     TEXT        NOT NULL DEFAULT 'default',
    trip_id       UUID        NOT NULL,
    event_type    TEXT        NOT NULL,
    event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lat           DOUBLE PRECISION,
    lng           DOUBLE PRECISION,
    speed_kmh     DOUBLE PRECISION,
    stop_id       UUID,
    stop_name     TEXT,
    student_id    UUID,
    student_name  TEXT,
    students_count INT,
    description   TEXT,
    metadata      JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbte_trip   ON school_bus_trip_events(trip_id, event_time)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbte_tenant ON school_bus_trip_events(tenant_id, event_time)`);
}

/* ── seed data ───────────────────────────────────────────── */
const ROUTES = [
  { name: 'Marina Morning Pickup',    code: 'RTE-001', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB A 12345', driver: 'Ahmed Al Mansouri',  attendant: 'Fatima Al Zaabi',   stops: ['Marina Walk', 'JBR Tower 5', 'Media City', 'Knowledge Village', 'Al Quoz School'], students: 28 },
  { name: 'JBR Afternoon Drop-off',   code: 'RTE-002', session: 'AFTERNOON', direction: 'DROPOFF', plate: 'SHJ B 67890', driver: 'Mohammed Al Rashidi', attendant: 'Aisha Mohammed',    stops: ['School Gate', 'JBR Cluster A', 'Marina Heights', 'Dubai Marina Metro'], students: 22 },
  { name: 'Downtown Morning Pickup',  code: 'RTE-003', session: 'MORNING',   direction: 'PICKUP',  plate: 'AUH C 34567', driver: 'Khalid Al Hamdan',    attendant: 'Mariam Al Nuaimi',  stops: ['Burj Khalifa', 'Downtown Blvd', 'Business Bay', 'DIFC Gate'], students: 35 },
  { name: 'Jumeirah Morning Pickup',  code: 'RTE-004', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB D 89012', driver: 'Salem Al Ketbi',      attendant: 'Hessa Al Mansoori', stops: ['Jumeirah 1', 'Jumeirah 2', 'Safa Park', 'Al Wasl Road'], students: 18 },
  { name: 'Al Barsha Afternoon Drop', code: 'RTE-005', session: 'AFTERNOON', direction: 'DROPOFF', plate: 'DXB E 45678', driver: 'Saeed Al Falasi',     attendant: 'Latifa Al Shamsi',  stops: ['School Exit', 'Al Barsha 1', 'Al Barsha 2', 'Sheikh Zayed Rd'], students: 30 },
  { name: 'Deira Morning Pickup',     code: 'RTE-006', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB F 23456', driver: 'Rashid Al Mualla',    attendant: 'Noura Al Marri',    stops: ['Gold Souk', 'Deira City Centre', 'Union Metro', 'Rigga'], students: 25 },
  { name: 'Silicon Oasis Route',      code: 'RTE-007', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB G 78901', driver: 'Hassan Al Shamsi',    attendant: 'Sara Al Nuaimi',    stops: ['DSO Cluster A', 'DSO Cluster B', 'Academic City', 'Nad Al Sheba'], students: 32 },
  { name: 'Mirdif Afternoon Drop',    code: 'RTE-008', session: 'AFTERNOON', direction: 'DROPOFF', plate: 'DXB H 56789', driver: 'Omar Al Rashidi',     attendant: 'Reem Al Qubaisi',   stops: ['School Gate', 'Mirdif City Centre', 'Uptown Mirdif', 'Mushrif Park'], students: 20 },
];

interface TripPlan {
  daysAgo: number; routeIdx: number; status: string;
  startTime: string; endTime: string | null;
  speed: number | null; maxSpeed: number | null; distKm: number | null;
  speeding: number; braking: number; geofence: number; notes?: string;
}

const TRIP_PLANS: TripPlan[] = [
  // Today — morning completed, afternoon in-progress, evening scheduled
  { daysAgo: 0, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:55', speed: 42, maxSpeed: 72, distKm: 18.4, speeding: 1, braking: 2, geofence: 0 },
  { daysAgo: 0, routeIdx: 2, status: 'COMPLETED',   startTime: '06:30', endTime: '07:40', speed: 38, maxSpeed: 68, distKm: 14.2, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 0, routeIdx: 3, status: 'COMPLETED',   startTime: '06:55', endTime: '07:50', speed: 35, maxSpeed: 61, distKm: 11.8, speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 5, status: 'COMPLETED',   startTime: '06:40', endTime: '07:48', speed: 40, maxSpeed: 75, distKm: 16.3, speeding: 2, braking: 1, geofence: 1 },
  { daysAgo: 0, routeIdx: 1, status: 'IN_PROGRESS', startTime: '14:00', endTime: null,    speed: 36, maxSpeed: 58, distKm: null,  speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 4, status: 'IN_PROGRESS', startTime: '14:15', endTime: null,    speed: 33, maxSpeed: 62, distKm: null,  speeding: 1, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 7, status: 'SCHEDULED',   startTime: '15:00', endTime: null,    speed: null, maxSpeed: null, distKm: null, speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 6, status: 'SCHEDULED',   startTime: '06:50', endTime: null,    speed: null, maxSpeed: null, distKm: null, speeding: 0, braking: 0, geofence: 0 },
  // Yesterday — all completed + one cancelled
  { daysAgo: 1, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:52', speed: 44, maxSpeed: 70, distKm: 18.1, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 1, routeIdx: 2, status: 'COMPLETED',   startTime: '06:32', endTime: '07:45', speed: 39, maxSpeed: 65, distKm: 14.5, speeding: 1, braking: 2, geofence: 0 },
  { daysAgo: 1, routeIdx: 1, status: 'COMPLETED',   startTime: '14:02', endTime: '15:10', speed: 37, maxSpeed: 60, distKm: 12.2, speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 1, routeIdx: 4, status: 'COMPLETED',   startTime: '14:10', endTime: '15:18', speed: 35, maxSpeed: 64, distKm: 13.8, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 1, routeIdx: 3, status: 'CANCELLED',   startTime: '06:55', endTime: null,    speed: null, maxSpeed: null, distKm: null, speeding: 0, braking: 0, geofence: 0, notes: 'Vehicle breakdown — replacement arranged for next day' },
  { daysAgo: 1, routeIdx: 5, status: 'COMPLETED',   startTime: '06:40', endTime: '07:50', speed: 41, maxSpeed: 69, distKm: 15.9, speeding: 1, braking: 0, geofence: 0 },
  { daysAgo: 1, routeIdx: 6, status: 'COMPLETED',   startTime: '06:50', endTime: '08:02', speed: 37, maxSpeed: 66, distKm: 19.0, speeding: 0, braking: 2, geofence: 0 },
  { daysAgo: 1, routeIdx: 7, status: 'COMPLETED',   startTime: '14:20', endTime: '15:22', speed: 34, maxSpeed: 57, distKm: 11.1, speeding: 0, braking: 1, geofence: 0 },
  // 2 days ago — full fleet day
  { daysAgo: 2, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:58', speed: 40, maxSpeed: 67, distKm: 17.9, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 2, routeIdx: 6, status: 'COMPLETED',   startTime: '06:50', endTime: '08:05', speed: 36, maxSpeed: 71, distKm: 19.2, speeding: 2, braking: 3, geofence: 1 },
  { daysAgo: 2, routeIdx: 2, status: 'COMPLETED',   startTime: '06:30', endTime: '07:42', speed: 38, maxSpeed: 63, distKm: 13.8, speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 2, routeIdx: 7, status: 'COMPLETED',   startTime: '14:20', endTime: '15:25', speed: 34, maxSpeed: 58, distKm: 11.4, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 2, routeIdx: 4, status: 'COMPLETED',   startTime: '14:15', endTime: '15:22', speed: 36, maxSpeed: 62, distKm: 13.1, speeding: 1, braking: 0, geofence: 0 },
  { daysAgo: 2, routeIdx: 5, status: 'COMPLETED',   startTime: '06:40', endTime: '07:53', speed: 39, maxSpeed: 68, distKm: 16.0, speeding: 0, braking: 1, geofence: 0 },
  // 3 days ago
  { daysAgo: 3, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:54', speed: 43, maxSpeed: 73, distKm: 18.6, speeding: 1, braking: 0, geofence: 0 },
  { daysAgo: 3, routeIdx: 5, status: 'COMPLETED',   startTime: '06:40', endTime: '07:51', speed: 39, maxSpeed: 66, distKm: 16.1, speeding: 0, braking: 2, geofence: 0 },
  { daysAgo: 3, routeIdx: 1, status: 'COMPLETED',   startTime: '14:05', endTime: '15:08', speed: 37, maxSpeed: 59, distKm: 11.9, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 3, routeIdx: 3, status: 'COMPLETED',   startTime: '06:55', endTime: '07:49', speed: 34, maxSpeed: 60, distKm: 11.6, speeding: 0, braking: 0, geofence: 0 },
];

/* ── insert events for a trip ─────────────────────────────── */
async function insertEvents(
  tripId: string,
  plan: TripPlan,
  route: typeof ROUTES[0],
  tripDate: string,
) {
  if (plan.status === 'SCHEDULED' || plan.status === 'CANCELLED') return 0;

  const base = new Date(`${tripDate}T${plan.startTime}:00+04:00`);
  let minOffset = 0;
  let count = 0;

  const addEvt = async (type: string, desc: string, extras: Row = {}) => {
    const evtTime = new Date(base.getTime() + minOffset * 60_000).toISOString();
    await exec(`
      INSERT INTO school_bus_trip_events
        (tenant_id, trip_id, event_type, event_time, stop_name, students_count, description, speed_kmh, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    `,
      'default', tripId, type, evtTime,
      extras.stop_name ?? null,
      extras.students_count ?? null,
      desc,
      extras.speed_kmh ?? null,
      JSON.stringify(extras),
    );
    count++;
  };

  // Departure
  await addEvt('DEPARTURE', `Route ${route.code} departed depot`);
  minOffset += rnd(3, 6);

  // Stops
  for (let i = 0; i < route.stops.length; i++) {
    const stop = route.stops[i];
    await addEvt('STOP_ARRIVAL', `Arrived at ${stop}`, { stop_name: stop });
    minOffset += 1;
    const boarded = rnd(3, 7);
    await addEvt('BOARDING', `${boarded} students boarded at ${stop}`, { stop_name: stop, students_count: boarded });
    minOffset += rnd(4, 9);
    if (i < route.stops.length - 1) {
      await addEvt('STOP_DEPARTURE', `Departed ${stop}`, { stop_name: stop });
    }
  }

  // Safety events
  for (let s = 0; s < plan.speeding; s++) {
    const spd = rnd(82, 96);
    await addEvt('SPEEDING', `Speed ${spd} km/h detected — 80 km/h zone`, { speed_kmh: spd });
    minOffset += rnd(5, 12);
  }
  for (let b = 0; b < plan.braking; b++) {
    await addEvt('HARSH_BRAKING', 'Harsh braking detected', { speed_kmh: rnd(45, 65) });
    minOffset += rnd(3, 8);
  }
  if (plan.geofence > 0) {
    await addEvt('GEOFENCE_EXIT', 'Vehicle exited approved route corridor');
    minOffset += rnd(2, 5);
  }

  // Arrival
  if (plan.status === 'COMPLETED' && plan.endTime) {
    await addEvt('ARRIVAL', `All students ${route.direction === 'PICKUP' ? 'delivered to school' : 'dropped home'}`);
  }

  return count;
}

/* ── main seed logic ─────────────────────────────────────── */
export async function POST() {
  try {
    await ensureTables();

    let tripCount   = 0;
    let eventCount  = 0;
    let skipped     = 0;
    const inserted: string[] = [];

    for (const plan of TRIP_PLANS) {
      const route    = ROUTES[plan.routeIdx];
      const tripDate = dateStr(plan.daysAgo);

      // Unique trip code per route+date
      const safeCode = `${route.code}-${tripDate}-${plan.session ?? route.session}`;

      // Skip if already exists
      const [existing] = await query<{ id: string }>(
        `SELECT id FROM school_bus_trips WHERE trip_code = $1 AND tenant_id = 'default'`, safeCode,
      );
      if (existing?.id) { skipped++; continue; }

      // Duration
      let durationMin: number | null = null;
      if (plan.startTime && plan.endTime) {
        const [sh, sm] = plan.startTime.split(':').map(Number);
        const [eh, em] = plan.endTime.split(':').map(Number);
        durationMin = (eh * 60 + em) - (sh * 60 + sm);
      }

      const isActive = plan.status !== 'SCHEDULED' && plan.status !== 'CANCELLED';
      const stopsCompleted = plan.status === 'COMPLETED'
        ? route.stops.length
        : plan.status === 'IN_PROGRESS'
        ? Math.ceil(route.stops.length / 2)
        : 0;
      const studentsBoarded = plan.status === 'COMPLETED'
        ? route.students
        : plan.status === 'IN_PROGRESS'
        ? Math.ceil(route.students / 2)
        : 0;

      const [tripRow] = await query<{ id: string }>(`
        INSERT INTO school_bus_trips (
          tenant_id, trip_code, route_name, route_code,
          vehicle_plate, driver_name, attendant_name,
          direction, session, scheduled_date, scheduled_start,
          actual_start, actual_end,
          students_total, students_boarded, stops_total, stops_completed,
          distance_km, duration_min, avg_speed_kmh, max_speed_kmh,
          speeding_events, harsh_braking, geofence_exits,
          status, notes
        ) VALUES (
          'default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10::time,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
        )
        ON CONFLICT (trip_code, tenant_id) DO NOTHING
        RETURNING id
      `,
        safeCode, route.name, route.code,
        route.plate, route.driver, route.attendant,
        route.direction, route.session, tripDate, plan.startTime,
        isActive ? ts(tripDate, plan.startTime) : null,
        plan.endTime ? ts(tripDate, plan.endTime) : null,
        route.students, studentsBoarded,
        route.stops.length, stopsCompleted,
        plan.distKm, durationMin, plan.speed, plan.maxSpeed,
        plan.speeding, plan.braking, plan.geofence,
        plan.status, plan.notes ?? null,
      );

      if (!tripRow?.id) { skipped++; continue; }

      tripCount++;
      inserted.push(`${safeCode} (${plan.status})`);

      // Telemetry events
      const evts = await insertEvents(tripRow.id, plan, route, tripDate);
      eventCount += evts;
    }

    // Final summary from DB
    const statusSummary = await query<{ status: string; cnt: bigint }>(
      `SELECT status, COUNT(*) AS cnt FROM school_bus_trips WHERE tenant_id = 'default' GROUP BY status ORDER BY cnt DESC`,
    );

    return NextResponse.json({
      ok: true,
      tripsInserted: tripCount,
      eventsInserted: eventCount,
      skipped,
      inserted,
      databaseTotals: statusSummary.map(r => ({ status: r.status, count: Number(r.cnt) })),
      message: `✅ Seeded ${tripCount} trips and ${eventCount} telemetry events. ${skipped} already existed.`,
    });
  } catch (err) {
    console.error('[school-bus/trips/seed POST]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
