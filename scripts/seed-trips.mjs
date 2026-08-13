/**
 * School Bus Demo Trip Seeder
 * Seeds realistic UAE school bus trips + telemetry events
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const TENANT = 'default';

/* ── Helpers ─────────────────────────────────────────────── */
function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function ts(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00+04:00`).toISOString();
}
function randomBetween(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
async function exec(sql, ...vals) {
  return prisma.$executeRawUnsafe(sql, ...vals).catch(() => {});
}
async function query(sql, ...vals) {
  return prisma.$queryRawUnsafe(sql, ...vals).catch(() => []);
}

/* ── Seed data ───────────────────────────────────────────── */
const ROUTES = [
  { name: 'Marina Morning Pickup',    code: 'RTE-001', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB-A-12345', driver: 'Ahmed Al Mansouri',   attendant: 'Fatima Al Zaabi',  stops: ['Marina Walk', 'JBR Tower 5', 'Media City Station', 'Knowledge Village', 'Al Quoz School'], students: 28 },
  { name: 'JBR Afternoon Drop',       code: 'RTE-002', session: 'AFTERNOON', direction: 'DROPOFF', plate: 'SHJ-B-67890', driver: 'Mohammed Al Rashidi',  attendant: 'Aisha Mohammed',   stops: ['School Gate', 'JBR Cluster A', 'Marina Heights', 'Dubai Marina Metro'], students: 22 },
  { name: 'Downtown Morning Pickup',  code: 'RTE-003', session: 'MORNING',   direction: 'PICKUP',  plate: 'AUH-C-34567', driver: 'Khalid Al Hamdan',     attendant: 'Mariam Al Nuaimi', stops: ['Burj Khalifa Area', 'Downtown Blvd', 'Business Bay', 'DIFC Gate'], students: 35 },
  { name: 'Jumeirah Morning Pickup',  code: 'RTE-004', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB-D-89012', driver: 'Salem Al Ketbi',       attendant: 'Hessa Al Mansoori',stops: ['Jumeirah 1', 'Jumeirah 2', 'Safa Park', 'Al Wasl Road'], students: 18 },
  { name: 'Al Barsha Evening Drop',   code: 'RTE-005', session: 'AFTERNOON', direction: 'DROPOFF', plate: 'DXB-E-45678', driver: 'Saeed Al Falasi',      attendant: 'Latifa Al Shamsi', stops: ['School Exit', 'Al Barsha 1', 'Al Barsha 2', 'Sheikh Zayed Rd'], students: 30 },
  { name: 'Deira Morning Pickup',     code: 'RTE-006', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB-F-23456', driver: 'Rashid Al Mualla',     attendant: 'Noura Al Marri',   stops: ['Gold Souk Area', 'Deira City Centre', 'Union Metro', 'Rigga Station'], students: 25 },
  { name: 'Silicon Oasis Route',      code: 'RTE-007', session: 'MORNING',   direction: 'PICKUP',  plate: 'DXB-G-78901', driver: 'Hassan Al Shamsi',     attendant: 'Sara Al Nuaimi',   stops: ['DSO Cluster A', 'DSO Cluster B', 'Academic City', 'Nad Al Sheba'], students: 32 },
  { name: 'Mirdif Afternoon Drop',    code: 'RTE-008', session: 'AFTERNOON', direction: 'DROPOFF', plate: 'DXB-H-56789', driver: 'Omar Al Rashidi',      attendant: 'Reem Al Qubaisi',  stops: ['School Gate', 'Mirdif City Centre', 'Uptown Mirdif', 'Mushrif Park'], students: 20 },
];

/* ── Trip templates per day ─────────────────────────────── */
// daysAgo=0 → today, 1 → yesterday, etc.
const TRIP_PLANS = [
  // Today: mix of completed morning, in-progress afternoon, scheduled future
  { daysAgo: 0, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:55', speed: 42, maxSpeed: 72, distKm: 18.4, speeding: 1, braking: 2, geofence: 0 },
  { daysAgo: 0, routeIdx: 2, status: 'COMPLETED',   startTime: '06:30', endTime: '07:40', speed: 38, maxSpeed: 68, distKm: 14.2, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 0, routeIdx: 3, status: 'COMPLETED',   startTime: '06:55', endTime: '07:50', speed: 35, maxSpeed: 61, distKm: 11.8, speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 5, status: 'COMPLETED',   startTime: '06:40', endTime: '07:48', speed: 40, maxSpeed: 75, distKm: 16.3, speeding: 2, braking: 1, geofence: 1 },
  { daysAgo: 0, routeIdx: 1, status: 'IN_PROGRESS', startTime: '14:00', endTime: null,    speed: 36, maxSpeed: 58, distKm: null,  speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 4, status: 'IN_PROGRESS', startTime: '14:15', endTime: null,    speed: 33, maxSpeed: 62, distKm: null,  speeding: 1, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 7, status: 'SCHEDULED',   startTime: '15:00', endTime: null,    speed: null,maxSpeed:null,distKm:null,  speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 0, routeIdx: 6, status: 'SCHEDULED',   startTime: '06:50', endTime: null,    speed: null,maxSpeed:null,distKm:null,  speeding: 0, braking: 0, geofence: 0 },
  // Yesterday: all completed + one cancelled
  { daysAgo: 1, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:52', speed: 44, maxSpeed: 70, distKm: 18.1, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 1, routeIdx: 2, status: 'COMPLETED',   startTime: '06:32', endTime: '07:45', speed: 39, maxSpeed: 65, distKm: 14.5, speeding: 1, braking: 2, geofence: 0 },
  { daysAgo: 1, routeIdx: 1, status: 'COMPLETED',   startTime: '14:02', endTime: '15:10', speed: 37, maxSpeed: 60, distKm: 12.2, speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 1, routeIdx: 4, status: 'COMPLETED',   startTime: '14:10', endTime: '15:18', speed: 35, maxSpeed: 64, distKm: 13.8, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 1, routeIdx: 3, status: 'CANCELLED',   startTime: '06:55', endTime: null,    speed: null,maxSpeed:null,distKm:null,  speeding: 0, braking: 0, geofence: 0, notes: 'Vehicle breakdown — replacement arranged' },
  { daysAgo: 1, routeIdx: 5, status: 'COMPLETED',   startTime: '06:40', endTime: '07:50', speed: 41, maxSpeed: 69, distKm: 15.9, speeding: 1, braking: 0, geofence: 0 },
  // 2 days ago: full day
  { daysAgo: 2, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:58', speed: 40, maxSpeed: 67, distKm: 17.9, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 2, routeIdx: 6, status: 'COMPLETED',   startTime: '06:50', endTime: '08:05', speed: 36, maxSpeed: 71, distKm: 19.2, speeding: 2, braking: 3, geofence: 1 },
  { daysAgo: 2, routeIdx: 2, status: 'COMPLETED',   startTime: '06:30', endTime: '07:42', speed: 38, maxSpeed: 63, distKm: 13.8, speeding: 0, braking: 0, geofence: 0 },
  { daysAgo: 2, routeIdx: 7, status: 'COMPLETED',   startTime: '14:20', endTime: '15:25', speed: 34, maxSpeed: 58, distKm: 11.4, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 2, routeIdx: 4, status: 'COMPLETED',   startTime: '14:15', endTime: '15:22', speed: 36, maxSpeed: 62, distKm: 13.1, speeding: 1, braking: 0, geofence: 0 },
  // 3 days ago
  { daysAgo: 3, routeIdx: 0, status: 'COMPLETED',   startTime: '06:45', endTime: '07:54', speed: 43, maxSpeed: 73, distKm: 18.6, speeding: 1, braking: 0, geofence: 0 },
  { daysAgo: 3, routeIdx: 5, status: 'COMPLETED',   startTime: '06:40', endTime: '07:51', speed: 39, maxSpeed: 66, distKm: 16.1, speeding: 0, braking: 2, geofence: 0 },
  { daysAgo: 3, routeIdx: 1, status: 'COMPLETED',   startTime: '14:05', endTime: '15:08', speed: 37, maxSpeed: 59, distKm: 11.9, speeding: 0, braking: 1, geofence: 0 },
  { daysAgo: 3, routeIdx: 3, status: 'COMPLETED',   startTime: '06:55', endTime: '07:49', speed: 34, maxSpeed: 60, distKm: 11.6, speeding: 0, braking: 0, geofence: 0 },
];

/* ── Event builder per trip ─────────────────────────────── */
function buildEvents(tripId, plan, route, tripDate) {
  const events = [];
  const { startTime, endTime, status, speeding, braking, geofence } = plan;
  if (status === 'SCHEDULED' || status === 'CANCELLED') return events;

  const base = new Date(`${tripDate}T${startTime}:00+04:00`);
  let minuteOffset = 0;

  const addEvt = (type, desc, extras = {}) => {
    events.push({
      tripId, type, desc, extras,
      time: new Date(base.getTime() + minuteOffset * 60000).toISOString(),
    });
  };

  // Departure
  addEvt('DEPARTURE', `Trip started from depot — Route ${route.code}`);
  minuteOffset += randomBetween(3, 6);

  // Stop arrivals
  route.stops.forEach((stop, i) => {
    addEvt('STOP_ARRIVAL', `Arrived at ${stop}`, { stop_name: stop });
    minuteOffset += 1;
    const boarded = randomBetween(3, 7);
    for (let b = 0; b < Math.min(boarded, 3); b++) {
      minuteOffset += 1;
      addEvt('BOARDING', `Student boarded at ${stop}`, { stop_name: stop, students_count: boarded });
    }
    minuteOffset += randomBetween(4, 9);
    if (i < route.stops.length - 1) {
      addEvt('STOP_DEPARTURE', `Departed from ${stop}`, { stop_name: stop });
    }
  });

  // Safety events
  if (speeding > 0) {
    for (let s = 0; s < speeding; s++) {
      addEvt('SPEEDING', `Speed exceeded — ${randomBetween(82, 95)} km/h in 80 zone`, { speed_kmh: randomBetween(82, 95) });
      minuteOffset += randomBetween(5, 12);
    }
  }
  if (braking > 0) {
    for (let b = 0; b < braking; b++) {
      addEvt('HARSH_BRAKING', 'Harsh braking detected', { speed_kmh: randomBetween(45, 65) });
      minuteOffset += randomBetween(3, 8);
    }
  }
  if (geofence > 0) {
    addEvt('GEOFENCE_EXIT', 'Vehicle exited approved route corridor', {});
    minuteOffset += randomBetween(2, 5);
  }

  // Arrival (completed trips only)
  if (status === 'COMPLETED' && endTime) {
    addEvt('ARRIVAL', `Trip completed — all ${route.students} students ${plan.direction === 'PICKUP' ? 'delivered' : 'dropped'}`);
  }

  return events;
}

/* ── Ensure tables ───────────────────────────────────────── */
async function ensureTables() {
  const e = (sql) => prisma.$executeRawUnsafe(sql).catch(() => {});
  await e(`CREATE TABLE IF NOT EXISTS school_bus_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    trip_code TEXT, route_id UUID, route_name TEXT, route_code TEXT,
    vehicle_id TEXT, vehicle_plate TEXT, driver_id TEXT, driver_name TEXT,
    attendant_id UUID, attendant_name TEXT,
    direction TEXT NOT NULL DEFAULT 'PICKUP', session TEXT NOT NULL DEFAULT 'MORNING',
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE, scheduled_start TIME,
    actual_start TIMESTAMPTZ, actual_end TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    students_total INT NOT NULL DEFAULT 0, students_boarded INT NOT NULL DEFAULT 0,
    students_dropped INT NOT NULL DEFAULT 0, stops_total INT NOT NULL DEFAULT 0,
    stops_completed INT NOT NULL DEFAULT 0,
    distance_km DOUBLE PRECISION, duration_min INT,
    avg_speed_kmh DOUBLE PRECISION, max_speed_kmh DOUBLE PRECISION,
    speeding_events INT NOT NULL DEFAULT 0, harsh_braking INT NOT NULL DEFAULT 0,
    geofence_exits INT NOT NULL DEFAULT 0, notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await e(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sbt2_code ON school_bus_trips(trip_code, tenant_id) WHERE trip_code IS NOT NULL`);
  await e(`CREATE TABLE IF NOT EXISTS school_bus_trip_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    trip_id UUID NOT NULL, event_type TEXT NOT NULL,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lat DOUBLE PRECISION, lng DOUBLE PRECISION, speed_kmh DOUBLE PRECISION,
    stop_id UUID, stop_name TEXT, student_id UUID, student_name TEXT,
    students_count INT, description TEXT, metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await e(`CREATE INDEX IF NOT EXISTS idx_sbte_trip ON school_bus_trip_events(trip_id, event_time)`);
}

/* ── Main ────────────────────────────────────────────────── */
async function main() {
  console.log('🚌 Seeding school bus demo trips...\n');
  await ensureTables();

  let tripCount = 0;
  let eventCount = 0;
  let skipped = 0;

  for (const plan of TRIP_PLANS) {
    const route    = ROUTES[plan.routeIdx];
    const tripDate = dateStr(plan.daysAgo);
    const dayLabel = plan.daysAgo === 0 ? 'Today' : plan.daysAgo === 1 ? 'Yesterday' : `${plan.daysAgo} days ago`;

    // Build trip code
    const [countRow] = await query(
      `SELECT COUNT(*) AS cnt FROM school_bus_trips WHERE tenant_id = $1 AND scheduled_date = $2`,
      TENANT, tripDate,
    );
    const seq      = String(Number(countRow?.cnt ?? 0) + 1).padStart(3, '0');
    const tripCode = `TRIP-${tripDate.replace(/-/g, '')}-${seq}`;

    // Skip if already exists (idempotent)
    const [existing] = await query(
      `SELECT id FROM school_bus_trips WHERE trip_code = $1 AND tenant_id = $2`, tripCode, TENANT,
    );
    if (existing?.id) { skipped++; continue; }

    // Calculate duration
    let durationMin = null;
    if (plan.startTime && plan.endTime) {
      const [sh, sm] = plan.startTime.split(':').map(Number);
      const [eh, em] = plan.endTime.split(':').map(Number);
      durationMin = (eh * 60 + em) - (sh * 60 + sm);
    }

    // Insert trip
    const [tripRow] = await query(`
      INSERT INTO school_bus_trips (
        tenant_id, trip_code, route_name, route_code,
        vehicle_plate, driver_name, attendant_name,
        direction, session, scheduled_date, scheduled_start,
        actual_start, actual_end,
        students_total, stops_total, stops_completed, students_boarded,
        distance_km, duration_min, avg_speed_kmh, max_speed_kmh,
        speeding_events, harsh_braking, geofence_exits,
        status, notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::time,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
      ) RETURNING id
    `,
      TENANT, tripCode, route.name, route.code,
      route.plate, route.driver, route.attendant,
      plan.direction ?? route.direction, route.session, tripDate, plan.startTime,
      plan.status !== 'SCHEDULED' && plan.status !== 'CANCELLED' ? ts(tripDate, plan.startTime) : null,
      plan.endTime ? ts(tripDate, plan.endTime) : null,
      route.students, route.stops.length,
      plan.status === 'COMPLETED' ? route.stops.length : plan.status === 'IN_PROGRESS' ? Math.ceil(route.stops.length / 2) : 0,
      plan.status === 'COMPLETED' ? route.students : plan.status === 'IN_PROGRESS' ? Math.ceil(route.students / 2) : 0,
      plan.distKm, durationMin, plan.speed, plan.maxSpeed,
      plan.speeding, plan.braking, plan.geofence,
      plan.status, plan.notes ?? null,
    );

    if (!tripRow?.id) { console.warn(`  ⚠ Failed to insert trip ${tripCode}`); continue; }
    tripCount++;
    console.log(`  ✅ [${dayLabel}] ${tripCode} — ${route.name} (${plan.status})`);

    // Insert events
    const events = buildEvents(tripRow.id, plan, route, tripDate);
    for (const evt of events) {
      await exec(`
        INSERT INTO school_bus_trip_events
          (tenant_id, trip_id, event_type, event_time, stop_name, students_count, description, speed_kmh, metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      `,
        TENANT, tripRow.id, evt.type,
        evt.time,
        evt.extras?.stop_name ?? null,
        evt.extras?.students_count ?? null,
        evt.desc,
        evt.extras?.speed_kmh ?? null,
        JSON.stringify(evt.extras ?? {}),
      );
      eventCount++;
    }
    if (events.length) console.log(`     → ${events.length} telemetry events`);
  }

  console.log(`\n✅ Done! ${tripCount} trips seeded, ${eventCount} events, ${skipped} skipped (already existed).`);
  console.log(`\nSummary by status:`);
  const rows = await query(`
    SELECT status, COUNT(*) AS cnt FROM school_bus_trips
    WHERE tenant_id = $1 GROUP BY status ORDER BY cnt DESC
  `, TENANT);
  for (const r of rows) {
    console.log(`  ${String(r.status).padEnd(12)} ${r.cnt}`);
  }
}

main()
  .catch(e => { console.error('❌ Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
