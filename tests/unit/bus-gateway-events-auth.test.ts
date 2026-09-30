/**
 * tests/unit/bus-gateway-events-auth.test.ts
 *
 * POST /api/bus-ops/gateway/events is public in the middleware: in-bus BLE
 * gateways have no operator session and sign the raw body with HMAC-SHA256
 * instead. The route used to demand session tenant headers first, which the
 * middleware strips, so every real device was refused before its signature
 * was checked.
 *
 * Covered:
 *  - no session headers at all + valid signature → accepted, and the work
 *    runs under the gateway's own tenant, whatever x-tenant-id says
 *  - bad signature, unknown gateway, disabled gateway, gateway without a
 *    tenant → the same 401, and no tenant-scoped work starts
 *  - a gateway not mounted on a vehicle → 409
 *
 * The real signature check (src/lib/bus-gateway.ts) is used; the database
 * and withWebhookTenant are replaced by an in-memory model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  gateways: [] as Array<{ gatewayId: string; tenantId: string | null; isActive: boolean; secret: string | null; vehicleId: string | null }>,
  scopedTenants: [] as string[],
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {} }));
vi.mock('@/lib/bus-ops/passenger-attendance', () => ({ recordBoarding: async () => {}, logAlightEvent: async () => {} }));

vi.mock('@/lib/rls', () => {
  const find = (gatewayId: string, tenant: string | null) =>
    state.gateways.find((g) => g.gatewayId === gatewayId && (tenant === null || g.tenantId === tenant)) ?? null;
  return {
    withWebhookTenant: async (
      _prisma: unknown,
      identify: (tx: unknown) => Promise<string | null>,
      handle: (ctx: { tx: unknown; tenantId: string }) => Promise<unknown>,
    ) => {
      const platformTx = { bleGateway: { findUnique: async ({ where }: { where: { gatewayId: string } }) => find(where.gatewayId, null) } };
      const tenantId = await identify(platformTx);
      if (!tenantId) return null;
      state.scopedTenants.push(tenantId);
      const tenantTx = {
        bleGateway: {
          findUnique: async ({ where }: { where: { gatewayId: string } }) => find(where.gatewayId, tenantId),
          update: async () => ({}),
        },
        tripSchedule: { findFirst: async () => null },
        bleGatewayPresence: { findMany: async () => [], upsert: async () => ({}) },
      };
      return handle({ tx: tenantTx, tenantId });
    },
  };
});

import { POST } from '@/app/api/bus-ops/gateway/events/route';
import { NextRequest } from 'next/server';

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const SECRET = 'per-gateway-test-secret';

function send(body: Record<string, unknown>, opts: { secret?: string; headers?: Record<string, string> } = {}) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', opts.secret ?? SECRET).update(raw, 'utf8').digest('hex');
  return POST(new NextRequest('http://x/api/bus-ops/gateway/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gateway-signature': sig, ...opts.headers },
    body: raw,
  }));
}
const emptyBatch = (gatewayId = 'GW-BUS-1') => ({ gatewayId, events: [] });

beforeEach(() => {
  delete process.env.BLE_GATEWAY_SHARED_SECRET;
  state.gateways = [{ gatewayId: 'GW-BUS-1', tenantId: TENANT_A, isActive: true, secret: SECRET, vehicleId: 'veh-1' }];
  state.scopedTenants = [];
});

describe('bus gateway events device authentication', () => {
  it('accepts a signed request with no session and runs under the gateway tenant', async () => {
    const res = await send(emptyBatch());
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(state.scopedTenants).toEqual([TENANT_A]);
  });

  it('ignores a spoofed x-tenant-id header', async () => {
    const res = await send(emptyBatch(), { headers: { 'x-tenant-id': TENANT_B } });
    expect(res.status).toBe(200);
    expect(state.scopedTenants).toEqual([TENANT_A]);
  });

  it('gives the same 401 for a bad signature, an unknown gateway, a disabled gateway and a tenantless gateway', async () => {
    const bad = await send(emptyBatch(), { secret: 'wrong-secret' });
    const unknown = await send(emptyBatch('GW-NOPE'));
    state.gateways.push({ gatewayId: 'GW-OFF', tenantId: TENANT_A, isActive: false, secret: SECRET, vehicleId: 'veh-2' });
    const disabled = await send(emptyBatch('GW-OFF'));
    state.gateways.push({ gatewayId: 'GW-ORPHAN', tenantId: null, isActive: true, secret: SECRET, vehicleId: 'veh-3' });
    const orphan = await send(emptyBatch('GW-ORPHAN'));
    const bodies = await Promise.all([bad, unknown, disabled, orphan].map((r) => r.json()));
    expect([bad.status, unknown.status, disabled.status, orphan.status]).toEqual([401, 401, 401, 401]);
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(state.scopedTenants).toEqual([]);
  });

  it('rejects a request with no signature', async () => {
    const res = await POST(new NextRequest('http://x/api/bus-ops/gateway/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(emptyBatch()),
    }));
    expect(res.status).toBe(401);
    expect(state.scopedTenants).toEqual([]);
  });

  it('returns 409 for a gateway that is not on a vehicle', async () => {
    state.gateways[0].vehicleId = null;
    const res = await send(emptyBatch());
    expect(res.status).toBe(409);
  });
});
