import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TenantOperationsSnapshot, TripRow, FleetVehicleRow, FleetDriverRow } from '@/lib/agents/data-loaders/tenant-operations';

// The Compliance, Fleet Workforce Planner and Vehicle Reuse agents load their
// own tenant's data when a run carries none, and the planner's scenarios are
// built from what it actually assigned.
const h = vi.hoisted(() => ({
  snapshot: null as unknown as TenantOperationsSnapshot,
  proposals: [] as Array<Record<string, unknown>>,
  approvals: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
    fn({
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        h.queries.push({ sql, params });
        return [];
      },
    }),
  ),
}));
vi.mock('@/lib/agents/governance', () => ({
  policyService: {
    evaluateActionProposal: vi.fn(async (_t: string, p: Record<string, unknown>) => {
      h.proposals.push(p);
      return { requiresApprovalQueue: true };
    }),
    createApprovalItem: vi.fn(async (_t: string, p: Record<string, unknown>) => {
      h.approvals.push(p);
      return { id: 'appr' };
    }),
  },
}));
vi.mock('@/lib/routing/intelligence-service', () => ({
  routingIntelligence: { getTravelTime: vi.fn(async () => ({ distanceKm: 5, durationMin: 10, isCacheHit: true, provider: 'test' })) },
}));

const loaders = await import('@/lib/agents/data-loaders/tenant-operations');
let loadSpy = vi.spyOn(loaders, 'loadTenantOperations').mockImplementation(async () => h.snapshot);
const { complianceInput, plannerRequest, reuseInput } = await import('@/lib/agents/data-loaders/agent-inputs');
const { masterPlannerSolver } = await import('@/lib/agents/fleet-workforce-planner/master-solver');
const { complianceAgent } = await import('@/lib/agents/compliance/agent');
const { fleetWorkforcePlannerAgent } = await import('@/lib/agents/fleet-workforce-planner/agent');
const { vehicleReuseAgent, selectCompatibleChains } = await import('@/lib/agents/vehicle-reuse/agent');

const at = (day: string, hm: string) => new Date(`${day}T${hm}:00+04:00`);
const TODAY = '2026-11-04';
const TOMORROW = '2026-11-05';

const vehicle = (id: string, seats: number, extra: Partial<FleetVehicleRow> = {}): FleetVehicleRow => ({
  id, code: id.toUpperCase(), plate: null, category: null, seats, status: 'AVAILABLE', depotId: 'dep-1', usage: 'STAFF',
  registrationExpiry: at('2027-06-01', '00:00'), insuranceExpiry: at('2027-06-01', '00:00'), mulkiyaExpiry: null, ...extra,
});
const driver = (id: string, extra: Partial<FleetDriverRow> = {}): FleetDriverRow => ({
  id, name: `Driver ${id}`, licenseType: 'BUS', licenseExpiry: at('2027-06-01', '00:00'), emiratesIdExpiry: at('2027-06-01', '00:00'), visaExpiry: null, status: 'ACTIVE', ...extra,
});
const trip = (id: string, day: string, from: string, to: string, extra: Partial<TripRow> = {}): TripRow => ({
  id, tripNumber: id, routeId: 'r1', routeName: 'Route 1', origin: 'A', destination: 'B', requiredLicenseType: 'BUS', requiredVehicleGroup: null,
  vehicleId: null, driverId: null, departure: at(day, from), arrival: at(day, to), arrivalAssumed: false, passengers: 20, status: 'SCHEDULED',
  startLat: 25.2, startLng: 55.27, endLat: 25.25, endLng: 55.3, ...extra,
});
const snapshot = (over: Partial<TenantOperationsSnapshot>): TenantOperationsSnapshot => ({
  vehicles: [], drivers: [], tripsToday: [], tripsTomorrow: [], dutyToday: new Map(), dutyLast7Days: new Map(),
  depots: [{ id: 'dep-1', name: 'Al Quoz depot', lat: 25.13, lng: 55.23 }], today: TODAY, tomorrow: TOMORROW, unavailable: [], ...over,
});

