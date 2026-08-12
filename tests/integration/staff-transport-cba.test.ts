/**
 * tests/integration/staff-transport-cba.test.ts
 *
 * Integration tests for the CBA / Union Rule-Sets API (Phase 1).
 * Hits the running Next.js dev server on localhost:3000.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { cleanupTenant, isServerRunning, makeRequest, seedTestTenantFull } from '../setup';

let serverUp = false;
let seed: Awaited<ReturnType<typeof seedTestTenantFull>> | null = null;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('[cba integration] Dev server not reachable on localhost:3000 — skipping');
    return;
  }
  seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');
});

afterAll(async () => {
  if (seed) await cleanupTenant(seed.tenant.id);
});

const testOrSkip = serverUp ? it : it.skip;

describe('CBA /api/bus-ops/cba', () => {
  it('GET returns an empty list for a new tenant', async () => {
    const r = await makeRequest('GET', '/api/bus-ops/cba', undefined, seed!.headers);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it('POST creates a rule-set and sets it as default', async () => {
    const r = await makeRequest('POST', '/api/bus-ops/cba', {
      name: 'E2E Test CBA',
      description: 'Created by integration test',
      jurisdiction: 'AE',
      isDefault: true,
      rules: {
        schemaVersion: 1,
        rules: [
          { id: 'r-test-1', name: 'Max work', category: 'MAX_WORK_HOURS_PER_DAY', value: 9, unit: 'HOURS', enforced: true },
          { id: 'r-test-2', name: 'OT rate', category: 'OT_RATE', value: 1.5, unit: 'MULTIPLIER', enforced: true },
        ],
        meta: { jurisdiction: 'AE', counterparty: 'E2E test CBA' },
      },
    }, seed!.headers);
    expect(r.status).toBe(201);
    const created = await r.json();
    expect(created.name).toBe('E2E Test CBA');
    expect(created.isDefault).toBe(true);
    expect(created.rules.rules).toHaveLength(2);

    // GET should now return it
    const list = await makeRequest('GET', '/api/bus-ops/cba', undefined, seed!.headers);
    const items = await list.json();
    expect(items.some((c: { id: string; isDefault: boolean }) => c.id === created.id && c.isDefault)).toBe(true);
  });

  it('GET /:id returns the rule-set', async () => {
    // First create one
    const created = await (await makeRequest('POST', '/api/bus-ops/cba', {
      name: 'E2E Get One',
      rules: { schemaVersion: 1, rules: [], meta: {} },
    }, seed!.headers)).json();

    const r = await makeRequest('GET', `/api/bus-ops/cba?id=${created.id}`, undefined, seed!.headers);
    expect(r.status).toBe(200);
    const one = await r.json();
    expect(one.id).toBe(created.id);
  });

  it('GET ?default=true returns the default rule-set', async () => {
    const r = await makeRequest('GET', '/api/bus-ops/cba?default=true', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const def = await r.json();
    expect(def).not.toBeNull();
    expect(def.isDefault).toBe(true);
  });

  it('DELETE soft-deletes the rule-set', async () => {
    const created = await (await makeRequest('POST', '/api/bus-ops/cba', {
      name: 'E2E Delete Me',
      rules: { schemaVersion: 1, rules: [], meta: {} },
    }, seed!.headers)).json();

    const r = await makeRequest('DELETE', `/api/bus-ops/cba?id=${created.id}`, undefined, seed!.headers);
    expect(r.status).toBe(200);

    // GET should no longer return it
    const list = await makeRequest('GET', '/api/bus-ops/cba', undefined, seed!.headers);
    const items = await list.json();
    expect(items.some((c: { id: string }) => c.id === created.id)).toBe(false);
  });

  it('returns 401 without auth', async () => {
    const r = await makeRequest('GET', '/api/bus-ops/cba');
    expect(r.status).toBe(401);
  });
});
