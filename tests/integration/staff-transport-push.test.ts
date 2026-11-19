/**
 * tests/integration/staff-transport-push.test.ts
 *
 * Integration tests for the Push notification APIs:
 *
 *   - GET    /api/push/public-key — VAPID public key
 *   - POST   /api/push/subscribe  — register a device (requires xl-session + linked StaffMember)
 *   - DELETE /api/push/subscribe  — unregister
 *   - POST   /api/push/test       — send a test push
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { cleanupTenant, cleanupUser, isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';

let serverUp = false;
let seed: SeedResult | null = null;
let testStaffId: string | null = null;
const testEmployeeId = `E2E-PUSH-${crypto.randomUUID().slice(0, 8)}`;
const testEndpoint = `https://fcm.googleapis.com/fcm/send/E2E-PUSH-ENDPOINT-${crypto.randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    throw new Error('dev server must be running on :3000 — start with `npm run dev`');
  }
  seed = await seedTestTenantFull();
  await withPlatformAdmin(basePrisma, async (tx) => {
    await tx.user.update({
      where: { id: seed!.user.id },
      data: { employeeId: testEmployeeId },
    });
  });
  const s = await withTenantRls(basePrisma, seed.tenant.id, (tx) =>
    tx.staffMember.create({
      data: {
        tenantId: seed!.tenant.id,
        employeeId: testEmployeeId,
        name: 'E2E Push Staff',
        department: 'QA',
        isActive: true,
        transportType: 'BUS',
      },
    }),
  );
  testStaffId = s.id;
});

afterAll(async () => {
  if (seed) {
    if (testStaffId) {
      await withTenantRls(basePrisma, seed.tenant.id, async (tx) => {
        await tx.pushSubscription.deleteMany({ where: { staffMemberId: testStaffId!, endpoint: testEndpoint } }).catch(() => {});
        await tx.staffMember.deleteMany({ where: { id: testStaffId! } }).catch(() => {});
      }).catch(() => {});
    }
    await cleanupTenant(seed.tenant.id).catch(() => {});
    await cleanupUser(seed.user.id).catch(() => {});
  }
});

describe('Push /api/push/*', () => {
  it('GET /public-key returns the VAPID public key', async () => {
    const r = await makeRequest('GET', '/api/push/public-key');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(typeof body.publicKey).toBe('string');
    expect(body.publicKey.length).toBeGreaterThan(50);
    expect(body.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('POST /subscribe without session returns 401', async () => {
    const r = await makeRequest('POST', '/api/push/subscribe', {});
    expect(r.status).toBe(401);
  });

  it('POST /subscribe with missing fields returns 400', async () => {
    const r = await makeRequest('POST', '/api/push/subscribe', {}, seed!.headers);
    expect(r.status).toBe(400);
  });

  it('POST /subscribe with mismatched employeeId returns 403', async () => {
    const r = await makeRequest('POST', '/api/push/subscribe', {
      endpoint: testEndpoint,
      keys: { p256dh: 'a', auth: 'b' },
      employeeId: 'EMP-DOES-NOT-EXIST-9999',
    }, seed!.headers);
    expect(r.status).toBe(403);
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
    }, seed!.headers);
    expect(r.status).toBe(201);

    const found = await withTenantRls(basePrisma, seed!.tenant.id, (tx) =>
      tx.pushSubscription.findFirst({ where: { endpoint: testEndpoint } }),
    );
    expect(found).not.toBeNull();
    expect(found?.staffMemberId).toBe(testStaffId);
  });

  it('POST /test sends a push and prunes the fake endpoint (410)', async () => {
    const r = await makeRequest('POST', '/api/push/test', { employeeId: testEmployeeId }, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sent + body.pruned).toBeGreaterThanOrEqual(1);

    const found = await withTenantRls(basePrisma, seed!.tenant.id, (tx) =>
      tx.pushSubscription.findFirst({ where: { endpoint: testEndpoint } }),
    );
    expect(found?.revokedAt).not.toBeNull();
    expect(found?.lastErrorCode).toBe(410);
  });

  it('DELETE /subscribe (without endpoint) returns 400', async () => {
    const r = await makeRequest('DELETE', '/api/push/subscribe', undefined, seed!.headers);
    expect(r.status).toBe(400);
  });
});
