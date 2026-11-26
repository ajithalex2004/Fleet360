/**
 * Track C — Durable Session Revocation & Go Backend JWT Parity Acceptance Suite
 *
 * Covers all 7 Module 1 Track C acceptance categories:
 *  1. Durable PostgreSQL state (`revoked_session_tokens`) & bounded expired-row pruning
 *  2. Atomic logout across `xl-session`, `xl-driver-session`, `xl-impersonator-session`,
 *     and Go HS256 `Authorization: Bearer <jwt>`, idempotency, DB-failure 503, CSRF 403
 *  3. Paired Next.js <-> Go `sid`/`jti` parity & proxy `iat` preservation (no `iat` laundering)
 *  4. Shared claim semantics (`sid`/`jti`, `sub`, `tenant_id`, `role`, `iat`, `exp`, `perms`, `impersonated_by`)
 *  5. Redis outage & recovery (logout during Redis outage -> Postgres persists -> prod fails closed ->
 *     after Redis recovers with empty key, copied token is STILL rejected via Postgres & self-heals Redis)
 *  6. Multi-device vs single-device logout (`sidA` revoked while `sidB` stays valid; `logout-all` revokes both)
 *  7. Cross-tenant RLS policy invariants + impersonation stop durable revocation & resurrection defense
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';

interface RevokedTokenRow {
  token_key: string;
  user_id: string;
  tenant_id: string;
  expires_at: Date;
  revoked_at: Date;
  reason: string;
  redis_synced_at: Date | null;
}

interface ScopeRevocationRow {
  user_id: string | null;
  tenant_id: string | null;
  not_before: Date;
  reason: string;
}

const { state, mockRedis, mockPrisma, mockWithPlatformAdmin, mockWithTenantRls, mockLogAudit } = vi.hoisted(() => {
  const kv = new Map<string, string | number>();
  const revokedTokens = new Map<string, RevokedTokenRow>();
  const scopeRevocations: ScopeRevocationRow[] = [];

  const st = {
    redisEnabled: true,
    redisFailMode: false,
    pgFailWrites: false,
    pgFailReads: false,
    currentRlsTenant: '*' as string,
    kv,
    revokedTokens,
    scopeRevocations,
    lastPruneLimit: 0,
  };

  const redis = {
    get: vi.fn(async (key: string) => {
      if (st.redisFailMode) throw new Error('Upstash ECONNREFUSED');
      const v = kv.get(key);
      return v === undefined ? null : String(v);
    }),
    set: vi.fn(async (key: string, val: string | number) => {
      if (st.redisFailMode) throw new Error('Upstash ECONNREFUSED');
      kv.set(key, val);
      return 'OK';
    }),
    mget: vi.fn(async (...keys: string[]) => {
      if (st.redisFailMode) throw new Error('Upstash ECONNREFUSED');
      return keys.map((k) => kv.get(k) ?? null);
    }),
  };

  function makeTx(rlsTenant: string) {
    return {
      $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
        if (st.pgFailWrites) throw new Error('PostgreSQL write unavailable');

        if (sql.includes('INSERT INTO public.revoked_session_tokens')) {
          // Enforce restrictive platform-only write guard in our in-memory PG model
          if (rlsTenant !== '*') {
            throw new Error('new row violates row-level security policy for table "revoked_session_tokens"');
          }
          const [token_key, user_id, tenant_id, expires_at, reason] = args as [
            string,
            string,
            string,
            Date,
            string,
          ];
          if (!revokedTokens.has(token_key)) {
            revokedTokens.set(token_key, {
              token_key,
              user_id,
              tenant_id,
              expires_at: new Date(expires_at),
              revoked_at: new Date(),
              reason,
              redis_synced_at: null,
            });
            return 1;
          }
          return 0; // ON CONFLICT DO NOTHING
        }

        if (sql.includes('UPDATE public.revoked_session_tokens') && sql.includes('SET redis_synced_at = now()')) {
          const keys = (args[0] as string[]) ?? [];
          let updated = 0;
          for (const k of keys) {
            const row = revokedTokens.get(k);
            if (row && row.redis_synced_at === null) {
              row.redis_synced_at = new Date();
              updated += 1;
            }
          }
          return updated;
        }

        if (sql.includes('DELETE FROM public.revoked_session_tokens')) {
          if (rlsTenant !== '*') {
            throw new Error('RLS violation on DELETE');
          }
          const limit = Number(args[0]) || 100;
          st.lastPruneLimit = limit;
          const now = Date.now();
          const expired = Array.from(revokedTokens.values())
            .filter((r) => r.expires_at.getTime() < now)
            .sort((a, b) => a.expires_at.getTime() - b.expires_at.getTime())
            .slice(0, limit);
          for (const row of expired) {
            revokedTokens.delete(row.token_key);
          }
          return expired.length;
        }

        if (sql.includes('INSERT INTO session_revocations')) {
          const [user_id, tenant_id, not_before, reason] = args as [
            string | null,
            string | null,
            Date,
            string,
          ];
          const idx = scopeRevocations.findIndex(
            (r) => (r.user_id ?? '') === (user_id ?? '') && (r.tenant_id ?? '') === (tenant_id ?? ''),
          );
          const next: ScopeRevocationRow = {
            user_id,
            tenant_id,
            not_before: new Date(not_before),
            reason,
          };
          if (idx >= 0) scopeRevocations[idx] = next;
          else scopeRevocations.push(next);
          return 1;
        }

        return 0;
      }),

      $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
        if (st.pgFailReads) throw new Error('PostgreSQL read unavailable');

        // Per-token check (single table or combined EXISTS query)
        if (sql.includes('FROM public.revoked_session_tokens') && !sql.includes('AS revoked')) {
          if (sql.includes('WHERE token_key = ANY($1::text[])')) {
            const keys = (args[0] as string[]) ?? [];
            const now = Date.now();
            const hits: Array<{ token_key: string; expires_at: Date }> = [];
            for (const k of keys) {
              const row = revokedTokens.get(k);
              if (!row) continue;
              // Simulate FORCE RLS SELECT policy: tenant_id = app.tenant_id OR app.tenant_id = '*'
              if (rlsTenant !== '*' && row.tenant_id !== rlsTenant) continue;
              if (row.expires_at.getTime() > now) {
                hits.push({ token_key: row.token_key, expires_at: row.expires_at });
              }
            }
            return hits.slice(0, 1);
          }
          // Rehydration / outbox keyset-paginated scan (platform admin)
          if (sql.includes('ORDER BY token_key ASC')) {
            const cursor = String(args[0] ?? '');
            const limit = Number(args[1]) || 500;
            const onlyUnsynced = sql.includes('AND redis_synced_at IS NULL');
            const now = Date.now();
            return Array.from(revokedTokens.values())
              .filter(
                (r) =>
                  (rlsTenant === '*' || r.tenant_id === rlsTenant) &&
                  r.expires_at.getTime() > now &&
                  r.token_key > cursor &&
                  (!onlyUnsynced || r.redis_synced_at === null),
              )
              .sort((a, b) => (a.token_key < b.token_key ? -1 : a.token_key > b.token_key ? 1 : 0))
              .slice(0, limit)
              .map((r) => ({ token_key: r.token_key, expires_at: r.expires_at }));
          }
        }

        // Combined EXISTS check used by POST /api/auth/session
        if (sql.includes('FROM public.revoked_session_tokens') && sql.includes('AS revoked')) {
          const [tokenKeys, tenantId, userId, issuedAt] = args as [string[], string, string, Date];
          const now = Date.now();
          const tokenHit = (tokenKeys ?? []).some((k) => {
            const row = revokedTokens.get(k);
            return Boolean(row && row.tenant_id === tenantId && row.expires_at.getTime() > now);
          });
          const scopeHit = scopeRevocations.some(
            (r) =>
              r.not_before.getTime() > new Date(issuedAt).getTime() &&
              ((r.user_id === userId && r.tenant_id === null) ||
                (r.tenant_id === tenantId && r.user_id === null) ||
                (r.user_id === userId && r.tenant_id === tenantId)),
          );
          return [{ revoked: tokenHit || scopeHit }];
        }

        // Bulk scope revocations check
        if (sql.includes('FROM public.session_revocations')) {
          if (sql.includes('ORDER BY not_before DESC') && args.length >= 2) {
            const [userId, tenantId] = args as [string, string];
            const matches = scopeRevocations
              .filter((r) => {
                if (rlsTenant !== '*' && r.tenant_id !== null && r.tenant_id !== rlsTenant) return false;
                return (
                  (r.user_id === userId && r.tenant_id === null) ||
                  (r.user_id === null && r.tenant_id === tenantId) ||
                  (r.user_id === userId && r.tenant_id === tenantId)
                );
              })
              .sort((a, b) => b.not_before.getTime() - a.not_before.getTime());
            return matches.slice(0, 1);
          }
          // Rehydration scan
          const limit = Number(args[0]) || 500;
          return scopeRevocations.slice(0, limit);
        }

        if (sql.includes('FROM tenants WHERE id = $1')) {
          return [{ name: 'Tenant Alpha', code: 'ALPHA', default_language: 'en' }];
        }
        return [];
      }),

      userTenant: {
        findUnique: vi.fn(async ({ where }: { where: { userId_tenantId: { userId: string; tenantId: string } } }) => ({
          isActive: true,
          tenant: {
            id: where.userId_tenantId.tenantId,
            name: 'Tenant Alpha',
            code: 'ALPHA',
            plan: 'ENTERPRISE',
            domain: 'alpha.test',
            isActive: true,
            modules: [],
          },
          user: {
            id: where.userId_tenantId.userId,
            username: 'alice',
            email: 'alice@alpha.test',
            firstName: 'Alice',
            lastName: 'Admin',
            isActive: true,
          },
          role: { id: 'role-1', name: 'Tenant Admin', code: 'TENANT_ADMIN' },
        })),
      },
    };
  }

  const rootPrisma = makeTx('*');

  return {
    state: st,
    mockRedis: redis,
    mockPrisma: rootPrisma,
    mockWithPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      st.currentRlsTenant = '*';
      return fn(makeTx('*'));
    }),
    mockWithTenantRls: vi.fn(async (_p: unknown, tenantId: string, fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      st.currentRlsTenant = tenantId;
      return fn(makeTx(tenantId));
    }),
    mockLogAudit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/upstash', () => ({
  getRedis: () => (state.redisEnabled ? mockRedis : null),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: mockWithPlatformAdmin,
  withTenantRls: mockWithTenantRls,
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('@/lib/branding', () => ({
  getBranding: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/module-policies', () => ({
  tenantModulesFor: vi.fn(async (mods: string[]) => mods),
}));

vi.mock('@/lib/authz/session-permissions', () => ({
  sessionPermissionsFor: vi.fn(async () => ['fleet:view:*']),
}));

vi.mock('@/lib/db-router', () => ({
  residencyClaimForTenant: vi.fn(async () => ({})),
}));

vi.mock('@/lib/logistics/drayage-domain', () => ({
  recordDrayageDriverLogout: vi.fn().mockResolvedValue(undefined),
}));

let signSession: typeof import('@/lib/tenant-session').signSession;
let verifySession: typeof import('@/lib/tenant-session').verifySession;
let tokenFingerprint: typeof import('@/lib/session-blocklist').tokenFingerprint;
let isSessionRevoked: typeof import('@/lib/session-blocklist').isSessionRevoked;
let REVOCATION_HYDRATED_KEY: string;
let clearRevocationCache: typeof import('@/lib/auth/revocation-check').clearRevocationCache;
let isRevokedSince: typeof import('@/lib/auth/revocation-check').isRevokedSince;
let signJwtForBackend: typeof import('@/lib/auth/jwt').signJwtForBackend;
let verifyJwtForBackend: typeof import('@/lib/auth/jwt').verifyJwtForBackend;
let withVerifiedIdentity: typeof import('@/lib/identity-headers').withVerifiedIdentity;
let stripIdentityHeaders: typeof import('@/lib/identity-headers').stripIdentityHeaders;
let proxyToGoBackend: typeof import('@/lib/api-shim').proxyToGoBackend;
let durable: typeof import('@/lib/auth/durable-session-revocation');
let logoutPOST: typeof import('@/app/api/auth/logout/route').POST;
let logoutAllPOST: typeof import('@/app/api/auth/logout-all/route').POST;
let sessionPOST: typeof import('@/app/api/auth/session/route').POST;
let sessionDELETE: typeof import('@/app/api/auth/session/route').DELETE;
let authMeGET: typeof import('@/app/api/auth/me/route').GET;
let impersonateStopPOST: typeof import('@/app/api/admin/impersonate/stop/route').POST;
let getDriverTenantContext: typeof import('@/lib/driver-session').getDriverTenantContext;
let vehicleLoginPOST: typeof import('@/app/api/driver-app/auth/vehicle-login/route').POST;

const TEST_SESSION_SECRET = 'track-c-session-secret-0123456789abcdef0123456789abcdef';
const TEST_JWT_SECRET = 'track-c-jwt-secret-0123456789abcdef0123456789abcdef';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUPER_ADMIN = '99999999-9999-4999-8999-999999999999';

beforeAll(async () => {
  vi.resetModules();
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  ({ signSession, verifySession } = await import('@/lib/tenant-session'));
  ({ tokenFingerprint, isSessionRevoked, REVOCATION_HYDRATED_KEY } = await import('@/lib/session-blocklist'));
  ({ clearRevocationCache, isRevokedSince } = await import('@/lib/auth/revocation-check'));
  ({ signJwtForBackend, verifyJwtForBackend } = await import('@/lib/auth/jwt'));
  ({ withVerifiedIdentity, stripIdentityHeaders } = await import('@/lib/identity-headers'));
  ({ proxyToGoBackend } = await import('@/lib/api-shim'));
  durable = await import('@/lib/auth/durable-session-revocation');
  ({ POST: logoutPOST } = await import('@/app/api/auth/logout/route'));
  ({ POST: logoutAllPOST } = await import('@/app/api/auth/logout-all/route'));
  ({ POST: sessionPOST, DELETE: sessionDELETE } = await import('@/app/api/auth/session/route'));
  ({ GET: authMeGET } = await import('@/app/api/auth/me/route'));
  ({ POST: impersonateStopPOST } = await import('@/app/api/admin/impersonate/stop/route'));
  ({ getDriverTenantContext } = await import('@/lib/driver-session'));
  ({ POST: vehicleLoginPOST } = await import('@/app/api/driver-app/auth/vehicle-login/route'));
});

beforeEach(() => {
  state.redisEnabled = true;
  state.redisFailMode = false;
  state.pgFailWrites = false;
  state.pgFailReads = false;
  state.kv.clear();
  state.kv.set(REVOCATION_HYDRATED_KEY, '1');
  state.revokedTokens.clear();
  state.scopeRevocations.length = 0;
  state.lastPruneLimit = 0;
  clearRevocationCache();
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://fleet360.example.com');
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Track C — Category 1: Durable PG state & bounded expired-row pruning', () => {
  it('persists sid + tok durably, is idempotent on duplicate writes, and prunes only expired rows up to limit', async () => {
    const sid = crypto.randomUUID();
    const activeExp = new Date(Date.now() + 60 * 60 * 1000);
    const expired1 = new Date(Date.now() - 120_000);
    const expired2 = new Date(Date.now() - 60_000);

    const r1 = await durable.revokeSessionTokensDurable([
      { tokenKey: `sid:${sid}`, userId: USER_A, tenantId: TENANT_A, expiresAt: activeExp, reason: 'logout:xl-session' },
      { tokenKey: 'tok:expired-1', userId: USER_A, tenantId: TENANT_A, expiresAt: expired1, reason: 'logout:xl-session' },
      { tokenKey: 'tok:expired-2', userId: USER_A, tenantId: TENANT_A, expiresAt: expired2, reason: 'logout:xl-session' },
    ]);
    expect(r1).toEqual({ ok: true, persistedCount: 3 });

    // Re-insert active key (idempotent ON CONFLICT DO NOTHING)
    const r2 = await durable.revokeSessionTokensDurable([
      { tokenKey: `sid:${sid}`, userId: USER_A, tenantId: TENANT_A, expiresAt: activeExp, reason: 'logout:retry' },
    ]);
    expect(r2).toEqual({ ok: true, persistedCount: 1 });

    // Re-seed two expired rows explicitly (since revokeSessionTokensDurable triggers opportunistic prune)
    state.revokedTokens.set('tok:exp-a', {
      token_key: 'tok:exp-a', user_id: USER_A, tenant_id: TENANT_A, expires_at: expired1, revoked_at: new Date(), reason: 'test', redis_synced_at: null,
    });
    state.revokedTokens.set('tok:exp-b', {
      token_key: 'tok:exp-b', user_id: USER_A, tenant_id: TENANT_A, expires_at: expired2, revoked_at: new Date(), reason: 'test', redis_synced_at: null,
    });

    // Bounded prune with limit=1 deletes only the oldest expired row, never the active row
    const deleted = await durable.pruneExpiredRevokedSessionTokens(1);
    expect(deleted).toBe(1);
    expect(state.lastPruneLimit).toBe(1);
    expect(state.revokedTokens.has(`sid:${sid}`)).toBe(true);
    expect(state.revokedTokens.has('tok:exp-a')).toBe(false);
    expect(state.revokedTokens.has('tok:exp-b')).toBe(true);
  });
});

describe('Track C — Category 2: Atomic logout across cookies + Go Bearer JWT, DB-failure 503, CSRF 403', () => {
  it('atomically revokes xl-session, xl-driver-session, xl-impersonator-session, and Go HS256 Bearer JWT', async () => {
    const sharedSid = crypto.randomUUID();
    const staffTok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'TENANT_ADMIN', sid: sharedSid });
    const driverTok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'DRIVER' });
    const impTok = await signSession({ userId: SUPER_ADMIN, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'SUPER_ADMIN' });
    const goJwtSid = crypto.randomUUID();
    const goJwt = await signJwtForBackend({ userId: USER_A, tenantId: TENANT_A, role: 'TENANT_ADMIN', sid: goJwtSid });

    const req = new NextRequest('https://fleet360.example.com/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fleet360.example.com',
        authorization: `Bearer ${goJwt}`,
        cookie: `xl-session=${staffTok}; xl-driver-session=${driverTok}; xl-impersonator-session=${impTok}`,
      },
    });

    const res = await logoutPOST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, revoked: true, durable: true, redisMirrored: true, revocationMode: 'postgres+redis', revokedCount: 4 });

    // Both Next.js paired sid and standalone Go JWT jti are durably persisted in Postgres
    expect(state.revokedTokens.has(`sid:${sharedSid}`)).toBe(true);
    expect(state.revokedTokens.has(`sid:${goJwtSid}`)).toBe(true);
    expect(state.revokedTokens.has(`tok:${await tokenFingerprint(goJwt)}`)).toBe(true);

    // Repeating logout is idempotent
    const retryRes = await sessionDELETE(new NextRequest('https://fleet360.example.com/api/auth/session', {
      method: 'DELETE',
      headers: { origin: 'https://fleet360.example.com', cookie: `xl-session=${staffTok}` },
    }));
    expect(retryRes.status).toBe(200);
  });

  it('surfaces HTTP 503 when PostgreSQL durable write fails while still clearing cookies, and 403 on CSRF', async () => {
    const tok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'TENANT_ADMIN' });

    const csrfRes = await logoutPOST(new NextRequest('https://fleet360.example.com/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example', cookie: `xl-session=${tok}` },
    }));
    expect(csrfRes.status).toBe(403);
    expect(state.revokedTokens.size).toBe(0);

    state.pgFailWrites = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failRes = await logoutPOST(new NextRequest('https://fleet360.example.com/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://fleet360.example.com', cookie: `xl-session=${tok}` },
    }));
    errSpy.mockRestore();

    expect(failRes.status).toBe(503);
    expect(await failRes.json()).toMatchObject({ ok: false, revoked: false, durable: false, cookiesCleared: true });
    expect(failRes.headers.get('set-cookie')).toContain('xl-session=;');
  });
});

describe('Track C — Category 3 & 4: Paired sid/jti parity, shared claim semantics, and no proxy iat laundering', () => {
  it('preserves shared sid -> jti and original session iat across api-shim proxy without iat laundering', async () => {
    vi.stubEnv('GO_BACKEND_URL', 'http://go-backend.internal:8080');
    const sharedSid = crypto.randomUUID();
    const session = await signSession({
      userId: USER_A,
      tenantId: TENANT_A,
      plan: 'ENTERPRISE',
      role: 'TENANT_ADMIN',
      permissions: ['fleet:view:*'],
      impersonatedBy: SUPER_ADMIN,
      sid: sharedSid,
    });
    const verified = await verifySession(session);
    expect(verified).not.toBeNull();
    expect(verified!.sid).toBe(sharedSid);

    // Simulate an older session (2 hours ago) so any fresh `now` iat laundering is caught
    const twoHoursAgoMs = Date.now() - 2 * 60 * 60 * 1000;
    const forwardedHeaders = withVerifiedIdentity(new Headers({ 'x-session-id': 'spoofed-sid' }), {
      ...verified!,
      issuedAt: twoHoursAgoMs,
    });
    expect(forwardedHeaders.get('x-session-id')).toBe(sharedSid);
    expect(forwardedHeaders.get('x-session-iat')).toBe(String(twoHoursAgoMs));

    let capturedAuthHeader = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const h = new Headers(init?.headers);
      capturedAuthHeader = h.get('authorization') ?? '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const shimReq = new NextRequest('https://fleet360.example.com/api/logistics/shipments', { method: 'GET' });
    const shimRes = await proxyToGoBackend(shimReq, forwardedHeaders, verified!.permissions);
    fetchSpy.mockRestore();

    expect(shimRes.proxied).toBe(true);
    expect(capturedAuthHeader.startsWith('Bearer ')).toBe(true);
    const proxiedJwt = capturedAuthHeader.slice(7);
    const decoded = await verifyJwtForBackend(proxiedJwt);
    expect(decoded).not.toBeNull();
    expect(decoded!.jti).toBe(sharedSid);
    expect(decoded!.userId).toBe(USER_A);
    expect(decoded!.tenantId).toBe(TENANT_A);
    expect(decoded!.role).toBe('TENANT_ADMIN');
    expect(decoded!.impersonatedBy).toBe(SUPER_ADMIN);
    // Original iat preserved (not laundered to Date.now()) while exp is short-lived (~300s)
    expect(Math.floor(decoded!.issuedAtMs / 1000)).toBe(Math.floor(twoHoursAgoMs / 1000));
    expect(decoded!.expiresAtMs - Date.now()).toBeLessThanOrEqual(305_000);
    expect(decoded!.expiresAtMs - Date.now()).toBeGreaterThan(240_000);

    // SHA-256 fingerprint parity with Go `auth.TokenFingerprint`
    const expectedNodeSha = crypto.createHash('sha256').update('fleet360-test-token').digest('hex');
    expect(await tokenFingerprint('fleet360-test-token')).toBe(expectedNodeSha);
  });
});

describe('Track C — Category 5: Redis outage & recovery (durable rejection + Redis self-heal)', () => {
  it('persists logout to Postgres during Redis outage, fails closed in prod, rejects token AFTER Redis recovers empty, and self-heals Redis', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const sharedSid = crypto.randomUUID();
    const token = await signSession({
      userId: USER_A,
      tenantId: TENANT_A,
      plan: 'ENTERPRISE',
      role: 'DRIVER',
      sid: sharedSid,
    });
    const verifiedBefore = await verifySession(token);
    expect(verifiedBefore).not.toBeNull();

    // 1. Redis goes DOWN; user logs out
    state.redisFailMode = true;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logoutRes = await logoutPOST(new NextRequest('https://fleet360.example.com/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://fleet360.example.com', cookie: `xl-session=${token}` },
    }));
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toMatchObject({
      ok: true,
      revoked: true,
      durable: true,
      redisMirrored: false,
      revocationMode: 'postgres',
    });

    // 2. While Redis is still down in production, Edge verifySession fails closed
    expect(await verifySession(token)).toBeNull();

    // 3. Redis RECOVERS with a completely EMPTY cache (simulates flush/restart/outage recovery)
    state.redisFailMode = false;
    state.kv.clear();
    warnSpy.mockRestore();
    errSpy.mockRestore();

    // 4. Replaying the copied token to Node.js endpoints MUST STILL BE REJECTED via PostgreSQL!
    // 4a. GET /api/auth/me -> 401
    const meHeaders = withVerifiedIdentity(new Headers({ cookie: `xl-session=${token}` }), verifiedBefore!);
    const meRes = await authMeGET(new NextRequest('https://fleet360.example.com/api/auth/me', { headers: meHeaders }));
    expect(meRes.status).toBe(401);

    // 4b. POST /api/auth/session (token re-issue/laundering attempt during partial Redis write-miss) -> 401
    state.kv.clear();
    state.kv.set(REVOCATION_HYDRATED_KEY, '1'); // sentinel present, token key absent -> proves Postgres directly blocks re-issue!
    const reissueRes = await sessionPOST(new NextRequest('https://fleet360.example.com/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `xl-session=${token}` },
      body: JSON.stringify({ userId: USER_A, tenantId: TENANT_A }),
    }));
    expect(reissueRes.status).toBe(401);

    // 4c. Driver session helper (sentinel present, token key absent) -> null via Postgres & self-heals Redis
    state.kv.clear();
    state.kv.set(REVOCATION_HYDRATED_KEY, '1');
    const driverCtx = await getDriverTenantContext(new NextRequest('https://fleet360.example.com/api/driver-app/me', {
      headers: { cookie: `xl-driver-session=${token}` },
    }));
    expect(driverCtx).toBeNull();

    // 5. Self-healing: the PostgreSQL hit backfilled Redis so Edge verifySession NOW blocks it too!
    await new Promise((r) => setTimeout(r, 10));
    expect(state.kv.get(`blocklist:sid:${sharedSid}`)).toBe('1');
    expect(await verifySession(token)).toBeNull();

    // 6. Explicit bulk rehydration restores active revocations after a Redis flush
    state.kv.clear();
    const rehydrated = await durable.rehydrateRevocationsToRedis();
    expect(rehydrated.tokensMirrored).toBeGreaterThanOrEqual(2);
    expect(state.kv.get(`blocklist:sid:${sharedSid}`)).toBe('1');
  });
});

describe('Track C — Category 6: Multi-device vs single-device logout', () => {
  it('single-device logout revokes Device A (sidA) while Device B (sidB) stays active; logout-all revokes both', async () => {
    const sidA = crypto.randomUUID();
    const sidB = crypto.randomUUID();
    const deviceA = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'TENANT_ADMIN', sid: sidA });
    const deviceB = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'TENANT_ADMIN', sid: sidB });

    // Log out Device A only
    const resA = await logoutPOST(new NextRequest('https://fleet360.example.com/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://fleet360.example.com', cookie: `xl-session=${deviceA}` },
    }));
    expect(resA.status).toBe(200);

    // Device A is revoked in both Edge & durable Postgres; Device B remains completely valid!
    expect(await verifySession(deviceA)).toBeNull();
    expect(await durable.verifySessionDurable(deviceA)).toBeNull();
    expect(await verifySession(deviceB)).not.toBeNull();
    expect(await durable.verifySessionDurable(deviceB)).not.toBeNull();

    // Now invoke POST /api/auth/logout-all from Device B
    await new Promise((r) => setTimeout(r, 5));
    const verifiedB = (await verifySession(deviceB))!;
    const logoutAllHeaders = withVerifiedIdentity(
      new Headers({ origin: 'https://fleet360.example.com', cookie: `xl-session=${deviceB}` }),
      verifiedB,
    );
    const resAll = await logoutAllPOST(new NextRequest('https://fleet360.example.com/api/auth/logout-all', {
      method: 'POST',
      headers: logoutAllHeaders,
    }));
    expect(resAll.status).toBe(200);
    expect(resAll.headers.get('set-cookie')).toContain('xl-impersonator-session=;');

    // Device B is now revoked immediately via both sidB (t = 0 s) AND session_revocations
    expect(await verifySession(deviceB)).toBeNull();
    expect(await durable.verifySessionDurable(deviceB)).toBeNull();
    expect(state.revokedTokens.has(`sid:${sidB}`)).toBe(true);
    expect(state.scopeRevocations.some((r) => r.user_id === USER_A && r.tenant_id === null)).toBe(true);
  });
});

describe('Track C — Category 7: Cross-tenant RLS isolation & impersonation stop regressions', () => {
  it('migration SQL enforces ENABLE + FORCE RLS, zero IS NULL escape, restrictive platform write guards, and fleet360_app grants', () => {
    const sqlPath = path.resolve(
      process.cwd(),
      'prisma/migrations/20261126000000_revoked_session_tokens/migration.sql',
    );
    const sql = fs.readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.revoked_session_tokens');
    expect(sql).toMatch(/tenant_id\s+TEXT\s+NOT\s+NULL/);
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('AS RESTRICTIVE FOR INSERT');
    expect(sql).toContain('AS RESTRICTIVE FOR UPDATE');
    expect(sql).toContain('AS RESTRICTIVE FOR DELETE');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON public.revoked_session_tokens TO fleet360_app');
    expect(sql).not.toMatch(/tenant_id\s+IS\s+NULL/i);
  });

  it('scopes durable Postgres checks to the caller tenant under withTenantRls (Tenant A cannot see Tenant B)', async () => {
    const sidB = crypto.randomUUID();
    await durable.revokeSessionTokensDurable([
      {
        tokenKey: `sid:${sidB}`,
        userId: USER_A,
        tenantId: TENANT_B,
        expiresAt: new Date(Date.now() + 60_000),
        reason: 'logout:xl-session',
      },
    ]);

    const seenInA = await durable.isSessionRevokedInPostgres({
      sid: sidB,
      userId: USER_A,
      tenantId: TENANT_A,
      issuedAtMs: Date.now(),
    });
    expect(seenInA.revoked).toBe(false);

    const seenInB = await durable.isSessionRevokedInPostgres({
      sid: sidB,
      userId: USER_A,
      tenantId: TENANT_B,
      issuedAtMs: Date.now(),
    });
    expect(seenInB.revoked).toBe(true);
    expect(seenInB.source).toBe('token');
  });

  it('POST /api/admin/impersonate/stop durably revokes discarded impersonation token and blocks resurrecting a revoked stashed token', async () => {
    const impSid = crypto.randomUUID();
    const origSid = crypto.randomUUID();
    const impersonationTok = await signSession({
      userId: USER_A,
      tenantId: TENANT_A,
      plan: 'ENTERPRISE',
      role: 'TENANT_ADMIN',
      impersonatedBy: SUPER_ADMIN,
      sid: impSid,
    });
    const originalAdminTok = await signSession({
      userId: SUPER_ADMIN,
      tenantId: TENANT_B,
      plan: 'ENTERPRISE',
      role: 'SUPER_ADMIN',
      sid: origSid,
    });

    // Normal stop: restores originalAdminTok AND durably revokes impersonationTok
    const stopReq = new NextRequest('https://fleet360.example.com/api/admin/impersonate/stop', {
      method: 'POST',
      headers: {
        origin: 'https://fleet360.example.com',
        'x-tenant-id': TENANT_A,
        'x-user-id': USER_A,
        'x-user-role': 'TENANT_ADMIN',
        'x-impersonated-by': SUPER_ADMIN,
        cookie: `xl-session=${impersonationTok}; xl-impersonator-session=${originalAdminTok}`,
      },
    });
    const stopRes = await impersonateStopPOST(stopReq);
    expect(stopRes.status).toBe(200);
    expect(state.revokedTokens.has(`sid:${impSid}`)).toBe(true);
    expect(await durable.verifySessionDurable(impersonationTok)).toBeNull();
    expect(await durable.verifySessionDurable(originalAdminTok)).not.toBeNull();

    // Resurrection defense: if the original admin token was revoked in Postgres (even with empty Redis),
    // stopping impersonation MUST reject restoration with 401 and wipe both cookies!
    await durable.revokeSessionTokensDurable([
      {
        tokenKey: `sid:${origSid}`,
        userId: SUPER_ADMIN,
        tenantId: TENANT_B,
        expiresAt: new Date(Date.now() + 60_000),
        reason: 'logout:xl-impersonator-session',
      },
    ]);
    state.kv.clear();
    const imp2 = await signSession({
      userId: USER_A,
      tenantId: TENANT_A,
      plan: 'ENTERPRISE',
      role: 'TENANT_ADMIN',
      impersonatedBy: SUPER_ADMIN,
    });
    const reviveRes = await impersonateStopPOST(new NextRequest('https://fleet360.example.com/api/admin/impersonate/stop', {
      method: 'POST',
      headers: {
        origin: 'https://fleet360.example.com',
        'x-tenant-id': TENANT_A,
        'x-user-id': USER_A,
        'x-user-role': 'TENANT_ADMIN',
        'x-impersonated-by': SUPER_ADMIN,
        cookie: `xl-session=${imp2}; xl-impersonator-session=${originalAdminTok}`,
      },
    }));
    expect(reviveRes.status).toBe(401);
  });
});

describe('Track C — Adversarial Review Regression Hardening (BLOCKER-1..3, HIGH-1..2, MEDIUM-2/4)', () => {
  it('BLOCKER-1 + MEDIUM-4: cold/flushed Redis and unconfigured Redis fail closed in production until rehydrated', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'TENANT_ADMIN' });
      // Hydrated Redis accepts active token
      expect(await verifySession(tok)).not.toBeNull();

      // Cold/flushed Redis (hydration sentinel absent) -> Edge fails closed!
      state.kv.clear();
      expect(await verifySession(tok)).toBeNull();

      // Rehydration restores sentinel & mirrors active Postgres revocations -> active token accepted again
      const reh = await durable.rehydrateRevocationsToRedis();
      expect(reh.hydratedSentinelSet).toBe(true);
      expect(state.kv.get(REVOCATION_HYDRATED_KEY)).toBe('1');
      expect(await verifySession(tok)).not.toBeNull();

      // Unconfigured Redis on Railway production (either env var name) -> fails closed even if 'disabled' sentinel is set
      vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
      vi.stubEnv('RAILWAY_ENVIRONMENT', '');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'disabled');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'disabled');
      state.redisEnabled = false;
      clearRevocationCache();
      expect(await isSessionRevoked(tok)).toBe(true);
      expect(await isRevokedSince(USER_A, TENANT_A, Date.now())).toBe(true);

      vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', '');
      vi.stubEnv('RAILWAY_ENVIRONMENT', 'production');
      clearRevocationCache();
      expect(await isSessionRevoked(tok)).toBe(true);
      expect(await isRevokedSince(USER_A, TENANT_A, Date.now())).toBe(true);

      // Non-Railway production with completely unset Upstash vars (not CI, not 'disabled') -> FAILS CLOSED
      vi.stubEnv('RAILWAY_ENVIRONMENT', '');
      vi.stubEnv('CI', '');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
      clearRevocationCache();
      expect(await isSessionRevoked(tok)).toBe(true);
      expect(await isRevokedSince(USER_A, TENANT_A, Date.now())).toBe(true);

      // Isolated CI next-start (CI=true with empty Upstash vars, OR explicit 'disabled' sentinel) -> delegates cleanly to Postgres
      vi.stubEnv('CI', 'true');
      clearRevocationCache();
      expect(await isSessionRevoked(tok)).toBe(false);
      expect(await isRevokedSince(USER_A, TENANT_A, Date.now())).toBe(false);

      vi.stubEnv('CI', '');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'disabled');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'disabled');
      clearRevocationCache();
      expect(await isSessionRevoked(tok)).toBe(false);
      expect(await isRevokedSince(USER_A, TENANT_A, Date.now())).toBe(false);

      // Partial / mismatched Upstash config (even in CI) -> still fails closed
      vi.stubEnv('CI', 'true');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://real-redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'disabled');
      clearRevocationCache();
      expect(await isSessionRevoked(tok)).toBe(true);
      expect(await isRevokedSince(USER_A, TENANT_A, Date.now())).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('BLOCKER-2: POST /api/driver-app/auth/vehicle-login refuses revoked driver token and NEVER falls back to Edge headers', async () => {
    const sid = crypto.randomUUID();
    const driverTok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'DRIVER', sid });
    await durable.revokeSessionTokensDurable([
      { tokenKey: `sid:${sid}`, userId: USER_A, tenantId: TENANT_A, expiresAt: new Date(Date.now() + 60_000), reason: 'logout:xl-driver-session' },
    ]);
    // Simulate Redis recovered empty (missing key) while middleware had injected headers
    state.kv.clear();
    state.kv.set(REVOCATION_HYDRATED_KEY, '1');

    const res = await vehicleLoginPOST(new NextRequest('https://fleet360.example.com/api/driver-app/auth/vehicle-login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `xl-driver-session=${driverTok}`,
        'x-tenant-id': TENANT_A,
        'x-user-id': USER_A,
        'x-user-role': 'DRIVER',
        'x-session-id': sid,
      },
      body: JSON.stringify({ vehicleIdentifier: 'TRX-01' }),
    }));
    expect(res.status).toBe(401);
  });

  it('BLOCKER-3 + HIGH-1: strips x-real-user-id (no forged impersonated_by) and overwrites client Bearer xl-session with Go HS256 JWT', async () => {
    vi.stubEnv('GO_BACKEND_URL', 'http://go-backend.internal:8080');
    const stripped = stripIdentityHeaders(new Headers({ 'x-real-user-id': SUPER_ADMIN, 'x-impersonated-by': SUPER_ADMIN }));
    expect(stripped.get('x-real-user-id')).toBeNull();
    expect(stripped.get('x-impersonated-by')).toBeNull();

    const sid = crypto.randomUUID();
    const nextTok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'VIEWER', sid });
    const headers = new Headers({
      authorization: `Bearer ${nextTok}`,
      'x-user-id': USER_A,
      'x-tenant-id': TENANT_A,
      'x-user-role': 'VIEWER',
      'x-session-id': sid,
      'x-session-iat': String(Date.now() - 10_000),
      'x-real-user-id': SUPER_ADMIN, // must NEVER become impersonated_by!
    });

    let capturedAuth = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
      return new Response('{}', { status: 200 });
    });
    const res = await proxyToGoBackend(
      new NextRequest('https://fleet360.example.com/api/logistics/shipments', { method: 'GET', headers }),
      headers,
      ['logistics:view:*'],
    );
    fetchSpy.mockRestore();

    expect(res.proxied).toBe(true);
    const goJwt = capturedAuth.slice(7);
    expect(goJwt).not.toBe(nextTok);
    const decoded = await verifyJwtForBackend(goJwt);
    expect(decoded).not.toBeNull();
    expect(decoded!.jti).toBe(sid);
    expect(decoded!.impersonatedBy).toBeUndefined();
  });

  it('HIGH-2: POST /api/auth/session tenant switch revokes pre-switch sid and emits paired backendToken', async () => {
    const oldSid = crypto.randomUUID();
    const oldTok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'TENANT_ADMIN', sid: oldSid });

    const res = await sessionPOST(new NextRequest('https://fleet360.example.com/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `xl-session=${oldTok}` },
      body: JSON.stringify({ userId: USER_A, tenantId: TENANT_B }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.backendToken).toBe('string');

    // Old pre-switch sid is durably revoked!
    expect(state.revokedTokens.has(`sid:${oldSid}`)).toBe(true);
    // New backendToken is a valid Go HS256 JWT scoped to TENANT_B with a fresh jti != oldSid
    const decodedNew = await verifyJwtForBackend(body.backendToken);
    expect(decodedNew).not.toBeNull();
    expect(decodedNew!.tenantId).toBe(TENANT_B);
    expect(decodedNew!.jti).toBeTruthy();
    expect(decodedNew!.jti).not.toBe(oldSid);
  });

  it('MEDIUM-2: POST /api/admin/impersonate/stop blocks cross-site CSRF and revokes Bearer impersonation tokens', async () => {
    const impSid = crypto.randomUUID();
    const impTok = await signSession({ userId: USER_A, tenantId: TENANT_A, plan: 'ENTERPRISE', role: 'TENANT_ADMIN', impersonatedBy: SUPER_ADMIN, sid: impSid });
    const origTok = await signSession({ userId: SUPER_ADMIN, tenantId: TENANT_B, plan: 'ENTERPRISE', role: 'SUPER_ADMIN' });

    // Cross-site blocked
    const csrfRes = await impersonateStopPOST(new NextRequest('https://fleet360.example.com/api/admin/impersonate/stop', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'x-tenant-id': TENANT_A,
        'x-user-id': USER_A,
        'x-user-role': 'TENANT_ADMIN',
        cookie: `xl-session=${impTok}; xl-impersonator-session=${origTok}`,
      },
    }));
    expect(csrfRes.status).toBe(403);

    // Bearer-authenticated impersonation token is durably revoked on /stop
    const okRes = await impersonateStopPOST(new NextRequest('https://fleet360.example.com/api/admin/impersonate/stop', {
      method: 'POST',
      headers: {
        origin: 'https://fleet360.example.com',
        authorization: `Bearer ${impTok}`,
        'x-tenant-id': TENANT_A,
        'x-user-id': USER_A,
        'x-user-role': 'TENANT_ADMIN',
        cookie: `xl-impersonator-session=${origTok}`,
      },
    }));
    expect(okRes.status).toBe(200);
    expect(state.revokedTokens.has(`sid:${impSid}`)).toBe(true);
  });

  it('PRISMA-DEADLOCK-GUARD: bare-prisma revocation checks run strictly inside runWithActiveTx + runWithRlsScope (no tx recursion)', () => {
    const prismaSource = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'prisma.ts'), 'utf8');
    const matches = [...prismaSource.matchAll(/enforceRequestSessionRevocation/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      const idx = m.index ?? 0;
      const preceding = prismaSource.slice(Math.max(0, idx - 350), idx);
      // Must be preceded by runWithActiveTx + runWithRlsScope inside the same transaction callback
      expect(preceding).toContain('runWithActiveTx(tx,');
      expect(preceding).toContain('runWithRlsScope({ tenantId, mode: \'tenant\', tx }');
    }
  });
});
