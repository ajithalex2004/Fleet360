/**
 * Partner users are created from /admin/exchange-partners: a platform
 * administrator sets the tenant that onboarded the partner and invites a new
 * user by email into that tenant, always with the Partner tenant role. Accepting the invitation creates the user in
 * the tenant's User Master and links them to the partner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const db = vi.hoisted(() => ({
  partner: null as null | { id: string; legalName: string; onboardedByTenantId: string | null },
  role: null as null | { id: string; name: string; code: string; tenantId: string | null },
  existingUser: null as null | { id: string },
  invitation: null as null | Record<string, unknown>,
  sql: [] as Array<{ sql: string; params: unknown[] }>,
}));
const partnerUpdate = vi.hoisted(() => vi.fn(async () => ({})));
const relationshipUpsert = vi.hoisted(() => vi.fn(async () => ({})));
const partnerUserUpsert = vi.hoisted(() => vi.fn(async () => ({})));
const userTenantCreate = vi.hoisted(() => vi.fn(async () => ({})));
const sendEmail = vi.hoisted(() => vi.fn(async () => ({ sent: true })));
const audit = vi.hoisted(() => vi.fn());
const PARTNER_TEMPLATE = { id: 'partner-role', name: 'Partner', code: 'PARTNER', tenantId: null as string | null };
const roleFindMany = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));

const TENANTS: Record<string, { id: string; name: string; plan: string; isActive: boolean }> = {
  'lease-a': { id: 'lease-a', name: 'Lease Tenant A', plan: 'STANDARD', isActive: true },
  closed: { id: 'closed', name: 'Closed Co', plan: 'STANDARD', isActive: false },
};

vi.mock('@/lib/prisma', () => {
  const tx = {
    transportPartner: {
      findFirst: vi.fn(async () => db.partner),
      update: partnerUpdate,
    },
    tenant: { findUnique: vi.fn(async (a: { where: { id: string } }) => TENANTS[a.where.id] ?? null) },
    tenantPartnerRelationship: { upsert: relationshipUpsert },
    role: {
      findFirst: vi.fn(async () => db.role),
      findUnique: vi.fn(async () => db.role),
      findMany: roleFindMany,
    },
    user: {
      findFirst: vi.fn(async () => db.existingUser),
      findUnique: vi.fn(async () => db.existingUser),
      create: vi.fn(async () => ({})),
    },
    userTenant: {
      count: vi.fn(async () => 1),
      create: userTenantCreate,
      findUnique: vi.fn(async () => null),
    },
    partnerUser: { upsert: partnerUserUpsert },
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      db.sql.push({ sql, params });
      if (sql.includes('FROM tenant_invitations i\n     WHERE token_hash')) return db.invitation ? [db.invitation] : [];
      if (sql.includes('COUNT(*)')) return [{ c: 0n }];
      if (sql.includes('password_hash')) return [{ password_hash: 'stored' }];
      return [];
    }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => { db.sql.push({ sql, params }); return 1; }),
  };
  return { prisma: tx };
});
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return { withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)) };
});
vi.mock('@/lib/audit', () => ({ logAudit: audit }));
vi.mock('@/lib/email', () => ({ sendEmail }));
vi.mock('@/lib/sentry', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/db-router', () => ({ residencyClaimForTenant: vi.fn(async () => ({})) }));
vi.mock('@/lib/tenant-session', () => ({ signSession: vi.fn(async () => 'signed') }));
vi.mock('@/lib/password-policy', () => ({
  hashPassword: vi.fn(() => 'hash'),
  verifyPassword: vi.fn(() => true),
  validatePassword: vi.fn(() => ({ ok: true })),
  DEFAULT_PASSWORD_POLICY: {},
}));

import { NextRequest } from 'next/server';
import { PUT as setTenant } from '@/app/api/admin/exchange/partners/[id]/onboarding-tenant/route';
import { GET as listInvites, POST as invite, DELETE as revoke } from '@/app/api/admin/exchange/partners/[id]/invitations/route';
import { POST as accept } from '@/app/api/auth/invitation/accept/route';

const headers = (role: string) => ({ 'content-type': 'application/json', 'x-user-id': 'admin-1', 'x-tenant-id': 'platform', 'x-user-role': role });
const params = { params: Promise.resolve({ id: 'p1' }) };
const putTenant = (role: string, body: unknown) =>
  setTenant(new NextRequest('http://localhost/api/admin/exchange/partners/p1/onboarding-tenant', { method: 'PUT', headers: headers(role), body: JSON.stringify(body) }), params);
const postInvite = (role: string, body: unknown) =>
  invite(new NextRequest('http://localhost/api/admin/exchange/partners/p1/invitations', { method: 'POST', headers: headers(role), body: JSON.stringify(body) }), params);
const inserts = () => db.sql.filter((q) => q.sql.includes('INSERT INTO tenant_invitations'));
const validInvite = { email: 'Driver.Ops@GCoaches.ae', partnerRole: 'PARTNER_ADMIN' };

beforeEach(() => {
  db.partner = { id: 'p1', legalName: 'Gulf Coaches LLC', onboardedByTenantId: 'lease-a' };
  db.role = { id: 'partner-role', name: 'Partner', code: 'PARTNER', tenantId: null };
  db.existingUser = null;
  db.invitation = null;
  db.sql = [];
  for (const f of [partnerUpdate, relationshipUpsert, partnerUserUpsert, userTenantCreate, sendEmail, audit]) f.mockClear();
  roleFindMany.mockReset();
  roleFindMany.mockResolvedValue([PARTNER_TEMPLATE]);
});

describe('PUT onboarding-tenant', () => {
  it('is platform-admin only', async () => {
    expect((await putTenant('TENANT_ADMIN', { onboardedByTenantId: 'lease-a' })).status).toBe(403);
    expect(partnerUpdate).not.toHaveBeenCalled();
  });

  it('records the tenant and adds the partner to its network', async () => {
    const res = await putTenant('SUPER_ADMIN', { onboardedByTenantId: 'lease-a' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onboardedByTenantId: 'lease-a', onboardedByTenantName: 'Lease Tenant A' });
    expect(partnerUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { onboardedByTenantId: 'lease-a' } });
    expect(relationshipUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });

  it('refuses an unknown partner or an inactive tenant', async () => {
    expect((await putTenant('SUPER_ADMIN', { onboardedByTenantId: 'closed' })).status).toBe(400);
    expect((await putTenant('SUPER_ADMIN', {})).status).toBe(400);
    db.partner = null;
    expect((await putTenant('SUPER_ADMIN', { onboardedByTenantId: 'lease-a' })).status).toBe(404);
    expect(partnerUpdate).not.toHaveBeenCalled();
  });
});

describe('POST invitations', () => {
  it('is platform-admin only', async () => {
    expect((await postInvite('TENANT_ADMIN', validInvite)).status).toBe(403);
    expect(inserts()).toHaveLength(0);
  });

  it('invites into the onboarding tenant, naming the partner and partner role, and emails the link', async () => {
    const res = await postInvite('SUPER_ADMIN', validInvite);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, emailed: true });
    const [ins] = inserts();
    expect(ins.params[0]).toBe('lease-a');
    expect(ins.params[1]).toBe('driver.ops@gcoaches.ae');
    expect(ins.params[2]).toBe('partner-role');
    expect(roleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: 'PARTNER', OR: [{ tenantId: 'lease-a' }, { tenantId: null }] },
    }));
    expect(ins.params.slice(-2)).toEqual(['p1', 'PARTNER_ADMIN']);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'driver.ops@gcoaches.ae' }));
  });

  it('hands back the link when the email cannot be sent', async () => {
    sendEmail.mockResolvedValueOnce({ sent: false, reason: 'smtp_not_configured' } as never);
    const body = await (await postInvite('SUPER_ADMIN', validInvite)).json();
    expect(body.emailed).toBe(false);
    expect(body.acceptUrl).toMatch(/\/invitation\/[0-9a-f]{64}$/);
  });

  it('needs an onboarding tenant first', async () => {
    db.partner = { ...db.partner!, onboardedByTenantId: null };
    expect((await postInvite('SUPER_ADMIN', validInvite)).status).toBe(409);
    expect(inserts()).toHaveLength(0);
  });

  it('sends someone with an account to Link user instead', async () => {
    db.existingUser = { id: 'u9' };
    const res = await postInvite('SUPER_ADMIN', validInvite);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Link user/);
    expect(inserts()).toHaveLength(0);
  });

  it('always uses the Partner role, the tenant\'s own copy first', async () => {
    roleFindMany.mockResolvedValue([PARTNER_TEMPLATE, { id: 'lease-a-partner', name: 'Partner', code: 'PARTNER', tenantId: 'lease-a' }]);
    await postInvite('SUPER_ADMIN', { ...validInvite, roleId: 'tenant-admin-role' });
    expect(inserts()[0].params[2]).toBe('lease-a-partner');
  });

  it('refuses while the Partner role is not set up', async () => {
    roleFindMany.mockResolvedValue([]);
    const res = await postInvite('SUPER_ADMIN', validInvite);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Partner role/);
    expect(inserts()).toHaveLength(0);
  });

  it('refuses bad input', async () => {
    expect((await postInvite('SUPER_ADMIN', { ...validInvite, partnerRole: 'OWNER' })).status).toBe(400);
    expect((await postInvite('SUPER_ADMIN', { ...validInvite, email: 'nope' })).status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });
});

describe('GET invitations', () => {
  const list = (role: string) =>
    listInvites(new NextRequest('http://localhost/api/admin/exchange/partners/p1/invitations', { headers: headers(role) }), params);

  it('is platform-admin only', async () => {
    expect((await list('TENANT_ADMIN')).status).toBe(403);
  });

  it('lists the partner\'s invitations', async () => {
    const res = await list('SUPER_ADMIN');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ invitations: [] });
    expect(db.sql.some((q) => q.sql.includes('WHERE i.partner_id = $1') && q.params[0] === 'p1')).toBe(true);
  });
});

describe('DELETE invitations', () => {
  it('revokes only this partner\'s pending invitation', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const res = await revoke(new NextRequest(`http://localhost/api/admin/exchange/partners/p1/invitations?id=${id}`, { method: 'DELETE', headers: headers('SUPER_ADMIN') }), params);
    expect(res.status).toBe(200);
    const upd = db.sql.find((q) => q.sql.includes('SET revoked = TRUE'))!;
    expect(upd.sql).toContain('partner_id = $2');
    expect(upd.params).toEqual([id, 'p1']);
  });
});

describe('accepting an invitation', () => {
  const acceptWith = (body: Record<string, string>) =>
    accept(new NextRequest('http://localhost/api/auth/invitation/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'x'.repeat(64), ...body }) }));
  const invitation = (extra: Record<string, unknown> = {}) => ({
    id: 'inv-1', tenant_id: 'lease-a', email: 'new@gcoaches.ae', role_id: 'partner-role',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), used_at: null, revoked: false,
    partner_id: 'p1', partner_role: 'PARTNER_ADMIN', ...extra,
  });

  it('creates the user in the tenant and links them to the partner', async () => {
    db.invitation = invitation();
    const res = await acceptWith({ password: 'Str0ng!Password', firstName: 'Sara', lastName: 'Ali' });
    expect(res.status).toBe(200);
    expect(userTenantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'lease-a', roleId: 'partner-role' }) });
    expect(partnerUserUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ partnerId: 'p1', role: 'PARTNER_ADMIN' }),
    }));
  });

  it('links an existing user who accepts', async () => {
    db.invitation = invitation();
    db.existingUser = { id: 'u9', email: 'new@gcoaches.ae', isActive: true } as never;
    expect((await acceptWith({ password: 'whatever' })).status).toBe(200);
    expect(partnerUserUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { partnerId_userId: { partnerId: 'p1', userId: 'u9' } },
    }));
  });

  it('links nothing for an ordinary tenant invitation', async () => {
    db.invitation = invitation({ partner_id: null, partner_role: null });
    expect((await acceptWith({ password: 'Str0ng!Password', firstName: 'Sara', lastName: 'Ali' })).status).toBe(200);
    expect(userTenantCreate).toHaveBeenCalled();
    expect(partnerUserUpsert).not.toHaveBeenCalled();
  });
});
