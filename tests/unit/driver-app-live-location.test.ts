// CORS and session checks for /api/driver-app/telematics/live-location.
// Who may ping for which vehicle (the driver's own in-progress trip) is
// covered against the real driver-actor logic in driver-app-actor.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { db, tx } = vi.hoisted(() => {
  const db = { pings: [] as unknown[] };
  const tx = {
    busGpsPing: { create: vi.fn(async ({ data }: { data: unknown }) => { db.pings.push(data); return data; }) },
  };
  return { db, tx };
});

// vitest.config.ts aliases next/server to a minimal stub; use the real one
// (as middleware-identity-headers.test.ts does) so instanceof NextResponse holds.
vi.mock('next/server', async () => await import('next/server.js'));
vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: (_p: unknown, _t: string, fn: (t: typeof tx) => unknown) => fn(tx),
}));
// No valid driver session: the route must stop before any database work.
vi.mock('@/lib/driver-session', () => ({
  requireDriverSessionForTenant: async () => NextResponse.json({ error: 'Driver session required' }, { status: 401 }),
}));

import { OPTIONS, POST } from '@/app/api/driver-app/telematics/live-location/route';

const URL_ = 'http://localhost/api/driver-app/telematics/live-location';
const ping = { lat: 25.1, lng: 55.1, vehicleId: 'veh-a' };

function post(headers: Record<string, string>) {
  return POST(new NextRequest(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(ping),
  }));
}

beforeEach(() => {
  db.pings = [];
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
  it('refuses an anonymous ping and writes nothing', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(db.pings).toHaveLength(0);
  });

  it('refuses identity headers without a valid driver session, keeping CORS for the app', async () => {
    const res = await post({ 'x-tenant-id': 'tenant-a', 'x-user-id': 'drv-1', origin: 'https://localhost2' });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost2');
    expect(db.pings).toHaveLength(0);
  });
});
