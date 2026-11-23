/**
 * Module 1 P1 Security Hardening Regression Suite (PR #259)
 *
 * Covers:
 *  - M1-P1-2: Redis-backed login & MFA throttling, rightmost-XFF IP extraction,
 *             cross-IP account & MFA lockouts, atomic single-use recovery code
 *             consumption, unified anti-enumeration login errors, and MFA
 *             enroll/verify + disable throttling.
 *  - M1-P1-5: Forgot-password per-IP & per-email rate limiting before DB lookup,
 *             reset-password per-IP throttling, unified invalid-token error
 *             message, and atomic conditional token claim preventing TOCTOU replay.
 *  - Platform settings secret redaction: GET/PATCH /api/admin/platform-settings
 *             and POST /api/admin/test-channel SUPER_ADMIN guards, redaction of
 *             health_alert_webhook_url / smtp_password / email_api_key / sms_auth_token,
 *             preserve-when-blank semantics, explicit clearSecrets, and log scrubbing.
 *  - M1-P1-7: getSecurityHealthMetrics() using withPlatformAdmin + active membership
 *             filter so totalAdmins/mfaAdminCount are accurate under RLS, and
 *             POST /api/auth/mfa/enroll returning Cache-Control: no-store + scannable QR.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';

const {
  mockRedis,
  redisKv,
  redisState,
  mockPrisma,
  mockWithPlatformAdmin,
  mockLogAudit,
  mockSendTemplatedEmail,
  mockRevokeSessionsSafely,
  mockInvalidateSmtpCache,
  settingsStore,
} = vi.hoisted(() => {
  const kv = new Map<string, number>();
  const redis = {
    get: vi.fn(async (key: string) => (kv.has(key) ? String(kv.get(key)) : null)),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => (kv.has(k) ? String(kv.get(k)) : null))),
    incr: vi.fn(async (key: string) => {
      const next = (kv.get(key) ?? 0) + 1;
      kv.set(key, next);
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const next = (kv.get(key) ?? 0) - 1;
      kv.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 600),
    del: vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const k of keys) {
        if (kv.delete(k)) deleted += 1;
      }
      return deleted;
    }),
  };

  const settings = new Map<string, string>();
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    userTenant: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  };

  return {
    mockRedis: redis,
    redisKv: kv,
    redisState: { enabled: true },
    mockPrisma: prisma,
    mockWithPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    mockLogAudit: vi.fn().mockResolvedValue(undefined),
    mockSendTemplatedEmail: vi.fn().mockResolvedValue({ sent: true }),
    mockRevokeSessionsSafely: vi.fn().mockResolvedValue(true),
    mockInvalidateSmtpCache: vi.fn(),
    settingsStore: settings,
  };
});

vi.mock('@/lib/upstash', () => ({
  getRedis: () => (redisState.enabled ? mockRedis : null),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  isDbConnectionError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: mockWithPlatformAdmin,
  withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('@/lib/sentry', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/email-templates', () => ({
  appUrl: (p: string) => `https://fleet360.example.com${p}`,
  NO_TENANT: '*',
  sendTemplatedEmail: mockSendTemplatedEmail,
}));

vi.mock('@/lib/auth/session-revocation', () => ({
  revokeSessionsSafely: mockRevokeSessionsSafely,
}));

vi.mock('@/lib/email', () => ({
  invalidateSmtpCache: mockInvalidateSmtpCache,
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/permissions/effective-role', () => ({
  getEffectiveRole: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/authz/session-permissions', () => ({
  effectivePermissions: vi.fn().mockResolvedValue(['*:*:*']),
}));

vi.mock('@/lib/module-policies', () => ({
  tenantModulesFor: vi.fn().mockResolvedValue(['FLEET']),
}));

vi.mock('@/lib/drivers/driver-login-user', () => ({
  matchDriverProfileForUser: vi.fn().mockResolvedValue(null),
}));

let loginPOST: typeof import('@/app/api/auth/login/route').POST;
let forgotPOST: typeof import('@/app/api/auth/forgot-password/route').POST;
let resetPOST: typeof import('@/app/api/auth/reset-password/route').POST;
let mfaEnrollPOST: typeof import('@/app/api/auth/mfa/enroll/route').POST;
let mfaVerifyPOST: typeof import('@/app/api/auth/mfa/enroll/verify/route').POST;
let mfaDisablePOST: typeof import('@/app/api/auth/mfa/disable/route').POST;
let platformSettingsGET: typeof import('@/app/api/admin/platform-settings/route').GET;
let platformSettingsPATCH: typeof import('@/app/api/admin/platform-settings/route').PATCH;
let testChannelPOST: typeof import('@/app/api/admin/test-channel/route').POST;
let getSecurityHealthMetrics: typeof import('@/lib/health/extended-metrics').getSecurityHealthMetrics;
let resetAuthRateLimitsForTests: typeof import('@/lib/auth/auth-rate-limit').resetAuthRateLimitsForTests;
let generateRecoveryCodes: typeof import('@/lib/totp').generateRecoveryCodes;
let generateTotpSecret: typeof import('@/lib/totp').generateTotpSecret;
let totpNow: typeof import('@/lib/totp').totpNow;

function makePbkdf2Hash(password: string): string {
  const salt = '0123456789abcdef0123456789abcdef';
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

const VALID_PASSWORD = 'Strong!Password#2026';
const VALID_PASSWORD_HASH = makePbkdf2Hash(VALID_PASSWORD);

beforeAll(async () => {
  vi.resetModules();
  ({ POST: loginPOST } = await import('@/app/api/auth/login/route'));
  ({ POST: forgotPOST } = await import('@/app/api/auth/forgot-password/route'));
  ({ POST: resetPOST } = await import('@/app/api/auth/reset-password/route'));
  ({ POST: mfaEnrollPOST } = await import('@/app/api/auth/mfa/enroll/route'));
  ({ POST: mfaVerifyPOST } = await import('@/app/api/auth/mfa/enroll/verify/route'));
  ({ POST: mfaDisablePOST } = await import('@/app/api/auth/mfa/disable/route'));
  ({ GET: platformSettingsGET, PATCH: platformSettingsPATCH } = await import('@/app/api/admin/platform-settings/route'));
  ({ POST: testChannelPOST } = await import('@/app/api/admin/test-channel/route'));
  ({ getSecurityHealthMetrics } = await import('@/lib/health/extended-metrics'));
  ({ resetAuthRateLimitsForTests } = await import('@/lib/auth/auth-rate-limit'));
  ({ generateRecoveryCodes, generateTotpSecret, totpNow } = await import('@/lib/totp'));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockReset();
  mockPrisma.user.findFirst.mockReset();
  mockPrisma.userTenant.findMany.mockReset();
  mockPrisma.$queryRaw.mockReset();
  mockPrisma.$queryRawUnsafe.mockReset();
  mockPrisma.$executeRaw.mockReset();
  mockPrisma.$executeRawUnsafe.mockReset();
  mockPrisma.$transaction.mockReset();
  mockWithPlatformAdmin.mockReset();
  mockWithPlatformAdmin.mockImplementation(async (_p: unknown, fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  redisKv.clear();
  redisState.enabled = true;
  settingsStore.clear();
  resetAuthRateLimitsForTests();
  vi.stubEnv('SESSION_SECRET', '0123456789abcdef0123456789abcdef0123456789abcdef');
  vi.stubEnv('JWT_SECRET', '0123456789abcdef0123456789abcdef0123456789abcdef');
  mockPrisma.$executeRaw.mockResolvedValue(1);
  mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
  mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// Workstream 2 — M1-P1-2: Login & MFA abuse protection
// ─────────────────────────────────────────────────────────────────────────────
describe('M1-P1-2: Redis-backed login & MFA throttling and anti-enumeration', () => {
  it('stores hashed failure keys in Redis, defeats leftmost XFF spoofing, and locks out on 6th attempt', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue(null);

    for (let i = 0; i < 5; i++) {
      const req = new NextRequest('https://fleet360.example.com/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Rotating spoofed leftmost IP, constant real proxy edge IP on right
          'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.50`,
        },
        body: JSON.stringify({ email: 'victim@fleet360.example.com', password: 'wrong-password' }),
      });
      const res = await loginPOST(req);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }

    // Confirm Redis was used and raw email PII is never stored in Redis keys
    expect(mockRedis.incr).toHaveBeenCalled();
    for (const key of redisKv.keys()) {
      expect(key).not.toContain('victim@fleet360.example.com');
    }

    // 6th attempt from same edge IP (even with another spoofed leftmost XFF) must 429
    const blocked = await loginPOST(
      new NextRequest('https://fleet360.example.com/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.99, 203.0.113.50',
        },
        body: JSON.stringify({ email: 'victim@fleet360.example.com', password: 'wrong-password' }),
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('unifies error status (401) and generic message across unknown, disabled, and passwordless accounts', async () => {
    const scenarios = [
      { name: 'not found', user: null, hash: null },
      { name: 'disabled', user: { id: 'u-dis', email: 'dis@acme.test', username: 'dis', isActive: false }, hash: VALID_PASSWORD_HASH },
      { name: 'passwordless', user: { id: 'u-nopw', email: 'nopw@acme.test', username: 'nopw', isActive: true }, hash: null },
    ];

    for (const [idx, s] of scenarios.entries()) {
      mockPrisma.user.findUnique.mockResolvedValueOnce(s.user);
      if (!s.user) mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      if (s.user?.isActive) {
        mockPrisma.$queryRaw.mockResolvedValueOnce(s.hash ? [{ password_hash: s.hash }] : [{ password_hash: null }]);
      }

      const res = await loginPOST(
        new NextRequest('https://fleet360.example.com/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${60 + idx}` },
          body: JSON.stringify({ email: `acct${idx}@acme.test`, password: 'SomePassword123!' }),
        }),
      );
      const body = await res.json();
      expect(res.status, s.name).toBe(401);
      expect(body.message, s.name).toBe('Invalid email or password');
    }
  });

  it('throttles failed MFA TOTP attempts across rotating IPs (429 on 6th attempt)', async () => {
    const secret = generateTotpSecret();
    const activeUser = { id: 'u-mfa-1', email: 'admin@acme.test', username: 'admin', isActive: true };

    for (let i = 0; i < 5; i++) {
      mockPrisma.user.findUnique.mockResolvedValueOnce(activeUser);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ password_hash: VALID_PASSWORD_HASH }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        { mfa_enabled: true, mfa_secret: secret, mfa_recovery_codes: [] },
      ]);

      const res = await loginPOST(
        new NextRequest('https://fleet360.example.com/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${10 + i}` },
          body: JSON.stringify({ email: 'admin@acme.test', password: VALID_PASSWORD, mfaCode: '000000' }),
        }),
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.mfaRequired).toBe(true);
    }

    // 6th attempt from a brand-new IP must be throttled with 429 before verifying TOTP
    mockPrisma.user.findUnique.mockResolvedValueOnce(activeUser);
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ password_hash: VALID_PASSWORD_HASH }]);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { mfa_enabled: true, mfa_secret: secret, mfa_recovery_codes: [] },
    ]);

    const lockedRes = await loginPOST(
      new NextRequest('https://fleet360.example.com/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.200' },
        body: JSON.stringify({ email: 'admin@acme.test', password: VALID_PASSWORD, mfaCode: '123456' }),
      }),
    );
    expect(lockedRes.status).toBe(429);
    expect(Number(lockedRes.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('rejects concurrent recovery code replay atomically when conditional UPDATE affects 0 rows', async () => {
    const { plaintext, hashed } = generateRecoveryCodes(2);
    const activeUser = { id: 'u-mfa-rec', email: 'rec@acme.test', username: 'rec', isActive: true };

    mockPrisma.user.findUnique.mockResolvedValueOnce(activeUser);
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ password_hash: VALID_PASSWORD_HASH }]);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: hashed },
    ]);
    // Simulate concurrent request already having consumed the recovery code (0 rows updated)
    mockPrisma.$executeRawUnsafe.mockResolvedValueOnce(0);

    const res = await loginPOST(
      new NextRequest('https://fleet360.example.com/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
        body: JSON.stringify({
          email: 'rec@acme.test',
          password: VALID_PASSWORD,
          recoveryCode: plaintext[0],
        }),
      }),
    );

    expect(res.status).toBe(401);
    const [sql] = mockPrisma.$executeRawUnsafe.mock.calls[0];
    expect(String(sql)).toContain('mfa_recovery_codes @> jsonb_build_array($1::text)');
  });

  it('throttles repeated invalid MFA verification attempts on /api/auth/mfa/enroll/verify and /api/auth/mfa/disable', async () => {
    const authHeaders = {
      'content-type': 'application/json',
      'x-tenant-id': 't-1',
      'x-user-id': 'u-mfa-throttle',
      'x-tenant-plan': 'ENTERPRISE',
    };

    for (let i = 0; i < 5; i++) {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        { pending_mfa_secret: generateTotpSecret(), mfa_enabled: false },
      ]);
      const res = await mfaVerifyPOST(
        new NextRequest('https://fleet360.example.com/api/auth/mfa/enroll/verify', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ code: '000000' }),
        }),
      );
      expect(res.status).toBe(400);
    }

    const verifyBlocked = await mfaVerifyPOST(
      new NextRequest('https://fleet360.example.com/api/auth/mfa/enroll/verify', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: '111111' }),
      }),
    );
    expect(verifyBlocked.status).toBe(429);

    // Same user is also throttled on /api/auth/mfa/disable
    const disableBlocked = await mfaDisablePOST(
      new NextRequest('https://fleet360.example.com/api/auth/mfa/disable', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ password: VALID_PASSWORD, code: '111111' }),
      }),
    );
    expect(disableBlocked.status).toBe(429);
  });

  it('defeats concurrent TOCTOU bursts via atomic increment-before-verify on MFA enroll/verify and login', async () => {
    const authHeaders = {
      'content-type': 'application/json',
      'x-tenant-id': 't-1',
      'x-user-id': 'u-mfa-burst',
      'x-tenant-plan': 'ENTERPRISE',
    };
    const secret = generateTotpSecret();
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      { pending_mfa_secret: secret, mfa_enabled: false },
    ]);

    // Fire 10 simultaneous invalid TOTP verification requests: exactly 5 may reach DB/verify, 5 must 429.
    const verifyResponses = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        mfaVerifyPOST(
          new NextRequest('https://fleet360.example.com/api/auth/mfa/enroll/verify', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ code: String(100000 + idx) }),
          }),
        ),
      ),
    );
    const verifyStatuses = verifyResponses.map((r) => r.status);
    expect(verifyStatuses.filter((s) => s === 400).length).toBe(5);
    expect(verifyStatuses.filter((s) => s === 429).length).toBe(5);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(5);

    // Parallel MFA login burst across 10 distinct IPs: at most 5 TOTP guesses evaluated, 5 immediately 429.
    mockPrisma.$queryRawUnsafe.mockReset();
    const activeUser = { id: 'u-login-burst', email: 'burst@acme.test', username: 'burst', isActive: true };
    mockPrisma.user.findUnique.mockResolvedValue(activeUser);
    mockPrisma.$queryRaw.mockResolvedValue([{ password_hash: VALID_PASSWORD_HASH }]);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      { mfa_enabled: true, mfa_secret: secret, mfa_recovery_codes: [] },
    ]);

    const loginResponses = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        loginPOST(
          new NextRequest('https://fleet360.example.com/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${10 + idx}` },
            body: JSON.stringify({
              email: 'burst@acme.test',
              password: VALID_PASSWORD,
              mfaCode: String(200000 + idx),
            }),
          }),
        ),
      ),
    );
    const loginStatuses = loginResponses.map((r) => r.status);
    expect(loginStatuses.filter((s) => s === 401).length).toBe(5);
    expect(loginStatuses.filter((s) => s === 429).length).toBe(5);
  });

  it('rejects concurrent recovery code replay in /api/auth/mfa/disable and double-activation in /api/auth/mfa/enroll/verify', async () => {
    const authHeaders = {
      'content-type': 'application/json',
      'x-tenant-id': 't-1',
      'x-user-id': 'u-atomic-mfa',
      'x-tenant-plan': 'ENTERPRISE',
    };
    const { plaintext, hashed } = generateRecoveryCodes(2);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      {
        password_hash: VALID_PASSWORD_HASH,
        mfa_enabled: true,
        mfa_secret: generateTotpSecret(),
        mfa_recovery_codes: hashed,
      },
    ]);
    // Simulate concurrent request already consuming the recovery code (0 rows affected)
    mockPrisma.$executeRawUnsafe.mockResolvedValueOnce(0);

    const disableRes = await mfaDisablePOST(
      new NextRequest('https://fleet360.example.com/api/auth/mfa/disable', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ password: VALID_PASSWORD, recoveryCode: plaintext[0] }),
      }),
    );
    expect(disableRes.status).toBe(401);
    const [disableSql] = mockPrisma.$executeRawUnsafe.mock.calls[0];
    expect(String(disableSql)).toContain('mfa_recovery_codes @> jsonb_build_array($2::text)');
    expect(mockLogAudit).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();

    // Concurrent double-activation on /api/auth/mfa/enroll/verify
    const enrollSecret = generateTotpSecret();
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { pending_mfa_secret: enrollSecret, mfa_enabled: false },
    ]);
    mockPrisma.$executeRawUnsafe.mockResolvedValueOnce(0);

    const verifyRes = await mfaVerifyPOST(
      new NextRequest('https://fleet360.example.com/api/auth/mfa/enroll/verify', {
        method: 'POST',
        headers: { ...authHeaders, 'x-user-id': 'u-atomic-verify' },
        body: JSON.stringify({ code: totpNow(enrollSecret) }),
      }),
    );
    expect(verifyRes.status).toBe(400);
    const [verifySql] = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(String(verifySql)).toContain('mfa_enabled = FALSE');
    expect(String(verifySql)).toContain('pending_mfa_secret IS NOT NULL');
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workstream 3 — M1-P1-5: Password reset throttling & atomic consumption
// ─────────────────────────────────────────────────────────────────────────────
describe('M1-P1-5: Password reset rate limiting, unified errors, and atomic consumption', () => {
  it('rate-limits /api/auth/forgot-password per-email before DB lookup (429 on 4th attempt)', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]); // unknown email

    for (let i = 0; i < 3; i++) {
      const res = await forgotPOST(
        new NextRequest('https://fleet360.example.com/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${10 + i}` },
          body: JSON.stringify({ email: 'target@fleet360.example.com' }),
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }

    mockPrisma.$queryRawUnsafe.mockClear();
    const blocked = await forgotPOST(
      new NextRequest('https://fleet360.example.com/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99' },
        body: JSON.stringify({ email: 'target@fleet360.example.com' }),
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Rate limit fired BEFORE any DB lookup
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('unifies error messages for used, revoked, and expired tokens on /api/auth/reset-password', async () => {
    const rawToken = 'a'.repeat(64);
    const states = [
      { id: '11111111-1111-1111-1111-111111111111', user_id: 'u1', expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: new Date().toISOString(), revoked: false, email: 'a@b.test', username: 'a' },
      { id: '22222222-2222-2222-2222-222222222222', user_id: 'u1', expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null, revoked: true, email: 'a@b.test', username: 'a' },
      { id: '33333333-3333-3333-3333-333333333333', user_id: 'u1', expires_at: new Date(Date.now() - 60_000).toISOString(), used_at: null, revoked: false, email: 'a@b.test', username: 'a' },
    ];

    const errors: string[] = [];
    for (const [idx, row] of states.entries()) {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([row]);
      const res = await resetPOST(
        new NextRequest('https://fleet360.example.com/api/auth/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${120 + idx}` },
          body: JSON.stringify({ token: rawToken, newPassword: 'BrandNew!Password#99' }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      errors.push(body.error);
    }

    expect(new Set(errors).size).toBe(1);
    expect(errors[0]).toBe('Invalid or expired reset link.');
  });

  it('consumes reset tokens atomically inside $transaction and aborts password update on 0 affected rows', async () => {
    const rawToken = 'b'.repeat(64);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: '44444444-4444-4444-4444-444444444444',
        user_id: 'u-race',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
        revoked: false,
        email: 'race@acme.test',
        username: 'race',
      },
    ]);
    // Simulate concurrent race loser: conditional token claim updates 0 rows
    mockPrisma.$executeRawUnsafe.mockResolvedValueOnce(0);

    const res = await resetPOST(
      new NextRequest('https://fleet360.example.com/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.150' },
        body: JSON.stringify({ token: rawToken, newPassword: 'BrandNew!Password#99' }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid or expired reset link.');
    // Only the conditional token UPDATE executed; password_hash UPDATE never ran
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [claimSql] = mockPrisma.$executeRawUnsafe.mock.calls[0];
    expect(String(claimSql)).toContain('used_at IS NULL');
    expect(String(claimSql)).toContain('revoked = FALSE');
    expect(String(claimSql)).toContain('expires_at > NOW()');
    expect(mockRevokeSessionsSafely).not.toHaveBeenCalled();
  });

  it('rate-limits /api/auth/reset-password per-IP (429 on 11th request)', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await resetPOST(
        new NextRequest('https://fleet360.example.com/api/auth/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.180' },
          body: JSON.stringify({ token: 'short', newPassword: 'x' }),
        }),
      );
      expect(res.status).toBe(400);
    }

    const blocked = await resetPOST(
      new NextRequest('https://fleet360.example.com/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.180' },
        body: JSON.stringify({ token: 'short', newPassword: 'x' }),
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workstream 4 — Platform Settings secret redaction & preservation
// ─────────────────────────────────────────────────────────────────────────────
describe('Platform settings secret redaction, preservation, and authorization', () => {
  const SECRET_WEBHOOK = 'https://hooks.slack.com/services/T99/B88/TOP_SECRET_WEBHOOK_XYZ';
  const SECRET_SMTP_PW = 'Smtp!SuperSecretPass#2026';
  const SECRET_API_KEY = 'SG.super_secret_sendgrid_key_12345';
  const SECRET_SMS_TOK = 'twilio_super_secret_token_98765';

  function superAdminHeaders(): Record<string, string> {
    return {
      'x-tenant-id': 'platform-tenant-1',
      'x-user-id': 'sa-1',
      'x-user-role': 'SUPER_ADMIN',
    };
  }

  beforeEach(() => {
    settingsStore.set('timezone', 'Asia/Dubai');
    settingsStore.set('email_provider', 'smtp');
    settingsStore.set('email_from_name', 'Fleet360');
    settingsStore.set('smtp_host', 'smtp.office365.com');
    settingsStore.set('smtp_port', '587');
    settingsStore.set('smtp_username', 'alerts@fleet360.example.com');
    settingsStore.set('smtp_encryption', 'tls');
    settingsStore.set('smtp_password', SECRET_SMTP_PW);
    settingsStore.set('email_api_key', SECRET_API_KEY);
    settingsStore.set('sms_provider', 'twilio');
    settingsStore.set('sms_account_sid', 'AC1234567890');
    settingsStore.set('sms_auth_token', SECRET_SMS_TOK);
    settingsStore.set('health_alert_webhook_url', SECRET_WEBHOOK);

    mockPrisma.$queryRawUnsafe.mockImplementation(async (sql: string, keyArg?: string | string[]) => {
      const s = String(sql);
      if (s.includes('FROM platform_settings WHERE key = ANY($1::text[])') && Array.isArray(keyArg)) {
        return keyArg
          .filter((k) => settingsStore.has(k))
          .map((key) => ({ key, value: settingsStore.get(key) ?? '' }));
      }
      if (s.includes('FROM platform_settings WHERE key = $1')) {
        const val = typeof keyArg === 'string' ? settingsStore.get(keyArg) : undefined;
        return val !== undefined ? [{ value: val }] : [];
      }
      if (s.includes('FROM platform_settings')) {
        return Array.from(settingsStore.entries()).map(([key, value]) => ({ key, value }));
      }
      return [];
    });

    mockPrisma.$executeRawUnsafe.mockImplementation(async (sql: string, key?: string, val?: string) => {
      const s = String(sql);
      if (s.includes('INTO platform_settings') && typeof key === 'string' && typeof val === 'string') {
        if (s.includes('DO NOTHING')) {
          if (!settingsStore.has(key)) settingsStore.set(key, val);
        } else {
          settingsStore.set(key, val);
        }
      }
      return 1;
    });
  });

  it('denies unauthenticated (401) and TENANT_ADMIN (403) callers on /api/admin/platform-settings and /api/admin/test-channel', async () => {
    expect((await platformSettingsGET(new NextRequest('https://fleet360.example.com/api/admin/platform-settings'))).status).toBe(401);
    expect(
      (await platformSettingsGET(new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        headers: { 'x-tenant-id': 't-1', 'x-user-id': 'u-1', 'x-user-role': 'TENANT_ADMIN' },
      }))).status,
    ).toBe(403);
    expect(
      (await platformSettingsPATCH(new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-tenant-id': 't-1', 'x-user-id': 'u-1', 'x-user-role': 'TENANT_ADMIN' },
        body: JSON.stringify({ timezone: 'UTC' }),
      }))).status,
    ).toBe(403);
    expect(
      (await testChannelPOST(new NextRequest('https://fleet360.example.com/api/admin/test-channel', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': 't-1', 'x-user-id': 'u-1', 'x-user-role': 'TENANT_ADMIN' },
        body: JSON.stringify({ channel: 'sms', settings: {} }),
      }))).status,
    ).toBe(403);
  });

  it('GET /api/admin/platform-settings redacts all secret keys and returns configured flags', async () => {
    const res = await platformSettingsGET(
      new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        headers: superAdminHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    const rawJson = JSON.stringify(body);

    expect(body.settings.timezone).toBe('Asia/Dubai');
    expect(body.settings.smtp_password).toBe('');
    expect(body.settings.email_api_key).toBe('');
    expect(body.settings.sms_auth_token).toBe('');
    expect(body.settings.health_alert_webhook_url).toBe('');

    expect(body.configuredSecrets.smtp_password).toBe(true);
    expect(body.configuredSecrets.email_api_key).toBe(true);
    expect(body.configuredSecrets.sms_auth_token).toBe(true);
    expect(body.configuredSecrets.health_alert_webhook_url).toBe(true);

    expect(body.secretStatus).toEqual({
      webhookConfigured: true,
      webhookUrl: '',
      smtpPasswordConfigured: true,
      smtpPassword: '',
      emailApiKeyConfigured: true,
      emailApiKey: '',
      smsAuthTokenConfigured: true,
      smsAuthToken: '',
    });

    expect(rawJson).not.toContain(SECRET_WEBHOOK);
    expect(rawJson).not.toContain('TOP_SECRET_WEBHOOK_XYZ');
    expect(rawJson).not.toContain(SECRET_SMTP_PW);
    expect(rawJson).not.toContain(SECRET_API_KEY);
    expect(rawJson).not.toContain(SECRET_SMS_TOK);
  });

  it('PATCH preserves stored secrets when omitted/blank, blocks credential-exfiltration swaps, clears only via clearSecrets, and scrubs error logs', async () => {
    // 1. Save unrelated email setting with blank smtp_password -> preserves stored secrets & drops SMTP cache
    const saveRes = await platformSettingsPATCH(
      new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          email_from_name: 'Fleet360 Ops',
          smtp_host: 'smtp.office365.com',
          smtp_port: '587',
          smtp_username: 'alerts@fleet360.example.com',
          smtp_encryption: 'tls',
          smtp_password: '   ',
          health_alert_webhook_url: '',
        }),
      }),
    );
    expect(saveRes.status).toBe(200);
    const saveBody = await saveRes.json();
    expect(saveBody.configuredSecrets.smtp_password).toBe(true);
    expect(saveBody.configuredSecrets.health_alert_webhook_url).toBe(true);
    expect(settingsStore.get('email_from_name')).toBe('Fleet360 Ops');
    expect(settingsStore.get('smtp_password')).toBe(SECRET_SMTP_PW);
    expect(settingsStore.get('health_alert_webhook_url')).toBe(SECRET_WEBHOOK);
    expect(mockInvalidateSmtpCache).toHaveBeenCalledTimes(1);

    // 1b. Attempting to swap smtp_host OR downgrade smtp_encryption to 'none' while preserving smtp_password MUST 400
    const swapHostRes = await platformSettingsPATCH(
      new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          smtp_host: 'attacker.example.net',
          smtp_password: '',
        }),
      }),
    );
    expect(swapHostRes.status).toBe(400);
    expect(settingsStore.get('smtp_host')).toBe('smtp.office365.com');

    const downgradeTlsRes = await platformSettingsPATCH(
      new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          smtp_encryption: 'none',
          smtp_password: '',
        }),
      }),
    );
    expect(downgradeTlsRes.status).toBe(400);
    expect(settingsStore.get('smtp_encryption')).toBe('tls');

    // 2. Explicit clearSecrets removes only requested secret
    const clearRes = await platformSettingsPATCH(
      new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ clearSecrets: ['smtp_password'] }),
      }),
    );
    expect(clearRes.status).toBe(200);
    const clearBody = await clearRes.json();
    expect(clearBody.configuredSecrets.smtp_password).toBe(false);
    expect(clearBody.configuredSecrets.sms_auth_token).toBe(true);
    expect(settingsStore.get('smtp_password')).toBe('');

    // 3. Malformed JSON returns 400
    const badJson = await platformSettingsPATCH(
      new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: '{invalid-json',
      }),
    );
    expect(badJson.status).toBe(400);

    // 4. DB failure scrubs supplied secret from logs & response
    const newSecret = 'BrandNewSecretPass#9988';
    mockWithPlatformAdmin.mockRejectedValueOnce(new Error(`DB failed writing ${newSecret}`));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failRes = await platformSettingsPATCH(
        new NextRequest('https://fleet360.example.com/api/admin/platform-settings', {
          method: 'PATCH',
          headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ smtp_password: newSecret }),
        }),
      );
      expect(failRes.status).toBe(500);
      const failBody = await failRes.json();
      expect(JSON.stringify(failBody)).not.toContain(newSecret);
      const logged = errSpy.mock.calls.map((a) => a.map(String).join(' ')).join('\n');
      expect(logged).not.toContain(newSecret);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('POST /api/admin/test-channel blocks stored SMTP/SMS credential exfiltration to mismatched hosts/encryption/SIDs and scrubs base64 secrets', async () => {
    // 1. Blank smtp_password with attacker-controlled smtp_host MUST 400 before touching nodemailer
    const exfilHostRes = await testChannelPOST(
      new NextRequest('https://fleet360.example.com/api/admin/test-channel', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          settings: {
            email_provider: 'smtp',
            smtp_host: 'attacker.example.net',
            smtp_port: '587',
            smtp_username: 'alerts@fleet360.example.com',
            smtp_encryption: 'tls',
            smtp_password: '',
          },
          toEmail: 'admin@fleet360.example.com',
        }),
      }),
    );
    expect(exfilHostRes.status).toBe(400);
    expect(exfilHostRes.headers.get('cache-control')).toBe('no-store');

    // 2. Blank smtp_password with cleartext smtp_encryption: 'none' MUST 400
    const exfilCleartextRes = await testChannelPOST(
      new NextRequest('https://fleet360.example.com/api/admin/test-channel', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          settings: {
            email_provider: 'smtp',
            smtp_host: 'smtp.office365.com',
            smtp_port: '587',
            smtp_username: 'alerts@fleet360.example.com',
            smtp_encryption: 'none',
            smtp_password: '',
          },
          toEmail: 'admin@fleet360.example.com',
        }),
      }),
    );
    expect(exfilCleartextRes.status).toBe(400);

    // 3. Blank sms_auth_token with mismatched sms_account_sid MUST 400 without calling fetch
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const badSidRes = await testChannelPOST(
      new NextRequest('https://fleet360.example.com/api/admin/test-channel', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'sms',
          settings: {
            sms_provider: 'twilio',
            sms_account_sid: 'AC_DIFFERENT_SID',
            sms_auth_token: '',
            sms_from_number: '+971500000000',
          },
        }),
      }),
    );
    expect(badSidRes.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    // 4. Matching saved SID uses stored token and scrubs both raw and base64-encoded auth header from errors
    const basicB64 = Buffer.from(`AC1234567890:${SECRET_SMS_TOK}`).toString('base64');
    fetchMock.mockRejectedValueOnce(new Error(`Auth failed for ${SECRET_SMS_TOK} / Basic ${basicB64}`));

    const res = await testChannelPOST(
      new NextRequest('https://fleet360.example.com/api/admin/test-channel', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'sms',
          settings: {
            sms_provider: 'twilio',
            sms_account_sid: 'AC1234567890',
            sms_auth_token: '',
            sms_from_number: '+971500000000',
          },
        }),
      }),
    );
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(`Basic ${basicB64}`);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(SECRET_SMS_TOK);
    expect(JSON.stringify(body)).not.toContain(basicB64);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workstream 5 — M1-P1-7: MFA metrics accuracy under RLS & QR code UX
// ─────────────────────────────────────────────────────────────────────────────
describe('M1-P1-7: MFA health metrics under withPlatformAdmin and QR code enrollment', () => {
  it('getSecurityHealthMetrics runs MFA & failed-login queries under withPlatformAdmin with active membership filter', async () => {
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ active_24h: 12, active_1h: 3 }])
      .mockResolvedValueOnce([{ failed_attempts: 2, unique_ips: 1, targeted_accounts: 1 }])
      .mockResolvedValueOnce([{ total_users: 191, mfa_enabled_users: 4, total_admins: 6, mfa_enabled_admins: 3 }]);

    const metrics = await getSecurityHealthMetrics();

    expect(mockWithPlatformAdmin).toHaveBeenCalledTimes(2);
    const mfaSqlCall = mockPrisma.$queryRawUnsafe.mock.calls.find(([sql]) =>
      String(sql).includes('mfa_enabled_admins'),
    );
    expect(mfaSqlCall).toBeDefined();
    expect(String(mfaSqlCall![0])).toContain('COALESCE(ut.is_active, true) = true');
    expect(String(mfaSqlCall![0])).toContain('LEFT JOIN tenants t ON t.id = ut.tenant_id AND COALESCE(t.is_active, true) = true');

    expect(metrics.mfa.totalStaff).toBe(191);
    expect(metrics.mfa.totalAdmins).toBe(6);
    expect(metrics.mfa.mfaAdminCount).toBe(3);
    expect(metrics.mfa.adminEnrolledPercent).toBe(50);
  });

  it('POST /api/auth/mfa/enroll returns Cache-Control: no-store, valid otpauth URI, and inline QR data URL', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { email: 'superadmin@fleet360.example.com', username: 'superadmin', mfa_enabled: false },
    ]);

    const res = await mfaEnrollPOST(
      new NextRequest('https://fleet360.example.com/api/auth/mfa/enroll', {
        method: 'POST',
        headers: {
          'x-tenant-id': 'platform-tenant-1',
          'x-user-id': 'sa-1',
          'x-tenant-plan': 'ENTERPRISE',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Fleet360:/);
    expect(body.qrDataUrl).toMatch(/^data:image\/(png|svg\+xml);base64,/);
  });
});
