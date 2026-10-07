/**
 * tests/unit/impersonate-route.test.ts
 *
 * Admin > Tenants > Impersonate posts { tenantId } for the tenant to sign
 * in as. The route stripped tenantId from the body (tenant-spoofing guard)
 * before reading it, so every attempt failed with "tenantId is required".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ tenantQueries: [] as unknown[][], members: [] as unknown[], cookies: [] as string[] }));
const tx = {
  $queryRawUnsafe: async (_sql: string, ...args: unknown[]) => {
    db.tenantQueries.push(args);
    return [{ id: args[0], name: 'EXL Solutions LLC', plan: 'STANDARD', is_active: true }];
  },
  userTenant: { findMany: async () => db.members },
};
vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
      cookies: { set: (name: string) => db.cookies.push(name) },
    }),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
  withTenantRls: async (_p: unknown, _t: string, fn: (t: typeof tx) => unknown) => fn(tx),
}));
vi.mock('@/lib/tenant-session', () => ({ signSession: async () => 'signed-token' }));
vi.mock('@/lib/authz/session-permissions', () => ({ resolveSessionPermissions: async () => [] }));
vi.mock('@/lib/db-router', () => ({ residencyClaimForTenant: async () => ({}) }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }));
vi.mock('@/lib/sentry', () => ({ captureException: () => undefined }));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: (h: unknown) => h }));

import { POST } from '@/app/api/admin/impersonate/route';

const TARGET = '45eb28d1-5b53-47ef-8d94-c3adbaec06f2';
const call = (body: unknown) => (POST as unknown as (r: unknown) => Promise<{ status: number; json: () => Promise<{ error?: string; asUser?: { email: string } }> }>)({
  headers: new Headers({
    'x-user-role': 'SUPER_ADMIN',
    'x-user-id': 'platform-admin',
    'x-tenant-id': '00000000-0000-0000-0000-000000000001',
  }),
  nextUrl: new URL('http://localhost/api/admin/impersonate'),
  json: async () => body,
  cookies: { get: () => ({ value: 'admin-token' }) },
});

beforeEach(() => { db.tenantQueries = []; db.members = []; db.cookies = []; });

describe('POST /api/admin/impersonate', () => {
  it('impersonates the tenant named in the body', async () => {
    db.members = [{ user: { id: 'u1', email: 'admin@exl.ae', isActive: true }, role: { code: 'TENANT_ADMIN' } }];
    const res = await call({ tenantId: TARGET });
    const data = await res.json();
    expect(res.status, JSON.stringify(data)).toBe(200);
    expect(db.tenantQueries[0][0]).toBe(TARGET);
    expect(data.asUser?.email).toBe('admin@exl.ae');
    expect(db.cookies).toEqual(['xl-session', 'xl-impersonator-session']);
  });

  it('explains when the tenant has no users to sign in as', async () => {
    const res = await call({ tenantId: TARGET });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('no active users');
  });

  it('still requires a tenant', async () => {
    const res = await call({});
    expect(res.status).toBe(400);
  });
});
