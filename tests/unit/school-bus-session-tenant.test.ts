/**
 * tests/unit/school-bus-session-tenant.test.ts
 *
 * School bus routes act for the signed-in tenant only. They used to read
 * the tenant from ?tenantId= (default 'default') or destructure
 * `tenantId = 'default'` from a body whose tenantId had already been
 * stripped, so real tenants' writes went to 'default' (refused by row level
 * security) and their reads found nothing.
 *
 * Every query's parameters include the session tenant, and never 'default'
 * or a tenant named in the request. A read naming another tenant in the
 * query string is refused (the screens used to send ?tenantId=default,
 * which made every such read a 403 for real tenants).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';

const rec = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; args: unknown[] }> }));

const tx = vi.hoisted(() => {
  const record = async (sql: string, ...args: unknown[]) => {
    rec.calls.push({ sql, args });
    return [{ id: '00000000-0000-0000-0000-00000000000a', cnt: 0n, enrolled: 0n, seat_capacity: 40, total: 0n }];
  };
  return { $queryRawUnsafe: record, $executeRawUnsafe: async (sql: string, ...args: unknown[]) => { await record(sql, ...args); return 1; } };
});
vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx),
}));
vi.mock('@/lib/dispatch/schema', () => ({ ensureDispatchSchema: async () => {} }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));

import { NextRequest } from 'next/server';
import * as schedules from '@/app/api/school-bus/schedules/route';
import * as trips from '@/app/api/school-bus/trips/route';
import * as stops from '@/app/api/school-bus/stops/route';
import * as routes from '@/app/api/school-bus/routes/route';
import * as attendants from '@/app/api/school-bus/attendants/route';
import * as allocations from '@/app/api/school-bus/allocations/route';
import * as driverScores from '@/app/api/school-bus/driver-scores/route';
import * as fleetPositions from '@/app/api/school-bus/fleet-positions/route';
import * as capacity from '@/app/api/school-bus/capacity-check/route';
import * as reports from '@/app/api/school-bus/reports/route';
import * as generate from '@/app/api/school-bus/trips/generate/route';

const headers = { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };

type Handler = (req: NextRequest) => Promise<Response>;

const get = (h: Handler, path: string, query = '') =>
  h(new NextRequest(`http://localhost/api/school-bus/${path}${query}`, { headers }));
const post = (h: Handler, path: string, body: Record<string, unknown>) =>
  h(new NextRequest(`http://localhost/api/school-bus/${path}`, {
    method: 'POST', headers, body: JSON.stringify({ tenantId: OTHER, ...body }),
  }));

function expectSessionTenantOnly() {
  const tenantScoped = rec.calls.filter((c) => /tenant_id/.test(c.sql));
  expect(tenantScoped.length, 'no tenant-scoped query ran').toBeGreaterThan(0);
  for (const c of tenantScoped) {
    expect(c.args, c.sql).toContain(TENANT);
  }
  for (const c of rec.calls) {
    expect(c.args, c.sql).not.toContain(OTHER);
    expect(c.args, c.sql).not.toContain('default');
    expect(c.sql, c.sql).not.toMatch(/tenant_id\s*=\s*'default'/);
  }
}

beforeEach(() => { rec.calls = []; });

const READS = [
  ['schedules', schedules.GET],
  ['trips', trips.GET],
  ['stops', stops.GET],
  ['routes', routes.GET],
  ['attendants', attendants.GET],
  ['allocations', allocations.GET],
  ['driver-scores', driverScores.GET],
  ['fleet-positions', fleetPositions.GET],
  ['capacity-check', capacity.GET],
  ['reports', reports.GET],
] as Array<[string, Handler]>;

describe('school bus reads use the session tenant', () => {
  it.each(READS)('%s', async (path, handler) => {
    const res = await get(handler, path);
    expect(res.status, await res.clone().text()).toBeLessThan(400);
    expectSessionTenantOnly();
  });

  it.each(READS)('%s refuses ?tenantId= naming another tenant', async (path, handler) => {
    const res = await get(handler, path, `?tenantId=${OTHER}`);
    expect(res.status).toBe(403);
    expect(rec.calls).toHaveLength(0);
  });
});

describe("school bus writes use the session tenant, not 'default'", () => {
  it.each([
    ['schedules', schedules.POST, { scheduleName: 'Morning A', departureTime: '07:00' }],
    ['trips', trips.POST, { routeName: 'Route 1' }],
    ['stops', stops.POST, { stopName: 'Gate 3' }],
    ['routes', routes.POST, { routeName: 'Route 1', departureTime: '07:00' }],
    ['attendants', attendants.POST, { firstName: 'Mona', lastName: 'Ali' }],
    ['allocations', allocations.POST, { studentName: 'Layla', busMode: 'TWO_WAY' }],
    ['driver-scores', driverScores.POST, { driverName: 'Ahmed' }],
    ['fleet-positions', fleetPositions.POST, { vehicleId: 'BUS-1', lat: 25.2, lng: 55.3 }],
    ['trips/generate', generate.POST, { date: '2026-10-01' }],
  ] as Array<[string, Handler, Record<string, unknown>]>)('%s', async (path, handler, body) => {
    const res = await post(handler, path, body);
    expect(res.status, await res.clone().text()).toBeLessThan(400);
    expectSessionTenantOnly();
  });
});
