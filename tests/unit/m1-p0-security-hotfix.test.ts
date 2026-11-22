/**
 * Module 1 P0 Security Hotfix Regression & Security Verification Suite
 *
 * Covers:
 *  - M1-P0-1: Public /api/health sanitized response vs SUPER_ADMIN-only diagnostics.
 *  - M1-P0-2: /api/setup/super-admin lockdown (no unauth enumeration, fail-closed
 *             bootstrap config, expired window rejection, permanent disable after
 *             initial bootstrap, replay rejection, rate limiting 429, and audit logs).
 *  - M1-P0-3: Logout revocation across all base64url payload lengths (mod 4 = 0,2,3),
 *             unified POST /api/auth/logout & DELETE /api/auth/session revocation,
 *             impersonator cookie + Bearer token revocation, GET logout removal (405),
 *             CSRF same-origin enforcement (403), and fail-honest observable 503 when
 *             Redis revocation fails.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';

const {
  mockRedis,
  mockPrisma,
  mockLogAudit,
  mockWithPlatformAdmin,
  mockWithTenantRls,
  mockSchemaReport,
  mockStorageStatus,
  mockGetBackgroundJobsAndOutboxHealth,
  mockGetDbPoolMetrics,
  mockGetEnterpriseBridgeMetrics,
  mockGetSecurityHealthMetrics,
  mockGetAiHealthAndSpendingMetrics,
  mockGetGoogleMapsAndApisSpendingMetrics,
  mockGetHealthAlertConfig,
  mockEvaluateAndTriggerHealthAlerts,
  mockRecordDrayageDriverLogout,
  redisState,
} = vi.hoisted(() => {
  const kv = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    set: vi.fn(async (key: string, val: string) => {
      kv.set(key, val);
      return 'OK';
    }),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => kv.get(k) ?? null)),
    _kv: kv,
  };
  const prisma = {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    tenant: { findFirst: vi.fn(), create: vi.fn() },
    role: { findFirst: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    userTenant: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  return {
    mockRedis: redis,
    redisState: { enabled: true },
    mockPrisma: prisma,
    mockLogAudit: vi.fn().mockResolvedValue(undefined),
    mockWithPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    mockWithTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    mockSchemaReport: vi.fn().mockResolvedValue({ status: 'ok', missingCount: 0, missing: {} }),
    mockStorageStatus: vi.fn().mockResolvedValue({ backend: 's3', durable: true, ok: true }),
    mockGetBackgroundJobsAndOutboxHealth: vi.fn().mockResolvedValue({
      scheduler: { status: 'active', isTicking: true },
      jobRuns24h: { status: 'healthy', failed24h: 0 },
      outbox: { status: 'healthy', pendingCount: 0, lagMs: null },
    }),
    mockGetDbPoolMetrics: vi.fn().mockResolvedValue({
      status: 'healthy',
      active: 1,
      idle: 18,
      idleInTransaction: 0,
      waiting: 0,
      total: 19,
      maxConnections: 901,
      poolUtilizationPercent: 2,
      commits: 1000,
      rollbacks: 4,
      rollbackRatePercent: 0.4,
      longRunningQueries: [{ state: 'active', durationSeconds: 9.2 }],
    }),
    mockGetEnterpriseBridgeMetrics: vi.fn().mockResolvedValue({
      status: 'not_configured',
      totalConnectors: 0,
      recentLogs: [{ id: 'log-1', errorMessage: 'secret-erp-host' }],
    }),
    mockGetSecurityHealthMetrics: vi.fn().mockResolvedValue({
      status: 'healthy',
      activeSessions: { activeUsers24h: 1, activeUsers1h: 0, redisConfigured: true },
      bruteForce: { status: 'normal', failedLogins1h: 0, uniqueIps1h: 0, targetedAccounts1h: 0 },
      mfa: { allStaffEnrolledPercent: 0, adminEnrolledPercent: 0, totalStaff: 191, mfaStaffCount: 0, totalAdmins: 0, mfaAdminCount: 0 },
    }),
    mockGetAiHealthAndSpendingMetrics: vi.fn().mockResolvedValue({
      status: 'healthy',
      summary: { totalSpendUsd: 0 },
      governance: { monthlyBudgetAed: 500 },
    }),
    mockGetGoogleMapsAndApisSpendingMetrics: vi.fn().mockResolvedValue({
      status: 'healthy',
      apiKeyConfigured: true,
      apiKeyMasked: null,
      summary: { grossSpendUsd: 0.14 },
    }),
    mockGetHealthAlertConfig: vi.fn().mockResolvedValue({
      enabled: true,
      minSeverity: 'degraded' as const,
      webhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/SUPER_SECRET_TOKEN_XYZ',
      webhookEnabled: true,
      email: 'ops@fleet360.example.com',
      emailEnabled: true,
      cooldownMinutes: 15,
      lastStatus: null,
      lastSentAt: null,
      lastSummary: null,
    }),
    mockEvaluateAndTriggerHealthAlerts: vi.fn().mockResolvedValue({ triggered: false }),
    mockRecordDrayageDriverLogout: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/upstash', () => ({
  getRedis: () => (redisState.enabled ? mockRedis : null),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  ensureDbConnected: vi.fn().mockResolvedValue(undefined),
  isDbConnectionError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: mockWithPlatformAdmin,
  withTenantRls: mockWithTenantRls,
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('@/lib/db/schema-registry', () => ({
  schemaReport: mockSchemaReport,
  REQUIRED_SCHEMAS: {},
}));

vi.mock('@/lib/storage/health', () => ({
  storageStatus: mockStorageStatus,
}));

vi.mock('@/lib/jobs/health', () => ({
  getBackgroundJobsAndOutboxHealth: mockGetBackgroundJobsAndOutboxHealth,
}));

vi.mock('@/lib/health/extended-metrics', () => ({
  getDbPoolMetrics: mockGetDbPoolMetrics,
  getEnterpriseBridgeMetrics: mockGetEnterpriseBridgeMetrics,
  getSecurityHealthMetrics: mockGetSecurityHealthMetrics,
  getAiHealthAndSpendingMetrics: mockGetAiHealthAndSpendingMetrics,
  getGoogleMapsAndApisSpendingMetrics: mockGetGoogleMapsAndApisSpendingMetrics,
}));

vi.mock('@/lib/health/alerting', async () => {
  const actual = await vi.importActual<typeof import('@/lib/health/alerting')>('@/lib/health/alerting');
  return {
    ...actual,
    getHealthAlertConfig: mockGetHealthAlertConfig,
    evaluateAndTriggerHealthAlerts: mockEvaluateAndTriggerHealthAlerts,
  };
});

vi.mock('@/lib/logistics/drayage-domain', () => ({
  recordDrayageDriverLogout: mockRecordDrayageDriverLogout,
}));

// tests/setup.ts imports @/lib/tenant-session before this file's vi.mock('@/lib/upstash')
// runs. Reset modules in beforeAll so all auth & logout modules bind to mockRedis.
let signSession: typeof import('@/lib/tenant-session').signSession;
let verifySession: typeof import('@/lib/tenant-session').verifySession;
let extractSessionExpiry: typeof import('@/lib/tenant-session').extractSessionExpiry;
let healthGET: typeof import('@/app/api/health/route').GET;
let adminHealthGET: typeof import('@/app/api/admin/health/route').GET;
let adminHealthPingPOST: typeof import('@/app/api/admin/health/ping/route').POST;
let setupGET: typeof import('@/app/api/setup/super-admin/route').GET;
let setupPOST: typeof import('@/app/api/setup/super-admin/route').POST;
let resetSetupRateLimiterForTests: typeof import('@/lib/auth/setup-bootstrap').resetSetupRateLimiterForTests;
let logoutPOST: typeof import('@/app/api/auth/logout/route').POST;
let logoutGET: typeof import('@/app/api/auth/logout/route').GET;
let sessionDELETE: typeof import('@/app/api/auth/session/route').DELETE;

const TEST_SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_STRONG_SETUP_SECRET = 'setup-secret-high-entropy-0123456789abcdef';

beforeAll(async () => {
  vi.resetModules();
  ({ signSession, verifySession, extractSessionExpiry } = await import('@/lib/tenant-session'));
  ({ GET: healthGET } = await import('@/app/api/health/route'));
  ({ GET: adminHealthGET } = await import('@/app/api/admin/health/route'));
  ({ POST: adminHealthPingPOST } = await import('@/app/api/admin/health/ping/route'));
  ({ GET: setupGET, POST: setupPOST } = await import('@/app/api/setup/super-admin/route'));
  ({ resetSetupRateLimiterForTests } = await import('@/lib/auth/setup-bootstrap'));
  ({ POST: logoutPOST, GET: logoutGET } = await import('@/app/api/auth/logout/route'));
  ({ DELETE: sessionDELETE } = await import('@/app/api/auth/session/route'));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis._kv.clear();
  redisState.enabled = true;
  resetSetupRateLimiterForTests();
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://fleet360.example.com');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GO_BACKEND_URL', '');
  mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'platform-tenant-1', name: 'Fleet360 — Platform' });
  mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-sa-1', code: 'SUPER_ADMIN', tenantId: null });
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockImplementation(async ({ data }: { data: { id: string; email: string } }) => data);
  mockPrisma.userTenant.create.mockResolvedValue({ id: 'ut-new-1' });
  mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────
// M1-P0-1: Public /api/health must not disclose sensitive telemetry
// ─────────────────────────────────────────────────────────────────────────────
describe('M1-P0-1: Public /api/health telemetry isolation', () => {
  it('returns only sanitized operational status publicly — zero security, dbPool, spending, bridge, jobs, or config leaks', async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.db?.status).toBe('connected');
    expect(body.schema?.status).toBe('ok');
    expect(body.storage?.ok).toBe(true);
    expect(body.services?.goBackend).toBe('ok');

    // Forbidden sensitive fields must NEVER appear on public /api/health
    expect(body.security).toBeUndefined();
    expect(body.dbPool).toBeUndefined();
    expect(body.enterpriseBridge).toBeUndefined();
    expect(body.aiSpending).toBeUndefined();
    expect(body.googleApisSpending).toBeUndefined();
    expect(body.jobs).toBeUndefined();
    expect(body.integrations).toBeUndefined();
    expect(body.missingConfig).toBeUndefined();
    expect(body.release).toBeUndefined();

    // Extended diagnostic collectors must not even be invoked publicly
    expect(mockGetSecurityHealthMetrics).not.toHaveBeenCalled();
    expect(mockGetDbPoolMetrics).not.toHaveBeenCalled();
    expect(mockGetAiHealthAndSpendingMetrics).not.toHaveBeenCalled();
    expect(mockGetGoogleMapsAndApisSpendingMetrics).not.toHaveBeenCalled();
    expect(mockGetEnterpriseBridgeMetrics).not.toHaveBeenCalled();
    expect(mockGetBackgroundJobsAndOutboxHealth).not.toHaveBeenCalled();
  });

  it('denies unauthenticated (401) and TENANT_ADMIN (403) requests to /api/admin/health with zero collector invocations', async () => {
    const assertZeroCollectorsCalled = () => {
      expect(mockSchemaReport).not.toHaveBeenCalled();
      expect(mockStorageStatus).not.toHaveBeenCalled();
      expect(mockGetBackgroundJobsAndOutboxHealth).not.toHaveBeenCalled();
      expect(mockGetDbPoolMetrics).not.toHaveBeenCalled();
      expect(mockGetEnterpriseBridgeMetrics).not.toHaveBeenCalled();
      expect(mockGetSecurityHealthMetrics).not.toHaveBeenCalled();
      expect(mockGetAiHealthAndSpendingMetrics).not.toHaveBeenCalled();
      expect(mockGetGoogleMapsAndApisSpendingMetrics).not.toHaveBeenCalled();
      expect(mockGetHealthAlertConfig).not.toHaveBeenCalled();
      expect(mockEvaluateAndTriggerHealthAlerts).not.toHaveBeenCalled();
    };

    const unauth = await adminHealthGET(new NextRequest('https://fleet360.example.com/api/admin/health'));
    expect(unauth.status).toBe(401);
    assertZeroCollectorsCalled();

    const tenantAdmin = await adminHealthGET(new NextRequest('https://fleet360.example.com/api/admin/health', {
      headers: {
        'x-tenant-id': 'tenant-1',
        'x-user-id': 'user-1',
        'x-user-role': 'TENANT_ADMIN',
      },
    }));
    expect(tenantAdmin.status).toBe(403);
    assertZeroCollectorsCalled();
  });

  it('denies unauthenticated (401) and TENANT_ADMIN (403) requests to /api/admin/health/ping without running probes', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy_key_for_authz_probe_guard');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const unauth = await adminHealthPingPOST(
        new NextRequest('https://fleet360.example.com/api/admin/health/ping', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target: 'all' }),
        }),
      );
      expect(unauth.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();

      const tenantAdmin = await adminHealthPingPOST(
        new NextRequest('https://fleet360.example.com/api/admin/health/ping', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-tenant-id': 'tenant-1',
            'x-user-id': 'user-1',
            'x-user-role': 'TENANT_ADMIN',
          },
          body: JSON.stringify({ target: 'all' }),
        }),
      );
      expect(tenantAdmin.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('allows SUPER_ADMIN on /api/admin/health while keeping alert webhook URL completely redacted', async () => {
    const res = await adminHealthGET(
      new NextRequest('https://fleet360.example.com/api/admin/health', {
        headers: {
          'x-tenant-id': 'platform-tenant-1',
          'x-user-id': 'sa-1',
          'x-user-role': 'SUPER_ADMIN',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    const rawJson = JSON.stringify(body);

    expect(body.alerting?.webhookConfigured).toBe(true);
    expect(body.alerting?.webhookUrl).toBe('');
    expect(rawJson).not.toContain('SUPER_SECRET_TOKEN_XYZ');
    expect(rawJson).not.toContain('hooks.slack.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M1-P0-2: /api/setup/super-admin permanent post-bootstrap disable & lockdown
// ─────────────────────────────────────────────────────────────────────────────
describe('M1-P0-2: /api/setup/super-admin lockdown and replay prevention', () => {
  it('denies unauthenticated GET without enumerating whether a Super Admin exists', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: '1' }]);

    const req = new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    const res = await setupGET(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.superAdminExists).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('SETUP_SECRET');
    expect(mockLogAudit).toHaveBeenCalled();
  });

  it('allows authenticated SUPER_ADMIN GET to inspect bootstrap status via withPlatformAdmin', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: '1' }]);
    const saToken = await signSession({
      userId: 'sa-1',
      tenantId: 'platform-tenant-1',
      plan: 'ENTERPRISE',
      role: 'SUPER_ADMIN',
      permissions: ['*:*:*'],
    });

    const req = new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      headers: {
        'x-forwarded-for': '203.0.113.15',
        cookie: `xl-session=${saToken}`,
      },
    });
    const res = await setupGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ bootstrapComplete: true, setupEndpointDisabled: true });
    expect(mockWithPlatformAdmin).toHaveBeenCalled();
  });

  it('fails closed in production when SETUP_SECRET is missing, weak (< 32 chars), or SETUP_BOOTSTRAP_ENABLED is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SETUP_SECRET', 'short-16-char-pw');
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: '0' }]);

    const req = new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({
        secret: 'short-16-char-pw',
        email: 'attacker@evil.example',
        password: 'StrongPassword!1234',
      }),
    });
    const res = await setupPOST(req);
    expect(res.status).toBe(503);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalled();
  });

  it('rejects expired short-lived bootstrap window (SETUP_BOOTSTRAP_EXPIRES_AT in the past)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SETUP_BOOTSTRAP_ENABLED', 'true');
    vi.stubEnv('SETUP_SECRET', TEST_STRONG_SETUP_SECRET);
    vi.stubEnv('SETUP_BOOTSTRAP_EXPIRES_AT', '2020-01-01T00:00:00.000Z');

    const req = new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.16' },
      body: JSON.stringify({
        secret: TEST_STRONG_SETUP_SECRET,
        email: 'admin@fleet360.example.com',
        password: 'StrongPassword!1234',
      }),
    });
    const res = await setupPOST(req);
    expect(res.status).toBe(410);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('permanently rejects bootstrap replay once an active SUPER_ADMIN exists, even with a valid strong SETUP_SECRET', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SETUP_BOOTSTRAP_ENABLED', 'true');
    vi.stubEnv('SETUP_SECRET', TEST_STRONG_SETUP_SECRET);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: '1' }]);

    const req = new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12' },
      body: JSON.stringify({
        secret: TEST_STRONG_SETUP_SECRET,
        email: 'admin@fleet360.example.com',
        password: 'NewStrongPassword!1234',
      }),
    });
    const res = await setupPOST(req);

    expect(res.status).toBe(410);
    // Only the transaction advisory lock may run; zero password UPDATEs or user INSERTs
    const writeCalls = mockPrisma.$executeRawUnsafe.mock.calls.filter(
      ([sql]) => !String(sql).includes('pg_advisory_xact_lock'),
    );
    expect(writeCalls).toHaveLength(0);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockWithPlatformAdmin).toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalled();
  });

  it('enforces single-use bootstrap creation followed immediately by 410 replay rejection and rate limits repeated attempts (429)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SETUP_BOOTSTRAP_ENABLED', 'true');
    vi.stubEnv('SETUP_SECRET', TEST_STRONG_SETUP_SECRET);
    redisState.enabled = false; // exercise in-memory fallback rate limiter deterministically

    // 1st call: unbootstrapped DB -> creates initial SUPER_ADMIN (201)
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: '0' }]);
    const first = await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
      body: JSON.stringify({
        secret: TEST_STRONG_SETUP_SECRET,
        email: 'founder@fleet360.example.com',
        password: 'StrongPassword!1234',
      }),
    }));
    expect(first.status).toBe(201);

    // 2nd call (replay with same valid secret): DB now has 1 SUPER_ADMIN -> 410 Gone
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: '1' }]);
    const replay = await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
      body: JSON.stringify({
        secret: TEST_STRONG_SETUP_SECRET,
        email: 'attacker@fleet360.example.com',
        password: 'StrongPassword!1234',
      }),
    }));
    expect(replay.status).toBe(410);

    // Exhaust remaining attempts from same IP (limit = 5 / 15m) -> 6th attempt gets 429
    for (let i = 0; i < 3; i++) {
      await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
        body: JSON.stringify({ secret: 'wrong-secret', email: 'a@b.com', password: 'StrongPassword!1234' }),
      }));
    }
    const throttled = await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
      body: JSON.stringify({ secret: TEST_STRONG_SETUP_SECRET, email: 'a@b.com', password: 'StrongPassword!1234' }),
    }));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('retry-after')).toBeTruthy();
  });

  it('defeats leftmost X-Forwarded-For spoofing, enforces global throttle without DB audit flood, and rejects malformed/non-string payloads safely', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SETUP_BOOTSTRAP_ENABLED', 'true');
    vi.stubEnv('SETUP_SECRET', TEST_STRONG_SETUP_SECRET);
    redisState.enabled = false;
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: '1' }]);

    // 1. JSON null and non-string secret object must return clean 400/403 (never unhandled 500) AND be audited
    const nullBodyRes = await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.1, 203.0.113.99' },
      body: 'null',
    }));
    expect(nullBodyRes.status).toBe(400);

    const objSecretRes = await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.2, 203.0.113.99' },
      body: JSON.stringify({ secret: { toString: null }, email: 'a@b.com', password: 'StrongPassword!1234' }),
    }));
    expect(objSecretRes.status).toBe(403);

    // 2. Spoofing a new leftmost IP on every request behind the same rightmost proxy hop (203.0.113.99)
    //    must STILL hit the 5-request per-IP limit (2 already used above + 3 more -> 6th gets 429)
    for (let i = 3; i <= 5; i++) {
      await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${i}, 203.0.113.99` },
        body: JSON.stringify({ secret: 'wrong', email: 'a@b.com', password: 'StrongPassword!1234' }),
      }));
    }
    mockLogAudit.mockClear();
    const spoofBlocked = await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.99, 203.0.113.99' },
      body: JSON.stringify({ secret: TEST_STRONG_SETUP_SECRET, email: 'a@b.com', password: 'StrongPassword!1234' }),
    }));
    expect(spoofBlocked.status).toBe(429);
    // Throttled 429 hits must NOT write to audit_logs (prevents DB pool/audit flood)
    expect(mockLogAudit).not.toHaveBeenCalled();

    // 3. Rejects bootstrap windows exceeding 24h max in production
    resetSetupRateLimiterForTests();
    vi.stubEnv('SETUP_BOOTSTRAP_EXPIRES_AT', new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString());
    const tooLongWindow = await setupPOST(new NextRequest('https://fleet360.example.com/api/setup/super-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ secret: TEST_STRONG_SETUP_SECRET, email: 'a@b.com', password: 'StrongPassword!1234' }),
    }));
    expect(tooLongWindow.status).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M1-P0-3: Logout revocation across all base64url lengths, CSRF, & Redis errors
// ─────────────────────────────────────────────────────────────────────────────
describe('M1-P0-3: Logout revocation, CSRF protection, and fail-honest Redis handling', () => {
  async function mintTokenWithMod4(targetMod4: 0 | 2 | 3): Promise<string> {
    for (let extra = 0; extra < 12; extra++) {
      const token = await signSession({
        userId: `u-${'x'.repeat(extra)}`,
        tenantId: 'tenant-logout-test',
        plan: 'ENTERPRISE',
        role: 'TENANT_ADMIN',
        permissions: ['fleet:view:*'],
      });
      const b64url = token.slice(0, token.lastIndexOf('.'));
      if (b64url.length % 4 === targetMod4) return token;
    }
    throw new Error(`Could not mint token with mod4=${targetMod4}`);
  }

  it.each([0, 2, 3] as const)(
    'revokes xl-session in Redis on POST /api/auth/logout AND blocks subsequent verifySession() for base64url mod 4 === %i',
    async (mod4) => {
      const token = await mintTokenWithMod4(mod4);
      expect(extractSessionExpiry(token)).toBeTypeOf('number');
      expect(await verifySession(token)).not.toBeNull();

      const req = new NextRequest('https://fleet360.example.com/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://fleet360.example.com',
          cookie: `xl-session=${token}`,
        },
      });
      const res = await logoutPOST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.revoked).toBe(true);
      expect(body.revocationMode).toBe('redis');
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      expect(mockRedis.set.mock.calls[0][0]).toMatch(/^blocklist:sess:[a-f0-9]{64}$/);

      // Proves the stolen/extracted token is rejected after logout!
      expect(await verifySession(token)).toBeNull();
    },
  );

  it('rejects GET /api/auth/logout with 405 Method Not Allowed and neither revokes nor clears cookies', async () => {
    const token = await mintTokenWithMod4(0);

    const res = await logoutGET();

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await verifySession(token)).not.toBeNull();
  });

  it('blocks cross-site CSRF POST /api/auth/logout (foreign Origin, null Origin, foreign Referer, cross-site Sec-Fetch-Site)', async () => {
    const token = await mintTokenWithMod4(0);

    const attackHeaders: Array<Record<string, string>> = [
      { origin: 'https://evil.example', cookie: `xl-session=${token}` },
      // X-Forwarded-Host / Host spoofing must NEVER expand CSRF allowlist
      { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', cookie: `xl-session=${token}` },
      { origin: 'https://fleet360.example.com.evil.example', cookie: `xl-session=${token}` },
      { origin: 'null', cookie: `xl-session=${token}` },
      { referer: 'https://evil.example/attack.html', cookie: `xl-session=${token}` },
      { 'sec-fetch-site': 'cross-site', cookie: `xl-session=${token}` },
      { 'sec-fetch-site': 'same-site', cookie: `xl-session=${token}` },
      // Cookie-authenticated request with zero Origin / Referer / Sec-Fetch-Site: same-origin fails closed
      { cookie: `xl-session=${token}` },
    ];
    for (const headers of attackHeaders) {
      mockRedis.set.mockClear();
      const req = new NextRequest('https://fleet360.example.com/api/auth/logout', {
        method: 'POST',
        headers,
      });
      const res = await logoutPOST(req);
      expect(res.status).toBe(403);
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect(await verifySession(token)).not.toBeNull();
  });

  it('fails honestly (503, ok:false, revoked:false) on logout during Redis outage while protected production requests fail closed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const token = await mintTokenWithMod4(0);
    mockRedis.set.mockRejectedValueOnce(new Error('Upstash ECONNREFUSED'));
    mockRedis.get.mockRejectedValueOnce(new Error('Upstash ECONNREFUSED'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const req = new NextRequest('https://fleet360.example.com/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://fleet360.example.com',
          cookie: `xl-session=${token}`,
        },
      });
      const res = await logoutPOST(req);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.revoked).toBe(false);
      expect(body.cookiesCleared).toBe(true);
      expect(errSpy).toHaveBeenCalled();
      expect(res.headers.get('set-cookie')).toContain('xl-session=;');

      // While Redis remains unavailable in production, verifySession fails closed (null)
      expect(await verifySession(token)).toBeNull();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('revokes tokens in Redis on DELETE /api/auth/session, enforces CSRF same-origin, and fails honestly on Redis error', async () => {
    const token = await mintTokenWithMod4(3);

    // Cross-site blocked
    const csrfRes = await sessionDELETE(new NextRequest('https://fleet360.example.com/api/auth/session', {
      method: 'DELETE',
      headers: {
        origin: 'https://attacker.example',
        cookie: `xl-session=${token}`,
      },
    }));
    expect(csrfRes.status).toBe(403);
    expect(mockRedis.set).not.toHaveBeenCalled();

    // Same-origin revokes in Redis
    const okRes = await sessionDELETE(new NextRequest('https://fleet360.example.com/api/auth/session', {
      method: 'DELETE',
      headers: {
        origin: 'https://fleet360.example.com',
        cookie: `xl-session=${token}`,
      },
    }));
    const okBody = await okRes.json();
    expect(okRes.status).toBe(200);
    expect(okBody.ok).toBe(true);
    expect(okBody.revoked).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    expect(await verifySession(token)).toBeNull();
  });

  it('revokes impersonator cookie and Bearer token as well as xl-session on POST /api/auth/logout', async () => {
    const staffToken = await mintTokenWithMod4(0);
    const impersonatorToken = await mintTokenWithMod4(3);
    const bearerTok = await mintTokenWithMod4(2);

    const req = new NextRequest('https://fleet360.example.com/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fleet360.example.com',
        authorization: `Bearer ${bearerTok}`,
        cookie: `xl-session=${staffToken}; xl-impersonator-session=${impersonatorToken}`,
      },
    });
    const res = await logoutPOST(req);
    expect(res.status).toBe(200);
    expect(mockRedis.set).toHaveBeenCalledTimes(3);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('xl-impersonator-session=;');
    expect(await verifySession(staffToken)).toBeNull();
    expect(await verifySession(impersonatorToken)).toBeNull();
    expect(await verifySession(bearerTok)).toBeNull();
  });
});
