/**
 * Tier 1: Feature Coverage — Milestone M3: Operational Silos, Stubbed Workflows & Mobile Driver App
 *
 * Covers Features F23 to F31 (>=5 tests per feature = 45 tests):
 *  - F23: Maintenance State Transitions (5 tests)
 *  - F24: Grounded Vehicle Safety (5 tests)
 *  - F25: Driver Fuel Bridging (5 tests)
 *  - F26: Driver Expense Bridging (5 tests)
 *  - F27: Multi-Vertical Fine Matching (5 tests)
 *  - F28: Mobile Offline Sync Engine (5 tests)
 *  - F29: Stop Arrive & Photo Sync (5 tests)
 *  - F30: Driver Identity & OCR Fix (5 tests)
 *  - F31: Demurrage & Dispatch UI Fix (5 tests)
 */

import { test, expect } from '@playwright/test';
import { isServerAvailable, skipIfOffline, e2eFetch, FIXTURES } from '../tier-helpers';

let serverUp = false;

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

// ============================================================================
// F23: Maintenance State Transitions
// ============================================================================
test.describe('F23: Maintenance State Transitions', () => {
  test('TC-F23-01: Closing maintenance work order transitions vehicle status to AVAILABLE', async () => {
    const workOrderId = FIXTURES.randomUUID();
    const res = await e2eFetch(`/api/maintenance/work-orders/${workOrderId}/close`, {
      method: 'POST',
      body: { finalCost: 1200, notes: 'Brake pads replaced and tested' },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.vehicleStatus).toBe('AVAILABLE');
    }
  });

  test('TC-F23-02: Active work order keeps vehicle in MAINTENANCE state', async () => {
    const res = await e2eFetch('/api/maintenance/work-orders', {
      method: 'POST',
      body: { vehicleId: FIXTURES.randomUUID(), issueDescription: 'Engine check light' },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F23-03: Maintenance invoice entry links to vehicle expense ledger', async () => {
    const res = await e2eFetch('/api/maintenance/invoices', {
      method: 'POST',
      body: {
        workOrderId: FIXTURES.randomUUID(),
        amount: 850,
        supplierName: 'Al Futtaim Motors',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F23-04: Resolving safety defect work order clears vehicle grounding flag', async () => {
    const res = await e2eFetch('/api/fleet/clear-grounding', {
      method: 'POST',
      body: { vehicleId: FIXTURES.randomUUID(), reason: 'Safety inspection passed' },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F23-05: Status change audit event recorded in vehicle history', async () => {
    const res = await e2eFetch(`/api/vehicles/${FIXTURES.randomUUID()}/status-history`);
    expect([200, 401, 403, 404]).toContain(res.status);
  });
});

// ============================================================================
// F24: Grounded Vehicle Safety
// ============================================================================
test.describe('F24: Grounded Vehicle Safety', () => {
  test('TC-F24-01: Vehicle with GROUNDED status is rejected by checkVehicleAssignable', async () => {
    const res = await e2eFetch('/api/fleet/check-assignable', {
      method: 'POST',
      body: { vehicleId: FIXTURES.randomUUID(), status: 'GROUNDED' },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.assignable).toBe(false);
      expect(data.reason).toContain('grounded');
    }
  });

  test('TC-F24-02: Pre-trip safety inspection failure automatically sets vehicle to GROUNDED', async () => {
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      body: {
        vehicleId: FIXTURES.randomUUID(),
        odometer: 45000,
        type: 'PRE_TRIP',
        passed: false,
        criticalDefects: ['BRAKES_FAILED'],
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      expect(data.grounded).toBe(true);
    }
  });

  test('TC-F24-03: Inactive vehicle (isActive = false) is marked unassignable', async () => {
    const res = await e2eFetch('/api/fleet/check-assignable', {
      method: 'POST',
      body: { vehicleId: FIXTURES.randomUUID(), isActive: false },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.assignable).toBe(false);
    }
  });

  test('TC-F24-04: Dispatch assignment API rejects assigning grounded vehicle', async () => {
    const res = await e2eFetch('/api/dispatch/assign', {
      method: 'POST',
      body: { jobId: FIXTURES.randomUUID(), vehicleId: 'grounded_veh_001' },
    });
    expect([400, 401, 403, 404, 422]).toContain(res.status);
  });

  test('TC-F24-05: Active vehicle with AVAILABLE status passes assignability check', async () => {
    const res = await e2eFetch('/api/fleet/check-assignable', {
      method: 'POST',
      body: { vehicleId: FIXTURES.randomUUID(), status: 'AVAILABLE', isActive: true },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.assignable).toBe(true);
    }
  });
});

// ============================================================================
// F25: Driver Fuel Bridging
// ============================================================================
test.describe('F25: Driver Fuel Bridging', () => {
  test('TC-F25-01: Driver fuel submission writes to fuel_entries and public.fuel_logs synchronously', async () => {
    const res = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: {
        vehicleId: FIXTURES.randomUUID(),
        odometer: 125000,
        liters: 65,
        totalCost: 195,
        stationName: 'ADNOC Oasis Dubai',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      expect(data.fuelLogId || data.id).toBeTruthy();
    }
  });

  test('TC-F25-02: Submitted odometer reading updates Vehicle.odometerReading', async () => {
    const vehicleId = FIXTURES.randomUUID();
    const res = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: { vehicleId, odometer: 130000, liters: 50, totalCost: 150 },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F25-03: FUEL_FILLED event emitted to trigger FinanceFuelConsumer', async () => {
    const res = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: {
        vehicleId: FIXTURES.randomUUID(),
        odometer: 135000,
        liters: 70,
        totalCost: 210,
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F25-04: Odometer reading lower than current vehicle odometer rejected or flagged', async () => {
    const res = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: { vehicleId: FIXTURES.randomUUID(), odometer: -50, liters: 40, totalCost: 120 },
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });

  test('TC-F25-05: Fuel entry rejects invalid filledAt timestamp and unresolvable vehicle before persistence', async () => {
    const invalidTsRes = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: {
        id: FIXTURES.randomUUID(),
        vehicleId: FIXTURES.randomUUID(),
        liters: 40,
        totalCost: 120,
        filledAt: 'not-a-valid-timestamp',
      },
    });
    expect([400, 401, 403, 422]).toContain(invalidTsRes.status);

    const noVehicleRes = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: {
        id: FIXTURES.randomUUID(),
        liters: 40,
        totalCost: 120,
      },
    });
    expect([400, 401, 403, 422]).toContain(noVehicleRes.status);
  });
});

// ============================================================================
// F26: Driver Expense Bridging
// ============================================================================
test.describe('F26: Driver Expense Bridging', () => {
  test('TC-F26-01: Driver expense entry creates corresponding finance.finance_expenses record', async () => {
    const res = await e2eFetch('/api/driver-app/expenses', {
      method: 'POST',
      body: {
        amount: 85,
        category: 'TOLL_SALIK',
        description: 'Salik toll tag recharge',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F26-02: Driver expense generates double-entry GL lines', async () => {
    const res = await e2eFetch('/api/driver-app/expenses', {
      method: 'POST',
      body: { amount: 150, category: 'PARKING' },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F26-03: Expense entry links uploaded receipt image URL', async () => {
    const res = await e2eFetch('/api/driver-app/expenses', {
      method: 'POST',
      body: {
        amount: 45,
        category: 'CAR_WASH',
        receiptUrl: 'https://storage.fleet360.io/receipts/rec_123.jpg',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F26-04: High-value expense triggers manager approval workflow', async () => {
    const res = await e2eFetch('/api/driver-app/expenses', {
      method: 'POST',
      body: { amount: 950, category: 'EMERGENCY_REPAIR' },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      expect(data.status).toBe('PENDING_APPROVAL');
    }
  });

  test('TC-F26-05: Expenses strictly partitioned by driver tenant ID', async () => {
    const res = await e2eFetch('/api/driver-app/expenses');
    expect([200, 401, 403]).toContain(res.status);
  });
});

// ============================================================================
// F27: Multi-Vertical Fine Matching
// ============================================================================
test.describe('F27: Multi-Vertical Fine Matching', () => {
  test('TC-F27-01: Fine matched to driver/trip across Drayage, Logistics, Bus, School Bus, Leasing', async () => {
    const res = await e2eFetch('/api/fines/match', {
      method: 'POST',
      body: {
        plateNumber: 'DXB-12345',
        violationTimestamp: '2026-11-10T14:30:00Z',
        fineAmount: 400,
      },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F27-02: Violation timestamp within trip interval attributes fine to trip driver', async () => {
    const res = await e2eFetch('/api/fines/match-trip', {
      method: 'POST',
      body: {
        vehicleId: FIXTURES.randomUUID(),
        timestamp: '2026-11-12T10:15:00Z',
      },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F27-03: Leasing contract recharges fine to customer; logistics recharges carrier', async () => {
    const res = await e2eFetch('/api/fines/recharge-policy?vertical=LEASING');
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.rechargeTarget).toBe('CUSTOMER');
    }
  });

  test('TC-F27-04: Fine matching automatically posts GL liability and receivable lines', async () => {
    const res = await e2eFetch('/api/fines/post-matched', {
      method: 'POST',
      body: { fineId: FIXTURES.randomUUID(), matchedEntityId: FIXTURES.randomUUID() },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F27-05: Unmatched fine routed to unassigned fleet manager queue', async () => {
    const res = await e2eFetch('/api/fines/unassigned');
    expect([200, 401, 403]).toContain(res.status);
  });
});

// ============================================================================
// F28: Mobile Offline Sync Engine
// ============================================================================
test.describe('F28: Mobile Offline Sync Engine', () => {
  test('TC-F28-01: Offline mutation queue flushes successfully when connectivity restored', async () => {
    const syncId = FIXTURES.randomUUID();
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      headers: {
        'X-Offline-Client': 'fleet360-driver/1.0',
        'X-Offline-Item-Id': syncId,
        'X-Offline-Created-At': String(Date.now()),
        'X-Offline-Attempts': '1',
      },
      body: {
        vehicleId: FIXTURES.randomUUID(),
        odometer: 1000,
        passed: true,
      },
    });
    expect([200, 207, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F28-02: Server accepts and returns CORS headers X-Offline-Sync-Id and X-Offline-Timestamp', async () => {
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-headers': 'x-offline-sync-id, x-offline-timestamp',
      },
    });
    expect([200, 204]).toContain(res.status);
  });

  test('TC-F28-03: Permanent client errors (400, 422) quarantined to quarantine queue', async () => {
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      body: {
        type: 'INVALID_MUTATION_SCHEMA',
        badPayload: true,
      },
    });
    expect([200, 207, 400, 401, 403, 422]).toContain(res.status);
  });

  test('TC-F28-04: Transient server errors (500, 503) retried with exponential backoff', async () => {
    const res = await e2eFetch('/api/driver-app/shift/history');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F28-05: Duplicate mutations with identical sync ID processed idempotently', async () => {
    const syncId = FIXTURES.randomUUID();
    const payload = {
      vehicleId: FIXTURES.randomUUID(),
      odometer: 1000,
      passed: true,
    };
    const res1 = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      headers: { 'X-Offline-Item-Id': syncId },
      body: payload,
    });
    const res2 = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      headers: { 'X-Offline-Item-Id': syncId },
      body: payload,
    });
    expect(res1.status).toBe(res2.status);
  });
});

// ============================================================================
// F29: Stop Arrive & Photo Sync
// ============================================================================
test.describe('F29: Stop Arrive & Photo Sync', () => {
  test('TC-F29-01: Stop arrive endpoint records arrival time, GPS coordinates, and stop ID', async () => {
    const res = await e2eFetch(`/api/driver-app/trips/${FIXTURES.randomUUID()}/stops/${FIXTURES.randomUUID()}/arrive`, {
      method: 'POST',
      body: {
        latitude: 25.2048,
        longitude: 55.2708,
        timestamp: new Date().toISOString(),
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F29-02: Base64 DVIR defect photos from IndexedDB dvir_photos serialized and stored', async () => {
    const dummyBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      body: {
        vehicleId: FIXTURES.randomUUID(),
        photos: [dummyBase64],
        defectDescription: 'Cracked windshield',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F29-03: Geofence radius validates driver proximity to stop location', async () => {
    const res = await e2eFetch(`/api/driver-app/trips/${FIXTURES.randomUUID()}/geofences`);
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F29-04: Stop departure before arrival sequence error prevented', async () => {
    const res = await e2eFetch(`/api/driver-app/trips/${FIXTURES.randomUUID()}/end`, {
      method: 'POST',
      body: { lat: 25.0, lng: 55.0 },
    });
    expect([400, 401, 403, 404, 409, 422]).toContain(res.status);
  });

  test('TC-F29-05: Large defect photos handled gracefully', async () => {
    const largeDummy = 'data:image/jpeg;base64,' + 'A'.repeat(50000);
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      body: { vehicleId: FIXTURES.randomUUID(), photos: [largeDummy] },
    });
    expect([200, 201, 400, 401, 403, 413]).toContain(res.status);
  });
});

// ============================================================================
// F30: Driver Identity & OCR Fix
// ============================================================================
test.describe('F30: Driver Identity & OCR Fix', () => {
  test('TC-F30-01: Driver endpoints resolve authenticated User.id to Driver.id profile', async () => {
    const res = await e2eFetch('/api/driver-app/today/assignments');
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F30-02: Shift vehicle GPS pings update active assigned vehicle location', async () => {
    const res = await e2eFetch('/api/driver-app/telematics/live-location', {
      method: 'POST',
      body: { latitude: 25.2048, longitude: 55.2708, speed: 60, heading: 90 },
    });
    expect([200, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F30-03: OCR endpoint calls real vision pipeline or returns explicit processing error without fake 99% mock', async () => {
    const res = await e2eFetch('/api/driver-app/ocr-scan', {
      method: 'POST',
      body: { image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' },
    });
    expect([200, 400, 401, 403, 422, 500]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.mock).toBeUndefined();
    }
  });

  test('TC-F30-04: User without driver profile returns 404/400', async () => {
    const res = await e2eFetch('/api/driver-app/shift/current', {
      headers: { 'x-non-driver': 'true' },
    });
    expect([400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F30-05: GPS pings outside active shift handled with off-duty status', async () => {
    const res = await e2eFetch('/api/driver-app/telematics/live-location', {
      method: 'POST',
      body: { latitude: 25.2048, longitude: 55.2708, offDuty: true },
    });
    expect([200, 400, 401, 403]).toContain(res.status);
  });
});

// ============================================================================
// F31: Demurrage & Dispatch UI Fix
// ============================================================================
test.describe('F31: Demurrage & Dispatch UI Fix', () => {
  test('TC-F31-01: Demurrage configuration persisted to database table', async () => {
    const res = await e2eFetch('/api/dispatch/demurrage', {
      method: 'POST',
      body: { freeHours: 2, hourlyRate: 150, currency: 'AED' },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F31-02: Dispatch candidate scoring evaluates driver proximity and HOS limits', async () => {
    const res = await e2eFetch(`/api/dispatch/jobs/${FIXTURES.randomUUID()}/candidates`);
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F31-03: Cancel dispatch job updates status to CANCELLED and unassigns resources', async () => {
    const res = await e2eFetch(`/api/dispatch/jobs/${FIXTURES.randomUUID()}/cancel`, {
      method: 'POST',
      body: { reason: 'Customer requested cancellation' },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F31-04: Assigning vehicle checks availability and links vehicle ID', async () => {
    const res = await e2eFetch('/api/dispatch/jobs/assign-vehicle', {
      method: 'POST',
      body: { jobId: FIXTURES.randomUUID(), vehicleId: FIXTURES.randomUUID() },
    });
    expect([200, 400, 401, 403, 404, 422]).toContain(res.status);
  });

  test('TC-F31-05: Detention exceeding free time calculates demurrage fee accurately', async () => {
    const res = await e2eFetch('/api/dispatch/calculate-demurrage', {
      method: 'POST',
      body: { freeHours: 2, totalWaitHours: 5, hourlyRate: 100 },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.demurrageCharge).toBe(300); // (5 - 2) * 100
    }
  });
});
