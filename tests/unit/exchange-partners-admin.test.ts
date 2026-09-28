/**
 * /api/admin/exchange/partners — listing and creating Exchange transport
 * partners is platform-admin only, validates the partner code, reports a
 * duplicate code as 409, and records the tenant that onboards the partner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const create = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());
const tenantFindUnique = vi.hoisted(() => vi.fn());
const tenantFindMany = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const partnerUpdate = vi.hoisted(() => vi.fn(async () => ({})));
const relationshipUpsert = vi.hoisted(() => vi.fn(async () => ({})));
const capabilityCreate = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transportPartner: { create, findMany, update: partnerUpdate },
    tenant: { findUnique: tenantFindUnique, findMany: tenantFindMany },
    tenantPartnerRelationship: { upsert: relationshipUpsert },
    partnerCapability: { create: capabilityCreate },
  },
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
  partnerUpdate.mockClear(); relationshipUpsert.mockClear(); tenantFindMany.mockClear(); capabilityCreate.mockClear();
  tenantFindUnique.mockReset();
  tenantFindUnique.mockImplementation(async (args: { where: { id: string } }) =>
    args.where.id === 'lease-a' ? { id: 'lease-a', name: 'Lease Tenant A', plan: 'STANDARD', isActive: true }
    : args.where.id === 'closed' ? { id: 'closed', name: 'Closed', plan: 'STANDARD', isActive: false }
    : null);
  create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'p1', legalName: args.data.legalName, partnerCode: args.data.partnerCode }));
  findMany.mockResolvedValue([
    { id: 'p1', legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', _count: { users: 2 },
      capabilities: [{ domain: 'PASSENGER_TRANSPORT' }, { domain: 'PASSENGER_TRANSPORT' }, { domain: 'LIMOUSINE' }],
      complianceDocuments: [{ id: 'd1' }] },
  ]);
});

describe('GET /api/admin/exchange/partners', () => {
  it('refuses anyone but a super admin', async () => {
    expect((await get('TENANT_ADMIN')).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lists live partners with their member count, approved service areas and documents to review', async () => {
    const res = await get('SUPER_ADMIN');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ partners: [{
      id: 'p1', legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', memberCount: 2,
      approvedDomains: ['PASSENGER_TRANSPORT', 'LIMOUSINE'], pendingDocuments: 1, onboardedByTenantName: null,
    }] });
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
    const res = await post('SUPER_ADMIN', { legalName: ' Gulf Coaches LLC ', partnerCode: ' gulf-dxb ', city: 'Dubai', tenantId: 'someone-else', onboardedByTenantId: 'lease-a', emirate: 'DUBAI' });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', city: 'Dubai', emirate: 'DUBAI' }),
    }));
    expect(create.mock.calls[0][0].data).not.toHaveProperty('tenantId');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'TransportPartner', action: 'CREATE', userId: 'admin-1' }));
  });

  it('rejects a missing name, a bad code or a bad contact email', async () => {
    expect((await post('SUPER_ADMIN', { partnerCode: 'GULF', onboardedByTenantId: 'lease-a', emirate: 'DUBAI' })).status).toBe(400);
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'g u l f', onboardedByTenantId: 'lease-a', emirate: 'DUBAI' })).status).toBe(400);
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', primaryContactEmail: 'nope', onboardedByTenantId: 'lease-a', emirate: 'DUBAI' })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a partner code already in use as 409', async () => {
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    const res = await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'lease-a', emirate: 'DUBAI' });
    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it('records the onboarding tenant and puts the partner in its network', async () => {
    const res = await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'lease-a', emirate: 'DUBAI' });
    expect(res.status).toBe(201);
    expect((await res.json()).partner).toMatchObject({ onboardedByTenantId: 'lease-a', onboardedByTenantName: 'Lease Tenant A' });
    expect(partnerUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { onboardedByTenantId: 'lease-a' } });
    expect(relationshipUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_partnerId: { tenantId: 'lease-a', partnerId: 'p1' } },
      create: { tenantId: 'lease-a', partnerId: 'p1', status: 'APPROVED' },
      update: {},
    }));
  });

  it('starts the partner Pending Activation, outside the marketplace', async () => {
    const res = await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'lease-a', emirate: 'DUBAI' });
    expect(res.status).toBe(201);
    expect(create.mock.calls[0][0].data).toMatchObject({ onboardingStatus: 'DRAFT', marketplaceStatus: 'NOT_APPLIED' });
  });

  it('requires the emirate, which decides the mandatory permits', async () => {
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'lease-a' })).status).toBe(400);
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'lease-a', emirate: 'Dubai' })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('records the chosen service areas as domain-wide capabilities', async () => {
    const res = await post('SUPER_ADMIN', {
      legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'lease-a', emirate: 'SHARJAH',
      serviceDomains: ['SCHOOL_TRANSPORT', 'FREIGHT'],
    });
    expect(res.status).toBe(201);
    expect(capabilityCreate.mock.calls.map((c) => (c as unknown as [{ data: unknown }])[0].data)).toEqual([
      { partnerId: 'p1', domain: 'SCHOOL_TRANSPORT', serviceType: 'ALL', isApproved: true },
      { partnerId: 'p1', domain: 'FREIGHT', serviceType: 'ALL', isApproved: true },
    ]);
    const bad = await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'lease-a', emirate: 'DUBAI', serviceDomains: ['TAXI'] });
    expect(bad.status).toBe(400);
  });

  it('requires an active onboarding tenant', async () => {
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF' })).status).toBe(400);
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'closed', emirate: 'DUBAI' })).status).toBe(400);
    expect((await post('SUPER_ADMIN', { legalName: 'Gulf', partnerCode: 'GULF', onboardedByTenantId: 'nope', emirate: 'DUBAI' })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
