/**
 * tests/unit/maintenance-batch-b.test.ts
 *
 * Maintenance screens now read and save through the API instead of
 * built-in sample data:
 *  - PM plans: input checks, updates only what was sent, 404 for a plan
 *    that isn't the tenant's
 *  - alert rules: saved under the signed-in tenant (was tenantId '', which
 *    row level security refuses), edits accept only the rule's fields,
 *    deletes are soft
 *  - breakdown reports: the vehicle must be the tenant's; events publish
 *    after the transaction commits
 *  - analytics: actual costs by month, type mix, top jobs, downtime
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';

const rec = vi.hoisted(() => ({
  inTx: false,
  creates: [] as Array<{ model: string; data: Record<string, unknown> }>,
  updates: [] as Array<{ model: string; where: unknown; data: Record<string, unknown> }>,
  found: {} as Record<string, unknown>,
  published: [] as Array<{ name: string; inTx: boolean; tenant: string | undefined }>,
  acting: undefined as string | undefined,
}));

const tx = vi.hoisted(() => {
  const model = (name: string) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      rec.creates.push({ model: name, data });
      return { id: `${name}-1`, reportNo: 'BRK-1', reportedAt: new Date(), vehicleId: 'v1', driverId: null,
        breakdownType: 'OTHER', severity: 'HIGH', location: null, maintenanceRequestId: null, ...data };
    },
    update: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
      rec.updates.push({ model: name, where, data });
      return { id: 'x1', tenantId: TENANT, vehicleId: 'v1', reportNo: 'BRK-1', reportedAt: new Date(),
        breakdownType: 'OTHER', severity: 'HIGH', location: null, driverId: null,
        maintenanceRequestId: 'mr-1', estimatedArrivalAt: null, recoveryVehicleId: null, recoveryDriverId: null, ...data };
    },
    findFirst: async () => rec.found[name] ?? null,
    findUnique: async () => rec.found[name] ?? null,
    findMany: async () => [],
  });
  return {
    $queryRawUnsafe: async () => [{ max: 0 }],
    maintenancePlan: model('maintenancePlan'),
    alertConfig: model('alertConfig'),
    breakdownReport: model('breakdownReport'),
    maintenanceRequest: model('maintenanceRequest'),
    vehicle: model('vehicle'),
  };
});
vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => {
    rec.inTx = true;
    try { return await fn(tx); } finally { rec.inTx = false; }
  },
}));
vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: async <T>(t: string, fn: () => Promise<T>) => {
    const prev = rec.acting; rec.acting = t;
    try { return await fn(); } finally { rec.acting = prev; }
  },
}));
vi.mock('@/lib/maintenance/publish-event', () => {
  const pub = (name: string) => async () => { rec.published.push({ name, inTx: rec.inTx, tenant: rec.acting }); };
  return {
    publishBreakdownReported: pub('breakdown_reported'),
    publishRecoveryDispatched: pub('recovery_dispatched'),
    publishRecoveryCompleted: pub('recovery_completed'),
  };
});
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: <T>(h: T) => h }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));

import { NextRequest } from 'next/server';
import { parsePmPlanInput } from '@/lib/maintenance/pm-plan';
import { parseAlertConfigInput } from '@/lib/alerts/alert-config';
import { summariseMaintenance, periodStart, type AnalyticsRow } from '@/lib/maintenance/analytics';
import * as pmPlan from '@/app/api/maintenance/pm-plans/[id]/route';
import * as pmPlans from '@/app/api/maintenance/pm-plans/route';
import * as alertConfigs from '@/app/api/alert-configs/route';
import * as alertConfig from '@/app/api/alert-configs/[id]/route';
import * as breakdowns from '@/app/api/maintenance/breakdown-reports/route';
import * as breakdown from '@/app/api/maintenance/breakdown-reports/[id]/route';
import * as dispatch from '@/app/api/maintenance/breakdown-reports/[id]/dispatch-recovery/route';

const headers = { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };
const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  rec.creates = []; rec.updates = []; rec.found = {}; rec.published = []; rec.inTx = false; rec.acting = undefined;
});

describe('PM plan input', () => {
  it('needs a name on create and derives each trigger unit from its type', () => {
    expect(parsePmPlanInput({ triggers: [] }, false)).toEqual({ ok: false, error: 'Plan name is required' });
    const r = parsePmPlanInput({ name: ' Oil ', triggers: [{ triggerType: 'CALENDAR', intervalValue: 180, intervalUnit: 'KM' }] }, false);
    expect(r).toMatchObject({ ok: true, data: { name: 'Oil', maintenanceType: 'PREVENTIVE', triggers: [{ triggerType: 'CALENDAR', intervalValue: 180, intervalUnit: 'DAYS' }] } });
  });

  it('refuses unknown trigger types and bad intervals', () => {
    expect(parsePmPlanInput({ name: 'x', triggers: [{ triggerType: 'MOON', intervalValue: 1 }] }, false).ok).toBe(false);
    expect(parsePmPlanInput({ name: 'x', triggers: [{ triggerType: 'ODOMETER', intervalValue: 0 }] }, false).ok).toBe(false);
    expect(parsePmPlanInput({ name: 'x', gracePeriodDays: -1 }, false).ok).toBe(false);
  });

  it('returns only the fields sent on update', () => {
    expect(parsePmPlanInput({ isActive: false }, true)).toEqual({ ok: true, data: { isActive: false } });
  });
});

describe('PM plan routes', () => {
  it('toggles a plan without touching its other fields', async () => {
    rec.found.maintenancePlan = { id: 'p1' };
    const res = await pmPlan.PUT(req('maintenance/pm-plans/p1', 'PUT', { isActive: false, tenantId: OTHER }), params('p1'));
    expect(res.status).toBe(200);
    expect(rec.updates).toEqual([{ model: 'maintenancePlan', where: { id: 'p1' }, data: { isActive: false } }]);
  });

  it("answers 404 for a plan that isn't the tenant's", async () => {
    const put = await pmPlan.PUT(req('maintenance/pm-plans/p9', 'PUT', { isActive: false }), params('p9'));
    const del = await pmPlan.DELETE(req('maintenance/pm-plans/p9', 'DELETE'), params('p9'));
    expect([put.status, del.status]).toEqual([404, 404]);
    expect(rec.updates).toHaveLength(0);
  });

  it('refuses an invalid plan with 400', async () => {
    const res = await pmPlans.POST(req('maintenance/pm-plans', 'POST', { name: 'x', triggers: [{ triggerType: 'MOON', intervalValue: 5 }] }));
    expect(res.status).toBe(400);
    expect(rec.creates).toHaveLength(0);
  });
});

describe('alert rule input', () => {
  const rule = { alertFor: 'Vehicle', alertType: 'Insurance Renewal', frequency: 'By Date', frequencyValue: 365, dueAlertThreshold: 'Days Before', thresholdValue: 30 };

  it('accepts a consistent rule and the older snake_case keys', () => {
    expect(parseAlertConfigInput(rule, false)).toMatchObject({ ok: true, data: { ...rule, notificationEnabled: false, whatsappEnabled: false } });
    expect(parseAlertConfigInput({ ...rule, alertFor: undefined, alert_for: 'Vehicle' }, false).ok).toBe(true);
  });

  it('refuses a type from the wrong list or a threshold for another frequency', () => {
    expect(parseAlertConfigInput({ ...rule, alertType: 'License Renewal' }, false).ok).toBe(false);
    expect(parseAlertConfigInput({ ...rule, dueAlertThreshold: 'Odometer Before' }, false).ok).toBe(false);
  });

  it('never returns tenantId or other unknown fields', () => {
    const r = parseAlertConfigInput({ tenantId: OTHER, id: 'x', deletedAt: null, notificationEnabled: true }, true);
    expect(r).toEqual({ ok: true, data: { notificationEnabled: true } });
  });
});

describe('alert rule routes', () => {
  const rule = { alertFor: 'Driver', alertType: 'License Renewal', frequency: 'By Date', frequencyValue: 730, dueAlertThreshold: 'Days Before', thresholdValue: 30, notificationEnabled: true };

  it('saves a new rule under the signed-in tenant', async () => {
    const res = await alertConfigs.POST(req('alert-configs', 'POST', { ...rule, tenantId: OTHER }));
    expect(res.status).toBe(201);
    expect(rec.creates[0]).toMatchObject({ model: 'alertConfig', data: { tenantId: TENANT, alertType: 'License Renewal', frequencyValue: 730n } });
  });

  it('updates only rule fields, checked against the saved rule', async () => {
    rec.found.alertConfig = { id: 'a1', ...rule };
    const ok = await alertConfig.PATCH(req('alert-configs/a1', 'PATCH', { thresholdValue: 14, tenantId: OTHER }), params('a1'));
    expect(ok.status).toBe(200);
    expect(rec.updates[0].data).toEqual({ thresholdValue: 14n });
    const bad = await alertConfig.PATCH(req('alert-configs/a1', 'PATCH', { alertType: 'Insurance Renewal' }), params('a1'));
    expect(bad.status).toBe(400);
  });

  it('soft-deletes, and answers 404 for a rule that isn\'t the tenant\'s', async () => {
    expect((await alertConfig.DELETE(req('alert-configs/a9', 'DELETE'), params('a9'))).status).toBe(404);
    rec.found.alertConfig = { id: 'a1' };
    expect((await alertConfig.DELETE(req('alert-configs/a1', 'DELETE'), params('a1'))).status).toBe(200);
    expect(rec.updates[0].data).toEqual({ deletedAt: expect.any(Date) });
  });
});

describe('breakdown reports', () => {
  it("refuses a vehicle that isn't the tenant's", async () => {
    const res = await breakdowns.POST(req('maintenance/breakdown-reports', 'POST', { vehicleId: 'v-other' }));
    expect(res.status).toBe(404);
    expect(rec.creates).toHaveLength(0);
  });

  it('creates the report and its maintenance request, then publishes after commit as the tenant', async () => {
    rec.found.vehicle = { id: 'v1' };
    const res = await breakdowns.POST(req('maintenance/breakdown-reports', 'POST', { vehicleId: 'v1', tenantId: OTHER }));
    expect(res.status).toBe(201);
    expect(rec.creates.map((c) => [c.model, c.data.tenantId])).toEqual([['breakdownReport', TENANT], ['maintenanceRequest', TENANT]]);
    await flush();
    expect(rec.published).toEqual([{ name: 'breakdown_reported', inTx: false, tenant: TENANT }]);
  });

  it('publishes recovery events after commit too', async () => {
    rec.found.breakdownReport = { id: 'b1', status: 'REPORTED', deletedAt: null };
    expect((await dispatch.POST(req('x', 'POST', {}), params('b1'))).status).toBe(200);
    rec.found.breakdownReport = { id: 'b1', status: 'RECOVERY_DISPATCHED', deletedAt: null };
    expect((await breakdown.PATCH(req('x', 'PATCH', { status: 'RECOVERY_COMPLETED' }), params('b1'))).status).toBe(200);
    await flush();
    expect(rec.published).toEqual([
      { name: 'recovery_dispatched', inTx: false, tenant: TENANT },
      { name: 'recovery_completed', inTx: false, tenant: TENANT },
    ]);
  });
});

describe('maintenance analytics', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const row = (o: Partial<AnalyticsRow>): AnalyticsRow => ({
    vehicleId: 'v1', maintenanceType: 'PREVENTIVE', status: 'Completed', requestDate: null,
    completionDate: null, createdAt: null, actualCost: null, maintenanceJobs: [], ...o,
  });

  it('sums actual costs by month over the period and ignores older work', () => {
    const s = summariseMaintenance([
      row({ requestDate: new Date('2026-09-01'), completionDate: new Date('2026-09-03'), actualCost: 1000, maintenanceJobs: ['Oil change'] }),
      row({ vehicleId: 'v2', maintenanceType: 'corrective', requestDate: new Date('2026-07-10'), completionDate: new Date('2026-07-11'), actualCost: 500, maintenanceJobs: ['Oil change', 'Brakes'] }),
      row({ completionDate: new Date('2025-01-01'), actualCost: 9999 }),
      row({ status: 'Under Maintenance', requestDate: new Date('2026-09-20') }),
    ], now, 3);
    expect(periodStart(now, 3).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(s.costByMonth.map((m) => [m.label, m.cost])).toEqual([['Jul 26', 500], ['Aug 26', 0], ['Sep 26', 1000]]);
    expect(s).toMatchObject({ requests: 3, completed: 2, openRequests: 1, vehiclesServiced: 2, totalCost: 1500, avgCostPerVehicle: 750, downtimeDays: 3 });
    expect(s.byType).toEqual([{ type: 'PREVENTIVE', count: 2, pct: 67 }, { type: 'CORRECTIVE', count: 1, pct: 33 }]);
    expect(s.topJobs).toEqual([{ job: 'Oil change', occurrences: 2, avgCost: 750 }, { job: 'Brakes', occurrences: 1, avgCost: 500 }]);
  });

  it('reports no cost or downtime rather than zeros when nothing is recorded', () => {
    const s = summariseMaintenance([row({ status: 'Requested', requestDate: new Date('2026-09-10') })], now, 6);
    expect(s).toMatchObject({ totalCost: 0, avgCostPerVehicle: null, downtimeDays: null, openRequests: 1 });
  });
});
