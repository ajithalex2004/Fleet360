/**
 * Portal and SSO lookups run in an RLS scope.
 *
 * lessee_portal_users / customer_portal_users, their invitations and
 * tenant_sso_configs are under FORCE ROW LEVEL SECURITY, and the routes that
 * use them are public (no request tenant). Their queries ran on the bare
 * client with app.tenant_id unset, so RLS returned nothing: every portal
 * login, invitation setup and session check failed, and SSO always reported
 * "not configured".
 *
 * Lookups that establish identity before a tenant is known (by email, by
 * invitation token, by email domain) run across tenants in a transaction of
 * their own; everything else runs in its tenant's scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rec = vi.hoisted(() => ({
  scopes: [] as Array<{ scope: string; sql: string[] }>,
  outside: 0,
  rows: [] as unknown[],
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls-scope', () => ({
  runOutsideRlsScope: async (fn: () => Promise<unknown>) => { rec.outside++; return fn(); },
}));
vi.mock('@/lib/rls', () => {
  const run = (scope: string) => async (fn: (tx: unknown) => unknown) => {
    const entry = { scope, sql: [] as string[] };
    rec.scopes.push(entry);
    const q = async (sql: string) => { entry.sql.push(sql); return rec.rows; };
    return fn({ $queryRawUnsafe: q, $executeRawUnsafe: async (sql: string) => { entry.sql.push(sql); return 1; } });
  };
  return {
    withTenantRls: (_p: unknown, tenantId: string, fn: (tx: unknown) => unknown) => run(`tenant:${tenantId}`)(fn),
    withPlatformAdmin: (_p: unknown, fn: (tx: unknown) => unknown) => run('platform')(fn),
  };
});
vi.mock('@/lib/email-templates', () => ({ sendTemplatedEmail: vi.fn(), tenantEmailContext: vi.fn(), renderEmail: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/session-secret', () => ({ requireSsoEncryptionSecret: () => 'k'.repeat(32) }));

import * as leasingUsers from '@/lib/leasing-portal/portal-users-store';
import * as shipperUsers from '@/lib/shipper-portal/portal-users-store';
import * as leasingInvites from '@/lib/leasing-portal/invitations';
import * as shipperInvites from '@/lib/shipper-portal/invitations';
import { findSsoConfigByEmail, findSsoConfigByTenant, getSsoConfigPublic } from '@/lib/sso';

const row = {
  id: 'u1', tenant_id: 'tenant-a', lessee_id: 'l1', customer_id: 'c1', email: 'a@x', full_name: null,
  phone: null, password_hash: 'h', is_active: true, role: 'LESSEE_USER', last_login_at: null,
  created_at: 'now', updated_at: 'now',
};

beforeEach(() => {
  rec.scopes.length = 0;
  rec.outside = 0;
  rec.rows = [row];
});

describe.each([
  ['leasing portal', leasingUsers, leasingInvites, 'lessee_portal'],
  ['shipper portal', shipperUsers, shipperInvites, 'customer_portal'],
] as const)('%s', (_name, users, invites, table) => {
  it('finds a user by email at login across tenants, in its own transaction', async () => {
    const u = await users._findUserWithHashByEmail('a@x');
    expect(u?.tenantId).toBe('tenant-a');
    expect(rec.scopes.map(s => s.scope)).toEqual(['platform']);
    expect(rec.outside).toBe(1);
  });

  it('reads and writes a known user in its tenant’s scope', async () => {
    await users.getPortalUserById('tenant-a', 'u1');
    await users.markPortalUserLoggedIn('tenant-a', 'u1');
    await users.setPortalUserPassword('tenant-a', 'u1', 'h2');
    expect(rec.scopes.map(s => s.scope)).toEqual(['tenant:tenant-a', 'tenant:tenant-a', 'tenant:tenant-a']);
    // The tenant-less writes now also pin the tenant in SQL.
    expect(rec.scopes[1].sql[0]).toMatch(/tenant_id = \$2/);
    expect(rec.scopes[2].sql[0]).toMatch(/tenant_id = \$3/);
  });

  it('creates an invitation in the inviting tenant’s scope', async () => {
    rec.rows = [{ id: 'i1', expires_at: 'later' }];
    await invites.createInvitation({ tenantId: 'tenant-a', portalUserId: 'u1', invitedByUserId: 'staff' });
    expect(rec.scopes.map(s => s.scope)).toEqual(['tenant:tenant-a']);
  });

  it('resolves an invitation by token across tenants', async () => {
    rec.rows = [{ id: 'i1', tenant_id: 'tenant-a', portal_user_id: 'u1', expires_at: '2999-01-01', accepted_at: null }];
    const inv = await invites.resolveInvitation('raw-token');
    expect(inv?.tenant_id).toBe('tenant-a');
    expect(rec.scopes.map(s => s.scope)).toEqual(['platform']);
  });

  it('claims an invitation and sets the password in one transaction', async () => {
    rec.rows = [{ portal_user_id: 'u1', tenant_id: 'tenant-a' }];
    const out = await invites.acceptInvitation('raw-token', 'hash');
    expect(out).toEqual({ portalUserId: 'u1', tenantId: 'tenant-a' });
    expect(rec.scopes).toHaveLength(1);
    expect(rec.scopes[0].scope).toBe('platform');
    expect(rec.scopes[0].sql[0]).toContain(`UPDATE ${table}_invitations`);
    expect(rec.scopes[0].sql[1]).toContain(`UPDATE ${table}_users`);
    expect(rec.scopes[0].sql[1]).toMatch(/tenant_id = \$3/);
  });
});

describe('SSO config lookups', () => {
  beforeEach(() => {
    rec.rows = [{
      id: 's1', tenant_id: 'tenant-a', provider: 'oidc', issuer: 'https://idp', client_id: 'c',
      client_secret_encrypted: null, allowed_email_domains: ['corp.example'], default_role_id: null,
      jit_enabled: false, is_active: true,
    }];
  });

  it('finds the tenant claiming an email domain across tenants', async () => {
    await findSsoConfigByEmail('me@corp.example').catch(() => null);
    expect(rec.scopes.map(s => s.scope)).toEqual(['platform']);
    expect(rec.outside).toBe(1);
  });

  it('reads a tenant’s own config in that tenant’s scope', async () => {
    await findSsoConfigByTenant('tenant-a').catch(() => null);
    await getSsoConfigPublic('tenant-a');
    expect(rec.scopes.map(s => s.scope)).toEqual(['tenant:tenant-a', 'tenant:tenant-a']);
  });
});
