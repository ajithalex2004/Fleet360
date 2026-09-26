/**
 * /api/admin/exchange/partner-users — linking users to transport partners is
 * platform-admin only, looks users up by email, and is idempotent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ partner: null as unknown, user: null as unknown }));
const upsert = vi.hoisted(() => vi.fn(async (args: { create: Record<string, string> }) => ({ id: 'm1', ...args.create })));
const audit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transportPartner: { findFirst: vi.fn(async () => db.partner) },
    user: { findFirst: vi.fn(async () => db.user) },
    partnerUser: { upsert, findMany: vi.fn(async () => []), delete: vi.fn() },
  },
}));
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return { withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)) };
});
vi.mock('@/lib/audit', () => ({ logAudit: audit }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/exchange/partner-users/route';

const post = (role: string, body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/exchange/partner-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'admin-1', 'x-tenant-id': 'platform', 'x-user-role': role },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  db.partner = { id: 'p1', legalName: 'Gulf Coaches' };
  db.user = { id: 'u9', email: 'ops@gulfcoaches.ae', isActive: true };
  upsert.mockClear(); audit.mockClear();
});

describe('POST /api/admin/exchange/partner-users', () => {
  it('refuses anyone but a super admin', async () => {
    const res = await post('TENANT_ADMIN', { partnerId: 'p1', email: 'ops@gulfcoaches.ae' });
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('links the user found by email with the given role and audits it', async () => {
    const res = await post('SUPER_ADMIN', { partnerId: 'p1', email: ' OPS@GulfCoaches.ae ', role: 'PARTNER_ADMIN' });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { partnerId_userId: { partnerId: 'p1', userId: 'u9' } },
      create: { partnerId: 'p1', userId: 'u9', role: 'PARTNER_ADMIN' },
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'PartnerUser', userId: 'admin-1' }));
  });

  it('rejects an unknown role, user or partner', async () => {
    expect((await post('SUPER_ADMIN', { partnerId: 'p1', email: 'x@y.z', role: 'OWNER' })).status).toBe(400);
    db.user = null;
    expect((await post('SUPER_ADMIN', { partnerId: 'p1', email: 'x@y.z' })).status).toBe(404);
    db.user = { id: 'u9', email: 'x@y.z', isActive: true }; db.partner = null;
    expect((await post('SUPER_ADMIN', { partnerId: 'nope', email: 'x@y.z' })).status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });
});
