/**
 * Session revocation within 60 s: a role or membership change, a
 * deactivation, a password reset or "sign out everywhere" invalidates the
 * sessions issued before it, re-checked at most every REVOCATION_RECHECK_MS.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  kv: new Map<string, string | number>(),
  mgetCalls: 0,
  failNext: false,
  configured: true,
  sql: [] as unknown[][],
  audits: [] as unknown[],
}));

vi.mock('@/lib/upstash', () => ({
  getRedis: () => (store.configured ? {
    mget: async (...keys: string[]) => {
      store.mgetCalls++;
      if (store.failNext) { store.failNext = false; throw new Error('redis down'); }
      return keys.map((k) => store.kv.get(k) ?? null);
    },
    get: async () => null,
    set: async (k: string, v: string | number) => { store.kv.set(k, v); return 'OK'; },
  } : null),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (tx: unknown) => unknown) => fn({
    $executeRawUnsafe: async (...args: unknown[]) => { store.sql.push(args); return 1; },
    role: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'tenant-role' ? { tenantId: 't1' } : where.id === 'platform-role' ? { tenantId: null } : null) },
    userTenant: { findMany: async () => [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u1' }] },
  }),
}));
vi.mock('@/lib/audit', () => ({ logAudit: async (a: unknown) => { store.audits.push(a); } }));

// tests/setup.ts loads the session module (and the real Redis client) before
// this file's mocks exist; import fresh copies that see the mocks.
let signSession: typeof import('@/lib/tenant-session').signSession;
let verifySession: typeof import('@/lib/tenant-session').verifySession;
let clearRevocationCache: typeof import('@/lib/auth/revocation-check').clearRevocationCache;
let isRevokedSince: typeof import('@/lib/auth/revocation-check').isRevokedSince;
let REVOCATION_RECHECK_MS: number;
let holdersOfRole: typeof import('@/lib/auth/session-revocation').holdersOfRole;
let revokeRoleHolders: typeof import('@/lib/auth/session-revocation').revokeRoleHolders;
let revokeSessions: typeof import('@/lib/auth/session-revocation').revokeSessions;

beforeAll(async () => {
  vi.resetModules();
  ({ signSession, verifySession } = await import('@/lib/tenant-session'));
  ({ clearRevocationCache, isRevokedSince, REVOCATION_RECHECK_MS } = await import('@/lib/auth/revocation-check'));
  ({ holdersOfRole, revokeRoleHolders, revokeSessions } = await import('@/lib/auth/session-revocation'));
});

beforeEach(() => {
  store.kv.clear();
  store.mgetCalls = 0;
  store.failNext = false;
  store.configured = true;
  store.sql = [];
  store.audits = [];
  clearRevocationCache();
});

describe('revocation check', () => {
  const T0 = 1_800_000_000_000;

  it('revokes sessions issued before the latest of the user, tenant and user-in-tenant moments', async () => {
    store.kv.set('sess:nbf:u:u1', T0);
    expect(await isRevokedSince('u1', 't1', T0 - 1, T0 + 1)).toBe(true);
    expect(await isRevokedSince('u1', 't1', T0, T0 + 1)).toBe(false);
    clearRevocationCache();
    store.kv.set('sess:nbf:t:t2', T0 + 5000);
    expect(await isRevokedSince('u9', 't2', T0 + 4000, T0 + 6000)).toBe(true);
    clearRevocationCache();
    store.kv.set('sess:nbf:ut:u3:t3', T0);
    expect(await isRevokedSince('u3', 't3', T0 - 10, T0)).toBe(true);
    expect(await isRevokedSince('u3', 'other', T0 - 10, T0)).toBe(false);
  });

  it('re-reads Redis at most once per interval, so a revocation lands within 60 s', async () => {
    expect(REVOCATION_RECHECK_MS).toBe(60_000);
    const issued = T0;
    expect(await isRevokedSince('u1', 't1', issued, T0 + 1000)).toBe(false);
    store.kv.set('sess:nbf:u:u1', T0 + 2000);                       // revoked elsewhere
    expect(await isRevokedSince('u1', 't1', issued, T0 + 30_000)).toBe(false);  // cached
    expect(await isRevokedSince('u1', 't1', issued, T0 + 61_001)).toBe(true);   // re-read
    expect(store.mgetCalls).toBe(2);
  });

  it('keeps the last known value when Redis errors, and allows when Redis is not configured', async () => {
    store.kv.set('sess:nbf:u:u1', T0);
    expect(await isRevokedSince('u1', 't1', T0 - 1, T0 + 1)).toBe(true);
    store.failNext = true;
    expect(await isRevokedSince('u1', 't1', T0 - 1, T0 + 120_000)).toBe(true);
    clearRevocationCache();
    store.configured = false;
    expect(await isRevokedSince('u1', 't1', T0 - 1, T0 + 1)).toBe(false);
  });
});

describe('verifySession', () => {
  it('rejects a session issued before a revocation, accepts one issued after', async () => {
    const before = await signSession({ userId: 'u1', tenantId: 't1', plan: 'PRO', role: 'VIEWER', permissions: [] });
    expect(await verifySession(before)).not.toBeNull();

    await new Promise((r) => setTimeout(r, 2));
    await revokeSessions({ userId: 'u1', reason: 'role-changed' });
    expect(await verifySession(before)).toBeNull();

    await new Promise((r) => setTimeout(r, 2));
    const after = await signSession({ userId: 'u1', tenantId: 't1', plan: 'PRO', role: 'VIEWER', permissions: [] });
    expect(await verifySession(after)).not.toBeNull();
  });

  it('revokes a tenant-wide scope for every user in the tenant, not other tenants', async () => {
    const a = await signSession({ userId: 'ua', tenantId: 't1', plan: 'PRO', role: 'VIEWER' });
    const b = await signSession({ userId: 'ub', tenantId: 't2', plan: 'PRO', role: 'VIEWER' });
    await new Promise((r) => setTimeout(r, 2));
    await revokeSessions({ tenantId: 't1', reason: 'tenant-deactivated' });
    expect(await verifySession(a)).toBeNull();
    expect(await verifySession(b)).not.toBeNull();
  });
});

describe('revokeSessions', () => {
  it('records the revocation durably, mirrors it to Redis and audits it', async () => {
    await revokeSessions({ userId: 'u1', tenantId: 't1', reason: 'membership-removed', revokedBy: 'admin' });
    expect(String(store.sql[0][0])).toMatch(/INSERT INTO session_revocations/);
    expect(store.sql[0].slice(1, 3)).toEqual(['u1', 't1']);
    expect(store.kv.has('sess:nbf:ut:u1:t1')).toBe(true);
    expect(store.audits[0]).toMatchObject({ tenantId: 't1', entityType: 'Session', userId: 'admin' });
  });

  it('refuses an empty scope', async () => {
    await expect(revokeSessions({ reason: 'x' })).rejects.toThrow(/userId, a tenantId/);
  });

  it('revokes a tenant role\'s tenant, and every holder of a platform role', async () => {
    await revokeRoleHolders(await holdersOfRole('tenant-role'), 'role-permissions-changed');
    expect(store.kv.has('sess:nbf:t:t1')).toBe(true);
    await revokeRoleHolders(await holdersOfRole('platform-role'), 'role-deleted');
    expect(store.kv.has('sess:nbf:u:u1')).toBe(true);
    expect(store.kv.has('sess:nbf:u:u2')).toBe(true);
    expect(await holdersOfRole('missing')).toBeNull();
  });
});
