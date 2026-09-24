/**
 * tests/unit/driver-app-actor.test.ts
 *
 * Object-level authorization for the three driver-app write endpoints
 * (emergency SOS, live location, NRM toggle) — src/lib/driver-app-actor.ts.
 *
 * A valid session is not enough: the caller must be an active driver of the
 * session's tenant, and the driver / vehicle / trip a write affects come
 * from that driver's own records, never from identifiers in the request.
 *
 * Covered:
 *  - an office user with a valid session for the tenant (no driver row) → 403
 *  - a suspended driver → 403
 *  - a body vehicleId from another tenant, or another driver's driverId → 403
 *    (live location, NRM); SOS ignores them and uses the trusted vehicle
 *  - no active trip → live location acknowledged but not stored
 *  - no trip or shift vehicle → NRM 409
 *  - expired and revoked sessions → 401 before any database access
 *
 * The database is replaced by an in-memory transaction; withTenantRls,
 * raiseAlert and logAudit are mocked so writes can be observed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real next/server: the routes use `instanceof NextResponse` and cookies.
vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  drivers: [] as Array<{ id: string; tenantId: string; name: string | null; firstName: string | null; lastName: string | null; status: string | null; deletedAt: null }>,
  trips: [] as Array<{ id: string; tenant: string; driver: string; status: string; vehicle_id: string | null; plate: string | null }>,
  shifts: [] as Array<{ tenant: string; driver: string; status: string; vehicle_id: string | null; plate: string | null }>,
  pings: [] as Array<Record<string, unknown>>,
  rlsOpened: 0,
}));

const fakeTx = {
  driver: {
    findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
      state.drivers.find((d) => d.id === where.id && d.tenantId === where.tenantId) ?? null,
  },
  $queryRawUnsafe: async (sql: string, tenantId: string, driverId: string) => {
    if (sql.includes('FROM trip_schedules')) {
      return state.trips
        .filter((t) => t.tenant === tenantId && t.driver === driverId && t.status === 'IN_PROGRESS')
        .map((t) => ({ id: t.id, vehicle_id: t.vehicle_id, plate: t.plate }));
    }
    if (sql.includes('FROM shifts')) {
      return state.shifts
        .filter((s) => s.tenant === tenantId && s.driver === driverId && s.status === 'ACTIVE')
        .map((s) => ({ vehicle_id: s.vehicle_id, plate: s.plate }));
    }
    throw new Error(`unexpected query: ${sql}`);
  },
  busGpsPing: {
    create: async ({ data }: { data: Record<string, unknown> }) => { state.pings.push(data); return data; },
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => {
    state.rlsOpened += 1;
    return fn(fakeTx);
  },
}));
vi.mock('@/lib/alerts/raise', () => ({ raiseAlert: vi.fn(async () => ({ eventId: 'evt-1' })) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { signSession } from '@/lib/tenant-session';
// tests/setup.ts loads tenant-session (and so session-blocklist) before this
// file's vi.mock calls apply, so revocation is simulated with a spy instead.
import * as sessionBlocklist from '@/lib/session-blocklist';
import { raiseAlert } from '@/lib/alerts/raise';
import { loadDriverActor, rejectForeignIdentifiers } from '@/lib/driver-app-actor';
import { POST as sos } from '@/app/api/driver-app/emergency-sos/route';
import { POST as liveLocation } from '@/app/api/driver-app/telematics/live-location/route';
import { POST as nrmToggle } from '@/app/api/driver-app/nrm-toggle/route';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const DRIVER_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_DRIVER_A = 'aaaaaaaa-0000-4000-8000-000000000002';
const OFFICE_USER_A = 'aaaaaaaa-0000-4000-8000-0000000000ff';
const VEHICLE_A = 'vvvvvvvv-0000-4000-8000-00000000000a';
const SHIFT_VEHICLE_A = 'vvvvvvvv-0000-4000-8000-00000000000c';
const VEHICLE_B = 'vvvvvvvv-0000-4000-8000-00000000000b';

async function sessionFor(userId: string, opts: { role?: string; ttlMs?: number } = {}) {
  return signSession({ userId, tenantId: TENANT_A, plan: 'STANDARD', role: opts.role ?? 'DRIVER', ttlMs: opts.ttlMs });
}

// Simulates what middleware forwards for a request carrying this cookie:
// the verified tenant/user identity plus the cookie itself.
function driverReq(path: string, token: string, userId: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `xl-driver-session=${token}`,
      'x-tenant-id': TENANT_A,
      'x-user-id': userId,
      'x-user-role': 'DRIVER',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.drivers = [
    { id: DRIVER_A, tenantId: TENANT_A, name: 'Aisha Driver', firstName: null, lastName: null, status: 'ACTIVE', deletedAt: null },
    { id: OTHER_DRIVER_A, tenantId: TENANT_A, name: 'Other Driver', firstName: null, lastName: null, status: 'ACTIVE', deletedAt: null },
  ];
  state.trips = [{ id: 'trip-1', tenant: TENANT_A, driver: DRIVER_A, status: 'IN_PROGRESS', vehicle_id: VEHICLE_A, plate: 'DXB-1' }];
  state.shifts = [{ tenant: TENANT_A, driver: DRIVER_A, status: 'ACTIVE', vehicle_id: SHIFT_VEHICLE_A, plate: 'DXB-9' }];
  state.pings = [];
  state.rlsOpened = 0;
  vi.mocked(raiseAlert).mockClear();
});

describe('loadDriverActor', () => {
  it('returns the driver with their in-progress trip vehicle and shift vehicle', async () => {
    const actor = await loadDriverActor(fakeTx as never, TENANT_A, DRIVER_A);
    expect(actor).toMatchObject({
      driverId: DRIVER_A,
      driverName: 'Aisha Driver',
      activeTrip: { id: 'trip-1', vehicle: { id: VEHICLE_A, plate: 'DXB-1' } },
      shiftVehicle: { id: SHIFT_VEHICLE_A, plate: 'DXB-9' },
    });
  });

  it('returns null for a user who is not a driver of the tenant', async () => {
    expect(await loadDriverActor(fakeTx as never, TENANT_A, OFFICE_USER_A)).toBeNull();
    expect(await loadDriverActor(fakeTx as never, TENANT_B, DRIVER_A)).toBeNull();
  });

  it('returns null for a suspended driver', async () => {
    state.drivers[0].status = 'SUSPENDED';
    expect(await loadDriverActor(fakeTx as never, TENANT_A, DRIVER_A)).toBeNull();
  });
});

describe('rejectForeignIdentifiers', () => {
  const actor = { tenantId: TENANT_A, driverId: DRIVER_A, driverName: 'A', activeTrip: null, shiftVehicle: null };
  const vehicle = { id: VEHICLE_A, plate: 'DXB-1' };

  it('allows omitted or matching identifiers', () => {
    expect(rejectForeignIdentifiers(actor, {}, vehicle)).toBeNull();
    expect(rejectForeignIdentifiers(actor, { driverId: DRIVER_A, vehicleId: VEHICLE_A }, vehicle)).toBeNull();
  });

  it('rejects another driver or another vehicle', () => {
    expect(rejectForeignIdentifiers(actor, { driverId: OTHER_DRIVER_A }, vehicle)?.status).toBe(403);
    expect(rejectForeignIdentifiers(actor, { vehicleId: VEHICLE_B }, vehicle)?.status).toBe(403);
    expect(rejectForeignIdentifiers(actor, { vehicleId: VEHICLE_A }, null)?.status).toBe(403);
  });
});

describe('emergency SOS', () => {
  it('refuses an office user with a valid session for the tenant (403, no alert)', async () => {
    const token = await sessionFor(OFFICE_USER_A, { role: 'TENANT_ADMIN' });
    const res = await sos(driverReq('/api/driver-app/emergency-sos', token, OFFICE_USER_A, { lat: 1, lng: 2 }));
    expect(res.status).toBe(403);
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("uses the driver's own vehicle and ignores a vehicle/driver from the request", async () => {
    const token = await sessionFor(DRIVER_A);
    const res = await sos(driverReq('/api/driver-app/emergency-sos', token, DRIVER_A, {
      lat: 25.2, lng: 55.3, vehicleId: VEHICLE_B, vehiclePlate: 'OTHER-1', driverId: OTHER_DRIVER_A, driverName: 'Spoofed',
    }));
    expect(res.status).toBe(200);
    const alert = vi.mocked(raiseAlert).mock.calls[0][0];
    expect(alert).toMatchObject({ tenantId: TENANT_A, subjectType: 'Vehicle', subjectId: VEHICLE_A, actor: DRIVER_A });
    expect(alert.context).toMatchObject({ driverId: DRIVER_A, vehicleId: VEHICLE_A, vehiclePlate: 'DXB-1', driverName: 'Aisha Driver' });
  });

  it('still goes through with no trip, falling back to the shift vehicle, then the driver', async () => {
    state.trips = [];
    const token = await sessionFor(DRIVER_A);
    await sos(driverReq('/api/driver-app/emergency-sos', token, DRIVER_A, { lat: 1, lng: 2 }));
    expect(vi.mocked(raiseAlert).mock.calls[0][0].subjectId).toBe(SHIFT_VEHICLE_A);

    state.shifts = [];
    await sos(driverReq('/api/driver-app/emergency-sos', token, DRIVER_A, { lat: 1, lng: 2 }));
    expect(vi.mocked(raiseAlert).mock.calls[1][0]).toMatchObject({ subjectType: 'Driver', subjectId: DRIVER_A });
  });
});

describe('live location', () => {
  it("stores the ping against the driver's in-progress trip vehicle", async () => {
    const token = await sessionFor(DRIVER_A);
    const res = await liveLocation(driverReq('/api/driver-app/telematics/live-location', token, DRIVER_A, { lat: 25.2, lng: 55.3 }));
    expect(res.status).toBe(200);
    expect(state.pings).toEqual([expect.objectContaining({ tenantId: TENANT_A, vehicleId: VEHICLE_A })]);
  });

  it("rejects another tenant's vehicle id (403, nothing stored)", async () => {
    const token = await sessionFor(DRIVER_A);
    const res = await liveLocation(driverReq('/api/driver-app/telematics/live-location', token, DRIVER_A, { lat: 1, lng: 2, vehicleId: VEHICLE_B }));
    expect(res.status).toBe(403);
    expect(state.pings).toEqual([]);
  });

  it("rejects another driver's id (403, nothing stored)", async () => {
    const token = await sessionFor(DRIVER_A);
    const res = await liveLocation(driverReq('/api/driver-app/telematics/live-location', token, DRIVER_A, { lat: 1, lng: 2, driverId: OTHER_DRIVER_A }));
    expect(res.status).toBe(403);
    expect(state.pings).toEqual([]);
  });

  it('acknowledges but does not store a ping when the driver has no trip in progress', async () => {
    state.trips = [];
    const token = await sessionFor(DRIVER_A);
    const res = await liveLocation(driverReq('/api/driver-app/telematics/live-location', token, DRIVER_A, { lat: 1, lng: 2 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: false });
    expect(state.pings).toEqual([]);
  });

  it('refuses an office user (403)', async () => {
    const token = await sessionFor(OFFICE_USER_A, { role: 'TENANT_ADMIN' });
    const res = await liveLocation(driverReq('/api/driver-app/telematics/live-location', token, OFFICE_USER_A, { lat: 1, lng: 2 }));
    expect(res.status).toBe(403);
  });
});

describe('NRM toggle', () => {
  it("raises the alert for the driver's own vehicle", async () => {
    const token = await sessionFor(DRIVER_A);
    const res = await nrmToggle(driverReq('/api/driver-app/nrm-toggle', token, DRIVER_A, { action: 'START' }));
    expect(res.status).toBe(200);
    expect(vi.mocked(raiseAlert).mock.calls[0][0]).toMatchObject({ subjectId: VEHICLE_A, actor: DRIVER_A });
  });

  it('rejects a vehicle that is not the driver\'s (403, no alert)', async () => {
    const token = await sessionFor(DRIVER_A);
    const res = await nrmToggle(driverReq('/api/driver-app/nrm-toggle', token, DRIVER_A, { action: 'START', vehicleId: VEHICLE_B }));
    expect(res.status).toBe(403);
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it('returns 409 when the driver has no trip or shift vehicle', async () => {
    state.trips = [];
    state.shifts = [];
    const token = await sessionFor(DRIVER_A);
    const res = await nrmToggle(driverReq('/api/driver-app/nrm-toggle', token, DRIVER_A, { action: 'START' }));
    expect(res.status).toBe(409);
    expect(raiseAlert).not.toHaveBeenCalled();
  });
});

describe('expired and revoked sessions', () => {
  const routes = [
    ['emergency-sos', sos, { lat: 1, lng: 2 }],
    ['telematics/live-location', liveLocation, { lat: 1, lng: 2 }],
    ['nrm-toggle', nrmToggle, { action: 'START' }],
  ] as const;

  for (const [name, handler, body] of routes) {
    it(`${name}: expired session → 401 before any database access`, async () => {
      const token = await sessionFor(DRIVER_A, { ttlMs: -1_000 });
      const res = await handler(driverReq(`/api/driver-app/${name}`, token, DRIVER_A, body));
      expect(res.status).toBe(401);
      expect(state.rlsOpened).toBe(0);
    });

    it(`${name}: revoked session → 401 before any database access`, async () => {
      const spy = vi.spyOn(sessionBlocklist, 'isSessionRevoked').mockResolvedValue(true);
      try {
        const token = await sessionFor(DRIVER_A);
        const res = await handler(driverReq(`/api/driver-app/${name}`, token, DRIVER_A, body));
        expect(res.status).toBe(401);
        expect(state.rlsOpened).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  }
});