beforeEach(() => {
  h.proposals = [];
  h.approvals = [];
  h.queries = [];
  loadSpy.mockClear();
});

describe('operating day', () => {
  it('uses Gulf time: 22:30 UTC is already the next day', () => {
    const d = loaders.operatingDay(0, new Date('2026-11-04T22:30:00Z'));
    expect(d.date).toBe('2026-11-05');
    expect(d.from.toISOString()).toBe('2026-11-04T20:00:00.000Z');
    expect(loaders.operatingDay(1, new Date('2026-11-04T10:00:00Z')).date).toBe('2026-11-05');
  });
});

describe('every loader query names the tenant', () => {
  it('passes the tenant id to each query', async () => {
    loadSpy.mockRestore();
    try {
      await loaders.loadTenantOperations('tenant-a');
    } finally {
      loadSpy = vi.spyOn(loaders, 'loadTenantOperations').mockImplementation(async () => h.snapshot);
    }
    expect(h.queries.length).toBeGreaterThanOrEqual(6);
    for (const q of h.queries) {
      expect(q.params[0]).toBe('tenant-a');
      expect(q.sql).toMatch(/tenant_id(::text)? = \$1/);
    }
  });
});

describe('input builders', () => {
  it('compliance: document expiries and one readiness check per driver on today\'s roster', () => {
    const s = snapshot({
      vehicles: [vehicle('v1', 30), vehicle('v2', 30, { insuranceExpiry: null })],
      drivers: [driver('d1'), driver('d2', { licenseExpiry: at('2026-10-01', '00:00') }), driver('d3')],
      tripsToday: [trip('t1', TODAY, '06:00', '07:00', { driverId: 'd1', vehicleId: 'v1' }), trip('t2', TODAY, '08:00', '09:00', { driverId: 'd2' })],
      dutyToday: new Map([['d1', 120]]),
    });
    const input = complianceInput(s);
    expect(input.documents.filter((d) => d.entityType === 'VEHICLE').map((d) => d.documentType).sort()).toEqual(['MOTOR_INSURANCE', 'MULKIYA_REGISTRATION', 'MULKIYA_REGISTRATION']);
    expect(input.missingExpiries.vehicles).toBe(1);
    expect(input.readinessRequests.map((r) => r.driverId).sort()).toEqual(['d1', 'd2']); // d3 has no trip today
    expect(input.readinessRequests.find((r) => r.driverId === 'd1')?.dailyDutyMinutesUsed).toBe(120);
  });

  it('planner: tomorrow only; vehicles that cannot legally run and drivers who may not drive are left out', () => {
    const s = snapshot({
      vehicles: [vehicle('ok', 30), vehicle('maint', 30, { status: 'MAINTENANCE' }), vehicle('noins', 30, { insuranceExpiry: at('2026-11-01', '00:00') })],
      drivers: [driver('ok'), driver('susp', { status: 'SUSPENDED' }), driver('expired', { licenseExpiry: at('2026-11-02', '00:00') })],
      tripsToday: [trip('today', TODAY, '06:00', '07:00')],
      tripsTomorrow: [trip('tomorrow', TOMORROW, '06:00', '07:00')],
    });
    const req = plannerRequest(s);
    expect(req.scheduleDate).toBe(TOMORROW);
    expect(req.trips.map((t) => t.id)).toEqual(['tomorrow']);
    expect(req.vehicles.map((v) => v.vehicleId)).toEqual(['ok']);
    expect(req.drivers.map((d) => d.driverId)).toEqual(['ok']);
    expect(req.excluded).toEqual({ vehicles: 2, drivers: 2 });
  });

  it('reuse: trips with a vehicle are predecessors; scheduled trips without one are waiting', () => {
    const s = snapshot({
      vehicles: [vehicle('v1', 30)],
      tripsToday: [trip('a', TODAY, '06:00', '07:00', { vehicleId: 'v1' }), trip('b', TODAY, '09:00', '10:00'), trip('c', TODAY, '11:00', '12:00', { status: 'DEPARTED' })],
    });
    const r = reuseInput(s);
    expect(r.activeTrips.map((x) => x.trip.id)).toEqual(['a']);
    expect(r.unassignedTrips.map((x) => x.id)).toEqual(['b']);
    expect(r.bookings.get('v1')).toHaveLength(1);
  });
});

