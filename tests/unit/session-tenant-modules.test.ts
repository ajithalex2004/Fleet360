/**
 * tests/unit/session-tenant-modules.test.ts
 *
 * Sustainability, finance branch reports, maintenance and dispatch act for
 * the signed-in tenant only.
 *
 * They used to take the tenant from the query string or body, or fall back
 * to 'default'. So Sustainability settings saved under 'default' and always
 * read defaults. The branch P&L and VAT reports refused to run without
 * ?tenantId. Warranties, PM plans and claims were created with an empty
 * tenant, and dispatch weights with none; row level security refuses both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';

const rec = vi.hoisted(() => ({
  raw: [] as Array<{ sql: string; args: unknown[] }>,
  creates: [] as Array<{ model: string; data: Record<string, unknown> }>,
}));

const tx = vi.hoisted(() => {
  const raw = async (sql: string, ...args: unknown[]) => { rec.raw.push({ sql, args }); return [{ id: 'x1', name: 'Acme' }]; };
  const model = (name: string) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      rec.creates.push({ model: name, data });
      return { id: `${name}-1`, ...data };
    },
    findMany: async () => [],
  });
  return {
    $queryRawUnsafe: raw,
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) => { await raw(sql, ...args); return 1; },
    vehicleWarranty: {
      ...model('vehicleWarranty'),
      findUnique: async ({ where }: { where: { id: string } }) =>
        ({ id: where.id, isActive: true, startDate: new Date('2026-01-01'), expiryDate: new Date('2030-01-01') }),
    },
    vehicle: { findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id }) },
    maintenancePlan: model('maintenancePlan'),
    warrantyClaim: model('warrantyClaim'),
  };
});
vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx),
}));
vi.mock('@/lib/dispatch/schema', () => ({ ensureDispatchSchema: async () => {}, DEFAULT_WEIGHTS: {} }));
vi.mock('@/lib/dispatch/merge-trigger', () => ({
  expireOldSuggestions: async () => 0, expireOrphanedSuggestions: async () => 0,
}));
vi.mock('@/lib/maintenance/publish-event', () => ({ publishWarrantyClaimRaised: vi.fn(async () => {}) }));
vi.mock('@/lib/agents/schema', () => ({ ensureAgentSchema: async () => {} }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));

import { NextRequest } from 'next/server';
import * as settings from '@/app/api/sustainability/settings/route';
import * as branchPl from '@/app/api/finance/branch-pl/route';
import * as vatBranch from '@/app/api/finance/vat-branch/route';
import * as warranties from '@/app/api/maintenance/warranties/route';
import * as pmPlans from '@/app/api/maintenance/pm-plans/route';
import * as claims from '@/app/api/maintenance/warranty-claims/route';
import * as weights from '@/app/api/dispatch/weights/route';
import * as merges from '@/app/api/dispatch/merge-suggestions/route';
import * as ecosystem from '@/app/api/agents/ecosystem/route';
import { publishWarrantyClaimRaised } from '@/lib/maintenance/publish-event';

const headers = { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };

const req = (path: string, init: { method?: string; body?: Record<string, unknown> } = {}) =>
  new NextRequest(`http://localhost/api/${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

/** Every raw query that names tenant_id is bound to the session tenant, never 'default' or another. */
function expectRawSessionTenant() {
  const scoped = rec.raw.filter((c) => /tenant_id/.test(c.sql));
  expect(scoped.length, 'no tenant-scoped query ran').toBeGreaterThan(0);
  for (const c of scoped) expect(c.args, c.sql).toContain(TENANT);
  for (const c of rec.raw) {
    expect(c.args, c.sql).not.toContain(OTHER);
    expect(c.args, c.sql).not.toContain('default');
  }
}

beforeEach(() => { rec.raw = []; rec.creates = []; vi.mocked(publishWarrantyClaimRaised).mockClear(); });

