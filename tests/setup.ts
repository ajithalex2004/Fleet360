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
import { hashPassword } from './test-utils';
export { hashPassword } from './test-utils';

// ── Lazy Prisma import (after env is loaded) ──────────────────────────────────
import { prisma } from '@/lib/prisma';
import { signSession } from '@/lib/tenant-session';
import { CANONICAL_ROLES, canonicalRoleCode } from '@/lib/role-canonicalization';

async function retryTestDb<T>(
  label: string,
  operation: () => Promise<T>,
  attempts = 3,
  delayMs = 750,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      console.warn(`[Test DB] ${label} failed on attempt ${attempt}/${attempts}; retrying...`);
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

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

  await retryTestDb('create tenant', () => prisma.tenant.create({
    data: {
      id,
      name,
      code,
      domain,
      plan,
      isActive,
    },
  }));

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
  await retryTestDb('create user', () => prisma.user.create({
    data: {
      id,
      email,
      username,
      firstName,
      lastName,
      isActive,
      updatedAt: new Date(),
    },
  }));

  // Set password_hash via raw SQL since the column was added outside Prisma schema
  const passwordHash = hashPassword(password);
  await retryTestDb('set user password hash', () => prisma.$executeRawUnsafe(
    `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
    passwordHash,
    id,
  ));

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
  const canonicalCode = canonicalRoleCode({ code: roleCode, name: overrides.name });
  const canonical = canonicalCode ? CANONICAL_ROLES[canonicalCode] : null;
  const name = overrides.name ?? canonical?.name ?? `Test Role ${uid}`;
  const description = overrides.description ?? canonical?.description ?? 'Auto-generated test role';

  await retryTestDb('create role', () => prisma.role.create({
    data: {
      id,
      tenantId,
      name,
      code: roleCode,
      description,
      isSystem: false,
    },
  }));

  return { id, tenantId, name, code: roleCode };
}

// ── Factory: UserTenant ───────────────────────────────────────────────────────

export async function createTestUserTenant(
  userId: string,
  tenantId: string,
  roleId: string,
): Promise<TestUserTenant> {
  const id = crypto.randomUUID();

  await retryTestDb('create user tenant link', () => prisma.userTenant.create({
    data: {
      id,
      userId,
      tenantId,
      roleId,
      isActive: true,
    },
  }));

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
    'x-test-auth-bypass': 'fleet360-test-bypass',
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
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  return fetch(`${BASE_URL}${path}`, options);
}

export async function readJsonResponse<T = unknown>(
  response: Response,
  label = 'response',
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty body (status ${response.status})`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `${label} returned non-JSON content (status ${response.status}): ${text.slice(0, 280)} :: ${String(error)}`,
    );
  }
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
    await retryTestDb(`cleanup tenant ${tenantId}`, async () => {
    // Delete in reverse FK order ─────────────────────────────────────────────

    // Nav permissions (raw table — no Prisma model)
    const deleteTenantRows = async (table: string) => {
      const existsRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        table,
      );
      if (!existsRows[0]?.exists) return;
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE tenant_id::text = $1`,
        tenantId,
      );
    };

    await deleteTenantRows('tenant_admin_nav_permissions');

    // Finance invoices (raw table — no Prisma model)
    await deleteTenantRows('finance_invoices');

    // Vehicles (raw table — uses tenant_id column added outside schema)
    await deleteTenantRows('vehicles');

    // School bus students (raw table)
    await deleteTenantRows('school_bus_students');

    // Incidents (raw table)
    await deleteTenantRows('incidents');

    // Logistics trips (raw table)
    await deleteTenantRows('logistics_trips');

    // Rental agreements (raw table)
    await deleteTenantRows('rental_agreements');

    // UserTenant links
    await prisma.userTenant.deleteMany({ where: { tenantId } });

    // Roles (including permissions cascade via FK on role_permissions)
    const roles = await prisma.role.findMany({ where: { tenantId } });
    for (const role of roles) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM role_permissions WHERE role_id::text = $1`,
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
    });
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
    await retryTestDb(`cleanup user ${userId}`, async () => {
      await prisma.userTenant.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    });
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
  const headers = {
    ...createAuthHeaders(token),
    'x-user-id': user.id,
    'x-tenant-id': tenant.id,
    'x-user-role': role,
    'x-tenant-plan': plan,
  };

  return { tenant, user, role: testRole, userTenant, token, headers };
}

// ── Server availability check ─────────────────────────────────────────────────

/**
 * Returns true if the Next.js dev server is healthy on localhost:3000.
 * If it is offline, fail fast so integration runs cannot report false-green results.
 */
export async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:3000/api/health', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`Health endpoint returned ${res.status}`);
    }
    return true;
  } catch (error) {
    throw new Error(`Integration test server check failed at http://localhost:3000/api/health: ${String(error)}`);
  }
}

// ── Global teardown ───────────────────────────────────────────────────────────

afterAll(async () => {
  await prisma.$disconnect();
});
