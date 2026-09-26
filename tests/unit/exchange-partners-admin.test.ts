/**
 * /api/admin/exchange/partners — listing and creating Exchange transport
 * partners is platform-admin only, validates the partner code and reports a
 * duplicate code as 409.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const create = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  prisma: { transportPartner: { create, findMany } },
}));
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return { withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)) };
});
vi.mock('@/lib/audit', () => ({ logAudit: audit }));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/exchange/partners/route';

const headers = (role: string) => ({ 'content-type': 'application/json', 'x-user-id': 'admin-1', 'x-tenant-id': 'platform', 'x-user-role': role });
const get = (role: string) => GET(new NextRequest('http://localhost/api/admin/exchange/partners', { headers: headers(role) }));
const post = (role: string, body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/exchange/partners', { method: 'POST', headers: headers(role), body: JSON.stringify(body) }));

beforeEach(() => {
  create.mockReset(); findMany.mockReset(); audit.mockClear();
  create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'p1', legalName: args.data.legalName, partnerCode: args.data.partnerCode }));
  findMany.mockResolvedValue([
    { id: 'p1', legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', _count: { users: 2 } },
  ]);
});

describe('GET /api/admin/exchange/partners', () => {
  it('refuses anyone but a super admin', async () => {
    expect((await get('TENANT_ADMIN')).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lists live partners with their member count', async () => {
    const res = await get('SUPER_ADMIN');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ partners: [{ id: 'p1', legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', memberCount: 2 }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null } }));
  });

  it('answers 503 when the Exchange tables are not migrated', async () => {
    findMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing table', { code: 'P2021', clientVersion: 'test' }));
    const res = await get('SUPER_ADMIN');
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('EXCHANGE_NOT_PROVISIONED');
  });
});

describe('POST /api/admin/exchange/partners', () => {
  it('refuses anyone but a super admin', async () => {
    expect((await post('TENANT_ADMIN', { legalName: 'X', partnerCode: 'XX' })).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the partner with a normalised code and audits it', async () => {
    const res = await post('SUPER_ADMIN', { legalName: ' Gulf Coaches LLC ', partnerCode: ' gulf-dxb ', city: 'Dubai', tenantId: 'someone-else' });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', city: 'Dubai' }),
    }));
    expect(create.mock.calls[0][0].data).not.toHaveProperty('tenantId');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'TransportPartner', action: 'CREATE', userId: 'admin-1' }));
  });

  it('rejects a missing name, a bad code or a bad contact email', async () => {
    expect((await post('SUPER_ADMIN', { partnerCode: 'GULF' })).status).toBe(400);
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'g u l f' })).status).toBe(400);
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', primaryContactEmail: 'nope' })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a partner code already in use as 409', async () => {
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    const res = await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF' });
    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });
});
