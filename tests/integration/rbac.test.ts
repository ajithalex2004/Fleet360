/**
 * Role-Based Access Control (RBAC) Integration Tests.
 *
 * What is verified:
 *  - SUPER_ADMIN can POST to any module endpoint
 *  - TENANT_ADMIN on TRIAL can POST to fleet (free) but not finance/rental (locked)
 *  - TENANT_ADMIN on ENTERPRISE can POST to all modules
 *  - No session → 401 on all protected routes
 *  - Invalid/tampered session → 401
 *
 * Prerequisites:
 *  - Next.js dev server running on localhost:3000
 *  - DATABASE_URL in .env.test must point to a valid PostgreSQL database
 *
 * Note: We test the HTTP-level enforcement (middleware + assertCanWrite), not
 * business logic inside the handlers. Tests verify status codes, not response bodies.
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
      '[rbac.test] Skipping integration tests — Next.js server not running on localhost:3000.',
    );
  }
});

// ── Test payloads ─────────────────────────────────────────────────────────────

function vehiclePayload() {
  return {
    plateNumber: `RBAC-${Math.floor(Math.random() * 999999)}`,
    make:        'Toyota',
    model:       'Hilux',
    year:        2023,
    vehicleType: 'TRUCK',
    status:      'AVAILABLE',
  };
}

function invoicePayload() {
  return {
    invoiceNumber: `INV-RBAC-${Math.floor(Math.random() * 999999)}`,
    clientName:    'RBAC Test Client',
    serviceType:   'GENERAL',
    module:        'GENERAL',
    lineItems:     [{ description: 'RBAC test', quantity: 1, unitPrice: 200 }],
    subtotal:      200,
    currency:      'AED',
    dueDate:       '2025-12-31',
  };
}

function agreementPayload() {
  return {
    agreementNumber: `AGR-RBAC-${Math.floor(Math.random() * 999999)}`,
    status:          'DRAFT',
  };
}

// ── No session — all protected routes return 401 ──────────────────────────────

describe('No session — protected routes return 401', () => {
  const protectedRoutes = [
    { method: 'GET'  as const, path: '/api/fleet/vehicles' },
    { method: 'POST' as const, path: '/api/fleet/vehicles' },
    { method: 'GET'  as const, path: '/api/finance/invoices' },
    { method: 'POST' as const, path: '/api/finance/invoices' },
    { method: 'GET'  as const, path: '/api/admin/tenants' },
    { method: 'GET'  as const, path: '/api/auth/me' },
  ];

  for (const { method, path } of protectedRoutes) {
    it(`${method} ${path} → 401 with no session`, async () => {
      if (!serverAvailable) return;

      const res = await makeRequest(method, path, method === 'POST' ? {} : undefined);
      expect(res.status).toBe(401);
    });
  }
});

// ── Tampered session → 401 ────────────────────────────────────────────────────

describe('Tampered/invalid session → 401', () => {
  const tamperedHeaders = {
    'Content-Type': 'application/json',
    Cookie:         'xl-session=tampered.payload.invalidsig',
  };

  it('GET /api/fleet/vehicles with tampered session → 401', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/fleet/vehicles', undefined, tamperedHeaders);
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me with tampered session → 401', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, tamperedHeaders);
    expect(res.status).toBe(401);
  });

  it('POST /api/fleet/vehicles with tampered session → 401', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/fleet/vehicles', vehiclePayload(), tamperedHeaders);
    expect(res.status).toBe(401);
  });
});

// ── TRIAL plan — fleet write allowed, finance write blocked ───────────────────

describe('TRIAL plan — TENANT_ADMIN', () => {
  let seed: SeedResult;

  beforeAll(async () => {
    if (!serverAvailable) return;
    seed = await seedTestTenantFull('TRIAL', 'TENANT_ADMIN');
  });

  afterAll(async () => {
    if (!seed) return;
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  });

  it('can POST to /api/fleet/vehicles (fleet is in TRIAL_FREE_MODULES)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/fleet/vehicles', vehiclePayload(), seed.headers);
    // Fleet is writable on TRIAL — should NOT be 403
    expect(res.status).not.toBe(403);
    expect([200, 201]).toContain(res.status);
  });

  it('cannot POST to /api/finance/invoices on TRIAL (returns 403 TRIAL_READ_ONLY)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/finance/invoices', invoicePayload(), seed.headers);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.code ?? body.error).toMatch(/TRIAL_READ_ONLY|Forbidden/i);
  });

  it('cannot POST to /api/rental/agreements on TRIAL (returns 403)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'POST',
      '/api/rental/agreements',
      agreementPayload(),
      seed.headers,
    );
    // Rental is NOT in TRIAL_FREE_MODULES — should be 403
    expect(res.status).toBe(403);
  });

  it('cannot POST to /api/leasing/contracts on TRIAL (returns 403)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'POST',
      '/api/leasing/contracts',
      { contractNumber: `CTR-TRIAL-${Date.now()}` },
      seed.headers,
    );
    expect(res.status).toBe(403);
  });
});

// ── ENTERPRISE plan — full write access ───────────────────────────────────────

describe('ENTERPRISE plan — TENANT_ADMIN full write access', () => {
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

  it('can POST to /api/fleet/vehicles (not 403)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/fleet/vehicles', vehiclePayload(), seed.headers);
    expect(res.status).not.toBe(403);
    expect([200, 201]).toContain(res.status);
  });

  it('can POST to /api/finance/invoices (not 403)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/finance/invoices', invoicePayload(), seed.headers);
    expect(res.status).not.toBe(403);
    expect([200, 201]).toContain(res.status);
  });

  it('can GET from all module endpoints without 401 or 403', async () => {
    if (!serverAvailable) return;

    const endpoints = [
      '/api/fleet/vehicles',
      '/api/finance/invoices',
    ];

    for (const endpoint of endpoints) {
      const res = await makeRequest('GET', endpoint, undefined, seed.headers);
      expect(res.status, `GET ${endpoint} should not return 401/403`).not.toBe(401);
      expect(res.status, `GET ${endpoint} should not return 403`).not.toBe(403);
      expect(res.status, `GET ${endpoint} should return 200`).toBe(200);
    }
  });
});

// ── SUPER_ADMIN — can access anything including admin routes ──────────────────

describe('SUPER_ADMIN role — unrestricted access', () => {
  let seed: SeedResult;

  beforeAll(async () => {
    if (!serverAvailable) return;
    // Even on TRIAL plan, SUPER_ADMIN should have full access
    seed = await seedTestTenantFull('TRIAL', 'SUPER_ADMIN');
  });

  afterAll(async () => {
    if (!seed) return;
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  });

  it('SUPER_ADMIN can POST to /api/fleet/vehicles on TRIAL', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/fleet/vehicles', vehiclePayload(), seed.headers);
    expect(res.status).not.toBe(403);
    expect([200, 201]).toContain(res.status);
  });

  it('SUPER_ADMIN can POST to /api/finance/invoices on TRIAL (bypasses TRIAL_READ_ONLY)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/finance/invoices', invoicePayload(), seed.headers);
    expect(res.status).not.toBe(403);
    expect([200, 201]).toContain(res.status);
  });

  it('SUPER_ADMIN can GET /api/admin/tenants', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/admin/tenants', undefined, seed.headers);
    expect(res.status).toBe(200);
  });

  it('SUPER_ADMIN receives isSuperAdmin: true from /api/auth/me', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/auth/me', undefined, seed.headers);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isSuperAdmin).toBe(true);
  });
});

// ── PROFESSIONAL plan — full write access ─────────────────────────────────────

describe('PROFESSIONAL plan — TENANT_ADMIN full write access', () => {
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

  it('can POST to /api/finance/invoices (not 403)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/finance/invoices', invoicePayload(), seed.headers);
    expect(res.status).not.toBe(403);
    expect([200, 201]).toContain(res.status);
  });
});
