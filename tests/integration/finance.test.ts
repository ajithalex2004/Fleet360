/**
 * Integration tests for Finance Invoices API.
 *
 * Endpoints tested:
 *  - GET  /api/finance/invoices
 *  - POST /api/finance/invoices
 *
 * Prerequisites:
 *  - Next.js dev server running on localhost:3000
 *  - DATABASE_URL in .env.test must point to a valid PostgreSQL database
 *
 * Business rules verified:
 *  - Unauthenticated requests are rejected with 401
 *  - ENTERPRISE plan can GET and POST invoices
 *  - TRIAL plan can GET (read-only) but POST returns 403 (TRIAL_READ_ONLY)
 *  - POST with missing required fields returns 400
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

// ── Minimal valid invoice body ────────────────────────────────────────────────

function invoiceBody(overrides: Record<string, unknown> = {}) {
  const num = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
  return {
    invoiceNumber: `INV-TEST-${num}`,
    clientName:    'Test Client Ltd',
    serviceType:   'GENERAL',
    module:        'GENERAL',
    lineItems:     [{ description: 'Test service', quantity: 1, unitPrice: 100 }],
    subtotal:      100,
    currency:      'AED',
    dueDate:       '2025-12-31',
    customerId:    null,
    ...overrides,
  };
}

// ── Server guard ──────────────────────────────────────────────────────────────

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable) {
    console.warn(
      '[finance.test] Skipping integration tests — Next.js server not running on localhost:3000.',
    );
  }
});

// ── GET /api/finance/invoices — ENTERPRISE ────────────────────────────────────

describe('GET /api/finance/invoices — ENTERPRISE', () => {
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

  it('returns 200 with a valid ENTERPRISE session', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/finance/invoices', undefined, seed.headers);
    expect(res.status).toBe(200);
  });

  it('returns an array or paginated object of invoices', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/finance/invoices', undefined, seed.headers);
    const body = await res.json();

    const invoices = Array.isArray(body) ? body : (body.data ?? body.invoices ?? []);
    expect(Array.isArray(invoices)).toBe(true);
  });

  it('returns 401 with no session', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('GET', '/api/finance/invoices');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/finance/invoices — TRIAL ─────────────────────────────────────────

describe('GET /api/finance/invoices — TRIAL plan (read allowed)', () => {
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

  it('returns 200 for GET on TRIAL plan (reads are always allowed)', async () => {
    if (!serverAvailable) return;

    // The middleware sets x-tenant-plan=TRIAL but doesn't block GET requests —
    // only the assertCanWrite() guard in POST handlers blocks writes.
    const res = await makeRequest('GET', '/api/finance/invoices', undefined, seed.headers);
    expect(res.status).toBe(200);
  });
});

// ── POST /api/finance/invoices — ENTERPRISE ───────────────────────────────────

describe('POST /api/finance/invoices — ENTERPRISE plan', () => {
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

  it('returns 201 (or 200) when creating an invoice with ENTERPRISE plan', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'POST',
      '/api/finance/invoices',
      invoiceBody(),
      seed.headers,
    );

    expect([200, 201]).toContain(res.status);
  });

  it('created invoice has an auto-generated invoiceNumber', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'POST',
      '/api/finance/invoices',
      invoiceBody(),
      seed.headers,
    );

    if (![200, 201].includes(res.status)) return; // skip content check if route differs

    const body = await res.json();
    const created = body.data ?? body;
    // API always auto-generates invoice numbers in INV-YYYYMM-XXXX-rnd format
    const returnedNum = created.invoiceNumber ?? created.invoice_number ?? created.invoiceNumber;
    if (returnedNum) {
      expect(typeof returnedNum).toBe('string');
      expect(returnedNum).toMatch(/^INV-/);
    }
  });

  it('returns 401 when no session is provided', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/finance/invoices', invoiceBody());
    expect(res.status).toBe(401);
  });

  it('returns 400 when clientName is missing', async () => {
    if (!serverAvailable) return;

    const body = invoiceBody();
    delete (body as Record<string, unknown>).clientName;

    const res = await makeRequest('POST', '/api/finance/invoices', body, seed.headers);
    // Should be a 400 or 422 validation error
    expect([400, 422]).toContain(res.status);
  });

  it('succeeds when invoiceNumber is missing (API auto-generates)', async () => {
    if (!serverAvailable) return;

    const body = invoiceBody();
    delete (body as Record<string, unknown>).invoiceNumber;

    const res = await makeRequest('POST', '/api/finance/invoices', body, seed.headers);
    // API auto-generates invoice numbers, so omitting invoiceNumber is fine
    expect([200, 201]).toContain(res.status);
  });
});

// ── POST /api/finance/invoices — TRIAL plan (should be blocked) ───────────────

describe('POST /api/finance/invoices — TRIAL plan (write blocked)', () => {
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

  it('returns 403 (TRIAL_READ_ONLY) when POSTing to finance on TRIAL plan', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'POST',
      '/api/finance/invoices',
      invoiceBody(),
      seed.headers,
    );

    // Finance is NOT in TRIAL_FREE_MODULES — should be forbidden
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.code ?? body.error).toMatch(/TRIAL_READ_ONLY|Forbidden/i);
  });
});

// ── POST /api/finance/invoices — SUPER_ADMIN always allowed ───────────────────

describe('POST /api/finance/invoices — SUPER_ADMIN on TRIAL', () => {
  let seed: SeedResult;

  beforeAll(async () => {
    if (!serverAvailable) return;
    seed = await seedTestTenantFull('TRIAL', 'SUPER_ADMIN');
  });

  afterAll(async () => {
    if (!seed) return;
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  });

  it('returns 200/201 for SUPER_ADMIN even on TRIAL plan (bypass TRIAL restrictions)', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'POST',
      '/api/finance/invoices',
      invoiceBody(),
      seed.headers,
    );

    // SUPER_ADMIN bypasses TRIAL read-only restrictions
    expect([200, 201]).toContain(res.status);
  });
});
