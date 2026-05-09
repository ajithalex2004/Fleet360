/**
 * Global test setup for Fleet360 Platform.
 *
 * What this file does:
 *  - Loads .env.test (fallback: .env) so DATABASE_URL and SESSION_SECRET are available
 *  - Exports factory helpers to create test tenants, users, roles, and session tokens
 *  - Exports makeRequest() for hitting the running Next.js dev server (localhost:3000)
 *  - Exports cleanupTenant() to delete all test data in reverse FK order
 *  - Exports seedTestTenantFull() — one-line convenience wrapper
 *
 * Prerequisites:
 *  - PostgreSQL must be accessible (DATABASE_URL in .env.test)
 *  - For integration tests: `npm run dev` must be running on localhost:3000
 *
 * NOTE: signSession() uses Web Crypto (globalThis.crypto.subtle). In Node.js 20+
 * globalThis.crypto is available, but we polyfill below for older versions.
 */

import * as crypto from 'crypto';
import { afterAll } from 'vitest';

// test-utils handles dotenv loading + Web Crypto polyfill and exports hashPassword
// It must be imported BEFORE @/lib/prisma so DATABASE_URL is set in time.
export { hashPassword } from './test-utils';

// ── Lazy Prisma import (after env is loaded) ──────────────────────────────────
import { prisma } from '@/lib/prisma';
import { signSession } from '@/lib/tenant-session';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestTenant {
  id: string;
  name: string;
  code: string;
  domain: string;
  plan: string;
}

export interface TestUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
}

export interface TestRole {
  id: string;
  tenantId: string | null;
  name: string;
  code: string;
}

export interface TestUserTenant {
  id: string;
  userId: string;
  tenantId: string;
  roleId: string;
}

export interface SeedResult {
  tenant: TestTenant;
  user: TestUser;
  role: TestRole;
  userTenant: TestUserTenant;
  token: string;
  headers: Record<string, string>;
}

// ── Factory: Tenant ───────────────────────────────────────────────────────────

export async function createTestTenant(
  overrides: Partial<{
    id: string;
    name: string;
    code: string;
    domain: string;
    plan: string;
    isActive: boolean;
  }> = {},
): Promise<TestTenant> {
  const uid = crypto.randomUUID().slice(0, 8);
  const id = overrides.id ?? crypto.randomUUID();
  const code = overrides.code ?? `TEST-${uid}`;
  const name = overrides.name ?? `Test Tenant ${uid}`;
  const domain = overrides.domain ?? `test-${uid}.example.com`;
  const plan = overrides.plan ?? 'ENTERPRISE';
  const isActive = overrides.isActive ?? true;

  await prisma.tenant.create({
    data: {
      id,
      name,
      code,
      domain,
      plan,
      isActive,
    },
  });

  return { id, name, code, domain, plan };
}

// ── Factory: User ─────────────────────────────────────────────────────────────

export async function createTestUser(
  overrides: Partial<{
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    password: string;
  }> = {},
): Promise<TestUser> {
  const uid = crypto.randomUUID().slice(0, 8);
  const id = overrides.id ?? crypto.randomUUID();
  const email = overrides.email ?? `testuser-${uid}@test.example.com`;
  const username = overrides.username ?? `testuser-${uid}`;
  const firstName = overrides.firstName ?? 'Test';
  const lastName = overrides.lastName ?? `User-${uid}`;
  const isActive = overrides.isActive ?? true;
  const password = overrides.password ?? 'TestPassword123!';

  // Create user via Prisma (no password_hash — that column is outside the Prisma schema)
  await prisma.user.create({
    data: {
      id,
      email,
      username,
      firstName,
      lastName,
      isActive,
      updatedAt: new Date(),
    },
  });

  // Set password_hash via raw SQL since the column was added outside Prisma schema
  const passwordHash = hashPassword(password);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
    passwordHash,
    id,
  );

  return { id, email, username, firstName, lastName };
}

// ── Factory: Role ─────────────────────────────────────────────────────────────

export async function createTestRole(
  tenantId: string,
  code?: string,
  overrides: Partial<{
    id: string;
    name: string;
    description: string;
  }> = {},
): Promise<TestRole> {
  const uid = crypto.randomUUID().slice(0, 8);
  const id = overrides.id ?? crypto.randomUUID();
  const roleCode = code ?? 'TENANT_ADMIN';
  const name = overrides.name ?? `Test Role ${uid}`;
  const description = overrides.description ?? 'Auto-generated test role';

  await prisma.role.create({
    data: {
      id,
      tenantId,
      name,
      code: roleCode,
      description,
      isSystem: false,
    },
  });

  return { id, tenantId, name, code: roleCode };
}

// ── Factory: UserTenant ───────────────────────────────────────────────────────

export async function createTestUserTenant(
  userId: string,
  tenantId: string,
  roleId: string,
): Promise<TestUserTenant> {
  const id = crypto.randomUUID();

  await prisma.userTenant.create({
    data: {
      id,
      userId,
      tenantId,
      roleId,
      isActive: true,
    },
  });

  return { id, userId, tenantId, roleId };
}

