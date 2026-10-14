/**
 * tests/unit/account-emails.test.ts
 *
 * Account emails through the email templates:
 *  - password reset: platform wording, the user's organisation language, a
 *    link built from the app URL (never the Host header); nothing for an
 *    unknown address
 *  - user invitation: the tenant's wording, from the inviter, sent after the
 *    invitation is saved
 *  - sign-up verification code: platform wording, a 6-digit code that is
 *    never logged, and an error when it can't be sent
 *  - which templates only platform administrators can edit
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';

const state = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  sendOk: true,
  inTx: false,
  sentInTx: 0,
  users: [] as Array<{ id: string; username: string }>,
  membership: [] as Array<{ tenant_id: string }>,
  sql: [] as Array<{ sql: string; args: unknown[] }>,
  preVerification: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/email-templates', () => ({
  NO_TENANT: '*',
  appUrl: (p: string) => `https://app.fleet.test${p}`,
  sendTemplatedEmail: async (args: Record<string, unknown>) => {
    if (state.inTx) state.sentInTx += 1;
    state.sent.push(args);
    return state.sendOk ? { sent: true } : { sent: false, reason: 'smtp_not_configured' };
  },
}));
vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: <T>(_t: string, fn: () => Promise<T>) => fn(),
}));
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: <T>(h: T) => h }));
vi.mock('@/lib/session-user', () => ({ sessionUser: async () => ({ email: 'sara@acme.test', name: 'Sara Khan' }) }));
vi.mock('@/lib/plan-limits', () => ({ requireUnderQuota: () => null, getLimits: () => ({ maxUsers: 100 }) }));
vi.mock('@/lib/admin-scope', () => ({ checkGrantableRole: () => null }));

const tx = vi.hoisted(() => ({
  role: {
    findFirst: async () => ({ id: 'r1', name: 'Fleet Manager', code: 'FLEET_MANAGER', tenantId: 'tenant-a' }),
    // The role's permissions, for narrowing module access (member-onboarding.ts).
    findUnique: async () => ({ id: 'r1', name: 'Fleet Manager', code: 'FLEET_MANAGER', tenantId: 'tenant-a', permissions: [] }),
  },
  tenant: { findUnique: async () => ({ id: 'tenant-a', name: 'Acme Fleet', plan: 'ENTERPRISE', isActive: true }) },
  department: { findFirst: async () => null },
  userTenant: { findFirst: async () => null, count: async () => 1 },
  $queryRawUnsafe: async () => [{ c: 0n }],
  $executeRawUnsafe: async (sql: string, ...args: unknown[]) => { state.sql.push({ sql, args }); return 1; },
}));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => Promise<unknown>) => {
    state.inTx = true;
    try { return await fn(tx); } finally { state.inTx = false; }
  },
  // Invitations are written in platform context (src/lib/admin/member-onboarding.ts).
  withPlatformAdmin: async (_p: unknown, fn: (t: unknown) => Promise<unknown>) => {
    state.inTx = true;
    try { return await fn(tx); } finally { state.inTx = false; }
  },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
      state.sql.push({ sql, args });
      if (sql.includes('FROM "User"')) return state.users;
      if (sql.includes('FROM user_tenants')) return state.membership;
      if (sql.includes('FROM domain_pre_verifications')) return state.preVerification ? [state.preVerification] : [];
      return [];
    },
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) => { state.sql.push({ sql, args }); return 1; },
  },
}));

import { NextRequest } from 'next/server';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { POST as invite } from '@/app/api/admin/tenants/[id]/invitations/route';
import { POST as preVerify } from '@/app/api/tenants/pre-verify-domain/route';
import { getTemplateDef } from '@/lib/email-templates/catalogue';

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  Object.assign(state, { sent: [], sendOk: true, inTx: false, sentInTx: 0, users: [], membership: [], sql: [], preVerification: null });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('password reset', () => {
  it("emails the platform's reset template in the user's organisation language", async () => {
    state.users = [{ id: 'u1', username: 'fatima.ali' }];
    state.membership = [{ tenant_id: TENANT }];
    const res = await forgotPassword(json('https://evil.example/api/auth/forgot-password', { email: 'Fatima@Acme.test' }, { host: 'evil.example' }));
    expect(res.status).toBe(200);
    expect(state.sent).toHaveLength(1);
    const [m] = state.sent as Array<{ tenantId: string; key: string; to: string; values: Record<string, string> }>;
    expect(m).toMatchObject({ tenantId: TENANT, key: 'account.password_reset', to: 'fatima@acme.test' });
    expect(m.values.userName).toBe('fatima.ali');
    expect(m.values.validMinutes).toBe('60');
    expect(m.values.resetUrl).toMatch(/^https:\/\/app\.fleet\.test\/reset-password\?token=[0-9a-f]{64}$/);
    // Only the token's hash is stored.
    const insert = state.sql.find((q) => q.sql.includes('INSERT INTO password_reset_tokens'))!;
    expect(m.values.resetUrl).not.toContain(String(insert.args[1]));
  });

  it('uses the platform (English) when the user has no organisation', async () => {
    state.users = [{ id: 'u1', username: 'ops' }];
    await forgotPassword(json('http://localhost/api/auth/forgot-password', { email: 'ops@platform.test' }));
    expect((state.sent[0] as { tenantId: string }).tenantId).toBe('*');
  });

  it('sends nothing for an unknown address, with the same answer', async () => {
    const res = await forgotPassword(json('http://localhost/api/auth/forgot-password', { email: 'nobody@acme.test' }));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/If an account exists/);
    expect(state.sent).toHaveLength(0);
  });
});

describe('user invitation', () => {
  it("sends the tenant's invitation after it is saved, from the inviter", async () => {
    const res = await invite(
      json(`http://localhost/api/admin/tenants/${TENANT}/invitations`, { email: 'New.User@acme.test', roleId: 'r1' },
        { 'x-tenant-id': TENANT, 'x-user-id': 'admin-1', 'x-user-role': 'TENANT_ADMIN' }),
      { params: Promise.resolve({ id: TENANT }) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, emailed: true });
    expect(state.sentInTx).toBe(0);
    const [m] = state.sent as Array<{ tenantId: string; key: string; to: string; replyTo: string; values: Record<string, string> }>;
    expect(m).toMatchObject({ tenantId: TENANT, key: 'account.user_invitation', to: 'new.user@acme.test', replyTo: 'sara@acme.test' });
    expect(m.values).toMatchObject({ roleName: 'Fleet Manager', invitedBy: 'Sara Khan', validDays: '7' });
    expect(m.values.acceptUrl).toMatch(/^https:\/\/app\.fleet\.test\/invitation\/[0-9a-f]+$/);
    expect(state.sql.some((q) => q.sql.includes('INSERT INTO tenant_invitations'))).toBe(true);
  });

  it('returns the link to pass on when the email could not be sent', async () => {
    state.sendOk = false;
    const res = await invite(
      json(`http://localhost/api/admin/tenants/${TENANT}/invitations`, { email: 'x@acme.test', roleId: 'r1' },
        { 'x-tenant-id': TENANT, 'x-user-id': 'admin-1', 'x-user-role': 'TENANT_ADMIN' }),
      { params: Promise.resolve({ id: TENANT }) },
    );
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, emailed: false, reason: 'smtp_not_configured' });
    expect(body.acceptUrl).toMatch(/\/invitation\//);
  });
});

describe('sign-up verification code', () => {
  const sendOtp = () => preVerify(json('http://localhost/api/tenants/pre-verify-domain?action=send-otp', { id: 'pv1', email: 'owner@acme.ae' }));

  it('emails a 6-digit code with the platform template and never logs it', async () => {
    state.preVerification = { id: 'pv1', domain: 'acme.ae', verified: false, expires_at: new Date(Date.now() + 3600_000).toISOString() };
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const res = await sendOtp();
    expect(res.status).toBe(200);
    const [m] = state.sent as Array<{ tenantId: string; key: string; to: string; values: Record<string, string> }>;
    expect(m).toMatchObject({ tenantId: '*', key: 'account.domain_verification_code', to: 'owner@acme.ae' });
    expect(m.values.code).toMatch(/^\d{6}$/);
    expect(m.values).toMatchObject({ domain: 'acme.ae', validMinutes: '15' });
    const logged = logs.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
    expect(logged).not.toContain(m.values.code);
  });

  it('tells the user when the code could not be sent', async () => {
    state.preVerification = { id: 'pv1', domain: 'acme.ae', verified: false, expires_at: new Date(Date.now() + 3600_000).toISOString() };
    state.sendOk = false;
    const res = await sendOtp();
    expect(res.status).toBe(503);
  });
});

describe('who edits the account templates', () => {
  it('keeps security and platform emails platform-only; invitations are the tenant\'s', () => {
    for (const key of ['account.password_reset', 'account.domain_verification_code', 'account.domain_verification_link', 'exchange.partner_invitation']) {
      expect(getTemplateDef(key)?.platformOnly, key).toBe(true);
    }
    expect(getTemplateDef('account.user_invitation')?.platformOnly).toBeFalsy();
  });
});
