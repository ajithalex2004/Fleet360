/**
 * tests/unit/tenant-subscriptions-route.test.ts
 *
 * Admin > Billing & subscriptions. A platform admin could neither see nor add
 * another tenant's subscriptions: every call ran under the caller's own
 * tenant (row level security), and create always answered "tenantId is
 * required" because tenantId was stripped from the body before being read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const st = vi.hoisted(() => ({
  scope: '' as string,
  inserted: [] as unknown[][],
  tenants: new Set(['tenant-exl']),
  updatedRows: 1,
}));

const tx = vi.hoisted(() => ({
  $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
    if (sql.includes('FROM tenants WHERE id')) return st.tenants.has(String(args[0])) ? [{ id: args[0] }] : [];
    if (sql.includes('INSERT INTO tenant_module_subscriptions')) { st.inserted.push(args); return [{ id: 'sub-1' }]; }
    if (sql.includes('UPDATE tenant_module_subscriptions')) return st.updatedRows ? [{ id: args[0] }] : [];
    return [];
  },
  $executeRawUnsafe: async () => 1,
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (t: unknown) => unknown) => { st.scope = 'platform'; return fn(tx); },
  withTenantRls: async (_p: unknown, tenantId: string, fn: (t: unknown) => unknown) => { st.scope = `tenant:${tenantId}`; return fn(tx); },
}));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: (h: unknown) => h }));
vi.mock('@/lib/tenant-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-context')>('@/lib/tenant-context');
  return {
    ...actual,
    requireAuthorizedTenant: (req: { headers: Headers }) =>
      ({ ok: true, tenantId: req.headers.get('x-tenant-id') ?? 'tenant-platform', userId: 'u1', role: req.headers.get('x-user-role') }),
  };
});

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tenant-subscriptions/route';

const req = (method: string, role: string, body?: unknown, query = '') =>
  new NextRequest(`http://x/api/tenant-subscriptions${query}`, {
    method,
    headers: { 'x-user-role': role, 'x-tenant-id': role === 'SUPER_ADMIN' ? 'tenant-platform' : 'tenant-exl', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const create = { tenantId: 'tenant-exl', moduleCode: 'RAC', basePrice: 1500, billingCycle: 'MONTHLY' };

beforeEach(() => { st.scope = ''; st.inserted = []; st.updatedRows = 1; });

describe('tenant subscriptions', () => {
  it('lets a platform admin add a subscription for another tenant', async () => {
    const res = await POST(req('POST', 'SUPER_ADMIN', create));
    expect(res.status).toBe(201);
    expect(st.scope).toBe('platform');
    expect(st.inserted[0].slice(0, 2)).toEqual(['tenant-exl', 'RAC']);
  });

  it('shows a platform admin every tenant, and a tenant only itself', async () => {
    await GET(req('GET', 'SUPER_ADMIN'));
    expect(st.scope).toBe('platform');
    await GET(req('GET', 'TENANT_ADMIN'));
    expect(st.scope).toBe('tenant:tenant-exl');
  });

  it('does not let a tenant change its own subscriptions', async () => {
    const res = await POST(req('POST', 'TENANT_ADMIN', create));
    expect(res.status).toBe(403);
    expect(st.inserted).toHaveLength(0);
  });

  it('rejects an unknown tenant, module, price or billing cycle', async () => {
    expect((await POST(req('POST', 'SUPER_ADMIN', { ...create, tenantId: 'nope' }))).status).toBe(404);
    expect((await POST(req('POST', 'SUPER_ADMIN', { ...create, moduleCode: 'FLEET' }))).status).toBe(400);
    expect((await POST(req('POST', 'SUPER_ADMIN', { ...create, basePrice: -5 }))).status).toBe(400);
    expect((await POST(req('POST', 'SUPER_ADMIN', { ...create, billingCycle: 'WEEKLY' }))).status).toBe(400);
    expect((await POST(req('POST', 'SUPER_ADMIN', { ...create, tenantId: undefined }))).status).toBe(400);
    expect(st.inserted).toHaveLength(0);
  });

  it('reports a missing subscription instead of claiming success', async () => {
    st.updatedRows = 0;
    expect((await POST(req('POST', 'SUPER_ADMIN', { action: 'suspend', id: 'missing' }))).status).toBe(404);
    expect((await POST(req('POST', 'SUPER_ADMIN', { action: 'cancel', id: 'missing' }))).status).toBe(404);
  });
});
