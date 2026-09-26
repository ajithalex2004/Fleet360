/**
 * tests/unit/school-bus-trip-columns.test.ts
 *
 * school_bus_trips (prisma/migrations/20260910000019_school_bus_tables_and_rls)
 * has scheduled_date + scheduled_start, actual_start / actual_end, session and
 * trip_code. Five school-bus routes queried scheduled_departure,
 * actual_departure, actual_arrival, session_type and trip_number instead.
 * Postgres rejected those queries (42703), each route's .catch(() => [])
 * turned the error into "no trips", and so:
 *  - the morning no-show sweep never found a trip (and filled the logs),
 *  - the driver's and parent's "today" lists were always empty,
 *  - every RFID / student-code scan answered 404 "Trip not found",
 *  - the manifest PDF answered 404 "Trip not found".
 *
 * These tests run each route and check the SQL it sends for school_bus_trips
 * only uses the table's real columns (the old names may appear only as
 * output aliases), and that the rows still reach the response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = '11111111-1111-4111-8111-111111111111';
const ROUTE = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';
const STUDENT = '44444444-4444-4444-8444-444444444444';

const rec = vi.hoisted(() => ({ sql: [] as string[] }));

const tripRow = {
  id: '33333333-3333-4333-8333-333333333333',
  route_id: '22222222-2222-4222-8222-222222222222',
  route_name: 'Route A',
  status: 'IN_PROGRESS',
  session_type: 'MORNING',
  scheduled_departure: '2026-09-26T06:45:00',
  actual_departure: '2026-09-26 06:50:00+04',
  actual_arrival: null,
  vehicle_id: null,
  driver_name: 'D1',
  driver_id: 'D1',
  trip_number: 'T-1',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  students_boarded: 0,
  students_dropped: 0,
};
const studentRow = {
  id: '44444444-4444-4444-8444-444444444444',
  student_code: 'S-1',
  first_name: 'Sara',
  last_name: 'Ahmed',
  route_id: '22222222-2222-4222-8222-222222222222',
  pickup_stop: 'Stop 1',
  dropoff_stop: 'School',
  medical_notes: null,
};

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const tx = vi.hoisted(() => ({
  $queryRawUnsafe: async (sql: string) => {
    rec.sql.push(sql);
    if (sql.includes('FROM school_bus_trips')) return [tripRow];
    if (sql.includes('FROM school_bus_students')) return [studentRow];
    return [];
  },
  $executeRawUnsafe: async (sql: string) => { rec.sql.push(sql); return 1; },
}));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx),
}));
vi.mock('@/lib/prisma-sweep', () => ({
  runSweep: async (fn: (ctx: unknown) => unknown) => [{ tenantId: TENANT, result: await fn({ tx, tenantId: TENANT }) }],
}));
vi.mock('@/lib/school-bus-notify', () => ({
  loadStudentForNotify: vi.fn(async () => null),
  notifyGuardians: vi.fn(async () => ({ ok: false })),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/sentry', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/pdf/render', () => ({ renderPdf: vi.fn(async () => Buffer.from('%PDF-1.4')) }));

import { NextRequest } from 'next/server';
import { POST as sweepNoShow } from '@/app/api/school-bus/attendance/sweep-no-show/route';
import { GET as driverToday } from '@/app/api/school-bus/driver/today/route';
import { GET as parentToday } from '@/app/api/school-bus/parent/today/route';
import { POST as scan } from '@/app/api/school-bus/attendance/scan/route';
import { GET as manifestPdf } from '@/app/api/school-bus/trips/[id]/manifest/pdf/route';

// Real columns of school_bus_trips, read from the migration that creates it.
const migration = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260910000019_school_bus_tables_and_rls/migration.sql'), 'utf8');
const createTable = migration.match(/CREATE TABLE IF NOT EXISTS school_bus_trips \(([\s\S]*?)\n\);/)![1];
const TRIP_COLUMNS = new Set(
  [...createTable.matchAll(/^\s+([a-z_]+)\s+[A-Z]/gm)].map((m) => m[1])
    .concat([...migration.matchAll(/ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS ([a-z_]+)/g)].map((m) => m[1])),
);
const RENAMED = ['scheduled_departure', 'actual_departure', 'actual_arrival', 'session_type', 'trip_number'];

const headers = { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN' };
const tripQueries = () => rec.sql.filter((s) => s.includes('FROM school_bus_trips'));

/** The trips query references no column the table lacks; old names only as `AS <alias>`. */
function expectRealColumns(sql: string) {
  for (const name of RENAMED) {
    const uses = [...sql.matchAll(new RegExp(`(\\bAS\\s+)?\\b${name}\\b`, 'g'))];
    for (const u of uses) expect(u[1], `"${name}" used as a column in:\n${sql}`).toBeTruthy();
  }
  for (const m of sql.matchAll(/\bt\.([a-z_]+)/g)) {
    expect(TRIP_COLUMNS.has(m[1]), `t.${m[1]} is not a school_bus_trips column`).toBe(true);
  }
}

