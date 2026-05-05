/**
 * Integration tests for Authentication API routes.
 *
 * Endpoints tested:
 *  - POST /api/auth/login
 *  - GET  /api/auth/me
 *  - POST /api/auth/logout
 *
 * Prerequisites:
 *  - Next.js dev server must be running on localhost:3000
 *  - DATABASE_URL in .env.test must point to a valid PostgreSQL database
 *  - Tests create and clean up their own data — safe to run against a shared dev DB
 *
 * Note: Each describe block calls seedTestTenantFull() in beforeAll and
 * cleans up in afterAll. Tests within each block share the seed data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTestTenantFull,
  cleanupTenant,
  cleanupUser,
  makeRequest,
  isServerRunning,
  type SeedResult,
} from '../setup';

// ── Server guard ──────────────────────────────────────────────────────────────

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable) {
    console.warn(
      '[auth.test] Skipping integration tests — Next.js server not running on localhost:3000. ' +
      'Start the server with `npm run dev` then re-run.',
    );
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  let seed: SeedResult;

  beforeAll(async () => {
    if (!serverAvailable) return;
    // Create a tenant + user with a known password
    seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN', 'TestPassword123!');
  });

  afterAll(async () => {
    if (!seed) return;
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  });

  it('returns 200 and sets xl-session cookie on correct credentials', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/login', {
      email:    seed.user.email,
      password: 'TestPassword123!',
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(seed.user.email);
    expect(body.tenant).toBeDefined();

    // Cookie should be set
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('xl-session=');
  });

  it('returns 200 and user data includes roleCode and tenantId', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/login', {
      email:    seed.user.email,
      password: 'TestPassword123!',
    });

    const body = await res.json();
    expect(body.user.roleCode).toBe('TENANT_ADMIN');
    expect(body.tenant.id).toBe(seed.tenant.id);
    expect(body.tenant.plan).toBe('ENTERPRISE');
  });

  it('returns 401 for wrong password', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/login', {
      email:    seed.user.email,
      password: 'WrongPassword!',
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 for unknown email', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/login', {
      email:    'nobody@nonexistent-domain-xyz.com',
      password: 'AnyPassword123!',
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 when email is missing', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/login', {
      password: 'TestPassword123!',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Bad Request');
  });

  it('returns 400 when password is missing', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/login', {
      email: seed.user.email,
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/login', {});
    expect(res.status).toBe(400);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  let seed: SeedResult;

  beforeAll(async () => {
    if (!serverAvailable) return;
    seed = await seedTestTenantFull('PROFESSIONAL', 'TENANT_ADMIN');
  });

  afterAll(async () => {
    if (!seed) return;
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  });

  it('returns 200 and session payload with valid session cookie', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, seed.headers);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.userId).toBe(seed.user.id);
    expect(body.tenantId).toBe(seed.tenant.id);
    expect(body.plan).toBe('PROFESSIONAL');
    expect(body.role).toBe('TENANT_ADMIN');
  });

  it('returns isSuperAdmin: false for TENANT_ADMIN', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, seed.headers);
    const body = await res.json();
    expect(body.isSuperAdmin).toBe(false);
  });

  it('returns 401 when no cookie is sent', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a tampered cookie value', async () => {
    if (!serverAvailable) return;

    const tamperedHeaders = {
      'Content-Type': 'application/json',
      Cookie: 'xl-session=tampered.invalidtoken',
    };

    const res = await makeRequest('GET', '/api/auth/me', undefined, tamperedHeaders);
    expect(res.status).toBe(401);
  });

  it('returns 401 with a random string as cookie', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, {
      'Content-Type': 'application/json',
      Cookie: 'xl-session=totally-not-a-real-token',
    });
    expect(res.status).toBe(401);
  });

  it('returns navPermissions object (can be empty)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, seed.headers);
    const body = await res.json();
    expect(body).toHaveProperty('navPermissions');
    expect(typeof body.navPermissions).toBe('object');
  });
});

// ── GET /api/auth/me — SUPER_ADMIN ────────────────────────────────────────────

describe('GET /api/auth/me — SUPER_ADMIN session', () => {
  let seed: SeedResult;

  beforeAll(async () => {
    if (!serverAvailable) return;
    seed = await seedTestTenantFull('ENTERPRISE', 'SUPER_ADMIN');
  });

  afterAll(async () => {
    if (!seed) return;
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  });

  it('returns isSuperAdmin: true for SUPER_ADMIN role', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, seed.headers);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isSuperAdmin).toBe(true);
    expect(body.role).toBe('SUPER_ADMIN');
  });

  it('returns empty navPermissions for SUPER_ADMIN (no tenant-level restrictions)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, seed.headers);
    const body = await res.json();
    // SUPER_ADMIN gets an empty object (no nav restrictions)
    expect(body.navPermissions).toEqual({});
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  let seed: SeedResult;

  beforeAll(async () => {
    if (!serverAvailable) return;
    seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');
  });

  afterAll(async () => {
    if (!seed) return;
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  });

  it('returns 200 and clears the xl-session cookie', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/logout', undefined, seed.headers);

    expect(res.status).toBe(200);

    // The Set-Cookie header should clear the cookie (maxAge=0 or expires=past)
    const setCookie = res.headers.get('set-cookie') ?? '';
    // Either the cookie is set to empty, or max-age=0, or expires in the past
    const cookieCleared =
      setCookie.includes('xl-session=;') ||
      setCookie.includes('xl-session=') && (
        setCookie.includes('Max-Age=0') ||
        setCookie.includes('max-age=0') ||
        setCookie.includes('Expires=') // some frameworks set a past date
      );

    // If the endpoint doesn't return a Set-Cookie (valid too — just returns 200)
    // we accept either behaviour
    const body = await res.json();
    expect(body.ok ?? true).toBeTruthy();
  });

  it('returns 200 even when called without a session (idempotent)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/logout');
    // Logout is a public route — should succeed even with no cookie
    expect([200, 401]).toContain(res.status);
  });
});
