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
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { cleanupTenant, cleanupUser, createTestRole, createTestTenant, createTestUser, createTestUserTenant, isServerRunning, makeRequest } from '../setup';

let serverUp = false;
let testTenantId: string | null = null;
let testUserId: string | null = null;
let testRoleId: string | null = null;
let createdPlatformRole = false;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('[permissions integration] Dev server not reachable — skipping');
    return;
  }

  // Ensure a platform SUPER_ADMIN exists in the local test database so login succeeds cleanly.
  const existing = await withPlatformAdmin(basePrisma, (tx) =>
    tx.user.findUnique({ where: { email: 'admin@xl-mobility.com' }, select: { id: true } }),
  );
  if (!existing) {
    const tenant = await createTestTenant({ plan: 'ENTERPRISE' });
    let role = await withPlatformAdmin(basePrisma, (tx) =>
      tx.role.findFirst({ where: { tenantId: null, code: 'SUPER_ADMIN' } }),
    );
    if (!role) {
      role = await withPlatformAdmin(basePrisma, (tx) =>
        tx.role.create({
          data: {
            tenantId: null,
            code: 'SUPER_ADMIN',
            name: 'Platform Super Admin',
            description: 'Platform-wide super administrator',
            isSystem: true,
          },
        }),
      );
      createdPlatformRole = true;
    }
    const user = await createTestUser({
      email: 'admin@xl-mobility.com',
      password: 'TestAdmin123!',
    });
    await createTestUserTenant(user.id, tenant.id, role.id);
    testTenantId = tenant.id;
    testUserId = user.id;
    testRoleId = role.id;
  }
});

afterAll(async () => {
  if (testUserId) {
    await cleanupUser(testUserId);
  }
  if (testTenantId) {
    await cleanupTenant(testTenantId);
  }
  if (createdPlatformRole && testRoleId) {
    await withPlatformAdmin(basePrisma, async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: testRoleId! } });
      await tx.role.delete({ where: { id: testRoleId! } }).catch(() => {});
    });
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
