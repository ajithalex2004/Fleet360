import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  cleanupTenant,
  cleanupUser,
  createTestUser,
  createTestUserTenant,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
  type TestUser,
} from '../setup';

let serverAvailable = false;

const PASSWORD = 'SecurityTest123!';

interface SessionRow {
  tenantId: string;
}

function cookieFrom(setCookie: string | null) {
  const match = setCookie?.match(/xl-session=[^;]+/);
  expect(match?.[0]).toBeTruthy();
  return match![0];
}

async function loginCookie(email: string, tenantId?: string) {
  const res = await makeRequest('POST', '/api/auth/login', {
    email,
    password: PASSWORD,
    ...(tenantId ? { tenantId } : {}),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body, cookie: res.ok ? cookieFrom(res.headers.get('set-cookie')) : '' };
}

async function latestSessionId(userId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
       FROM auth_sessions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    userId,
  );
  expect(rows[0]?.id).toBeTruthy();
  return rows[0].id;
}

async function approveRequest(approvalId: string, approverCookie: string) {
  const vote = await makeRequest(
    'POST',
    `/api/admin/approvals/${approvalId}/vote`,
    { decision: 'APPROVE', note: 'security test approval' },
    { Cookie: approverCookie },
  );
  expect(vote.status).toBe(200);
}

