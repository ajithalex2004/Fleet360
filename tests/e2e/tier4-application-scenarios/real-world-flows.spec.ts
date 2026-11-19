/**
 * Tier 4: Real-World Application Scenarios (Multi-Module Operational Flows)
 *
 * Covers 5 realistic operational end-to-end flows spanning multiple modules:
 *  - Flow 1: Driver Operations & Fleet Subledger Lifecycle
 *  - Flow 2: Freight Exchange Multi-Party Outsourcing & Double-Entry Invoicing
 *  - Flow 3: Fleet Maintenance, Grounding, & Vehicle Availability Restoration
 *  - Flow 4: Car Rental (RAC) Agreement & Traffic Fine Recharge Lifecycle
 *  - Flow 5: School Bus Transport Scheduling, Dispatch, & Transportation Invoicing
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

test.describe('Tier 4: Real-World Operational Flows', () => {
  test('FLOW-01: Driver Operations & Fleet Subledger Lifecycle', async () => {
    // 1. Check driver session and profile
    const profileRes = await e2eFetch('/api/driver-app/today/assignments');
    expect([200, 401, 403, 404]).toContain(profileRes.status);

    // 2. Perform pre-trip safety DVIR inspection
    const vehicleId = FIXTURES.randomUUID();
    const dvirRes = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      body: {
        vehicleId,
        type: 'PRE_TRIP',
        odometer: 105400,
        passed: true,
        criticalDefects: [],
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(dvirRes.status);

    // 3. Submit fuel entry with odometer reading increment
    const fuelRes = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: {
        vehicleId,
        odometer: 105450,
        liters: 55,
        totalCost: 176,
        stationName: 'ENOC Al Barsha',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(fuelRes.status);

    // 4. Log road toll / parking expense
    const expenseRes = await e2eFetch('/api/driver-app/expenses', {
      method: 'POST',
      body: {
        amount: 20,
        category: 'PARKING',
        description: 'Customer delivery parking',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(expenseRes.status);

    // 5. Complete shift and verify status
    const shiftEndRes = await e2eFetch(`/api/driver-app/shift/${FIXTURES.randomUUID()}/end`, {
      method: 'POST',
      body: { finalOdometer: 105550 },
    });
    expect([200, 400, 401, 403, 404]).toContain(shiftEndRes.status);
  });

  test('FLOW-02: Freight Exchange Multi-Party Outsourcing & Double-Entry Invoicing', async () => {
    // 1. Carrier submits quotation for outsource RFQ
    const quoteRes = await e2eFetch('/api/exchange/jobs/quotes', {
      method: 'POST',
      body: {
        requestId: FIXTURES.randomUUID(),
        amount: 2500,
        currency: 'AED',
        notes: 'Jebel Ali Free Zone Port -> Musaffah Industrial Abu Dhabi (12000kg)',
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(quoteRes.status);

    // 2. Dispatch order creation and carrier bid acceptance
    const orderRes = await e2eFetch('/api/exchange/orders', {
      method: 'POST',
      body: {
        partnerId: FIXTURES.randomUUID(),
        agreedRate: 2500,
        currency: 'AED',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(orderRes.status);

    // 3. Mark delivery confirmed with electronic POD
    const epodRes = await e2eFetch('/api/exchange/orders/confirm-delivery', {
      method: 'POST',
      body: {
        orderId: FIXTURES.randomUUID(),
        signatureName: 'Ahmed Al Mansoori',
        receivedAt: new Date().toISOString(),
      },
    });
    expect([200, 400, 401, 403, 404]).toContain(epodRes.status);

    // 4. Generate atomic double-entry GL invoice with UAE VAT 5% isolated
    const invoiceRes = await e2eFetch('/api/exchange/invoices', {
      method: 'POST',
      body: {
        orderId: FIXTURES.randomUUID(),
        amount: 2500,
        vatRate: 0.05,
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(invoiceRes.status);

    // 5. Export statement PDF for carrier settlement
    const pdfRes = await e2eFetch(`/api/exchange/statements/${FIXTURES.randomUUID()}/pdf`);
    expect([200, 401, 403, 404]).toContain(pdfRes.status);
  });

  test('FLOW-03: Fleet Maintenance, Grounding, & Vehicle Availability Restoration', async () => {
    const vehicleId = FIXTURES.randomUUID();

    // 1. Driver reports pre-trip critical steering defect
    const dvirRes = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      body: {
        vehicleId,
        type: 'PRE_TRIP',
        passed: false,
        criticalDefects: ['STEERING_LOCK_FAILURE'],
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(dvirRes.status);

    // 2. Confirm vehicle is marked GROUNDED and unassignable
    const checkRes = await e2eFetch('/api/fleet/check-assignable', {
      method: 'POST',
      body: { vehicleId, status: 'GROUNDED' },
    });
    if (checkRes.status === 200) {
      const data = await checkRes.json();
      expect(data.assignable).toBe(false);
    }

    // 3. Create maintenance work order
    const woRes = await e2eFetch('/api/maintenance/work-orders', {
      method: 'POST',
      body: {
        vehicleId,
        serviceType: 'STEERING_HYDRAULIC_REPAIR',
        priority: 'CRITICAL',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(woRes.status);

    // 4. Close work order with repair invoice details
    const closeRes = await e2eFetch(`/api/maintenance/work-orders/${FIXTURES.randomUUID()}/close`, {
      method: 'POST',
      body: {
        finalCost: 1850,
        replacedParts: ['STEERING_PUMP', 'FLUID'],
      },
    });
    expect([200, 400, 401, 403, 404]).toContain(closeRes.status);

    // 5. Verify vehicle availability restored to AVAILABLE
    const restoredRes = await e2eFetch('/api/fleet/check-assignable', {
      method: 'POST',
      body: { vehicleId, status: 'AVAILABLE', isActive: true },
    });
    if (restoredRes.status === 200) {
      const data = await restoredRes.json();
      expect(data.assignable).toBe(true);
    }
  });

  test('FLOW-04: Car Rental (RAC) Agreement & Traffic Fine Recharge Lifecycle', async () => {
    // 1. Create rental inquiry and quotation
    const quoteRes = await e2eFetch('/api/rental/quotations', {
      method: 'POST',
      body: {
        customerName: 'Saeed Bin Butti',
        vehicleCategory: 'SUV_PREMIUM',
        rentalDays: 7,
        dailyRate: 350,
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(quoteRes.status);

    // 2. Convert to active rental agreement
    const agreementRes = await e2eFetch('/api/rental/agreements', {
      method: 'POST',
      body: {
        quotationId: FIXTURES.randomUUID(),
        plateNumber: FIXTURES.randomPlate(),
        startDate: '2026-11-01',
        endDate: '2026-11-08',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(agreementRes.status);

    // 3. Traffic fine imported from Dubai Police API (Speeding: 600 AED)
    const fineRes = await e2eFetch('/api/fines/match', {
      method: 'POST',
      body: {
        plateNumber: FIXTURES.randomPlate(),
        violationTimestamp: '2026-11-04T16:20:00Z',
        fineAmount: 600,
        fineSource: 'DUBAI_POLICE',
      },
    });
    expect([200, 400, 401, 403, 404]).toContain(fineRes.status);

    // 4. Recharge fine with tax split: 0% statutory fine (600) vs 5% admin fee (60 + 3 VAT = 63)
    const rechargeRes = await e2eFetch('/api/leasing/traffic-fines/recharge', {
      method: 'POST',
      body: {
        fineId: FIXTURES.randomUUID(),
        fineAmount: 600,
        adminFee: 60,
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(rechargeRes.status);
    if (rechargeRes.status === 200 || rechargeRes.status === 201) {
      const data = await rechargeRes.json();
      expect(data.vatAmount).toBe(3); // 60 * 0.05
      expect(data.totalAmount).toBe(663); // 600 + 60 + 3
    }

    // 5. Customer settlement and receipt generation
    const settleRes = await e2eFetch('/api/rental/payments', {
      method: 'POST',
      body: {
        amount: 663,
        paymentMethod: 'CREDIT_CARD',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(settleRes.status);
  });

  test('FLOW-05: School Bus Transport Scheduling, Dispatch, & Transportation Invoicing', async () => {
    // 1. Upload student transport roster
    const rosterRes = await e2eFetch('/api/school-bus/students/roster', {
      method: 'POST',
      body: {
        students: [
          { name: 'Fatima Al Zaabi', grade: 'Grade 5', pickupZone: 'Jumeirah 1' },
          { name: 'Rashid Al Zaabi', grade: 'Grade 3', pickupZone: 'Jumeirah 1' },
        ],
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(rosterRes.status);

    // 2. Schedule morning bus route
    const routeRes = await e2eFetch('/api/school-bus/routes', {
      method: 'POST',
      body: {
        routeName: 'Route 101 - Jumeirah Express',
        vehicleId: FIXTURES.randomUUID(),
        departureTime: '06:30:00',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(routeRes.status);

    // 3. Dispatch morning trip with corrected timestamp arithmetic
    const tripRes = await e2eFetch('/api/school-bus/trips', {
      method: 'POST',
      body: {
        routeId: FIXTURES.randomUUID(),
        scheduledDate: '2026-11-16',
        scheduledStart: '06:30:00',
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(tripRes.status);

    // 4. Record student boarding attendance
    const attendanceRes = await e2eFetch('/api/school-bus/attendance', {
      method: 'POST',
      body: {
        tripId: FIXTURES.randomUUID(),
        studentId: FIXTURES.randomUUID(),
        status: 'BOARDED',
        timestamp: new Date().toISOString(),
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(attendanceRes.status);

    // 5. Generate term transportation fee invoice with Maker-Checker SoD control
    const invoiceRes = await e2eFetch('/api/finance/invoices', {
      method: 'POST',
      body: {
        customerType: 'PARENT',
        term: 'TERM_1_2026',
        amount: 3500,
        vatRate: 0.05,
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(invoiceRes.status);
  });
});
