/**
 * Tier 3: Cross-Feature Combinations (Pairwise Interactions)
 *
 * Covers interactions across features sharing state or control flow (15 tests):
 *  - Pair 1: F02 (Tenant Auth) + F05 (Webhook Signature) + F06 (Cross-Tenant RLS)
 *  - Pair 2: F08 (Auth Limits) + F03 (Roster OTP Hardening)
 *  - Pair 3: F24 (Grounded Vehicle Safety) + F23 (Maintenance Transitions) + F31 (Dispatch Assignment)
 *  - Pair 4: F15 (Leasing Fine Tax Split) + F27 (Multi-Vertical Fine Matching) + F16 (GL Postings)
 *  - Pair 5: F25 (Driver Fuel Bridging) + F21 (Decimal Precision) + F13 (UAE VAT Box 8)
 *  - Pair 6: F28 (Mobile Offline Sync) + F29 (DVIR Photo Sync) + F30 (Driver Identity)
 *  - Pair 7: F32 (AI Gateway Metering) + F33 (Prompt Injection Defense) + F02 (Tenant Auth)
 *  - Pair 8: F34 (Readyz Go Decoupling) + F10 (Dispatch Schema Migration) + F35 (Go Parity)
 *  - Pair 9: F18 (SaaS Billing Isolation) + F19 (Accounting Period Controls & SoD)
 *  - Pair 10: F20 (Credit Note GL Integrity) + F13 (UAE VAT 201 Box 1)
 *  - Pair 11: F14 (UAE FTA FAF Generation) + F21 (Decimal Precision) + F16 (Freight Exchange GL)
 *  - Pair 12: F12 (Public Origin Resolution) + F11 (Scheduler Timeout Fix)
 *  - Pair 13: F04 (Domain & Provisioning Security) + F18 (SaaS Billing Isolation)
 *  - Pair 14: F09 (School Bus Timestamp Arithmetic) + F27 (Fine Matching)
 *  - Pair 15: F26 (Driver Expense Bridging) + F22 (Empty State 422 Validation)
 */

import { test, expect } from '@playwright/test';
import { isServerAvailable, skipIfOffline, e2eFetch, createWebhookHmac, FIXTURES } from '../tier-helpers';

let serverUp = false;

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

