/**
 * tests/unit/connected-maintenance-screens.test.ts
 *
 * PM schedule, SLA and predictive alerts now read the tenant's records:
 *  - PM schedule: each active plan against each vehicle it covers, from
 *    the plan's last completed service; no invented baseline when there
 *    is none; open requests are recognised; request bodies
 *  - SLA: request status history becomes the SLA timeline, whatever the
 *    status spelling; open and recently finished requests are monitored
 *  - these screens no longer carry the Preview banner or sample arrays
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPmSchedule, NO_HISTORY, planApplies, pmRequestBody, type SchedulePlan, type ScheduleVehicle } from '@/lib/pm/schedule';
import { isSlaMonitored, toMaintenanceStatus, toSlaRequest } from '@/lib/maintenance/sla-requests';
import { computeSLASnapshot } from '@/lib/maintenance/sla-engine';
import { MaintenanceStatus, PMItemStatus } from '@/types/maintenance';
import { scoreGarages, type GarageJob } from '@/lib/maintenance/garage-performance';

const now = new Date('2026-09-30T12:00:00Z');
const plan = (o: Partial<SchedulePlan> = {}): SchedulePlan => ({
  id: 'p1', name: 'Oil service', maintenanceType: 'PREVENTIVE', applicability: { allVehicles: true },
  gracePeriodDays: 0, earlyWindowDays: 7, earlyWindowKm: 500,
  triggers: [
    { id: 't1', triggerType: 'CALENDAR', intervalValue: 180, intervalUnit: 'DAYS' },
    { id: 't2', triggerType: 'ODOMETER', intervalValue: 10000, intervalUnit: 'KM' },
  ],
  ...o,
});
const vehicle = (id: string, odometerKm: number | null, o: Partial<ScheduleVehicle> = {}): ScheduleVehicle => ({
  id, licensePlate: `DXB ${id}`, make: 'Toyota', model: 'Hiace', type: 'VAN', odometerKm, ...o,
});
const done = (vehicleId: string, completion: string, odometer: number | null, jobs = ['Oil service']) => ({
  id: `mr-${vehicleId}`, vehicleId, maintenanceJobs: jobs, completionDate: new Date(completion),
  requestDate: null, createdAt: null, odometer, status: 'Completed',
});

describe('PM schedule', () => {
  it('measures each vehicle from its last completed service under the plan', () => {
    const entries = buildPmSchedule({
      plans: [plan()],
      vehicles: [vehicle('v1', 50_600), vehicle('v2', 30_000), vehicle('v3', 20_000)],
      requests: [
        done('v1', '2026-06-01', 40_000),           // 10,600 km since: overdue by km
        done('v2', '2026-04-08', 29_000),           // 175 days: due within 7 days
        done('v3', '2026-01-01', 10_000, ['Brakes']), // another plan's job: not a baseline
      ],
      items: [],
      now,
    });
    const byVehicle = Object.fromEntries(entries.map((e) => [e.vehicleId, e]));
    expect(byVehicle.v1).toMatchObject({ status: PMItemStatus.OVERDUE, triggeringFactor: 'ODOMETER', kmUntilDue: -600, lastOdometerKm: 40_000 });
    expect(byVehicle.v2).toMatchObject({ status: PMItemStatus.DUE, triggeringFactor: 'CALENDAR' });
    expect(byVehicle.v3).toMatchObject({ status: NO_HISTORY, urgencyScore: 0 });
    expect(byVehicle.v3.lastServiceDate).toBeUndefined();
    expect(entries[0].vehicleId).toBe('v1');
  });

  it('prefers a saved schedule row, and notes an open request for the plan', () => {
    const [e] = buildPmSchedule({
      plans: [plan()],
      vehicles: [vehicle('v1', 12_000)],
      requests: [{ id: 'mr-open', vehicleId: 'v1', maintenanceJobs: ['oil service'], completionDate: null, requestDate: null, createdAt: null, odometer: null, status: 'Requested' }],
      items: [{ planId: 'p1', vehicleId: 'v1', lastServiceDate: new Date('2026-09-01'), lastOdometerKm: 11_000, nextDueDateCalc: null, nextDueOdometerKm: null, status: 'UPCOMING' }],
      now,
    });
    expect(e).toMatchObject({ status: PMItemStatus.UPCOMING, openRequestId: 'mr-open', lastOdometerKm: 11_000 });
  });

  it('covers only the vehicles a plan applies to', () => {
    expect(planApplies({ allVehicles: false, vehicleIds: ['v1'] }, vehicle('v1', 0))).toBe(true);
    expect(planApplies({ allVehicles: false, vehicleTypes: ['BUS'] }, vehicle('v2', 0))).toBe(false);
    expect(planApplies(null, vehicle('v2', 0))).toBe(true);
  });

  it('raises a preventive request carrying the plan name as its job', () => {
    expect(pmRequestBody({ vehicleId: 'v1', planName: 'Oil service', status: PMItemStatus.OVERDUE })).toEqual({
      vehicleId: 'v1', description: 'Preventive maintenance — Oil service (overdue)', maintenanceType: 'PREVENTIVE',
      priority: 'HIGH', status: 'Requested', maintenanceJobs: ['Oil service'],
    });
  });
});

describe('SLA from real requests', () => {
  it('reads statuses however they are written', () => {
    expect(toMaintenanceStatus('Under Maintenance')).toBe(MaintenanceStatus.UNDER_MAINTENANCE);
    expect(toMaintenanceStatus('UNDER_MAINTENANCE')).toBe(MaintenanceStatus.UNDER_MAINTENANCE);
    expect(toMaintenanceStatus('open')).toBeNull();
  });

  it('builds the timeline from status history, earliest time per status', () => {
    const mr = toSlaRequest({
      id: 'mr1', priority: 'High', maintenanceType: 'corrective', status: 'Accepted',
      requestDate: '2026-09-30T08:00:00Z',
      histories: [
        { status: 'Submitted', date: '2026-09-30T08:30:00Z' },
        { status: 'ACCEPTED', date: '2026-09-30T09:00:00Z' },
        { status: 'Accepted', date: '2026-09-30T10:00:00Z' },
        { status: 'Nonsense', date: '2026-09-30T09:15:00Z' },
      ],
    });
    expect(mr.statusTimeline).toEqual({
      [MaintenanceStatus.SUBMITTED]: '2026-09-30T08:30:00.000Z',
      [MaintenanceStatus.ACCEPTED]: '2026-09-30T09:00:00.000Z',
    });
    const snap = computeSLASnapshot(mr, undefined, now);
    expect(snap.tier).toBe('HIGH');
    expect(snap.phases.find((p) => p.phase === 'RESPONSE')?.elapsedMinutes).toBe(30);
  });

  it('monitors open requests and those finished in the last 30 days', () => {
    expect(isSlaMonitored({ id: 'a', status: 'Under Maintenance' }, now)).toBe(true);
    expect(isSlaMonitored({ id: 'b', status: 'Completed', completionDate: '2026-09-20T00:00:00Z' }, now)).toBe(true);
    expect(isSlaMonitored({ id: 'c', status: 'Closed', completionDate: '2026-07-01T00:00:00Z' }, now)).toBe(false);
  });
});

describe('garage performance', () => {
  const job = (o: Partial<GarageJob>): GarageJob => ({
    garageId: 'g1', garageName: 'Autopro', requestDate: new Date('2026-09-01T08:00:00Z'), createdAt: null,
    completionDate: null, expectedEndDate: null, estimatedCost: null, actualCost: null, histories: [], inspections: [], ...o,
  });

  it('scores each garage from its own jobs', () => {
    const [g] = scoreGarages([
      job({ completionDate: new Date('2026-09-03T08:00:00Z'), expectedEndDate: new Date('2026-09-04T00:00:00Z'),
        estimatedCost: 1000, actualCost: 900, histories: [{ status: 'ACCEPTED', date: new Date('2026-09-01T10:00:00Z') }],
        inspections: [
          { overallResult: 'FAIL', inspectedAt: new Date('2026-09-02T00:00:00Z'), createdAt: new Date('2026-09-02T00:00:00Z') },
          { overallResult: 'PASS', inspectedAt: new Date('2026-09-03T00:00:00Z'), createdAt: new Date('2026-09-03T00:00:00Z') },
        ] }),
      job({ completionDate: new Date('2026-09-10T08:00:00Z'), expectedEndDate: new Date('2026-09-05T00:00:00Z'),
        estimatedCost: 1000, actualCost: 1300, histories: [{ status: 'Accepted', date: new Date('2026-09-01T12:00:00Z') }],
        inspections: [{ overallResult: 'PASS', inspectedAt: null, createdAt: new Date('2026-09-09T00:00:00Z') }] }),
      job({}),
    ]);
    expect(g).toMatchObject({
      garageName: 'Autopro', totalJobs: 3, completedJobs: 2, avgCompletionDays: 5.5, avgActualCost: 1100,
      costVariancePct: 10, onTimeRate: 50, qcFirstPassRate: 50, responseHours: 3, overallScore: 50,
    });
  });

  it('leaves unmeasurable figures empty instead of inventing them', () => {
    const [g] = scoreGarages([job({})]);
    expect(g).toMatchObject({ completedJobs: 0, avgCompletionDays: null, avgActualCost: null, costVariancePct: null,
      onTimeRate: null, qcFirstPassRate: null, responseHours: null, overallScore: null });
  });
});

describe('connected screens', () => {
  it.each([
    ['maintenance/schedule', '/api/maintenance'],
    ['maintenance/sla', '/api/maintenance'],
    ['maintenance/predictive-alerts', '/api/maintenance'],
    ['maintenance/garage-assignments', '/api/maintenance'],
    ['maintenance/garage-performance', '/api/maintenance'],
    ['school-bus/analytics', '/api/school-bus/reports'],
    ['ai-platform/predictive', '/api/maintenance/risk-scores'],
  ])('%s reads %s and has no Preview banner or sample array', (screen, api) => {
    const src = readFileSync(join(process.cwd(), 'src/app/(app)', screen, 'page.tsx'), 'utf8');
    expect(src).not.toMatch(/PreviewBanner|MOCK_|SEED_|RISK_ITEMS/);
    expect(src).toContain(api);
  });
});

describe('school bus reports query', () => {
  // These column names don't exist (school_bus_routes has no vehicle_reg or
  // driver_name; vehicles has license_plate / seating_capacity; allocations
  // have no seat_type; finance_invoices has payment_status and a uuid
  // reference_id). Each made a query fail silently and the report go empty.
  const src = readFileSync(join(process.cwd(), 'src/app/api/school-bus/reports/route.ts'), 'utf8');
  const sql = (src.match(/`[\s\S]*?`/g) ?? []).join('\n').replace(/--[^\n]*/g, '');

  it('uses the real column names', () => {
    for (const bad of ['r.vehicle_reg', 'r.driver_name', 'v.registration_number', 'v.capacity', 'v.ownership_type', 'a.seat_type', 'i.metadata', 'i.status', "COALESCE(i.reference_id, '')"]) {
      expect(sql, bad).not.toContain(bad);
    }
  });

  it('runs in the tenant scope and invents no seats, staff or revenue', () => {
    expect(src).toMatch(/withTenantRls\(prisma, tenantId/);
    expect(src).not.toMatch(/,\s*40\)|\|\|\s*40\b|\? 5 : 0|Distribute evenly/);
  });
});
