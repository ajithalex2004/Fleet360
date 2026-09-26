/**
 * PUT /api/admin/exchange/partners/:id/services — approving or revoking a
 * transport partner for a service area is platform-admin only; approving
 * upserts one domain-wide capability, revoking un-approves every capability in
 * the domain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ partner: null as unknown, approved: [] as Array<{ domain: string }> }));
const upsert = vi.hoisted(() => vi.fn());
const updateMany = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transportPartner: { findFirst: vi.fn(async () => db.partner) },
    partnerCapability: { upsert, updateMany, findMany: vi.fn(async () => db.approved) },
  },
}));
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return { withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)) };
});
vi.mock('@/lib/audit', () => ({ logAudit: audit }));

import { NextRequest } from 'next/server';
import { PUT } from '@/app/api/admin/exchange/partners/[id]/services/route';

const put = (role: string, body: unknown, id = 'p1') =>
  PUT(
    new NextRequest(`http://localhost/api/admin/exchange/partners/${id}/services`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-user-id': 'admin-1', 'x-tenant-id': 'platform', 'x-user-role': role },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  db.partner = { id: 'p1', legalName: 'Gulf Coaches' };
  db.approved = [];
  upsert.mockClear(); updateMany.mockClear(); audit.mockClear();
});

describe('PUT /api/admin/exchange/partners/:id/services', () => {
  it('refuses anyone but a super admin', async () => {
    expect((await put('TENANT_ADMIN', { domain: 'FREIGHT', approved: true })).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('approves a service area with one domain-wide capability and audits it', async () => {
    db.approved = [{ domain: 'FREIGHT' }];
    const res = await put('SUPER_ADMIN', { domain: 'FREIGHT', approved: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ partnerId: 'p1', approvedDomains: ['FREIGHT'] });
    expect(upsert).toHaveBeenCalledWith({
      where: { partnerId_domain_serviceType: { partnerId: 'p1', domain: 'FREIGHT', serviceType: 'ALL' } },
      create: { partnerId: 'p1', domain: 'FREIGHT', serviceType: 'ALL', isApproved: true },
      update: { isApproved: true },
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'TransportPartner', action: 'UPDATE', userId: 'admin-1' }));
  });

  it('revokes every capability the partner has in the area', async () => {
    const res = await put('SUPER_ADMIN', { domain: 'RECOVERY', approved: false });
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({ where: { partnerId: 'p1', domain: 'RECOVERY' }, data: { isApproved: false } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown area, a missing flag or an unknown partner', async () => {
    expect((await put('SUPER_ADMIN', { domain: 'SPACE', approved: true })).status).toBe(400);
    expect((await put('SUPER_ADMIN', { domain: 'FREIGHT' })).status).toBe(400);
    db.partner = null;
    expect((await put('SUPER_ADMIN', { domain: 'FREIGHT', approved: true }, 'nope')).status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
