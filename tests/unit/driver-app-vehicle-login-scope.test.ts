import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// vehicle-login binds the caller to one of their own tenant's vehicles, by
// exact code or plate, as their own driver profile. ocr-scan needs a caller.
const h = vi.hoisted(() => ({
  vehicleFindFirst: vi.fn(),
  vehicleFindMany: vi.fn(),
  driverFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  rawQuery: vi.fn(async (sql: string, ...params: unknown[]) => { void sql; void params; return [] as Array<{ id: string }>; }),
  caller: null as null | { tenantId: string; userId: string },
}));

vi.mock('next/server', async () => await import('next/server.js'));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vehicle: { findFirst: h.vehicleFindFirst, findMany: h.vehicleFindMany, updateMany: vi.fn(async () => ({ count: 0 })), update: vi.fn(async () => ({})) },
    driver: { findFirst: h.driverFindFirst },
    user: { findUnique: h.userFindUnique },
    $queryRawUnsafe: h.rawQuery,
    busGpsPing: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
  },
}));
vi.mock('@/lib/rls', () => ({ withTenantRls: vi.fn((_p: unknown, _t: string, fn: () => unknown) => fn()) }));
vi.mock('@/lib/driver-session', () => ({ getDriverTenantContext: vi.fn(async () => null) }));
vi.mock('@/lib/db-router', () => ({ residencyClaimForTenant: vi.fn(async () => ({})) }));
vi.mock('@/lib/tenant-session', () => ({ signSession: vi.fn(async () => 'signed'), verifySession: vi.fn(async () => null) }));
vi.mock('@/lib/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenant-context')>();
  return {
    ...actual,
    requireAuthorizedTenant: vi.fn(() =>
      h.caller ? { ok: true, tenantId: h.caller.tenantId, userId: h.caller.userId, role: 'DRIVER' } : { ok: false, status: 401, error: 'unauthorized' },
    ),
  };
});

const { POST: loginPOST, GET: loginGET } = await import('@/app/api/driver-app/auth/vehicle-login/route');
const { POST: ocrPOST } = await import('@/app/api/driver-app/ocr-scan/route');

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (url: string) => new NextRequest(url);

describe('driver vehicle login stays in the caller\'s tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.caller = { tenantId: 'tenant-a', userId: 'drv-1' };
    h.driverFindFirst.mockResolvedValue({ id: 'drv-1', name: 'D', firstName: null, lastName: null, email: 'd@a.ae', driverType: 'LOGISTICS', assignedVehicleId: null });
    h.vehicleFindMany.mockResolvedValue([]);
  });

  it('requires a caller', async () => {
    h.caller = null;
    expect((await loginPOST(post('http://localhost/api/driver-app/auth/vehicle-login', { vehicleIdentifier: 'TRX-01' }))).status).toBe(401);
    expect((await ocrPOST(post('http://localhost/api/driver-app/ocr-scan', { image: 'abc' }))).status).toBe(401);
  });

  it('looks the vehicle up by exact match in the caller\'s tenant only, with no cross-tenant fallback', async () => {
    h.vehicleFindFirst.mockResolvedValue(null);
    const res = await loginPOST(post('http://localhost/api/driver-app/auth/vehicle-login', { vehicleIdentifier: 'TRX' }));
    expect(res.status).toBe(404);
    expect(h.vehicleFindFirst).toHaveBeenCalledTimes(1);
    const where = h.vehicleFindFirst.mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-a');
    expect(JSON.stringify(where)).not.toMatch(/contains|LOGISTICS/);
  });

  it('a non-driver account is never signed in as a driver, whatever its details match', async () => {
    h.vehicleFindFirst.mockResolvedValue({ id: 'veh-1', vehicleCode: 'TRX-01', licensePlate: null, plateNumber: null, registrationNo: null, deviceId: 'GPS-1', odometerReading: null, assignedDriverId: null });
    h.driverFindFirst.mockResolvedValue(null);
    h.userFindUnique.mockResolvedValue({ id: 'drv-1', email: 'd@a.ae', employeeId: 'E1', userType: 'STAFF' });
    const res = await loginPOST(post('http://localhost/api/driver-app/auth/vehicle-login', { vehicleIdentifier: 'TRX-01' }));
    expect(res.status).toBe(403);
    expect(h.rawQuery).not.toHaveBeenCalled();
  });

  it('a driver account whose user id differs is matched by id, exact email or employee id only', async () => {
    h.driverFindFirst.mockResolvedValue(null);
    h.userFindUnique.mockResolvedValue({ id: 'u-9', email: 'd@a.ae', employeeId: 'E1', userType: 'DRIVER' });
    await loginGET(get('http://localhost/api/driver-app/auth/vehicle-login'));
    expect(h.rawQuery).toHaveBeenCalled();
    const [sql, ...params] = h.rawQuery.mock.calls[0];
    expect(params).toEqual(['tenant-a', 'u-9', 'd@a.ae', 'E1']);
    expect(sql).not.toMatch(/SPLIT_PART|license_number|first_name/);
  });

  it('lists only the caller\'s tenant\'s vehicles', async () => {
    await loginGET(get('http://localhost/api/driver-app/auth/vehicle-login?list=true'));
    for (const [args] of h.vehicleFindMany.mock.calls) {
      expect(args.where.tenantId).toBe('tenant-a');
    }
  });

  it('returns only the assigned vehicle when a vehicle is assigned to the logged-in driver', async () => {
    h.driverFindFirst.mockResolvedValue({
      id: 'drv-1',
      name: 'Biju',
      firstName: 'Biju',
      lastName: 'Trexla',
      email: 'biju@trexla.ae',
      driverType: 'LOGISTICS',
      assignedVehicleId: null,
    });
    h.vehicleFindMany.mockResolvedValue([
      {
        id: 'veh-assigned',
        vehicleCode: 'TRX-001',
        licensePlate: 'DXB-41087',
        plateNumber: 'DXB-41087',
        registrationNo: null,
        make: 'Mercedes-Benz',
        model: 'Actros',
        year: 2024n,
        type: 'TRUCK',
        vehicleUsage: 'LOGISTICS',
        deviceId: '',
        odometerReading: 125000n,
        assignedDriverId: 'drv-1',
      },
      {
        id: 'veh-other',
        vehicleCode: 'TRX-002',
        licensePlate: 'DXB-51449',
        plateNumber: 'DXB-51449',
        registrationNo: null,
        make: 'MAN',
        model: 'TGX',
        year: 2024n,
        type: 'TRUCK',
        vehicleUsage: 'LOGISTICS',
        deviceId: '',
        odometerReading: 98000n,
        assignedDriverId: null,
      },
    ]);

    const res = await loginGET(get('http://localhost/api/driver-app/auth/vehicle-login?list=true'));
    const json = await res.json();
    expect(json.hasSession).toBe(true);
    expect(json.driver.assignedVehicleId).toBe('veh-assigned');
    expect(json.vehicles).toHaveLength(1);
    expect(json.vehicles[0].id).toBe('veh-assigned');
    expect(json.vehicles[0].licensePlate).toBe('DXB-41087');
    expect(json.vehicles[0].isAssignedToMe).toBe(true);
  });
});
