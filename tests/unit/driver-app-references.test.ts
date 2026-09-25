/**
 * tests/unit/driver-app-references.test.ts
 *
 * Object-level authorization for the remaining driver-app write routes
 * (src/lib/driver-app-actor.ts: requireActiveDriver, authorizeDriverReferences).
 *
 * A valid driver session is not enough. The caller must be an active driver
 * of the tenant, and every shift, trip and vehicle a request names must be
 * theirs:
 *  - shift: the driver's own shift
 *  - trip: the driver's own trip, not cancelled
 *  - vehicle: of that shift/trip, the driver's active shift or
 *    scheduled/in-progress trip, or assigned to the driver
 *
 * Covered per route (fuel entries, expenses, reports, shift start, behaviour
 * events, trip start/end, shift end/checklist, report cancel): another
 * driver's or another tenant's identifiers → 403 before anything is written;
 * office users and suspended drivers → 403; anonymous, expired and revoked
 * sessions → 401; the driver's own identifiers pass the guard.
 *
 * The database is an in-memory stand-in behind a mocked withTenantRls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const DRIVER_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_DRIVER_A = 'aaaaaaaa-0000-4000-8000-000000000002';
const DRIVER_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const OFFICE_USER_A = 'aaaaaaaa-0000-4000-8000-0000000000ff';
const SHIFT_A = 'c0000000-0000-4000-8000-00000000000a';
const SHIFT_OTHER = 'c0000000-0000-4000-8000-00000000000b';
const SHIFT_B = 'c0000000-0000-4000-8000-00000000000c';
const TRIP_A = 'd0000000-0000-4000-8000-00000000000a';
const TRIP_OTHER = 'd0000000-0000-4000-8000-00000000000b';
const TRIP_B = 'd0000000-0000-4000-8000-00000000000c';
const TRIP_CANCELLED = 'd0000000-0000-4000-8000-00000000000d';
const VEH_SHIFT = 'e0000000-0000-4000-8000-00000000000a';
const VEH_TRIP = 'e0000000-0000-4000-8000-00000000000b';
const VEH_ASSIGNED = 'e0000000-0000-4000-8000-00000000000c';
const VEH_POOL = 'e0000000-0000-4000-8000-00000000000d';
const VEH_B = 'e0000000-0000-4000-8000-00000000000e';

const db = vi.hoisted(() => ({
  drivers: [] as Array<{ id: string; tenantId: string; status: string | null }>,
  shifts: [] as Array<{ id: string; tenant: string; driver: string; status: string; vehicle: string | null }>,
  trips: [] as Array<{ id: string; tenant: string; driver: string; status: string; vehicle: string | null }>,
  vehicles: [] as Array<{ id: string; tenant: string; assignedDriver: string | null }>,
  bodyReached: 0,
}));

const fakeTx = {
  driver: {
    findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
      const d = db.drivers.find((x) => x.id === where.id && x.tenantId === where.tenantId);
      return d ? { status: d.status } : null;
    },
  },
  $queryRawUnsafe: async (sql: string, ...p: string[]) => {
    if (sql.includes('FROM shifts') && sql.includes('WHERE id::text = $1')) {
      const s = db.shifts.find((x) => x.id === p[0] && x.tenant === p[1] && x.driver === p[2]);
      return s ? [{ vehicle_id: s.vehicle }] : [];
    }
    if (sql.includes('FROM trip_schedules') && sql.includes('WHERE id::text = $1')) {
      const t = db.trips.find((x) => x.id === p[0] && x.tenant === p[1] && x.driver === p[2] && x.status !== 'CANCELLED');
      return t ? [{ vehicle_id: t.vehicle }] : [];
    }
    if (sql.includes('FROM vehicles v')) {
      const [vehicleId, tenantId, userId] = p;
      const v = db.vehicles.find((x) => x.id === vehicleId && x.tenant === tenantId);
      if (!v) return [];
      const ok = v.assignedDriver === userId
        || db.shifts.some((s) => s.vehicle === v.id && s.tenant === tenantId && s.driver === userId && s.status === 'ACTIVE')
        || db.trips.some((t) => t.vehicle === v.id && t.tenant === tenantId && t.driver === userId && ['SCHEDULED', 'IN_PROGRESS'].includes(t.status));
      return ok ? [{ id: v.id }] : [];
    }
    db.bodyReached += 1;
    return [];
  },
  // Anything past the guard: count it, and let the handler carry on or fail.
  $queryRaw: async () => { db.bodyReached += 1; return []; },
  $executeRaw: async () => { db.bodyReached += 1; return 1; },
  tripSchedule: { findFirst: async () => { db.bodyReached += 1; return null; } },
};

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn(fakeTx),
}));
vi.mock('@/lib/rate-limit-scope', () => ({ applyDriverTelemetryLimit: async () => null }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { signSession } from '@/lib/tenant-session';
import * as sessionBlocklist from '@/lib/session-blocklist';
import { authorizeDriverReferences, requireActiveDriver } from '@/lib/driver-app-actor';
import { POST as fuelEntries } from '@/app/api/driver-app/fuel-entries/route';
import { POST as expenses } from '@/app/api/driver-app/expenses/route';
import { POST as reports } from '@/app/api/driver-app/reports/route';
import { POST as shiftStart } from '@/app/api/driver-app/shift/current/route';
import { POST as behaviorEvents } from '@/app/api/driver-app/behavior-events/route';
import { POST as tripStart } from '@/app/api/driver-app/trips/[id]/start/route';
import { POST as tripEnd } from '@/app/api/driver-app/trips/[id]/end/route';
import { POST as shiftEnd } from '@/app/api/driver-app/shift/[id]/end/route';
import { POST as shiftChecklist } from '@/app/api/driver-app/shift/[id]/checklist/route';
import { POST as reportCancel } from '@/app/api/driver-app/reports/[id]/cancel/route';

const sessionA = { tenantId: TENANT_A, userId: DRIVER_A };

beforeEach(() => {
  db.drivers = [
    { id: DRIVER_A, tenantId: TENANT_A, status: 'ACTIVE' },
    { id: OTHER_DRIVER_A, tenantId: TENANT_A, status: 'ACTIVE' },
    { id: DRIVER_B, tenantId: TENANT_B, status: 'ACTIVE' },
  ];
  db.shifts = [
    { id: SHIFT_A, tenant: TENANT_A, driver: DRIVER_A, status: 'ACTIVE', vehicle: VEH_SHIFT },
    { id: SHIFT_OTHER, tenant: TENANT_A, driver: OTHER_DRIVER_A, status: 'ACTIVE', vehicle: VEH_POOL },
    { id: SHIFT_B, tenant: TENANT_B, driver: DRIVER_B, status: 'ACTIVE', vehicle: VEH_B },
  ];
  db.trips = [
    { id: TRIP_A, tenant: TENANT_A, driver: DRIVER_A, status: 'SCHEDULED', vehicle: VEH_TRIP },
    { id: TRIP_OTHER, tenant: TENANT_A, driver: OTHER_DRIVER_A, status: 'IN_PROGRESS', vehicle: VEH_POOL },
    { id: TRIP_B, tenant: TENANT_B, driver: DRIVER_B, status: 'IN_PROGRESS', vehicle: VEH_B },
    { id: TRIP_CANCELLED, tenant: TENANT_A, driver: DRIVER_A, status: 'CANCELLED', vehicle: VEH_POOL },
  ];
  db.vehicles = [
    { id: VEH_SHIFT, tenant: TENANT_A, assignedDriver: null },
    { id: VEH_TRIP, tenant: TENANT_A, assignedDriver: null },
    { id: VEH_ASSIGNED, tenant: TENANT_A, assignedDriver: DRIVER_A },
    { id: VEH_POOL, tenant: TENANT_A, assignedDriver: null },
    { id: VEH_B, tenant: TENANT_B, assignedDriver: DRIVER_B },
  ];
  db.bodyReached = 0;
});

describe('requireActiveDriver', () => {
  it('accepts an active driver and refuses office users, suspended drivers and other tenants', async () => {
    expect(await requireActiveDriver(fakeTx as never, sessionA)).toBeNull();
    expect((await requireActiveDriver(fakeTx as never, { tenantId: TENANT_A, userId: OFFICE_USER_A }))?.status).toBe(403);
    expect((await requireActiveDriver(fakeTx as never, { tenantId: TENANT_B, userId: DRIVER_A }))?.status).toBe(403);
    db.drivers[0].status = 'SUSPENDED';
    expect((await requireActiveDriver(fakeTx as never, sessionA))?.status).toBe(403);
  });
});

describe('authorizeDriverReferences', () => {
  const check = (refs: Parameters<typeof authorizeDriverReferences>[2]) =>
    authorizeDriverReferences(fakeTx as never, sessionA, refs);

  it('passes when nothing is named, or only the driver\'s own records are', async () => {
    expect(await check({})).toBeNull();
    expect(await check({ shiftId: SHIFT_A, tripId: TRIP_A })).toBeNull();
    expect(await check({ shiftId: SHIFT_A, vehicleId: VEH_SHIFT })).toBeNull();
    expect(await check({ tripId: TRIP_A, vehicleId: VEH_TRIP })).toBeNull();
    expect(await check({ vehicleId: VEH_ASSIGNED })).toBeNull();
    expect(await check({ vehicleId: VEH_SHIFT })).toBeNull();
    expect(await check({ vehicleId: VEH_TRIP })).toBeNull();
  });

  it.each([
    ['another driver\'s shift', { shiftId: SHIFT_OTHER }],
    ['another tenant\'s shift', { shiftId: SHIFT_B }],
    ['another driver\'s trip', { tripId: TRIP_OTHER }],
    ['another tenant\'s trip', { tripId: TRIP_B }],
    ['a cancelled trip', { tripId: TRIP_CANCELLED }],
    ['an unassigned vehicle of the same tenant', { vehicleId: VEH_POOL }],
    ['another tenant\'s vehicle', { vehicleId: VEH_B }],
    ['a vehicle that is not the named shift\'s', { shiftId: SHIFT_A, vehicleId: VEH_POOL }],
  ])('refuses %s', async (_name, refs) => {
    expect((await check(refs))?.status).toBe(403);
  });
});

async function token(userId: string, tenantId = TENANT_A, ttlMs?: number) {
  return signSession({ userId, tenantId, plan: 'STANDARD', role: 'DRIVER', ttlMs });
}

// What middleware forwards for a request with this cookie: verified identity + cookie.
function req(path: string, body: unknown, auth?: { token: string; userId: string; tenantId?: string }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    headers.cookie = `xl-driver-session=${auth.token}`;
    headers['x-tenant-id'] = auth.tenantId ?? TENANT_A;
    headers['x-user-id'] = auth.userId;
    headers['x-user-role'] = 'DRIVER';
  }
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const fuelBody = (over: Record<string, unknown>) => ({
  id: 'f0000000-0000-4000-8000-000000000001', liters: 40, costMinor: 10000, currency: 'AED',
  odometer: 1000, filledAt: new Date().toISOString(), ...over,
});
const expenseBody = (over: Record<string, unknown>) => ({
  id: 'f0000000-0000-4000-8000-000000000002', category: 'TOLLS', amountMinor: 500, currency: 'AED',
  incurredAt: new Date().toISOString(), ...over,
});
const asDriverA = (t: string) => ({ token: t, userId: DRIVER_A });

describe('routes refuse foreign identifiers before writing', () => {
  const cases: Array<[string, (t: string) => Promise<Response>]> = [
    ['fuel entry with another tenant\'s vehicle', (t) => fuelEntries(req('/api/driver-app/fuel-entries', fuelBody({ vehicleId: VEH_B }), asDriverA(t)))],
    ['fuel entry with an unassigned vehicle', (t) => fuelEntries(req('/api/driver-app/fuel-entries', fuelBody({ vehicleId: VEH_POOL }), asDriverA(t)))],
    ['fuel entry on another driver\'s shift', (t) => fuelEntries(req('/api/driver-app/fuel-entries', fuelBody({ shiftId: SHIFT_OTHER }), asDriverA(t)))],
    ['fuel entry on another tenant\'s trip', (t) => fuelEntries(req('/api/driver-app/fuel-entries', fuelBody({ tripId: TRIP_B }), asDriverA(t)))],
    ['expense on another driver\'s shift', (t) => expenses(req('/api/driver-app/expenses', expenseBody({ shiftId: SHIFT_OTHER }), asDriverA(t)))],
    ['report on another driver\'s trip', (t) => reports(req('/api/driver-app/reports', { kind: 'INCIDENT', type: 'ACCIDENT', title: 'x', tripId: TRIP_OTHER }, asDriverA(t)))],
    ['report on another tenant\'s shift', (t) => reports(req('/api/driver-app/reports', { kind: 'INCIDENT', type: 'ACCIDENT', title: 'x', shiftId: SHIFT_B }, asDriverA(t)))],
    ['shift start with an unassigned vehicle', (t) => shiftStart(req('/api/driver-app/shift/current', { vehicleId: VEH_POOL }, asDriverA(t)))],
    ['shift start with another tenant\'s vehicle', (t) => shiftStart(req('/api/driver-app/shift/current', { vehicleId: VEH_B }, asDriverA(t)))],
    ['behaviour events naming another tenant\'s trip', (t) => behaviorEvents(req('/api/driver-app/behavior-events', { events: [{ id: 'f0000000-0000-4000-8000-000000000004', type: 'HARSH_BRAKE', occurredAt: new Date().toISOString(), tripId: TRIP_B }] }, asDriverA(t)))],
  ];

  it.each(cases)('%s → 403', async (_name, call) => {
    const res = await call(await token(DRIVER_A));
    const body = await res.json().catch(() => ({}));
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(db.bodyReached).toBe(0);
  });

  it('refuses an office user on every write route', async () => {
    const t = await token(OFFICE_USER_A);
    const office = { token: t, userId: OFFICE_USER_A };
    for (const res of [
      await fuelEntries(req('/api/driver-app/fuel-entries', fuelBody({}), office)),
      await expenses(req('/api/driver-app/expenses', expenseBody({}), office)),
      await shiftStart(req('/api/driver-app/shift/current', {}, office)),
    ]) expect(res.status).toBe(403);
    expect(db.bodyReached).toBe(0);
  });

  it('lets the driver\'s own identifiers through the guard', async () => {
    const t = await token(DRIVER_A);
    const res = await fuelEntries(req('/api/driver-app/fuel-entries', fuelBody({ shiftId: SHIFT_A, vehicleId: VEH_SHIFT, tripId: TRIP_A }), asDriverA(t)));
    expect([401, 403]).not.toContain(res.status);
    expect(db.bodyReached).toBeGreaterThan(0);
  });
});

describe('routes acting on a record by id require an active driver', () => {
  const routes: Array<[string, (r: NextRequest) => Promise<Response>, string]> = [
    ['trip start', (r) => tripStart(r, params(TRIP_A)), `/api/driver-app/trips/${TRIP_A}/start`],
    ['trip end', (r) => tripEnd(r, params(TRIP_A)), `/api/driver-app/trips/${TRIP_A}/end`],
    ['shift end', (r) => shiftEnd(r, params(SHIFT_A)), `/api/driver-app/shift/${SHIFT_A}/end`],
    ['shift checklist', (r) => shiftChecklist(r, params(SHIFT_A)), `/api/driver-app/shift/${SHIFT_A}/checklist`],
    ['report cancel', (r) => reportCancel(r, params('f0000000-0000-4000-8000-000000000009')), '/api/driver-app/reports/f0000000-0000-4000-8000-000000000009/cancel'],
  ];

  it.each(routes)('%s: office user with a valid session → 403', async (_n, call, path) => {
    const t = await token(OFFICE_USER_A);
    const res = await call(req(path, {}, { token: t, userId: OFFICE_USER_A }));
    expect(res.status).toBe(403);
    expect(db.bodyReached).toBe(0);
  });

  it.each(routes)('%s: suspended driver → 403', async (_n, call, path) => {
    db.drivers[0].status = 'SUSPENDED';
    const res = await call(req(path, {}, { token: await token(DRIVER_A), userId: DRIVER_A }));
    expect(res.status).toBe(403);
  });

  it.each(routes)('%s: anonymous → 401', async (_n, call, path) => {
    expect((await call(req(path, {}))).status).toBe(401);
  });

  it.each(routes)('%s: expired session → 401', async (_n, call, path) => {
    const t = await token(DRIVER_A, TENANT_A, -1000);
    expect((await call(req(path, {}, { token: t, userId: DRIVER_A }))).status).toBe(401);
  });

  it.each(routes)('%s: revoked session → 401', async (_n, call, path) => {
    const spy = vi.spyOn(sessionBlocklist, 'isSessionRevoked').mockResolvedValue(true);
    try {
      const res = await call(req(path, {}, { token: await token(DRIVER_A), userId: DRIVER_A }));
      expect(res.status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(routes)('%s: a session for another tenant → 403', async (_n, call, path) => {
    // Headers claim tenant A (as a forged or stale header would); the session is tenant B's.
    const t = await token(DRIVER_B, TENANT_B);
    const res = await call(req(path, {}, { token: t, userId: DRIVER_B, tenantId: TENANT_A }));
    expect(res.status).toBe(403);
    expect(db.bodyReached).toBe(0);
  });
});
