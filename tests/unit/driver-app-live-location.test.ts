import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { db, tx } = vi.hoisted(() => {
  const db = {
    vehicles: [] as Array<{ id: string; tenantId: string }>,
    pings: [] as unknown[],
  };
  const tx = {
    vehicle: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; tenantId: string } }) =>
        db.vehicles.find((v) => v.tenantId === where.tenantId && (where.id ? v.id === where.id : false)) ?? null),
      update: vi.fn(async () => ({})),
    },
    busGpsPing: { create: vi.fn(async ({ data }: { data: unknown }) => { db.pings.push(data); return data; }) },
  };
  return { db, tx };
});

vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: (_p: unknown, _t: string, fn: (t: typeof tx) => unknown) => fn(tx),
}));

import { OPTIONS, POST } from '@/app/api/driver-app/telematics/live-location/route';

const URL_ = 'http://localhost/api/driver-app/telematics/live-location';
const ping = { lat: 25.1, lng: 55.1, vehicleId: 'veh-a' };

function post(headers: Record<string, string>, body: unknown = ping) {
  return POST(new NextRequest(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  db.vehicles = [{ id: 'veh-a', tenantId: 'tenant-a' }, { id: 'veh-b', tenantId: 'tenant-b' }];
  db.pings = [];
  vi.clearAllMocks();
});

describe('live-location CORS preflight', () => {
  it('allows the driver app WebView origin with credentials', async () => {
    const res = await OPTIONS(new NextRequest(URL_, { method: 'OPTIONS', headers: { origin: 'https://localhost2' } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost2');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('gives any other origin no CORS headers (it used to reflect every origin)', async () => {
    const res = await OPTIONS(new NextRequest(URL_, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('live-location POST', () => {
  it('refuses an anonymous ping and writes nothing (it used to guess the tenant from the body)', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(db.pings).toHaveLength(0);
  });

  it('records a ping for a vehicle in the caller tenant', async () => {
    const res = await post({ 'x-tenant-id': 'tenant-a', 'x-user-id': 'drv-1' });
    expect(res.status).toBe(200);
    expect(db.pings).toHaveLength(1);
  });

  it('refuses a vehicle of another tenant', async () => {
    const res = await post({ 'x-tenant-id': 'tenant-a', 'x-user-id': 'drv-1' }, { ...ping, vehicleId: 'veh-b' });
    expect(res.status).toBe(404);
    expect(db.pings).toHaveLength(0);
  });
});
