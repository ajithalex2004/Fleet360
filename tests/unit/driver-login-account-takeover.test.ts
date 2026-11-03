import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The Driver Hub must never link to, or set the password of, an account that
// is not this tenant's own driver login; and its list stays in one tenant.
const h = vi.hoisted(() => ({
  users: [] as Array<Record<string, unknown>>,
  platformCalls: [] as string[],
  driverCreate: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'drv-new', ...args.data })),
  driverFindMany: vi.fn(async (args: { where: Record<string, unknown> }) => { void args; return [] as unknown[]; }),
  rawWrites: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock('next/server', async () => await import('next/server.js'));

const tx = {
  user: {
    findMany: vi.fn(async () => h.users),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data })),
    update: vi.fn(async (args: { where: { id: string } }) => ({ id: args.where.id, email: 'x', username: 'x' })),
  },
  driver: { create: h.driverCreate, findMany: h.driverFindMany },
  role: { findFirst: vi.fn(async () => null) },
  userTenant: { upsert: vi.fn(async () => ({})) },
  $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
    h.rawWrites.push({ sql, params });
    return 1;
  }),
  $queryRawUnsafe: vi.fn(async () => []),
};

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn((_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx)),
  withPlatformAdmin: vi.fn(async (_p: unknown, fn: (t: unknown) => unknown) => {
    h.platformCalls.push(String(fn).slice(0, 60));
    return fn(tx);
  }),
}));
vi.mock('@/lib/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenant-context')>();
  return { ...actual, requireAuthorizedTenant: vi.fn(() => ({ ok: true, tenantId: 'tenant-a', userId: 'u-admin', role: 'ADMIN' })) };
});

const { findLinkableDriverUser } = await import('@/lib/drivers/driver-login-user');
const { GET, POST } = await import('@/app/api/drivers/route');

const victim = {
  id: 'u-super', email: 'owner@fleet360.ae', username: 'owner', userType: 'ADMIN',
  firstName: 'O', lastName: 'W', mobileNumber: null, employeeId: null, hierarchy: null, position: null,
  userTenants: [{ tenantId: 'tenant-b', role: { code: 'SUPER_ADMIN', name: 'Super Admin' } }],
};
const ownDriver = {
  id: 'drv-1', email: 'd1@a.ae', username: 'd1', userType: 'DRIVER',
  firstName: 'D', lastName: '1', mobileNumber: null, employeeId: null, hierarchy: null, position: 'Driver',
  userTenants: [{ tenantId: 'tenant-a', role: { code: 'DRIVER', name: 'Driver' } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.users = [];
  h.platformCalls = [];
  h.rawWrites = [];
});

describe('which login a driver profile may take over', () => {
  it('refuses an account of another tenant, an admin, or a non-driver', async () => {
    h.users = [victim];
    expect((await findLinkableDriverUser('tenant-a', { email: 'owner@fleet360.ae' })).kind).toBe('conflict');

    h.users = [{ ...ownDriver, userType: 'STAFF' }];
    expect((await findLinkableDriverUser('tenant-a', { email: 'd1@a.ae' })).kind).toBe('conflict');

    h.users = [{ ...ownDriver, userTenants: [...ownDriver.userTenants, { tenantId: 'tenant-b', role: { code: 'DRIVER', name: 'Driver' } }] }];
    expect((await findLinkableDriverUser('tenant-a', { email: 'd1@a.ae' })).kind).toBe('conflict');

    h.users = [{ ...ownDriver, userTenants: [{ tenantId: 'tenant-a', role: { code: 'ADMIN', name: 'Admin' } }] }];
    expect((await findLinkableDriverUser('tenant-a', { email: 'd1@a.ae' })).kind).toBe('conflict');
  });

  it('links this tenant\'s own driver login, and nothing when nothing matches', async () => {
    h.users = [ownDriver];
    const m = await findLinkableDriverUser('tenant-a', { email: 'd1@a.ae' });
    expect(m.kind).toBe('linkable');
    h.users = [];
    expect((await findLinkableDriverUser('tenant-a', { email: 'new@a.ae' })).kind).toBe('none');
  });
});

describe('POST /api/drivers', () => {
  const create = (body: Record<string, unknown>) =>
    POST(new NextRequest('http://localhost/api/drivers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

  it('refuses another account\'s email before writing anything, and never sets its password', async () => {
    h.users = [victim];
    const res = await create({ name: 'Fake Driver', licenseNumber: 'L-1', email: 'owner@fleet360.ae', password: 'Attacker#Pass123' });
    expect(res.status).toBe(409);
    expect(h.driverCreate).not.toHaveBeenCalled();
    expect(h.rawWrites.some((w) => /password_hash/.test(w.sql))).toBe(false);
  });
});

describe('GET /api/drivers stays in the caller\'s tenant', () => {
  it('reads drivers only through the tenant transaction, filtered by tenant, even with includeLogistics', async () => {
    await GET(new NextRequest('http://localhost/api/drivers?includeLogistics=true'));
    for (const [args] of h.driverFindMany.mock.calls as Array<[{ where: Record<string, unknown> }]>) {
      expect(args.where.tenantId).toBe('tenant-a');
    }
    expect(h.driverFindMany).toHaveBeenCalledTimes(1);
    // The only platform-context statement is the driver-user sync, scoped to this tenant.
    const sync = h.rawWrites.filter((w) => /INSERT INTO drivers/.test(w.sql));
    expect(sync).toHaveLength(1);
    expect(sync[0].sql).toMatch(/ut\."tenantId" = \$1/);
    expect(sync[0].sql.toLowerCase()).not.toContain('trexla');
    // No deletes or un-deletes on a list request.
    expect(h.rawWrites.some((w) => /DELETE FROM drivers|deleted_at = NULL/.test(w.sql))).toBe(false);
  });
});
