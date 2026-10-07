/**
 * tests/unit/invitation-roles.test.ts
 *
 * Admin > Tenants > Invitations listed only roles owned by the tenant. The
 * real roles (Tenant Administrator, Fleet Manager, …) are platform roles
 * with no tenant, so a new tenant's Role dropdown was empty.
 */
import { describe, it, expect, vi } from 'vitest';

const db = vi.hoisted(() => ({ roleWhere: null as unknown }));
const tx = {
  $queryRawUnsafe: async () => [],
  role: {
    findMany: async (args: { where: unknown }) => {
      db.roleWhere = args.where;
      return [
        { id: 'r1', name: 'Fleet Manager', code: 'FLEET_MANAGER', tenantId: null, _count: { permissions: 20 } },
        { id: 'r2', name: 'Tenant Administrator', code: 'TENANT_ADMIN', tenantId: null, _count: { permissions: 89 } },
        { id: 'r3', name: 'Depot Lead', code: 'DEPOT_LEAD', tenantId: 'tenant-1', _count: { permissions: 4 } },
      ];
    },
  },
};
vi.mock('next/server', () => ({
  NextResponse: { json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => data }) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
  withTenantRls: async (_p: unknown, _t: string, fn: (t: typeof tx) => unknown) => fn(tx),
}));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: (h: unknown) => h }));

import { GET } from '@/app/api/admin/tenants/[id]/invitations/route';

describe('GET /api/admin/tenants/[id]/invitations', () => {
  it('returns the tenant and platform roles an invitation can grant, never SUPER_ADMIN', async () => {
    const res = await (GET as unknown as (r: unknown, c: unknown) => Promise<{ status: number; json: () => Promise<{ roles: Array<{ code: string; scope: string; permissionCount: number }> }> }>)(
      {
        headers: new Headers({ 'x-user-role': 'SUPER_ADMIN', 'x-user-id': 'admin', 'x-tenant-id': 'platform-tenant' }),
        nextUrl: new URL('http://localhost/api/admin/tenants/tenant-1/invitations'),
      },
      { params: Promise.resolve({ id: 'tenant-1' }) },
    );
    expect(res.status).toBe(200);
    const { roles } = await res.json();
    expect(roles.map(r => [r.code, r.scope])).toEqual([
      ['FLEET_MANAGER', 'platform'], ['TENANT_ADMIN', 'platform'], ['DEPOT_LEAD', 'tenant'],
    ]);
    expect(roles[1].permissionCount).toBe(89);
    expect(db.roleWhere).toEqual({ OR: [{ tenantId: 'tenant-1' }, { tenantId: null }], NOT: { code: 'SUPER_ADMIN' } });
  });
});