describe('planner solver hard rules', () => {
  const base = { scheduleDate: TOMORROW, depots: [{ id: 'dep-1', name: 'Depot', lat: 25.1, lng: 55.2 }] };
  const plannerTrip = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
    id, plannedPickupTime: at(TOMORROW, from).toISOString(), plannedDropoffTime: at(TOMORROW, to).toISOString(), passengerCount: 20, vehicleCategoryRequired: 'COASTER_30', ...extra,
  });
  const plannerVehicle = (id: string) => ({ id, vehicleId: id, vehicleCode: id.toUpperCase(), capacity: 30, category: 'COASTER_30', currentDepotId: 'dep-1' });
  const plannerDriver = (id: string, licenses: string[] = ['BUS']) => ({ id, driverId: id, driverName: id, licenseClasses: licenses, currentDepotId: 'dep-1', rosterStatus: 'ON_DUTY' });

  it('never puts one driver on two overlapping trips', async () => {
    const plan = await masterPlannerSolver.solveMasterPlan({
      ...base,
      trips: [plannerTrip('t1', '06:00', '07:30'), plannerTrip('t2', '07:00', '08:00')],
      vehicles: [plannerVehicle('v1'), plannerVehicle('v2')],
      drivers: [plannerDriver('d1')],
    } as never);
    for (const s of plan.scenarios) {
      expect(s.assignments).toHaveLength(1);
      expect(s.unservedTripsCount + s.outsourcedTripsCount).toBe(1);
    }
  });

  it('a driver with no licence on record is not given a bus trip', async () => {
    const plan = await masterPlannerSolver.solveMasterPlan({
      ...base,
      trips: [plannerTrip('t1', '06:00', '07:00', { requiredLicenseType: 'BUS' })],
      vehicles: [plannerVehicle('v1')],
      drivers: [plannerDriver('d1', [])],
    } as never);
    expect(plan.recommendedScenario.assignments).toHaveLength(0);
    expect(plan.tripsUnserved).toBe(1);
  });

  it('standby and outsourcing are real; scenario C has no overtime; no invented ids', async () => {
    const plan = await masterPlannerSolver.solveMasterPlan({
      ...base,
      trips: [plannerTrip('t1', '06:00', '07:00'), plannerTrip('t2', '08:00', '09:00')],
      vehicles: [plannerVehicle('v1'), plannerVehicle('v2'), plannerVehicle('v3')],
      drivers: [plannerDriver('d1'), plannerDriver('d2'), plannerDriver('d3')],
    } as never);
    const ids = new Set(['v1', 'v2', 'v3', 'd1', 'd2', 'd3']);
    for (const s of plan.scenarios) {
      for (const a of s.standbyAllocations) {
        for (const v of a.standbyVehicles) expect(ids.has(v.vehicleId)).toBe(true);
        for (const d of a.standbyDrivers) expect(ids.has(d.driverId)).toBe(true);
      }
      expect(JSON.stringify(s)).not.toMatch(/v-sb-|d-sb-|Standby Driver \d/);
    }
    const [a, b, c] = plan.scenarios;
    expect(a.standbyVehiclesCount + a.standbyDriversCount).toBe(0);
    expect(b.standbyVehiclesCount).toBe(1);
    expect(b.standbyDriversCount).toBe(1);
    expect(c.overtimeMinutesTotal).toBe(0);
    expect(plan.recommendedScenario.scenarioId).toBe('SCENARIO_B_BALANCED');
  });
});

