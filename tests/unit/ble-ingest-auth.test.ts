/**
 * tests/unit/ble-ingest-auth.test.ts
 *
 * POST /api/assets/ble/ingest is public in the middleware: BLE gateway
 * hardware has no operator session, so its API key is the only credential.
 *
 * Covered:
 *  - no key → 401 before any database access
 *  - unknown key, or a real key with another gateway_code → the same 401,
 *    so responses never reveal which gateway codes exist
 *  - a valid key → the tenant comes from the gateway row; a spoofed
 *    x-tenant-id header or body tenant_id changes nothing
 *  - malformed or oversized batches → 400 / 413 before any database access
 *  - a failing statement → 500, never a success reply for unsaved data
 *
 * withWebhookTenant and the database are replaced by an in-memory model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  gateways: [] as Array<{ id: string; tenant_id: string; gateway_code: string; api_key_hash: string; is_active: boolean; location_zone: string | null; location_name: string }>,
  identifyCalls: [] as unknown[][],
  tenantStatements: [] as Array<{ sql: string; params: unknown[] }>,
  failOn: null as string | null,
}));

vi.mock('@/lib/assets/schema', () => ({ ensureAssetsSchema: async () => {} }));
vi.mock('@/lib/assets/ble-hw-schema', () => ({ ensureBleHwSchema: async () => {} }));

vi.mock('@/lib/prisma', () => {
  const record = (sql: string, params: unknown[]) => {
    state.tenantStatements.push({ sql, params });
    if (state.failOn && sql.includes(state.failOn)) throw new Error('simulated failure');
  };
  return {
    prisma: {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        record(sql, params);
        if (sql.includes('FROM ble_gateways WHERE api_key_hash')) {
          const [hash, code, tenant] = params;
          return state.gateways.filter((g) => g.api_key_hash === hash && g.gateway_code === code && g.tenant_id === tenant);
        }
        return [];
      },
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        record(sql, params);
        return 1;
      },
    },
  };
});

vi.mock('@/lib/rls', () => ({
  withWebhookTenant: async (
    _prisma: unknown,
    identify: (tx: unknown) => Promise<string | null>,
    handle: (ctx: { tx: unknown; tenantId: string }) => Promise<unknown>,
  ) => {
    const identifyTx = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        state.identifyCalls.push([sql, ...params]);
        const [hash, code] = params;
        return state.gateways
          .filter((g) => g.api_key_hash === hash && g.gateway_code === code && g.is_active !== false)
          .map((g) => ({ tenant_id: g.tenant_id }));
      },
    };
    const tenantId = await identify(identifyTx);
    if (!tenantId) return null;
    return handle({ tx: {}, tenantId });
  },
}));

import { POST } from '@/app/api/assets/ble/ingest/route';
import { NextRequest } from 'next/server';

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const KEY_A = 'bleg_' + 'a'.repeat(64);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new NextRequest('http://x/api/assets/ble/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
}
const batch = (extra: Record<string, unknown> = {}) => ({
  gateway_code: 'GW-0001',
  detections: [{ tag_mac: 'aa:bb:cc:dd:ee:ff', rssi: -70 }],
  ...extra,
});

beforeEach(() => {
  state.gateways = [{ id: 'gw-a', tenant_id: TENANT_A, gateway_code: 'GW-0001', api_key_hash: sha(KEY_A), is_active: true, location_zone: null, location_name: 'Yard' }];
  state.identifyCalls = [];
  state.tenantStatements = [];
  state.failOn = null;
});

describe('BLE ingest device authentication', () => {
  it('rejects a request with no key before touching the database', async () => {
    const res = await post(batch());
    expect(res.status).toBe(401);
    expect(state.identifyCalls).toHaveLength(0);
    expect(state.tenantStatements).toHaveLength(0);
  });

  it('gives the same 401 for an unknown key and for a real key with another gateway_code', async () => {
    const unknown = await post(batch(), { 'X-Gateway-Key': 'bleg_' + '0'.repeat(64) });
    const otherCode = await post(batch({ gateway_code: 'GW-0002' }), { 'X-Gateway-Key': KEY_A });
    expect(unknown.status).toBe(401);
    expect(otherCode.status).toBe(401);
    expect(await unknown.json()).toEqual(await otherCode.json());
    expect(state.tenantStatements).toHaveLength(0);
  });

  it('rejects a disabled gateway with the same 401', async () => {
    state.gateways[0].is_active = false;
    const res = await post(batch(), { 'X-Gateway-Key': KEY_A });
    expect(res.status).toBe(401);
  });

  it('identifies by key hash and gateway code, never by the plain key', async () => {
    await post(batch(), { 'X-Gateway-Key': KEY_A });
    expect(state.identifyCalls).toHaveLength(1);
    const [sql, ...params] = state.identifyCalls[0];
    expect(sql).toContain('api_key_hash = $1');
    expect(params).toEqual([sha(KEY_A), 'GW-0001']);
    expect(params).not.toContain(KEY_A);
  });

  it('takes the tenant from the gateway row, ignoring a spoofed header and body tenant', async () => {
    const res = await post(
      batch({ tenant_id: TENANT_B, tenantId: TENANT_B }),
      { 'X-Gateway-Key': KEY_A, 'x-tenant-id': TENANT_B },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).detections_received).toBe(1);
    const tenantArgs = state.tenantStatements.flatMap((s) => s.params).filter((p) => p === TENANT_A || p === TENANT_B);
    expect(tenantArgs.length).toBeGreaterThan(0);
    expect(tenantArgs.every((p) => p === TENANT_A)).toBe(true);
  });

  it('still accepts the key in the body for devices already deployed', async () => {
    const res = await post(batch({ api_key: KEY_A }));
    expect(res.status).toBe(200);
  });

  it('rejects malformed and oversized batches before touching the database', async () => {
    const bad = await post(batch({ detections: [{ rssi: -70 }] }), { 'X-Gateway-Key': KEY_A });
    const big = await post(batch({ detections: Array.from({ length: 1001 }, () => ({ tag_mac: 'x' })) }), { 'X-Gateway-Key': KEY_A });
    expect(bad.status).toBe(400);
    expect(big.status).toBe(413);
    expect(state.identifyCalls).toHaveLength(0);
  });

  it('reports a failed save as 500 instead of success', async () => {
    state.failOn = 'INSERT INTO ble_detections';
    const res = await post(batch(), { 'X-Gateway-Key': KEY_A });
    expect(res.status).toBe(500);
  });
});