describe('sustainability settings', () => {
  it('reads the session tenant', async () => {
    const res = await settings.GET(req('sustainability/settings'));
    expect(res.status).toBe(200);
    expectRawSessionTenant();
  });

  it("saves under the session tenant, not 'default' or the body's", async () => {
    const res = await settings.POST(req('sustainability/settings', {
      method: 'POST', body: { tenant_id: OTHER, tenantId: OTHER, org_name: 'Acme', baseline_year: 2024 },
    }));
    expect(res.status).toBe(200);
    const insert = rec.raw.find((c) => c.sql.includes('INSERT INTO sustainability_settings'))!;
    expect(insert.args[0]).toBe(TENANT);
    expectRawSessionTenant();
  });
});

describe('finance branch reports run for the session tenant without ?tenantId', () => {
  it.each([
    ['branch P&L', () => branchPl.GET(req('finance/branch-pl?startDate=2026-09-01&endDate=2026-09-30'))],
    ['VAT by branch', () => vatBranch.GET(req('finance/vat-branch?quarter=Q3-2026'))],
  ])('%s', async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(200);
    expectRawSessionTenant();
  });

  it('refuses ?tenantId naming another tenant', async () => {
    const res = await branchPl.GET(req(`finance/branch-pl?tenantId=${OTHER}`));
    expect(res.status).toBe(403);
    expect(rec.raw).toHaveLength(0);
  });
});

describe('maintenance records are created for the session tenant', () => {
  it.each([
    ['warranty', 'vehicleWarranty', () => warranties.POST(req('maintenance/warranties', {
      method: 'POST', body: { tenantId: OTHER, vehicleId: 'v1', warrantyType: 'MANUFACTURER', startDate: '2026-01-01', expiryDate: '2027-01-01' },
    }))],
    ['PM plan', 'maintenancePlan', () => pmPlans.POST(req('maintenance/pm-plans', {
      method: 'POST', body: { tenantId: OTHER, name: '10k service' },
    }))],
    ['warranty claim', 'warrantyClaim', () => claims.POST(req('maintenance/warranty-claims', {
      method: 'POST', body: { tenantId: OTHER, warrantyId: 'w1', description: 'Sensor', claimDate: '2026-09-01' },
    }))],
  ])('%s', async (_name, model, call) => {
    const res = await call();
    expect(res.status).toBe(201);
    expect(rec.creates).toEqual([{ model, data: expect.objectContaining({ tenantId: TENANT }) }]);
  });

  it('publishes the claim event under the session tenant', async () => {
    await claims.POST(req('maintenance/warranty-claims', { method: 'POST', body: { warrantyId: 'w1', description: 'Sensor', claimDate: '2026-09-01' } }));
    expect(publishWarrantyClaimRaised).toHaveBeenCalledWith('warrantyClaim-1', TENANT, expect.objectContaining({ tenantId: TENANT }));
  });
});

describe('dispatch', () => {
  it('saves weights under the session tenant, not a platform-wide row', async () => {
    const res = await weights.PUT(req('dispatch/weights', {
      method: 'PUT', body: { tenantId: OTHER, serviceType: 'AMBULANCE', priority: 'P1', weights: { eta: 1 } },
    }));
    expect(res.status).toBeLessThan(400);
    const insert = rec.raw.find((c) => c.sql.includes('INSERT INTO dispatch_weights'))!;
    expect(insert.args[0]).toBe(TENANT);
  });

  it('reads weights for the session tenant (and platform defaults)', async () => {
    await weights.GET(req('dispatch/weights'));
    expectRawSessionTenant();
  });

  it('lists merge suggestions without ?tenantId', async () => {
    const res = await merges.GET(req('dispatch/merge-suggestions'));
    expect(res.status).toBe(200);
    expectRawSessionTenant();
  });

  it('acts on a merge suggestion without a body tenant', async () => {
    const res = await merges.PATCH(req('dispatch/merge-suggestions', {
      method: 'PATCH', body: { suggestionId: 's1', action: 'SKIP' },
    }));
    expect(res.status).toBeLessThan(400);
    expectRawSessionTenant();
  });
});

describe('agents ecosystem', () => {
  it("refuses an unauthenticated caller instead of showing 'default'", async () => {
    const res = await ecosystem.GET(new NextRequest('http://localhost/api/agents/ecosystem'));
    expect(res.status).toBe(401);
    expect(rec.raw).toHaveLength(0);
  });
});