describe('agents load their own tenant\'s data when a run carries none', () => {
  it('compliance checks today\'s roster and proposes blocking a driver whose licence expired', async () => {
    h.snapshot = snapshot({
      vehicles: [vehicle('v1', 30)],
      drivers: [driver('d1'), driver('d2', { licenseExpiry: at('2026-10-01', '00:00') })],
      tripsToday: [trip('t1', TODAY, '06:00', '07:00', { driverId: 'd1', vehicleId: 'v1' }), trip('t2', TODAY, '08:00', '09:00', { driverId: 'd2' })],
    });
    const res = await complianceAgent.run({ agent_id: 'compliance', tenant_id: 'tenant-a', event_type: 'manual.trigger', payload: {} } as never);
    expect(loadSpy).toHaveBeenCalledWith('tenant-a', expect.anything());
    expect(res.itemsProcessed).toBeGreaterThan(2);
    expect(h.approvals.some((p) => p.actionType === 'SUSPEND_DRIVER' && p.entityId === 'd2')).toBe(true);
    expect(h.approvals.some((p) => p.entityId === 'd1')).toBe(false);
  });

  it('the planner plans tomorrow from the tenant\'s data, and an empty day is no plan to approve', async () => {
    h.snapshot = snapshot({
      vehicles: [vehicle('v1', 30)],
      drivers: [driver('d1')],
      tripsTomorrow: [trip('t1', TOMORROW, '06:00', '07:00')],
    });
    const res = await fleetWorkforcePlannerAgent.run({ agent_id: 'fleet-workforce-planner', tenant_id: 'tenant-a', event_type: 'manual.trigger', payload: {} } as never);
    expect(res.itemsProcessed).toBe(1);
    expect((res.output as { recommendedScenario: { assignments: unknown[] } }).recommendedScenario.assignments).toHaveLength(1);
    expect(h.proposals.some((p) => p.actionType === 'COMMIT_MASTER_PLAN')).toBe(true);

    h.proposals = [];
    h.snapshot = snapshot({ vehicles: [vehicle('v1', 30)], drivers: [driver('d1')] });
    const empty = await fleetWorkforcePlannerAgent.run({ agent_id: 'fleet-workforce-planner', tenant_id: 'tenant-a', event_type: 'manual.trigger', payload: {} } as never);
    expect(empty.itemsProcessed).toBe(0);
    expect(empty.actionsCreated).toBe(0);
    expect(h.proposals).toHaveLength(0);
  });

  it('vehicle reuse proposes chains from the tenant\'s trips for approval', async () => {
    h.snapshot = snapshot({
      vehicles: [vehicle('v1', 30)],
      tripsToday: [trip('a', TODAY, '06:00', '07:00', { vehicleId: 'v1' }), trip('b', TODAY, '08:30', '09:30')],
    });
    const res = await vehicleReuseAgent.run({ agent_id: 'vehicle-reuse', tenant_id: 'tenant-a', event_type: 'manual.trigger', payload: {} } as never);
    expect(res.itemsProcessed).toBe(1);
    expect(h.proposals.some((p) => p.actionType === 'LINK_TRIPS' && p.entityId === 'a->b')).toBe(true);
  });
});

describe('chain selection', () => {
  const r = (a: string, b: string, v: string, savings: number) => ({ isFeasible: true, tripAId: a, tripBId: b, vehicleId: v, financialSavingsAed: savings, bufferMin: 10 }) as never;
  it('one vehicle per waiting trip, and no chain that collides with another booking of the vehicle', () => {
    const bookings = new Map([['v2', [{ start: 1000, end: 2000, tripId: 'x' }]]]);
    const times = new Map([['b1', { start: 500, end: 900 }], ['b2', { start: 1500, end: 1800 }]]);
    const chosen = selectCompatibleChains([r('a1', 'b1', 'v1', 300), r('a2', 'b1', 'v3', 200), r('a3', 'b2', 'v2', 100)], bookings, times);
    expect(chosen.map((c: { tripBId: string; vehicleId: string }) => `${c.tripBId}:${c.vehicleId}`)).toEqual(['b1:v1']);
  });
});