beforeEach(() => { rec.sql = []; });

describe('school_bus_trips column names', () => {
  it('reads the real column list from the migration', () => {
    for (const c of ['scheduled_date', 'scheduled_start', 'actual_start', 'actual_end', 'session', 'trip_code']) {
      expect(TRIP_COLUMNS.has(c)).toBe(true);
    }
    for (const c of RENAMED) expect(TRIP_COLUMNS.has(c)).toBe(false);
  });

  it('no-show sweep selects today\'s departed morning trips by the real columns', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests';
    const res = await sweepNoShow(new NextRequest(
      'http://localhost/api/school-bus/attendance/sweep-no-show?dryRun=1',
      { method: 'POST', headers: { authorization: 'Bearer cron-secret-for-tests' } },
    ));
    expect(res.status).toBe(200);
    const [q] = tripQueries();
    expectRealColumns(q);
    expect(q).toMatch(/t\.scheduled_date = \$1::date/);
    expect(q).toMatch(/t\.session = 'MORNING'/);
    expect(q).toMatch(/t\.actual_start <= NOW\(\)/);
    const body = await res.json();
    expect(body.tripsScanned).toBe(1);
    expect(body.candidates).toBe(1);
  });

  it('driver "today" returns the trip with its schedule fields', async () => {
    const res = await driverToday(new NextRequest(
      'http://localhost/api/school-bus/driver/today?driverCode=D1', { headers }));
    const [q] = tripQueries();
    expectRealColumns(q);
    expect(q).toMatch(/t\.scheduled_date = \$1::date/);
    const body = await res.json();
    expect(body.trips).toHaveLength(1);
    expect(body.trips[0].scheduled_departure).toBe('2026-09-26T06:45:00');
    expect(body.trips[0].students).toHaveLength(1);
  });

  it('parent "today" returns the student\'s trip', async () => {
    const res = await parentToday(new NextRequest(
      'http://localhost/api/school-bus/parent/today?guardianPhone=%2B971501234567', { headers }));
    const [q] = tripQueries();
    expectRealColumns(q);
    expect(q).toMatch(/t\.scheduled_date = \$2::date/);
    const body = await res.json();
    expect(body.students[0].trips).toHaveLength(1);
  });

  it('scan finds the trip instead of answering 404', async () => {
    const res = await scan(new NextRequest('http://localhost/api/school-bus/attendance/scan', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ tripId: TRIP, scanType: 'BOARDING', studentCode: 'S-1' }),
    }));
    const [q] = tripQueries();
    expectRealColumns(q);
    expect(res.status).not.toBe(404);
  });

  it('manifest PDF finds the trip instead of answering 404', async () => {
    const res = await manifestPdf(
      new NextRequest(`http://localhost/api/school-bus/trips/${TRIP}/manifest/pdf`, { headers }),
      { params: Promise.resolve({ id: TRIP }) },
    );
    const [q] = tripQueries();
    expectRealColumns(q);
    expect(res.status).not.toBe(404);
  });
});

// Keep the fixtures' ids in step with the constants above.
expect(tripRow.route_id).toBe(ROUTE);
expect(studentRow.id).toBe(STUDENT);
