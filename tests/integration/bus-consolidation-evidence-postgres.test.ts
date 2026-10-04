/** Exact Item 4 query against a fresh localhost PostgreSQL database under FORCE RLS. */
import { PrismaClient, type Prisma } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { loadHistoricalTripEvidence } from '@/lib/planning/consolidation-evidence-db';
import { evaluateConsolidationEvidence } from '@/lib/planning/consolidation-evidence';

const connection = process.env.TEST_BUS_EVIDENCE_DATABASE_URL;
const suite = connection ? describe : describe.skip;
const tenantA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
let db: PrismaClient;

async function scoped<T>(tenant: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE bus_evidence_test_role');
    await tx.$queryRaw`SELECT set_config('app.tenant_id',${tenant},true)`;
    return fn(tx);
  });
}

suite('Bus Ops historical evidence PostgreSQL acceptance', () => {
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fleet360_bus_evidence_test')
      throw new Error('Requires isolated localhost fleet360_bus_evidence_test database');
    db = new PrismaClient({ datasources: { db: { url: connection } } });
    const exists = await db.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.trip_schedules')::text AS name`;
    if (exists[0].name) throw new Error('Refusing an existing dataset');
    await db.$executeRawUnsafe(`CREATE TABLE trip_schedules (
      id text PRIMARY KEY, tenant_id uuid NOT NULL, route_id text NOT NULL, deleted_at timestamptz,
      status text, departure_time timestamptz NOT NULL, shift_type text, direction text, capacity integer)`);
    await db.$executeRawUnsafe(`CREATE TABLE trip_passengers (
      id text PRIMARY KEY, tenant_id text NOT NULL, trip_id text NOT NULL, deleted_at timestamptz, status text)`);
    await db.$executeRawUnsafe(`CREATE TABLE trip_logs (
      id text PRIMARY KEY, tenant_id text NOT NULL, schedule_id text NOT NULL, deleted_at timestamptz,
      created_at timestamptz, fuel_used double precision, start_mileage double precision,
      end_mileage double precision, actual_departure_time timestamptz, actual_arrival_time timestamptz)`);
    for (const table of ['trip_schedules', 'trip_passengers', 'trip_logs']) {
      await db.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await db.$executeRawUnsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await db.$executeRawUnsafe(`CREATE POLICY tenant_scope ON ${table}
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))`);
    }
    await db.$executeRawUnsafe('CREATE ROLE bus_evidence_test_role NOLOGIN');
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO bus_evidence_test_role');
    await db.$executeRawUnsafe('GRANT SELECT ON trip_schedules,trip_passengers,trip_logs TO bus_evidence_test_role');
    await db.$executeRaw`INSERT INTO trip_schedules(id,tenant_id,route_id,status,departure_time,shift_type,direction,capacity)
      VALUES ('a',${tenantA}::uuid,'route-a','COMPLETED','2026-09-01 05:00+00','MORNING','INBOUND',30),
       ('b',${tenantA}::uuid,'route-b','COMPLETED','2026-09-01 05:20+00','MORNING','INBOUND',30),
       ('foreign',${tenantB}::uuid,'route-a','COMPLETED','2026-09-01 05:10+00','MORNING','INBOUND',30),
       ('cancelled',${tenantA}::uuid,'route-a','CANCELLED','2026-09-01 05:00+00','MORNING','INBOUND',30)`;
    await db.$executeRaw`INSERT INTO trip_passengers(id,tenant_id,trip_id,status)
      VALUES ('p1',${tenantA},'a','BOARDED'),('p2',${tenantA},'a','CONFIRMED'),
       ('p3',${tenantA},'b','BOARDED'),('foreign-child',${tenantB},'a','BOARDED')`;
    await db.$executeRaw`INSERT INTO trip_logs(id,tenant_id,schedule_id,created_at,fuel_used,start_mileage,end_mileage,actual_departure_time,actual_arrival_time)
      VALUES ('old',${tenantA},'a','2026-09-01 04:00+00',99,0,99,'2026-09-01 04:00+00','2026-09-01 06:00+00'),
       ('new',${tenantA},'a','2026-09-01 06:00+00',5,10,30,'2026-09-01 05:00+00','2026-09-01 06:00+00'),
       ('b-log',${tenantA},'b','2026-09-01 06:00+00',3,20,32,'2026-09-01 05:20+00','2026-09-01 06:00+00'),
       ('foreign-log',${tenantB},'a','2026-09-01 07:00+00',100,0,500,'2026-09-01 05:00+00','2026-09-01 07:00+00')`;
  });
  afterAll(async () => { if (db) await db.$disconnect(); });

  it('returns only tenant-owned, completed trips and their own attendance/latest logs', async () => {
    const result = await scoped(tenantA, tx => loadHistoricalTripEvidence(tx, tenantA, ['route-a', 'route-b'],
      new Date('2026-09-01T00:00:00Z'), new Date('2026-09-02T00:00:00Z')));
    expect(result.truncated).toBe(false);
    expect(result.trips.map(t => [t.routeId, t.reserved, t.boarded, t.fuelLitres, t.distanceKm]))
      .toEqual([['route-a', 2, 1, 5, 20], ['route-b', 1, 1, 3, 12]]);
    const evidence = evaluateConsolidationEvidence(result.trips, ['route-a', 'route-b'], 30,
      { fuelPerLitre: 3, driverPerHour: 30, vehiclePerKm: 0.5 });
    expect(evidence).toMatchObject({ pairedServices: 1, peakReserved: 3, completeCostTrips: 2,
      assessment: 'HISTORICALLY_PLAUSIBLE', realizedSavingsAED: null });
  });

  it('cannot view another tenant’s trips under the non-bypass role', async () => {
    const result = await scoped(tenantB, tx => loadHistoricalTripEvidence(tx, tenantB, ['route-b', 'route-c'],
      new Date('2026-09-01T00:00:00Z'), new Date('2026-09-02T00:00:00Z')));
    expect(result.trips).toEqual([]);
  });
});
