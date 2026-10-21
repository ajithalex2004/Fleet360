/**
 * The SSO callback trusts only what the identity provider asserts.
 *
 *  - The user is the IdP's email claim. It used to fall back to the address
 *    typed on the login page (state.email), which nothing verifies.
 *  - A membership an administrator disabled stays disabled. It used to be
 *    reactivated on the next SSO sign-in.
 *  - The post-login redirect stays on this site (returnTo is unchecked input).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const st = vi.hoisted(() => ({
  claims: {} as Record<string, unknown>,
  returnTo: '/platform' as string,
  membership: null as null | { id: string; isActive: boolean; role: { code: string } },
  updates: [] as unknown[],
  creates: [] as unknown[],
  signed: [] as Array<Record<string, unknown>>,
}));

vi.mock('openid-client', () => ({
  discovery: async () => ({}),
  authorizationCodeGrant: async () => ({ claims: () => st.claims }),
}));
vi.mock('@/lib/sso', () => ({
  findSsoConfigByTenant: async () => ({
    tenantId: 'tenant-a', isActive: true, issuer: 'https://idp.example', clientId: 'c', clientSecret: 's',
    allowedEmailDomains: ['corp.example'], jitEnabled: false, defaultRoleId: null,
  }),
}));
vi.mock('@/lib/sso-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/sso-state')>()),
  verifySsoState: async () => ({
    tenantId: 'tenant-a', state: 's', nonce: 'n', codeVerifier: 'v',
    email: 'admin@corp.example', returnTo: st.returnTo,
  }),
}));
const user = (email: string) => ({ id: `user:${email}`, email, isActive: true });
vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findUnique: async () => ({ id: 'tenant-a', name: 'A', plan: 'PRO', isActive: true }) },
    user: { findUnique: async ({ where }: { where: { email: string } }) => user(where.email) },
  },
}));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (tx: unknown) => unknown) => fn({
    role: { findFirst: async () => ({ id: 'viewer', code: 'VIEWER' }) },
    userTenant: {
      findUnique: async () => st.membership,
      update: async (a: unknown) => { st.updates.push(a); return {}; },
      create: async (a: unknown) => { st.creates.push(a); return {}; },
    },
  }),
}));
vi.mock('@/lib/tenant-session', () => ({
  signSession: async (p: Record<string, unknown>) => { st.signed.push(p); return 'tok'; },
}));
vi.mock('@/lib/authz/session-permissions', () => ({ sessionPermissionsFor: async () => [] }));
vi.mock('@/lib/db-router', () => ({ residencyClaimForTenant: async () => ({}) }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {} }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/sso/callback/route';
import { safeReturnPath } from '@/lib/sso-state';

async function callback() {
  const res = await GET(new NextRequest('http://localhost/api/auth/sso/callback?code=c&state=s', {
    headers: { cookie: 'xl-sso-state=signed' },
  }));
  return { location: res.headers.get('location') ?? '', res };
}

describe('SSO callback identity', () => {
  beforeEach(() => {
    st.claims = { sub: 'sub-1', email: 'me@corp.example' };
    st.returnTo = '/platform';
    st.membership = { id: 'm1', isActive: true, role: { code: 'MEMBER' } };
    st.updates.length = 0;
    st.creates.length = 0;
    st.signed.length = 0;
  });

  it('signs in the user the IdP names', async () => {
    const { location } = await callback();
    expect(location).toBe('http://localhost/platform');
    expect(st.signed).toEqual([expect.objectContaining({ userId: 'user:me@corp.example' })]);
  });

  it('never uses the email typed on the login page when the IdP sends none', async () => {
    st.claims = { sub: 'sub-1' };
    const { location } = await callback();
    expect(location).toContain('/login?sso=no-email');
    expect(st.signed).toHaveLength(0);
  });

  it('refuses an email the IdP marks unverified', async () => {
    st.claims = { sub: 'sub-1', email: 'me@corp.example', email_verified: false };
    const { location } = await callback();
    expect(location).toContain('/login?sso=email-unverified');
    expect(st.signed).toHaveLength(0);
  });

  it('refuses a disabled membership instead of reactivating it', async () => {
    st.membership = { id: 'm1', isActive: false, role: { code: 'MEMBER' } };
    const { location } = await callback();
    expect(location).toContain('/login?sso=membership-disabled');
    expect(st.updates).toHaveLength(0);
    expect(st.signed).toHaveLength(0);
  });

  it('sends a missing membership to the right error code when JIT is off', async () => {
    st.membership = null;
    const { location } = await callback();
    expect(location).toContain('/login?sso=membership-missing');
    expect(st.creates).toHaveLength(0);
  });

  it('does not follow an off-site returnTo after sign-in', async () => {
    st.returnTo = 'https://evil.example/phish';
    const { location } = await callback();
    expect(location).toBe('http://localhost/platform');
  });
});

describe('safeReturnPath', () => {
  it.each([
    ['/leasing/contracts?id=1', '/leasing/contracts?id=1'],
    [undefined, '/platform'],
    ['', '/platform'],
    ['https://evil.example', '/platform'],
    ['//evil.example', '/platform'],
    ['/\\evil.example', '/platform'],
    ['javascript:alert(1)', '/platform'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnPath(input as string | undefined)).toBe(expected);
  });
});
