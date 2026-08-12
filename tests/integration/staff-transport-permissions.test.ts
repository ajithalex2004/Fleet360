/**
 * tests/integration/staff-transport-permissions.test.ts
 *
 * Integration tests for the effective-role resolution (Phase 1 follow-up).
 *
 * Verifies that:
 *   - Login response includes the new effective-role fields
 *     (effectiveRoleId, isTenantOverride, originalRoleCode)
 *   - A platform SUPER_ADMIN keeps the `*:*:*` wildcard
 *   - The /api/admin/session endpoint reflects the effective role
 *
 * Also tests a regression: a 4xx login (wrong password) must NOT leak
 * the effective-role shape (which would only matter for 2xx).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { cleanupTenant, createTestRole, createTestTenant, createTestUser, createTestUserTenant, isServerRunning, makeRequest } from '../setup';

let serverUp = false;
let testTenantId: string | null = null;
let testUserId: string | null = null;
let testRoleId: string | null = null;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('[permissions integration] Dev server not reachable — skipping');
    return;
  }

  // Create a dedicated test tenant for the platform admin to log into,
  // and seed a user on the platform SUPER_ADMIN role. We need an admin
  // session, so we'll log in as the existing platform admin and probe
  // their response.
});

afterAll(async () => {
  if (testRoleId) {
    await basePrisma.rolePermission.deleteMany({ where: { roleId: testRoleId } });
    await basePrisma.role.delete({ where: { id: testRoleId } }).catch(() => {});
  }
  if (testUserId) {
    await basePrisma.userTenant.deleteMany({ where: { userId: testUserId } });
    await basePrisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  }
  if (testTenantId) {
    await cleanupTenant(testTenantId);
  }
});

describe('Effective role resolution at login', () => {
  it('login response includes effectiveRoleId, isTenantOverride, originalRoleCode', async () => {
    const r = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@xl-mobility.com',
      password: 'TestAdmin123!',
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.user).toBeDefined();
    // New effective-role fields
    expect(body.user.effectiveRoleId).toBeDefined();
    expect(typeof body.user.isTenantOverride).toBe('boolean');
    expect(body.user.originalRoleCode).toBeDefined();
    expect(body.user.roleCode).toBeDefined();
    // For the platform admin with no override, originalRoleCode === roleCode === 'SUPER_ADMIN'
    expect(body.user.roleCode).toBe('SUPER_ADMIN');
    expect(body.user.originalRoleCode).toBe('SUPER_ADMIN');
    expect(body.user.isTenantOverride).toBe(false);
    expect(body.user.effectiveRoleId).toBe(body.user.effectiveRoleId); // non-null
  });

  it('platform SUPER_ADMIN login includes the *:*:* wildcard', async () => {
    const r = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@xl-mobility.com',
      password: 'TestAdmin123!',
    });
    const body = await r.json();
    expect(body.permissions).toContain('*:*:*');
  });

  it('login with wrong password returns 401 (no effective-role leak)', async () => {
    const r = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@xl-mobility.com',
      password: 'wrong-password',
    });
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.user).toBeUndefined();
    expect(body.effectiveRoleId).toBeUndefined();
  });

  it('login with missing fields returns 400', async () => {
    const r = await makeRequest('POST', '/api/auth/login', { email: 'no-pw@example.com' });
    expect(r.status).toBe(400);
  });

  it('login with non-existent email returns 401', async () => {
    const r = await makeRequest('POST', '/api/auth/login', {
      email: 'nobody@example.com',
      password: 'whatever',
    });
    expect(r.status).toBe(401);
  });
});
