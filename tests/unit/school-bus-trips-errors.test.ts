/**
 * tests/unit/school-bus-trips-errors.test.ts
 *
 * Verifies GET /api/school-bus/trips:
 * 1. Valid empty query returns 200 { trips: [], summary, date }
 * 2. Invalid calendar dates (e.g. 2026-02-30) return 400
 * 3. SQL error propagates to try/catch and returns 500 (never silently swallowed as [])
 * 4. SQL uses explicit ::date / ::time casts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest } from 'next/server';

const { state, mockTx, resetState } = vi.hoisted(() => {
  const state = {
    sqlCalls: [] as Array<{ sql: string; args: unknown[] }>,
    throwOnQuery: false,
    rows: [] as Array<Record<string, unknown>>,
  };

  function resetState() {
    state.sqlCalls = [];
    state.throwOnQuery = false;
    state.rows = [];
  }

  const mockTx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.sqlCalls.push({ sql, args });
      if (state.throwOnQuery) {
        throw new Error('PG 42883: operator does not exist: date = text');
      }
      return state.rows;
    }),
  };

  return { state, mockTx, resetState };
});

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
}));

import { GET, POST } from '@/app/api/school-bus/trips/route';

const headers = {
  'content-type': 'application/json',
  'x-tenant-id': '11111111-1111-4111-8111-111111111111',
  'x-user-id': 'ops-user-1',
  'x-user-role': 'TENANT_ADMIN',
};

describe('GET/POST /api/school-bus/trips date validation, SQL casts & error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 200 { trips: [], summary, date } on valid empty query and casts $2::date', async () => {
    const req = new NextRequest('http://localhost:3000/api/school-bus/trips?date=2026-11-18', { headers });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trips).toEqual([]);
    expect(json.date).toBe('2026-11-18');
    expect(json.summary.total).toBe(0);
    expect(state.sqlCalls[0]?.sql).toContain('$2::date');
  });

  it('returns 400 on invalid calendar date such as 2026-02-30', async () => {
    const req = new NextRequest('http://localhost:3000/api/school-bus/trips?date=2026-02-30', { headers });
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(state.sqlCalls).toHaveLength(0);
  });

  it('returns 500 when tx.$queryRawUnsafe rejects instead of swallowing to []', async () => {
    state.throwOnQuery = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = new NextRequest('http://localhost:3000/api/school-bus/trips?date=2026-11-18', { headers });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch school bus trips');
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('POST validates scheduledDate and uses ::date / ::time SQL casts', async () => {
    const badReq = new NextRequest('http://localhost:3000/api/school-bus/trips', {
      method: 'POST',
      headers,
      body: JSON.stringify({ routeName: 'Route A', scheduledDate: '2026-02-30' }),
    });
    const badRes = await POST(badReq);
    expect(badRes.status).toBe(400);

    state.rows = [{ id: 'trip-1', trip_code: 'TRIP-20261118-001', status: 'SCHEDULED' }];
    const goodReq = new NextRequest('http://localhost:3000/api/school-bus/trips', {
      method: 'POST',
      headers,
      body: JSON.stringify({ routeName: 'Route A', scheduledDate: '2026-11-18', scheduledStart: '07:30' }),
    });
    const goodRes = await POST(goodReq);
    expect(goodRes.status).toBe(201);
    expect(state.sqlCalls.some((c) => c.sql.includes('$14::date') && c.sql.includes('$15::time'))).toBe(true);
  });
});