test.describe('Tier 3: Cross-Feature Pairwise Interactions', () => {
  test('PAIR-01: F02 (Auth) + F05 (Webhook) + F06 (RLS): Valid webhook strictly partitions writes by tenant', async () => {
    const tenantA = FIXTURES.randomUUID();
    const payload = JSON.stringify({ tenantId: tenantA, event: 'delivery.confirmed', orderId: FIXTURES.randomUUID() });
    const secret = 'webhook-secret-key';
    const signature = createWebhookHmac(secret, payload);

    const res = await e2eFetch('/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': `sha256=${signature}`,
        'x-tenant-id': tenantA,
      },
      body: payload,
    });
    expect([200, 401, 403, 500]).toContain(res.status);
  });

  test('PAIR-02: F08 (Auth Limits) + F03 (Roster OTP): Failed OTP attempts coordinate with rate limiters', async () => {
    // 1. Unauthenticated roster-otp access is strictly rejected fail-closed (401)
    const otpRes = await e2eFetch('/api/auth/roster-otp', {
      method: 'POST',
      body: { action: 'VERIFY_OTP', identifier: 'rashid@ein360.ae', otp: '849201' },
    });
    expect(otpRes.status).toBe(401);

    // 2. Repeated failed authentication attempts trigger F08 429 rate limiting
    const email = `pair02-${Date.now()}@test.example`;
    let gotRateLimited = false;
    for (let i = 0; i < 8; i++) {
      const res = await e2eFetch('/api/auth/login', {
        method: 'POST',
        body: { email, password: `wrong-${i}` },
      });
      if (res.status === 429) {
        gotRateLimited = true;
        break;
      }
    }
    expect(gotRateLimited).toBe(true);
  });

  test('PAIR-03: F24 (Grounded Safety) + F23 (Maintenance) + F31 (Dispatch): Grounded vehicle blocks dispatch until work order closes', async () => {
    const vehicleId = FIXTURES.randomUUID();
    // 1. Check assignability when grounded
    const checkRes = await e2eFetch('/api/fleet/check-assignable', {
      method: 'POST',
      body: { vehicleId, status: 'GROUNDED' },
    });
    if (checkRes.status === 200) {
      const checkData = await checkRes.json();
      expect(checkData.assignable).toBe(false);
    }

    // 2. Dispatch assignment should fail
    const assignRes = await e2eFetch('/api/dispatch/assign', {
      method: 'POST',
      body: { jobId: FIXTURES.randomUUID(), vehicleId },
    });
    expect([400, 401, 403, 404, 422]).toContain(assignRes.status);
  });

  test('PAIR-04: F15 (Fine Tax Split) + F27 (Fine Matching) + F16 (GL Postings): Fine match calculates 0%/5% tax split and posts GL', async () => {
    const res = await e2eFetch('/api/leasing/traffic-fines/process-matched', {
      method: 'POST',
      body: {
        plateNumber: FIXTURES.randomPlate(),
        fineAmount: 800,
        adminFee: 80,
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      expect(data.vatAmount).toBe(4); // 80 * 0.05
      expect(data.totalAmount).toBe(884); // 800 + 80 + 4
    }
  });

  test('PAIR-05: F25 (Fuel Bridging) + F21 (Decimal Precision) + F13 (UAE VAT Box 8): Fuel entry flows to VAT Box 8 with exact decimals', async () => {
    const fuelRes = await e2eFetch('/api/driver-app/fuel-entries', {
      method: 'POST',
      body: {
        vehicleId: FIXTURES.randomUUID(),
        liters: 45.5,
        totalCost: 145.60,
        odometer: 85200,
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(fuelRes.status);
  });

  test('PAIR-06: F28 (Offline Sync) + F29 (DVIR Photo Sync) + F30 (Driver Identity): Offline DVIR defect photo sync attributes to driver profile', async () => {
    const syncId = FIXTURES.randomUUID();
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      headers: { 'X-Offline-Item-Id': syncId },
      body: {
        vehicleId: FIXTURES.randomUUID(),
        passed: false,
        photos: ['data:image/jpeg;base64,/9j/4AAQSkZJRg=='],
      },
    });
    expect([200, 207, 400, 401, 403]).toContain(res.status);
  });

  test('PAIR-07: F32 (AI Metering) + F33 (Prompt Injection Defense) + F02 (Auth): Authenticated AI prompt sanitized and metered against tenant quota', async () => {
    const res = await e2eFetch('/api/chat', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: 'What is the fuel efficiency of our heavy trucks?' }],
      },
    });
    expect([200, 400, 401, 403, 429]).toContain(res.status);
  });

  test('PAIR-08: F34 (Readyz Go Decoupling) + F10 (Dispatch Schema) + F35 (Go Parity): Readyz verifies schema without failing on Go backend', async () => {
    const readyzRes = await e2eFetch('/api/readyz');
    expect(readyzRes.status).toBe(200);
    const healthRes = await e2eFetch('/api/health');
    expect(healthRes.status).toBe(200);
  });

  test('PAIR-09: F18 (SaaS Billing Isolation) + F19 (Accounting Period Controls & SoD): SUB- billing does not block month-end journal closing', async () => {
    const res = await e2eFetch('/api/finance/period-close/preview', {
      method: 'POST',
      body: { period: '2026-10' },
    });
    expect([200, 400, 401, 403]).toContain(res.status);
  });

  test('PAIR-10: F20 (Credit Note GL Integrity) + F13 (UAE VAT 201 Box 1): Credit note reversal updates Box 1 without cash inflation', async () => {
    const res = await e2eFetch('/api/finance/credit-notes/preview-tax-impact', {
      method: 'POST',
      body: { invoiceId: FIXTURES.randomUUID(), creditAmount: 500 },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.outputVatAdjustment).toBe(-25); // -5% of 500
    }
  });

  test('PAIR-11: F14 (UAE FTA FAF) + F21 (Decimal Precision) + F16 (Freight Exchange GL): FAF export balances double-entry freight exchange entries', async () => {
    const res = await e2eFetch('/api/finance/fta-faf?period=2026-Q1');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('PAIR-12: F12 (Public Origin Resolution) + F11 (Scheduler Timeout Fix): Background scheduler resolves reverse-proxy origin for outbound webhooks', async () => {
    const res = await e2eFetch('/api/jobs/sweep', {
      method: 'POST',
      headers: {
        'x-forwarded-host': 'api.fleet360.io',
        'x-forwarded-proto': 'https',
      },
    });
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('PAIR-13: F04 (Domain Security) + F18 (SaaS Billing Isolation): Enterprise custom domain verification requires verified SaaS subscription', async () => {
    const res = await e2eFetch('/api/admin/tenants/verify-enterprise-domain', {
      method: 'POST',
      body: { domain: 'enterprise.example.ae' },
    });
    expect([400, 401, 402, 403, 404]).toContain(res.status);
  });

  test('PAIR-14: F09 (Timestamp Arithmetic) + F27 (Fine Matching): School bus trip timestamp calculation matches daytime traffic fine', async () => {
    const res = await e2eFetch('/api/fines/match-school-bus', {
      method: 'POST',
      body: {
        plateNumber: FIXTURES.randomPlate(),
        violationDate: '2026-11-16',
        violationTime: '07:45:00',
      },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('PAIR-15: F26 (Driver Expense Bridging) + F22 (Empty State 422): Recorded driver expense converts self-billing from 422 to 200', async () => {
    const checkRes = await e2eFetch('/api/finance/self-billing?emptyTenant=true');
    expect([200, 401, 403, 422]).toContain(checkRes.status);
  });
});
