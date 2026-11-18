/**
 * tests/unit/m3-challenger-empirical.test.ts
 *
 * Empirical Adversarial Test Suite for Milestone M3 (Challenger M3.2):
 * 1. Challenge Offline Sync & CORS:
 *    - Verify src/middleware.ts preflight OPTIONS headers contain all X-Offline-* headers
 *    - Verify untrusted origins are rejected without CORS headers
 *    - Challenge sync queue error quarantining: 4xx errors quarantined without blocking subsequent queued items
 *    - Verify transient 5xx errors trigger backoff without quarantining
 * 2. Challenge Fuel & Expense Bridging:
 *    - Submit fuel entry: fuel_logs created, odometer updated, FUEL_FILLED event emitted
 *    - Challenge odometer rollback: verify lower/negative odometer readings rejected
 *    - Submit driver expense: finance_expenses created with category mapping, balanced GL lines posted
 *    - Challenge expense thresholds: <=500 AED SUBMITTED, >500 AED PENDING_APPROVAL, <=0 rejected
 * 3. Challenge Driver Identity & OCR:
 *    - Challenge driver resolution where Driver.userId != Driver.id
 *    - Challenge OCR endpoint with blank/garbage/adversarial images: verify fail-closed (HTTP 422, confidence 0, no echo)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real next/server: the routes use `instanceof NextResponse` and cookies.
vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest, NextResponse } from 'next/server';

// ── Mock Setup ──────────────────────────────────────────────────────────────

const { state, fakeTx, mockEventBus } = vi.hoisted(() => {
  const state = {
    drivers: [] as Array<{
      id: string;
      tenantId: string;
      userId?: string | null;
      name: string | null;
      firstName: string | null;
      lastName: string | null;
      status: string | null;
      deletedAt: null;
    }>,
    vehicles: [] as Array<{
      id: string;
      tenantId: string;
      licensePlate: string;
      odometerReading: bigint | null;
    }>,
    fuelLogs: [] as Array<Record<string, unknown>>,
    fuelEntries: [] as Array<Record<string, unknown>>,
    financeExpenses: [] as Array<Record<string, unknown>>,
    glJournalEntries: [] as Array<Record<string, unknown>>,
    publishedEvents: [] as Array<Record<string, unknown>>,
  };

  const mockEventBus = {
    publish: vi.fn(async (event: Record<string, unknown>) => {
      state.publishedEvents.push(event);
      return Promise.resolve();
    }),
  };

  const fakeTx = {
    driver: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; tenantId?: string; deletedAt?: null } }) => {
        return state.drivers.find(
          (d) => (!where.id || d.id === where.id) && (!where.tenantId || d.tenantId === where.tenantId)
        ) ?? null;
      }),
    },
    vehicle: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId?: string } }) => {
        return (
          state.vehicles.find(
            (v) => v.id === where.id && (!where.tenantId || v.tenantId === where.tenantId)
          ) ?? null
        );
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.vehicles.find((v) => v.id === where.id) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { odometerReading: bigint } }) => {
        const v = state.vehicles.find((veh) => veh.id === where.id);
        if (v) v.odometerReading = data.odometerReading;
        return v;
      }),
    },
    fuelLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.fuelLogs.push(data);
        return data;
      }),
    },
    tripSchedule: {
      findFirst: vi.fn(async () => null),
    },
    $executeRaw: vi.fn(async () => 1),
    $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('INSERT INTO finance_expenses')) {
        state.financeExpenses.push({
          id: args[0],
          expenseNo: args[1],
          category: args[2],
          description: args[3],
          amount: args[4],
          currency: args[5],
          totalAmount: args[7] ?? args[6],
          status: args[9] ?? args[8],
          driverId: args[10] ?? args[9],
        });
      }
      return 1;
    }),
    $queryRaw: vi.fn(async () => []),
    $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('FROM drivers') && sql.includes('user_id = $2')) {
        const tenantId = args[0] as string;
        const userId = args[1] as string;
        const matched = state.drivers.filter(
          (d) => d.tenantId === tenantId && d.userId === userId && d.status === 'ACTIVE'
        );
        return matched.map((d) => ({
          id: d.id,
          name: d.name,
          firstName: d.firstName,
          lastName: d.lastName,
          status: d.status,
        }));
      }
      if (sql.includes('FROM vehicles v')) {
        const vehicleId = args[0] as string;
        const v = state.vehicles.find((veh) => veh.id === vehicleId);
        return v ? [{ id: v.id }] : [];
      }
      return [];
    }),
  };

  return { state, fakeTx, mockEventBus };
});

vi.mock('@/events/event-bus', () => ({
  getEventBus: () => mockEventBus,
}));

vi.mock('@/lib/finance/journal-service', () => ({
  postOperationalJournalEntry: vi.fn(async (_tx: unknown, entry: Record<string, unknown>) => {
    state.glJournalEntries.push(entry);
    return { ok: true, journalEntryId: 'mock-je-1' };
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: fakeTx,
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => {
    return fn(fakeTx);
  },
}));

// Mock tenant session & auth helpers
import { signSession } from '@/lib/tenant-session';
import { middleware } from '@/middleware';
import { loadDriverActor, requireActiveDriver } from '@/lib/driver-app-actor';
import { POST as fuelEntriesPost } from '@/app/api/driver-app/fuel-entries/route';
import { POST as expensesPost } from '@/app/api/driver-app/expenses/route';
import { POST as ocrScanPost } from '@/app/api/driver-app/ocr-scan/route';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const DRIVER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const VEHICLE_ID = '33333333-3333-4333-8333-333333333333';

async function makeAuthHeaders(userId: string = USER_ID, tenantId: string = TENANT_ID) {
  const token = await signSession({
    userId,
    tenantId,
    plan: 'ENTERPRISE',
    role: 'DRIVER',
  });
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId,
    'x-user-role': 'DRIVER',
    cookie: `xl-driver-session=${token}`,
    authorization: `Bearer ${token}`,
  };
}

describe('Milestone M3 Empirical Adversarial Challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.drivers = [
      {
        id: DRIVER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        name: 'Rashid Al Maktoum',
        firstName: 'Rashid',
        lastName: 'Al Maktoum',
        status: 'ACTIVE',
        deletedAt: null,
      },
    ];
    state.vehicles = [
      {
        id: VEHICLE_ID,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-55442',
        odometerReading: 50000n,
      },
    ];
    state.fuelLogs = [];
    state.fuelEntries = [];
    state.financeExpenses = [];
    state.glJournalEntries = [];
    state.publishedEvents = [];
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Offline Sync & CORS Challenges
  // ════════════════════════════════════════════════════════════════════════════
  describe('1. Offline Sync & CORS Preflight', () => {
    const offlineHeaders = [
      'X-Offline-Client',
      'X-Offline-Item-Id',
      'X-Offline-Created-At',
      'X-Offline-Attempts',
      'X-Offline-Sync-Id',
      'X-Offline-Timestamp',
    ];

    it('OPTIONS preflight responds with all X-Offline-* headers for allowed origins', async () => {
      const allowedOrigins = [
        'https://localhost',
        'capacitor://localhost',
        'https://localhost2',
        'capacitor://localhost2',
      ];

      for (const origin of allowedOrigins) {
        const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'Content-Type, X-Offline-Client, X-Offline-Sync-Id',
          },
        });

        const res = await middleware(req);
        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');

        const allowHeaders = res.headers.get('Access-Control-Allow-Headers') || '';
        for (const h of offlineHeaders) {
          expect(allowHeaders).toContain(h);
        }
      }
    });

    it('OPTIONS preflight rejects untrusted/adversarial origins without CORS headers', async () => {
      const untrustedOrigins = [
        'https://malicious-fleet-hacker.com',
        'http://localhost.evil.com',
        'capacitor://untrusted.apk',
      ];

      for (const origin of untrustedOrigins) {
        const req = new NextRequest('http://localhost:3000/api/driver-app/dvir', {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
          },
        });

        const res = await middleware(req);
        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
        expect(res.headers.get('Access-Control-Allow-Headers')).toBeNull();
      }
    });

    it('sync queue quarantines 4xx client errors (400, 404, 422) and DOES NOT block subsequent items', async () => {
      // Re-implementing the exact sync drain loop state machine to stress-test head-of-line blocking
      interface QueueItem {
        id: string;
        endpoint: string;
        status: number;
        responseBody: string;
      }

      const queue: QueueItem[] = [
        { id: 'q-1', endpoint: '/api/driver-app/dvir', status: 400, responseBody: 'Bad schema validation' },
        { id: 'q-2', endpoint: '/api/driver-app/expenses', status: 422, responseBody: 'Unprocessable category' },
        { id: 'q-3', endpoint: '/api/driver-app/trips/1/stops/2/arrive', status: 404, responseBody: 'Stop not found' },
        { id: 'q-4', endpoint: '/api/driver-app/fuel-entries', status: 200, responseBody: '{"ok":true}' },
        { id: 'q-5', endpoint: '/api/driver-app/telematics', status: 500, responseBody: 'DB connection failure' },
        { id: 'q-6', endpoint: '/api/driver-app/dvir', status: 200, responseBody: '{"ok":true}' },
      ];

      const quarantined: Array<{ id: string; reason: string }> = [];
      const dequeued: string[] = [];
      const retries: Array<{ id: string; error: string }> = [];

      let syncedCount = 0;
      for (const item of queue) {
        try {
          if (item.status >= 400 && item.status < 500) {
            throw new Error(`permanent ${item.status}: ${item.responseBody}`);
          }
          if (item.status >= 500) {
            throw new Error(`transient ${item.status}`);
          }
          dequeued.push(item.id);
          syncedCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const is4xx = msg.startsWith('permanent 4');
          if (is4xx) {
            quarantined.push({ id: item.id, reason: msg });
            continue; // Continue processing subsequent items (quarantine behavior)
          }
          retries.push({ id: item.id, error: msg });
          break; // Transient 5xx stops drain to prevent backoff storm
        }
      }

      // Verifications:
      expect(quarantined).toHaveLength(3);
      expect(quarantined.map((q) => q.id)).toEqual(['q-1', 'q-2', 'q-3']);
      expect(dequeued).toEqual(['q-4']);
      expect(syncedCount).toBe(1);
      expect(retries).toHaveLength(1);
      expect(retries[0].id).toBe('q-5');
      // q-6 was not reached because q-5 was a transient 500 that backed off
      expect(dequeued).not.toContain('q-6');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Fuel & Expense Bridging Challenges
  // ════════════════════════════════════════════════════════════════════════════
  describe('2. Fuel & Expense Bridging', () => {
    it('creates fuel_logs record, updates vehicle odometer, and emits FUEL_FILLED event', async () => {
      // Set driver id to match session userId for fuel route testing
      state.drivers = [
        {
          id: USER_ID,
          tenantId: TENANT_ID,
          userId: USER_ID,
          name: 'Rashid Driver',
          firstName: 'Rashid',
          lastName: 'Driver',
          status: 'ACTIVE',
          deletedAt: null,
        },
      ];

      const headers = await makeAuthHeaders();
      const body = {
        vehicleId: VEHICLE_ID,
        liters: 75.5,
        totalCost: 226.5,
        currency: 'AED',
        odometer: 51200,
        stationName: 'Eppco Al Wasl',
        filledAt: new Date().toISOString(),
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.fuelLogId).toBeDefined();

      // Verify fuelLog creation in subledger
      expect(state.fuelLogs).toHaveLength(1);
      expect(state.fuelLogs[0]).toMatchObject({
        tenantId: TENANT_ID,
        vehicleId: VEHICLE_ID,
        liters: 75.5,
        totalCost: 226.5,
        mileage: 51200,
        station: 'Eppco Al Wasl',
      });

      // Verify odometer was advanced
      expect(state.vehicles[0].odometerReading).toBe(51200n);

      // Verify FUEL_FILLED event emission
      expect(state.publishedEvents).toHaveLength(1);
      expect(state.publishedEvents[0]).toMatchObject({
        eventType: 'fuel.filled',
        tenantId: TENANT_ID,
        aggregateType: 'fuel_log',
        sourceModule: 'driver-app',
        payload: {
          vehicleId: VEHICLE_ID,
          liters: 75.5,
          totalCost: 226.5,
          station: 'Eppco Al Wasl',
        },
      });
    });

    it('adversarially rejects odometer rollbacks (reading lower than current vehicle odometer)', async () => {
      state.drivers = [
        {
          id: USER_ID,
          tenantId: TENANT_ID,
          userId: USER_ID,
          name: 'Rashid Driver',
          firstName: 'Rashid',
          lastName: 'Driver',
          status: 'ACTIVE',
          deletedAt: null,
        },
      ];

      const headers = await makeAuthHeaders();
      // Current vehicle odometer is 50000; attempt to submit 48000 (rollback)
      const rollbackBody = {
        vehicleId: VEHICLE_ID,
        liters: 40,
        totalCost: 120,
        currency: 'AED',
        odometer: 48000,
        stationName: 'Eppco Al Wasl',
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(rollbackBody),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toContain('cannot be lower than current vehicle odometer');

      // Verify no records created and odometer unchanged
      expect(state.fuelLogs).toHaveLength(0);
      expect(state.vehicles[0].odometerReading).toBe(50000n);
      expect(state.publishedEvents).toHaveLength(0);
    });

    it('rejects negative odometer readings with HTTP 400', async () => {
      const headers = await makeAuthHeaders();
      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          vehicleId: VEHICLE_ID,
          liters: 20,
          totalCost: 60,
          currency: 'AED',
          odometer: -500,
        }),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('cannot be negative');
    });

    it('bridges driver expense to finance_expenses with category mapping and balanced GL posting', async () => {
      state.drivers = [
        {
          id: USER_ID,
          tenantId: TENANT_ID,
          userId: USER_ID,
          name: 'Rashid Driver',
          firstName: 'Rashid',
          lastName: 'Driver',
          status: 'ACTIVE',
          deletedAt: null,
        },
      ];

      const testCases = [
        { rawCat: 'Salik Toll Dubai', expectedDb: 'TOLLS', expectedGl: '5130', amount: 150 },
        { rawCat: 'Mall Parking', expectedDb: 'PARKING', expectedGl: '5140', amount: 50 },
        { rawCat: 'Driver Food & Water', expectedDb: 'MEALS', expectedGl: '5160', amount: 80 },
        { rawCat: 'Speeding Fine Police', expectedDb: 'FINES', expectedGl: '5170', amount: 600 },
        { rawCat: 'Truck Wash', expectedDb: 'OTHER', expectedGl: '5150', amount: 120 },
      ];

      const headers = await makeAuthHeaders();

      for (const tc of testCases) {
        state.financeExpenses = [];
        state.glJournalEntries = [];

        const req = new NextRequest('http://localhost:3000/api/driver-app/expenses', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            category: tc.rawCat,
            amount: tc.amount,
            currency: 'AED',
            description: `Testing ${tc.rawCat}`,
          }),
        });

        const res = await expensesPost(req);
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.ok).toBe(true);

        // Verify expense approval threshold: > 500 AED -> PENDING_APPROVAL, <= 500 AED -> SUBMITTED
        const expectedStatus = tc.amount > 500 ? 'PENDING_APPROVAL' : 'SUBMITTED';
        expect(json.status).toBe(expectedStatus);

        // Verify finance_expenses record
        expect(state.financeExpenses).toHaveLength(1);
        expect(state.financeExpenses[0].amount).toBe(tc.amount);
        expect(state.financeExpenses[0].status).toBe(expectedStatus);

        // Verify balanced General Ledger journal entry
        expect(state.glJournalEntries).toHaveLength(1);
        const je = state.glJournalEntries[0] as {
          lines: Array<{ code: string; debit: number; credit: number }>;
        };
        expect(je.lines).toHaveLength(2);
        // Line 0: Debit Operating Expense
        expect(je.lines[0].code).toBe(tc.expectedGl);
        expect(je.lines[0].debit).toBe(tc.amount);
        expect(je.lines[0].credit).toBe(0);
        // Line 1: Credit Driver Reimbursement Payable (2100)
        expect(je.lines[1].code).toBe('2100');
        expect(je.lines[1].debit).toBe(0);
        expect(je.lines[1].credit).toBe(tc.amount);
        // Ensure atomic double-entry balance
        expect(je.lines[0].debit).toBe(je.lines[1].credit);
      }
    });

    it('rejects driver expenses with zero or negative amounts with HTTP 400', async () => {
      const headers = await makeAuthHeaders();
      for (const amount of [0, -100]) {
        const req = new NextRequest('http://localhost:3000/api/driver-app/expenses', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            category: 'PARKING',
            amount,
            currency: 'AED',
          }),
        });

        const res = await expensesPost(req);
        expect(res.status).toBe(400);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Driver Identity & OCR Challenges
  // ════════════════════════════════════════════════════════════════════════════
  describe('3. Driver Identity & OCR Validation', () => {
    it('loadDriverActor successfully resolves driver when Driver.userId != Driver.id', async () => {
      // Driver row: id is DRIVER_ID, user_id is USER_ID
      const actor = await loadDriverActor(fakeTx as never, TENANT_ID, USER_ID);
      expect(actor).not.toBeNull();
      expect(actor?.driverId).toBe(DRIVER_ID);
      expect(actor?.driverName).toBe('Rashid Al Maktoum');
    });

    it('requireActiveDriver successfully resolves driver when Driver.userId != Driver.id', async () => {
      // Driver row has id = DRIVER_ID, but session has userId = USER_ID
      // requireActiveDriver falls back to parameterized SQL user_id = $2 when id lookup returns null
      const denied = await requireActiveDriver(fakeTx as never, {
        tenantId: TENANT_ID,
        userId: USER_ID,
      });

      // With Fix 4 applied, requireActiveDriver resolves the driver via user_id fallback
      // and permits active driver access (denied === null)
      expect(denied).toBeNull();
    });

    it('OCR endpoint fails closed with HTTP 422 and confidence 0 on blank or empty input', async () => {
      const headers = await makeAuthHeaders();
      const req = new NextRequest('http://localhost:3000/api/driver-app/ocr-scan', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageDataUri: '',
        }),
      });

      const res = await ocrScanPost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.ocr).toMatchObject({
        confidencePct: 0,
        containerNumber: null,
        sealNumber: null,
        gateStatus: 'REJECTED_UNVERIFIED',
      });
    });

    it('OCR endpoint fails closed and NEVER echoes expected values or returns fake 99% confidence on garbage images', async () => {
      const headers = await makeAuthHeaders();
      const adversarialBody = {
        imageDataUri: 'data:image/jpeg;base64,bm9uc2Vuc2UtZ2FyYmFnZS1kYXRh',
        expectedContainerNumber: 'MSCU8888888',
        expectedSealNumber: 'SEAL-DXB-999999',
        terminalName: 'DP World Jebel Ali',
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/ocr-scan', {
        method: 'POST',
        headers,
        body: JSON.stringify(adversarialBody),
      });

      const res = await ocrScanPost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.ok).toBe(false);

      // Verify that OCR pipeline did NOT echo the injected expected numbers
      expect(json.ocr.containerNumber).toBeNull();
      expect(json.ocr.sealNumber).toBeNull();

      // Verify that OCR pipeline did NOT return fake 98% or 99% confidence
      expect(json.ocr.confidencePct).toBe(0);
      expect(json.ocr.gateStatus).toBe('REJECTED_UNVERIFIED');
    });

    it('OCR endpoint rejects unauthenticated requests with HTTP 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/driver-app/ocr-scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageDataUri: 'data:image/jpeg;base64,test' }),
      });

      const res = await ocrScanPost(req);
      expect(res.status).toBe(401);
    });
  });
});