// ── Session token helpers ─────────────────────────────────────────────────────

/**
 * Signs an xl-session token with the given identity.
 * Uses signSession() from tenant-session.ts (Web Crypto HMAC-SHA256).
 */
export async function createSessionToken(
  userId: string,
  tenantId: string,
  plan = 'ENTERPRISE',
  role = 'TENANT_ADMIN',
): Promise<string> {
  return signSession({ userId, tenantId, plan, role });
}

/**
 * Returns an HTTP headers object ready to pass to fetch().
 * The cookie header mimics what a browser sends after login.
 */
export function createAuthHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Cookie: `xl-session=${token}`,
  };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

/**
 * Sends an HTTP request to the running Next.js dev server.
 *
 * IMPORTANT: Integration tests require `npm run dev` (or `npm start`) to be
 * running on localhost:3000 before executing. Tests will be skipped gracefully
 * if the server is unreachable.
 */
export async function makeRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  return fetch(`${BASE_URL}${path}`, options);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Deletes all test data associated with a tenant in reverse dependency order
 * to avoid foreign-key violations.
 *
 * Safe to call even if some records don't exist (uses deleteMany which is a no-op).
 */
export async function cleanupTenant(tenantId: string): Promise<void> {
  try {
    // Delete in reverse FK order ─────────────────────────────────────────────

    // Nav permissions (raw table — no Prisma model)
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenant_admin_nav_permissions WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {}); // table may not exist yet

    // Finance invoices (raw table — no Prisma model)
    await prisma.$executeRawUnsafe(
      `DELETE FROM finance_invoices WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {});

    // Vehicles (raw table — uses tenant_id column added outside schema)
    await prisma.$executeRawUnsafe(
      `DELETE FROM vehicles WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {});

    // School bus students (raw table)
    await prisma.$executeRawUnsafe(
      `DELETE FROM school_bus_students WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {});

    // Incidents (raw table)
    await prisma.$executeRawUnsafe(
      `DELETE FROM incidents WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {});

    // Logistics trips (raw table)
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_trips WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {});

    // Rental agreements (raw table)
    await prisma.$executeRawUnsafe(
      `DELETE FROM rental_agreements WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {});

    // UserTenant links
    await prisma.userTenant.deleteMany({ where: { tenantId } });

    // Roles (including permissions cascade via FK on role_permissions)
    const roles = await prisma.role.findMany({ where: { tenantId } });
    for (const role of roles) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM role_permissions WHERE role_id = $1`,
        role.id,
      ).catch(() => {});
    }
    await prisma.role.deleteMany({ where: { tenantId } });

    // TenantModules
    await prisma.tenantModule.deleteMany({ where: { tenantId } }).catch(() => {});

    // TenantSettings
    await prisma.tenantSettings.deleteMany({ where: { tenantId } }).catch(() => {});

    // Tenant itself
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  } catch (err) {
    // Non-fatal — test cleanup errors shouldn't fail tests
    console.warn(`[cleanupTenant] Warning cleaning up tenant ${tenantId}:`, err);
  }
}

/**
 * Deletes a test user and any orphaned UserTenant records.
 */
export async function cleanupUser(userId: string): Promise<void> {
  try {
    await prisma.userTenant.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  } catch (err) {
    console.warn(`[cleanupUser] Warning cleaning up user ${userId}:`, err);
  }
}

// ── Convenience: seed a full test environment in one call ─────────────────────

/**
 * Creates a complete test environment:
 *   Tenant → Role → User → UserTenant → session token → auth headers
 *
 * @param plan  - Tenant plan: 'TRIAL' | 'ENTERPRISE' | 'PROFESSIONAL'
 * @param role  - Role code: 'TENANT_ADMIN' | 'SUPER_ADMIN' | etc.
 * @param password - Password to set on the test user (default: 'TestPassword123!')
 * @returns All created entities plus a ready-to-use session token and headers
 */
export async function seedTestTenantFull(
  plan = 'ENTERPRISE',
  role = 'TENANT_ADMIN',
  password = 'TestPassword123!',
): Promise<SeedResult> {
  const tenant = await createTestTenant({ plan });
  const user = await createTestUser({ password });
  const testRole = await createTestRole(tenant.id, role);
  const userTenant = await createTestUserTenant(user.id, tenant.id, testRole.id);
  const token = await createSessionToken(user.id, tenant.id, plan, role);
  const headers = createAuthHeaders(token);

  return { tenant, user, role: testRole, userTenant, token, headers };
}

// ── Server availability check ─────────────────────────────────────────────────

/**
 * Returns true if the Next.js dev server is reachable on localhost:3000.
 * Integration tests should call this and skip if false.
 */
export async function isServerRunning(): Promise<boolean> {
  try {
    await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '__ping__', password: '__ping__' }),
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Global teardown ───────────────────────────────────────────────────────────

afterAll(async () => {
  await prisma.$disconnect();
});
