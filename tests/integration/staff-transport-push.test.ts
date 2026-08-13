/**
 * tests/integration/staff-transport-push.test.ts
 *
 * Integration tests for the Push notification APIs (Phase 1 follow-up).
 *
 *   - GET  /api/push/public-key — VAPID public key
 *   - POST /api/push/subscribe  — register a device
 *   - DELETE /api/push/subscribe — unregister
 *   - POST /api/push/test        — send a test push
 *
 * Note: /api/push/subscribe identifies the staff member by employeeId, not
 * an admin session, so it works without seedTestTenantFull().
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { isServerRunning, makeRequest } from '../setup';

let serverUp = false;
let testStaffId: string | null = null;
let testEmployeeId = 'E2E-PUSH-STAFF';
let testEndpoint = 'https://fcm.googleapis.com/fcm/send/E2E-PUSH-ENDPOINT';

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('[push integration] Dev server not reachable — skipping');
    return;
  }
  // Need a staff member to subscribe
  const existing = await basePrisma.staffMember.findFirst({ where: { employeeId: testEmployeeId } });
  if (existing) {
    testStaffId = existing.id;
  } else {
    // We don't have a tenant here — use the platform tenant from the seed
    const platform = await basePrisma.tenant.findFirst({ where: { isActive: true } });
    if (!platform) {
      console.warn('[push integration] No tenant found — skipping');
      serverUp = false;
      return;
    }
    const s = await basePrisma.staffMember.create({
      data: {
        tenantId: platform.id,
        employeeId: testEmployeeId,
        name: 'E2E Push Staff',
        department: 'QA',
        isActive: true,
        transportType: 'BUS',
      },
    });
    testStaffId = s.id;
  }
});

afterAll(async () => {
  if (testStaffId) {
    await basePrisma.pushSubscription.deleteMany({ where: { staffMemberId: testStaffId, endpoint: testEndpoint } });
    // Don't delete the staff member in case other tests use it
  }
});

describe('Push /api/push/*', () => {
  it('GET /public-key returns the VAPID public key', async () => {
    const r = await makeRequest('GET', '/api/push/public-key');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(typeof body.publicKey).toBe('string');
    expect(body.publicKey.length).toBeGreaterThan(50);
    // VAPID public keys are base64url-encoded
    expect(body.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('POST /subscribe with missing fields returns 400', async () => {
    const r = await makeRequest('POST', '/api/push/subscribe', {});
    expect(r.status).toBe(400);
  });

  it('POST /subscribe with unknown employeeId returns 404', async () => {
    const r = await makeRequest('POST', '/api/push/subscribe', {
      endpoint: testEndpoint,
      keys: { p256dh: 'a', auth: 'b' },
      employeeId: 'EMP-DOES-NOT-EXIST-9999',
    });
    expect(r.status).toBe(404);
  });

  it('POST /subscribe with valid input creates a subscription', async () => {
    const r = await makeRequest('POST', '/api/push/subscribe', {
      endpoint: testEndpoint,
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
      userAgent: 'E2E-test',
      employeeId: testEmployeeId,
    });
    expect(r.status).toBe(201);

    // Verify in DB
    const found = await basePrisma.pushSubscription.findFirst({ where: { endpoint: testEndpoint } });
    expect(found).not.toBeNull();
    expect(found?.staffMemberId).toBe(testStaffId);
  });

  it('POST /test sends a push and prunes the fake endpoint (410)', async () => {
    const r = await makeRequest('POST', '/api/push/test', { employeeId: testEmployeeId });
    expect(r.status).toBe(200);
    const body = await r.json();
    // Either it sent and got an error back, or it pruned the dead endpoint
    expect(body.sent + body.pruned).toBeGreaterThanOrEqual(1);

    // Verify the endpoint is now revoked
    const found = await basePrisma.pushSubscription.findFirst({ where: { endpoint: testEndpoint } });
    expect(found?.revokedAt).not.toBeNull();
    expect(found?.lastErrorCode).toBe(410);
  });

  it('DELETE /subscribe (without endpoint) returns 400', async () => {
    const r = await makeRequest('DELETE', '/api/push/subscribe');
    expect(r.status).toBe(400);
  });
});
