/**
 * tests/integration/staff-transport-planning.test.ts
 *
 * Integration tests for the Planning Core API (Phase 1 — P0).
 *   - POST /api/bus-ops/plan/compute — compute a plan
 *   - POST /api/bus-ops/plan — save a plan
 *   - GET  /api/bus-ops/plan — list plans
 *   - POST /api/bus-ops/plan/compare — compare two plans
 *   - DELETE /api/bus-ops/plan?id=X — archive a plan
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { cleanupTenant, isServerRunning, makeRequest, seedTestTenantFull } from '../setup';

let serverUp = false;
let seed: Awaited<ReturnType<typeof seedTestTenantFull>> | null = null;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('[planning integration] Dev server not reachable — skipping');
    return;
  }
  seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');
});

afterAll(async () => {
  if (seed) {
    // Delete any plans we created
    await basePrisma.staffTransportPlan.deleteMany({ where: { tenantId: seed.tenant.id, name: { startsWith: 'E2E-' } } });
    await cleanupTenant(seed.tenant.id);
  }
});

describe('Planning Core /api/bus-ops/plan', () => {
  it('POST /compute returns a plan with runs, blocks, rosters, summary', async () => {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const r = await makeRequest('POST', '/api/bus-ops/plan/compute', {
      dateFrom: fmt(today),
      dateTo: fmt(tomorrow),
      workRules: {
        maxWorkMins: 480, maxSpreadMins: 720, maxOTMins: 240,
        otThresholdMins: 480, otRate: 1.5, hourlyRate: 25,
        reportTimeMins: 15, wrapTimeMins: 10, deadheadMins: 15,
        maxTripsPerRun: 12,
      },
      blockOptions: { maxDeadheadMins: 60, maxBlockWorkMins: 600 },
      rosterOptions: { pattern: '5/2', weeklyCapMins: 2400 },
    }, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.plan).toBeDefined();
    expect(body.plan.summary).toBeDefined();
    expect(Array.isArray(body.plan.runs)).toBe(true);
    expect(Array.isArray(body.plan.blocks)).toBe(true);
    expect(Array.isArray(body.plan.rosters)).toBe(true);
  });

  it('POST /compute without body returns 400', async () => {
    const r = await makeRequest('POST', '/api/bus-ops/plan/compute', {}, seed!.headers);
    expect(r.status).toBe(400);
  });

  it('POST /plan (save) persists a plan', async () => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // Compute first
    const compute = await (await makeRequest('POST', '/api/bus-ops/plan/compute', {
      dateFrom: fmt(today),
      dateTo: fmt(new Date(today.getTime() + 24 * 60 * 60 * 1000)),
      workRules: { maxWorkMins: 480, maxSpreadMins: 720, maxOTMins: 240 },
      blockOptions: {},
      rosterOptions: {},
    }, seed!.headers)).json();

    // Save
    const r = await makeRequest('POST', '/api/bus-ops/plan', {
      name: 'E2E-Plan A',
      dateFrom: fmt(today),
      dateTo: fmt(new Date(today.getTime() + 24 * 60 * 60 * 1000)),
      workRules: compute.plan.workRules,
      blockOptions: compute.plan.blockOptions,
      runs: compute.plan.runs,
      blocks: compute.plan.blocks,
      rosters: compute.plan.rosters,
      summary: compute.plan.summary,
      save: true,
    }, seed!.headers);
    expect(r.status).toBe(201);
    const saved = await r.json();
    expect(saved.id).toBeDefined();
    expect(saved.name).toBe('E2E-Plan A');
  });

  it('GET /plan lists the saved plan', async () => {
    const r = await makeRequest('GET', '/api/bus-ops/plan', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const list = await r.json();
    expect(Array.isArray(list)).toBe(true);
  });

  it('POST /compare returns a diff between two plans', async () => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // Save two plans
    const a = await (await makeRequest('POST', '/api/bus-ops/plan', {
      name: 'E2E-Plan A (for compare)',
      dateFrom: fmt(today),
      dateTo: fmt(new Date(today.getTime() + 24 * 60 * 60 * 1000)),
      workRules: {}, blockOptions: {}, runs: [], blocks: [], rosters: [], summary: { runCount: 5, blockCount: 3, totalPayCost: 1000 },
      save: true,
    }, seed!.headers)).json();
    const b = await (await makeRequest('POST', '/api/bus-ops/plan', {
      name: 'E2E-Plan B (for compare)',
      dateFrom: fmt(today),
      dateTo: fmt(new Date(today.getTime() + 24 * 60 * 60 * 1000)),
      workRules: {}, blockOptions: {}, runs: [], blocks: [], rosters: [], summary: { runCount: 6, blockCount: 3, totalPayCost: 1200 },
      save: true,
    }, seed!.headers)).json();

    const r = await makeRequest('POST', '/api/bus-ops/plan/compare', {
      planIdA: a.id,
      planIdB: b.id,
    }, seed!.headers);
    expect(r.status).toBe(200);
    const diff = await r.json();
    expect(diff.runCountA).toBe(5);
    expect(diff.runCountB).toBe(6);
    expect(diff.totalPayCostA).toBe(1000);
    expect(diff.totalPayCostB).toBe(1200);
  });

  it('DELETE /plan?id=X archives the plan', async () => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const created = await (await makeRequest('POST', '/api/bus-ops/plan', {
      name: 'E2E-Plan to delete',
      dateFrom: fmt(today),
      dateTo: fmt(new Date(today.getTime() + 24 * 60 * 60 * 1000)),
      workRules: {}, blockOptions: {}, runs: [], blocks: [], rosters: [], summary: {},
      save: true,
    }, seed!.headers)).json();

    const r = await makeRequest('DELETE', `/api/bus-ops/plan?id=${created.id}`, undefined, seed!.headers);
    expect(r.status).toBe(200);

    // Verify status is ARCHIVED
    const after = await basePrisma.staffTransportPlan.findUnique({ where: { id: created.id } });
    expect(after?.status).toBe('ARCHIVED');
  });

  it('returns 401 without auth', async () => {
    const r = await makeRequest('GET', '/api/bus-ops/plan');
    expect(r.status).toBe(401);
  });
});
