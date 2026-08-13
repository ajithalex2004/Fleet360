/**
 * tests/integration/staff-transport-headway.test.ts
 *
 * Integration tests for the Headway Management API (Phase 1).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { cleanupTenant, isServerRunning, makeRequest, seedTestTenantFull } from '../setup';

let serverUp = false;
let seed: Awaited<ReturnType<typeof seedTestTenantFull>> | null = null;
let testRouteId: string | null = null;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('[headway integration] Dev server not reachable — skipping');
    return;
  }
  seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');

  // Need a route to attach headway rules to
  const route = await basePrisma.busRoute.create({
    data: {
      tenantId: seed.tenant.id,
      name: 'E2E Headway Route',
      origin: 'A',
      destination: 'B',
      routeType: 'STAFF',
      isActive: true,
    },
  });
  testRouteId = route.id;
});

afterAll(async () => {
  if (testRouteId) {
    await basePrisma.headwayRule.deleteMany({ where: { routeId: testRouteId } });
    await basePrisma.busRoute.delete({ where: { id: testRouteId } }).catch(() => {});
  }
  if (seed) await cleanupTenant(seed.tenant.id);
});

describe('Headway /api/bus-ops/headway', () => {
  it('GET returns empty list for a fresh route', async () => {
    const r = await makeRequest('GET', `/api/bus-ops/headway?routeId=${testRouteId}`, undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    // Without from/to, the API returns just { rules }; departures is computed
    // only when the caller asks for a date range.
    expect(body.rules).toEqual([]);
  });

  it('POST creates a headway rule', async () => {
    const r = await makeRequest('POST', '/api/bus-ops/headway', {
      routeId: testRouteId,
      dayMask: 'YYYYYYY',
      startTime: '06:00',
      endTime: '08:00',
      headwayMinutes: 30,
      anchorTime: '06:00',
      notes: 'E2E test rule',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const created = await r.json();
    expect(created.routeId).toBe(testRouteId);
    expect(created.headwayMinutes).toBe(30);
  });

  it('GET expand returns departures within the window', async () => {
    // Create a rule with a short window
    const created = await (await makeRequest('POST', '/api/bus-ops/headway', {
      routeId: testRouteId,
      dayMask: 'NYYNNNN', // Tue only
      startTime: '08:00',
      endTime: '09:00',
      headwayMinutes: 15,
      anchorTime: '08:00',
    }, seed!.headers)).json();

    // Expand for a Tuesday
    const r = await makeRequest('GET', `/api/bus-ops/headway?routeId=${testRouteId}&from=2026-08-04&to=2026-08-04`, undefined, seed!.headers);
    const body = await r.json();
    // 2026-08-04 is Tuesday
    const rule = body.rules.find((r: { id: string }) => r.id === created.id);
    expect(rule).toBeDefined();
    // Departures: 08:00, 08:15, 08:30, 08:45, 09:00 (5 departures at 15-min headway)
    const dep = body.departures.filter((d: { ruleId: string }) => d.ruleId === created.id);
    expect(dep.length).toBe(5);
    expect(dep[0].localTime).toBe('08:00');
    expect(dep[4].localTime).toBe('09:00');

    // Cleanup
    await makeRequest('DELETE', `/api/bus-ops/headway?id=${created.id}`, undefined, seed!.headers);
  });

  it('DELETE soft-deletes the rule', async () => {
    const created = await (await makeRequest('POST', '/api/bus-ops/headway', {
      routeId: testRouteId,
      dayMask: 'YYYYYYY',
      startTime: '06:00',
      endTime: '08:00',
      headwayMinutes: 60,
    }, seed!.headers)).json();
    const r = await makeRequest('DELETE', `/api/bus-ops/headway?id=${created.id}`, undefined, seed!.headers);
    expect(r.status).toBe(200);

    // Verify it's gone
    const list = await makeRequest('GET', `/api/bus-ops/headway?routeId=${testRouteId}`, undefined, seed!.headers);
    const body = await list.json();
    expect(body.rules.find((x: { id: string }) => x.id === created.id)).toBeUndefined();
  });

  it('returns 400 for missing fields', async () => {
    const r = await makeRequest('POST', '/api/bus-ops/headway', { routeId: testRouteId }, seed!.headers);
    expect(r.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const r = await makeRequest('GET', `/api/bus-ops/headway?routeId=${testRouteId}`);
    expect(r.status).toBe(401);
  });
});
