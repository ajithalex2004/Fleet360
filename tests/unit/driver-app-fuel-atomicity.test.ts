/**
 * tests/unit/driver-app-fuel-atomicity.test.ts
 *
 * Verifies genuine atomic transaction rollback and validation on
 * POST /api/driver-app/fuel-entries (no forceSubledgerError, no .catch swallows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest } from 'next/server';

const { state, mockEventBus, resetState } = vi.hoisted(() => {
  const state = {
    fuelEntries: [] as Array<Record<string, unknown>>,
    fuelLogs: [] as Array<Record<string, unknown>>,
    vehicleOdometer: 50000n,
    publishedEvents: [] as Array<Record<string, unknown>>,
    throwOnFuelLogCreate: false,
    throwOnVehicleUpdate: false,
    throwOnEventPublish: false,
    committed: false,
    rolledBack: false,
  };

  function resetState() {
    state.fuelEntries = [];
    state.fuelLogs = [];
    state.vehicleOdometer = 50000n;
    state.publishedEvents = [];
    state.throwOnFuelLogCreate = false;
    state.throwOnVehicleUpdate = false;
    state.throwOnEventPublish = false;
    state.committed = false;
    state.rolledBack = false;
  }

  const mockEventBus = {
    publish: vi.fn(async (event: Record<string, unknown>) => {
      if (state.throwOnEventPublish) {
        throw new Error('Outbox insert failed: connection lost');
      }
      state.publishedEvents.push(event);
    }),
  };

  return { state, mockEventBus, resetState };
});

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const VEHICLE_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('@/events/event-bus', () => ({
  getEventBus: () => mockEventBus,
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

// Simulate real transactional commit/rollback semantics around staged mutations
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => {
    const stagedFuelEntries = [...state.fuelEntries];
    const stagedFuelLogs = [...state.fuelLogs];
    let stagedOdometer = state.vehicleOdometer;

    const tx = {
      driver: {
        findFirst: vi.fn(async () => ({ id: USER_ID, tenantId: TENANT_ID, status: 'ACTIVE' })),
      },
      vehicle: {
        findFirst: vi.fn(async () => ({ id: VEHICLE_ID, odometerReading: stagedOdometer })),
        update: vi.fn(async ({ data }: { data: { odometerReading: bigint } }) => {
          if (state.throwOnVehicleUpdate) {
            throw new Error('Vehicle odometer update failed');
          }
          stagedOdometer = data.odometerReading;
          return { id: VEHICLE_ID, odometerReading: stagedOdometer };
        }),
      },
      fuelLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (state.throwOnFuelLogCreate) {
            throw new Error('Subledger fuel_logs constraint failure');
          }
          stagedFuelLogs.push(data);
          return data;
        }),
      },
      $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('INSERT INTO fuel_entries')) {
          stagedFuelEntries.push({ id: 'staged-entry' });
        }
        return 1;
      }),
      $executeRawUnsafe: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => []),
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes('FROM vehicles v') && sql.includes('v.id::text = $1')) {
          return [{ id: VEHICLE_ID }];
        }
        return [];
      }),
    };

    try {
      const res = await fn(tx);
      state.fuelEntries = stagedFuelEntries;
      state.fuelLogs = stagedFuelLogs;
      state.vehicleOdometer = stagedOdometer;
      state.committed = true;
      return res;
    } catch (err) {
      state.rolledBack = true;
      throw err;
    }
  },
}));

import { signSession } from '@/lib/tenant-session';
import { POST } from '@/app/api/driver-app/fuel-entries/route';

async function makeHeaders() {
  const token = await signSession({
    userId: USER_ID,
    tenantId: TENANT_ID,
    plan: 'ENTERPRISE',
    role: 'DRIVER',
  });
  return {
    'content-type': 'application/json',
    'x-tenant-id': TENANT_ID,
    'x-user-id': USER_ID,
    'x-user-role': 'DRIVER',
    cookie: `xl-driver-session=${token}`,
    authorization: `Bearer ${token}`,
  };
}

describe('POST /api/driver-app/fuel-entries atomic rollback & validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 500 and rolls back fuel_entries when tx.fuelLog.create throws', async () => {
    state.throwOnFuelLogCreate = true;
    const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
      method: 'POST',
      headers: await makeHeaders(),
      body: JSON.stringify({
        vehicleId: VEHICLE_ID,
        liters: 50,
        totalCost: 150,
        odometer: 50500,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to record fuel entry');
    expect(state.rolledBack).toBe(true);
    expect(state.committed).toBe(false);
    expect(state.fuelEntries).toHaveLength(0);
    expect(state.fuelLogs).toHaveLength(0);
    expect(state.vehicleOdometer).toBe(50000n);
    expect(state.publishedEvents).toHaveLength(0);
  });

  it('returns 500 and rolls back fuel_entries & fuel_logs when eventBus.publish throws', async () => {
    state.throwOnEventPublish = true;
    const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
      method: 'POST',
      headers: await makeHeaders(),
      body: JSON.stringify({
        vehicleId: VEHICLE_ID,
        liters: 50,
        totalCost: 150,
        odometer: 50500,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(state.rolledBack).toBe(true);
    expect(state.committed).toBe(false);
    expect(state.fuelEntries).toHaveLength(0);
    expect(state.fuelLogs).toHaveLength(0);
    expect(state.vehicleOdometer).toBe(50000n);
    expect(state.publishedEvents).toHaveLength(0);
  });

  it('rejects invalid filledAt timestamp with 400 before any DB write', async () => {
    const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
      method: 'POST',
      headers: await makeHeaders(),
      body: JSON.stringify({
        vehicleId: VEHICLE_ID,
        liters: 50,
        totalCost: 150,
        filledAt: 'invalid-date-string',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid filledAt');
    expect(state.fuelEntries).toHaveLength(0);
  });

  it('returns 422 when vehicleId is omitted and driver has no active shift/trip vehicle', async () => {
    const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
      method: 'POST',
      headers: await makeHeaders(),
      body: JSON.stringify({
        liters: 50,
        totalCost: 150,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('Vehicle could not be resolved');
    expect(state.fuelEntries).toHaveLength(0);
  });
});