describe('Admin Security granular API flow', () => {
  let seed: SeedResult;
  let otherSeed: SeedResult;
  let approver: TestUser;
  let approverTwo: TestUser;
  let lockoutUser: TestUser;
  let approverCookie = '';
  let approverTwoCookie = '';
  let requesterCookie = '';
  const createdUsers: string[] = [];

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    [seed, otherSeed] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN', PASSWORD),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN', PASSWORD),
    ]);
    [approver, approverTwo] = await Promise.all([
      createTestUser({ password: PASSWORD }),
      createTestUser({ password: PASSWORD }),
    ]);
    lockoutUser = await createTestUser({ password: PASSWORD });
    await Promise.all([
      createTestUserTenant(approver.id, seed.tenant.id, seed.role.id),
      createTestUserTenant(approverTwo.id, seed.tenant.id, seed.role.id),
      createTestUserTenant(lockoutUser.id, seed.tenant.id, seed.role.id),
    ]);
    createdUsers.push(seed.user.id, otherSeed.user.id, approver.id, approverTwo.id, lockoutUser.id);

    const requesterLogin = await loginCookie(seed.user.email, seed.tenant.id);
    expect(requesterLogin.res.status).toBe(200);
    requesterCookie = requesterLogin.cookie;

    const approverLogin = await loginCookie(approver.email, seed.tenant.id);
    expect(approverLogin.res.status).toBe(200);
    approverCookie = approverLogin.cookie;

    const approverTwoLogin = await loginCookie(approverTwo.email, seed.tenant.id);
    expect(approverTwoLogin.res.status).toBe(200);
    approverTwoCookie = approverTwoLogin.cookie;
  }, 180_000);

  afterAll(async () => {
    if (seed?.tenant?.id) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_mfa_policies WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM auth_sessions WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM auth_login_attempts WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
    }
    if (otherSeed?.tenant?.id) {
      await prisma.$executeRawUnsafe(`DELETE FROM auth_sessions WHERE tenant_id = $1`, otherSeed.tenant.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM auth_login_attempts WHERE tenant_id = $1`, otherSeed.tenant.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE tenant_id = $1`, otherSeed.tenant.id).catch(() => {});
    }
    for (const userId of createdUsers) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE actor_user_id = $1`, userId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE user_id = $1`, userId).catch(() => {});
    }
    await Promise.all([
      approver ? cleanupUser(approver.id) : Promise.resolve(),
      approverTwo ? cleanupUser(approverTwo.id) : Promise.resolve(),
      lockoutUser ? cleanupUser(lockoutUser.id) : Promise.resolve(),
      seed ? cleanupTenant(seed.tenant.id).then(() => cleanupUser(seed.user.id)) : Promise.resolve(),
      otherSeed ? cleanupTenant(otherSeed.tenant.id).then(() => cleanupUser(otherSeed.user.id)) : Promise.resolve(),
    ]);
  }, 90_000);

  it('lists only tenant-scoped sessions for tenant admins', async () => {
    if (!serverAvailable) return;

    const otherLogin = await loginCookie(otherSeed.user.email, otherSeed.tenant.id);
    expect(otherLogin.res.status).toBe(200);

    const ownSessions = await makeRequest(
      'GET',
      `/api/admin/security/sessions?tenantId=${seed.tenant.id}&limit=25`,
      undefined,
      { Cookie: requesterCookie },
    );
    expect(ownSessions.status).toBe(200);
    const ownBody = await ownSessions.json();
    expect(ownBody.sessions.length).toBeGreaterThan(0);
    expect(ownBody.sessions.every((s: SessionRow) => s.tenantId === seed.tenant.id)).toBe(true);

    const crossTenant = await makeRequest(
      'GET',
      `/api/admin/security/sessions?tenantId=${otherSeed.tenant.id}&limit=25`,
      undefined,
      { Cookie: requesterCookie },
    );
    expect(crossTenant.status).toBe(403);
  }, 90_000);

  it('revokes a session only after approval and blocks /api/auth/me with the revoked cookie', async () => {
    if (!serverAvailable) return;

    const victimLogin = await loginCookie(seed.user.email, seed.tenant.id);
    expect(victimLogin.res.status).toBe(200);
    const victimSessionId = await latestSessionId(seed.user.id);

    const queue = await makeRequest(
      'POST',
      `/api/admin/security/sessions/${victimSessionId}/revoke`,
      undefined,
      { Cookie: requesterCookie },
    );
    expect(queue.status).toBe(428);
    const queued = await queue.json();
    expect(queued.approvalRequest?.id).toBeTruthy();

    await approveRequest(queued.approvalRequest.id, approverCookie);
    await approveRequest(queued.approvalRequest.id, approverTwoCookie);

    const retry = await makeRequest(
      'POST',
      `/api/admin/security/sessions/${victimSessionId}/revoke`,
      undefined,
      { Cookie: requesterCookie, 'x-admin-approval-id': queued.approvalRequest.id },
    );
    expect(retry.status).toBe(200);

    const revokedMe = await makeRequest(
      'GET',
      '/api/auth/me',
      undefined,
      { Cookie: victimLogin.cookie },
    );
    expect(revokedMe.status).toBe(401);

    const revokedAdminApi = await makeRequest(
      'GET',
      '/api/admin/security/sessions?limit=5',
      undefined,
      { Cookie: victimLogin.cookie },
    );
    expect(revokedAdminApi.status).toBe(401);

    const history = await prisma.$queryRawUnsafe<Array<{ action: string; after_json: unknown }>>(
      `SELECT action, after_json
         FROM admin_change_history
        WHERE entity_type = 'AuthSession'
          AND entity_id = $1
        ORDER BY created_at DESC`,
      victimSessionId,
    );
    expect(history[0]).toMatchObject({ action: 'REVOKE' });
    expect(history[0].after_json).toMatchObject({ revoked: true });
  }, 120_000);

  it('approval-gates tenant MFA policy changes and enforces them at login', async () => {
    if (!serverAvailable) return;

    const queue = await makeRequest(
      'PATCH',
      '/api/admin/security/mfa-policy',
      {
        scope: 'TENANT',
        tenantId: seed.tenant.id,
        requireAllUsers: false,
        requireAdminRoles: true,
        requiredRoleCodes: [],
        gracePeriodHours: 0,
        isEnabled: true,
      },
      { Cookie: requesterCookie },
    );
    expect(queue.status).toBe(428);
    const queued = await queue.json();
    expect(queued.approvalRequest?.id).toBeTruthy();

    await approveRequest(queued.approvalRequest.id, approverCookie);
    await approveRequest(queued.approvalRequest.id, approverTwoCookie);

    const save = await makeRequest(
      'PATCH',
      '/api/admin/security/mfa-policy',
      {
        scope: 'TENANT',
        tenantId: seed.tenant.id,
        requireAllUsers: false,
        requireAdminRoles: true,
        requiredRoleCodes: [],
        gracePeriodHours: 0,
        isEnabled: true,
      },
      { Cookie: requesterCookie, 'x-admin-approval-id': queued.approvalRequest.id },
    );
    expect(save.status).toBe(200);
    const saved = await save.json();
    expect(saved.policy).toMatchObject({
      scope: 'TENANT',
      tenantId: seed.tenant.id,
      requireAdminRoles: true,
      isEnabled: true,
    });

    const mfaHistory = await prisma.$queryRawUnsafe<Array<{ action: string; before_json: unknown; after_json: unknown }>>(
      `SELECT action, before_json, after_json
         FROM admin_change_history
        WHERE entity_type = 'MfaPolicy'
          AND tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      seed.tenant.id,
    );
    expect(mfaHistory[0]).toMatchObject({ action: 'UPDATE' });
    expect(mfaHistory[0].before_json).toBeTruthy();
    expect(mfaHistory[0].after_json).toBeTruthy();

    const auditRows = await prisma.$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT action
         FROM audit_logs
        WHERE entity_type = 'MfaPolicy'
          AND tenant_id = $1
          AND user_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      seed.tenant.id,
      seed.user.id,
    );
    expect(auditRows[0]).toMatchObject({ action: 'UPDATE' });

    const summary = await makeRequest(
      'GET',
      `/api/admin/security/summary?tenantId=${seed.tenant.id}`,
      undefined,
      { Cookie: requesterCookie },
    );
    expect(summary.status).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody.policy.enforcedAtLogin).toBe(true);

    const blockedLogin = await makeRequest('POST', '/api/auth/login', {
      email: seed.user.email,
      password: PASSWORD,
      tenantId: seed.tenant.id,
    });
    expect(blockedLogin.status).toBe(403);
    const blockedBody = await blockedLogin.json();
    expect(blockedBody).toMatchObject({ mfaEnrollmentRequired: true });
  }, 120_000);

  it('surfaces failed-login and account-lockout evidence in the security summary', async () => {
    if (!serverAvailable) return;

    for (let i = 0; i < 5; i += 1) {
      const badLogin = await makeRequest('POST', '/api/auth/login', {
        email: lockoutUser.email,
        password: 'WrongPassword123!',
        tenantId: seed.tenant.id,
      });
      expect([401, 423]).toContain(badLogin.status);
    }

    const lockedLogin = await makeRequest('POST', '/api/auth/login', {
      email: lockoutUser.email,
      password: PASSWORD,
      tenantId: seed.tenant.id,
    });
    expect(lockedLogin.status).toBe(423);
    const lockedBody = await lockedLogin.json();
    expect(lockedBody.lockedUntil).toBeTruthy();

    const summary = await makeRequest(
      'GET',
      `/api/admin/security/summary?tenantId=${seed.tenant.id}`,
      undefined,
      { Cookie: requesterCookie },
    );
    expect(summary.status).toBe(200);
    const body = await summary.json();
    expect(body.loginSecurity.failedLogins24h).toBeGreaterThanOrEqual(5);
    expect(body.loginSecurity.lockedAccounts).toBeGreaterThanOrEqual(1);
    expect(body.loginSecurity.recentFailures.some((row: { email: string; lockedUntil: string | null }) => (
      row.email === lockoutUser.email.toLowerCase() && !!row.lockedUntil
    ))).toBe(true);
  }, 90_000);
});
