/**
 * Partner authentication for the Exchange marketplace.
 *
 * The marketplace routes used to take the partner from a header, query or
 * body and trust it, so any signed-in user could browse, quote and read
 * awards as any partner. The partner now comes from the caller's
 * partner_users membership, and quoting is gated by checkQuoteEligibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  memberships: [] as unknown[],
  request: null as unknown,
  partner: null as unknown,
  scope: [] as string[],
}));

vi.mock('@/lib/prisma', () => {
  const client = {
    partnerUser: { findMany: vi.fn(async () => db.memberships) },
    outsourceRequest: { findUnique: vi.fn(async () => db.request), findMany: vi.fn(async () => []) },
    transportPartner: { findFirst: vi.fn(async () => db.partner) },
    partnerQuote: { findMany: vi.fn(async () => []) },
    outsourceAward: { findMany: vi.fn(async () => []) },
    tenantPartnerRelationship: { findMany: vi.fn(async () => []) },
  };
  return { prisma: client };
});
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return {
    withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => { db.scope.push('*'); return fn(prisma); }),
    withTenantRls: vi.fn(async (_p: unknown, tenantId: string, fn: (tx: unknown) => unknown) => { db.scope.push(tenantId); return fn(prisma); }),
  };
});
vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: vi.fn(async (tenantId: string, fn: () => unknown) => { db.scope.push(`as:${tenantId}`); return fn(); }),
}));
const submit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/exchange/outsource-engine', () => ({ OutsourceEngine: { submitOrReviseQuote: submit } }));
const listOpps = vi.hoisted(() => vi.fn(async () => ({ opportunities: [], partnerDomains: [] })));
vi.mock('@/lib/exchange/marketplace-service', () => ({ MarketplaceService: { listOpportunitiesForPartner: listOpps } }));

import { NextRequest } from 'next/server';
import { checkQuoteEligibility, requirePartnerContext } from '@/lib/exchange/partner-auth';
import { GET as marketplaceGet } from '@/app/api/exchange/marketplace/route';
import { GET as quotesGet, POST as quotesPost } from '@/app/api/exchange/jobs/quotes/route';

const member = (partnerId: string, role = 'PARTNER_OPERATIONS') => ({
  role,
  partner: { id: partnerId, legalName: `Partner ${partnerId}`, marketplaceStatus: 'APPROVED', operationalStatus: 'ACTIVE', onboardingStatus: 'APPROVED', emirate: null },
});
const req = (url: string, headers: Record<string, string> = {}, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const signedIn = { 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-partner' };

const openRequest = (over: Record<string, unknown> = {}) => ({
  tenantId: 'tenant-buyer',
  status: 'PUBLISHED',
  opportunity: { status: 'OPEN', closesAt: new Date(Date.now() + 3_600_000), domain: 'PASSENGER_TRANSPORT', visibility: 'EXCHANGE_NETWORK' },
  invitedPartners: [],
  ...over,
});
const approvedPartner = (over: Record<string, unknown> = {}) => ({
  onboardingStatus: 'APPROVED',
  marketplaceStatus: 'APPROVED',
  operationalStatus: 'ACTIVE',
  capabilities: [{ domain: 'PASSENGER_TRANSPORT' }],
  tenantRelationships: [],
  ...over,
});

beforeEach(() => {
  db.memberships = []; db.request = null; db.partner = null; db.scope = [];
  submit.mockReset();
  listOpps.mockClear();
});

describe('requirePartnerContext', () => {
  it('401s without a verified user', async () => {
    const r = await requirePartnerContext(req('/x'));
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it('403s a user linked to no partner', async () => {
    const r = await requirePartnerContext(req('/x', signedIn));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('uses the only membership when none is named', async () => {
    db.memberships = [member('p1')];
    const r = await requirePartnerContext(req('/x', signedIn));
    expect(r).toMatchObject({ ok: true, ctx: { partnerId: 'p1', userId: 'user-1', role: 'PARTNER_OPERATIONS' } });
  });

  it('refuses a named partner the user is not a member of', async () => {
    db.memberships = [member('p1')];
    const r = await requirePartnerContext(req('/x?partnerId=p2', signedIn));
    expect(r).toMatchObject({ ok: false, status: 403 });
    const h = await requirePartnerContext(req('/x', { ...signedIn, 'x-partner-id': 'p2' }));
    expect(h).toMatchObject({ ok: false, status: 403 });
  });

  it('lets a member of several partners choose one, and asks when none is chosen', async () => {
    db.memberships = [member('p1'), member('p2')];
    expect(await requirePartnerContext(req('/x', signedIn))).toMatchObject({ ok: false, status: 400 });
    expect(await requirePartnerContext(req('/x', { ...signedIn, 'x-partner-id': 'p2' }))).toMatchObject({ ok: true, ctx: { partnerId: 'p2' } });
  });

  it('enforces roles', async () => {
    db.memberships = [member('p1', 'PARTNER_VIEWER')];
    const r = await requirePartnerContext(req('/x', signedIn), { roles: ['PARTNER_ADMIN', 'PARTNER_OPERATIONS'] });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a partner that is not activated yet, unless the route allows onboarding', async () => {
    const pending = member('p1');
    pending.partner = { ...pending.partner, onboardingStatus: 'UNDER_REVIEW' };
    db.memberships = [pending];
    expect(await requirePartnerContext(req('/x', signedIn))).toMatchObject({
      ok: false, status: 403, code: 'PARTNER_PENDING_ACTIVATION',
    });
    expect(await requirePartnerContext(req('/x', signedIn), { allowPending: true })).toMatchObject({
      ok: true, ctx: { partnerId: 'p1', onboardingStatus: 'UNDER_REVIEW' },
    });
  });
});

describe('checkQuoteEligibility', () => {
  it('allows an open EXCHANGE_NETWORK opportunity in a capable domain from a buyer in its network, returning the buyer tenant', async () => {
    db.request = openRequest(); db.partner = approvedPartner({ tenantRelationships: [{ status: 'APPROVED' }] });
    expect(await checkQuoteEligibility('p1', 'r1')).toEqual({ ok: true, tenantId: 'tenant-buyer' });
    expect(db.scope).toEqual(['*']);
  });

  it('allows an invited partner regardless of opportunity visibility', async () => {
    db.request = openRequest({ opportunity: null, invitedPartners: [{ status: 'INVITED' }] });
    db.partner = approvedPartner();
    expect(await checkQuoteEligibility('p1', 'r1')).toMatchObject({ ok: true });
  });

  it.each([
    ['unknown request', () => { db.request = null; db.partner = approvedPartner(); }, 404],
    ['partner not activated', () => { db.request = openRequest({ invitedPartners: [{ status: 'INVITED' }] }); db.partner = approvedPartner({ onboardingStatus: 'UNDER_REVIEW' }); }, 403],
    ['EXCHANGE_NETWORK from a buyer outside its network (exchange not open yet)', () => { db.request = openRequest(); db.partner = approvedPartner(); }, 403],
    ['partner not approved', () => { db.request = openRequest(); db.partner = approvedPartner({ marketplaceStatus: 'UNDER_REVIEW' }); }, 403],
    ['buyer blocked the partner', () => { db.request = openRequest({ invitedPartners: [{ status: 'INVITED' }] }); db.partner = approvedPartner({ tenantRelationships: [{ status: 'BLOCKED' }] }); }, 403],
    ['request already awarded', () => { db.request = openRequest({ status: 'AWARDED' }); db.partner = approvedPartner(); }, 409],
    ['DIRECT opportunity, not invited', () => { db.request = openRequest({ opportunity: { ...openRequest().opportunity, visibility: 'DIRECT' } }); db.partner = approvedPartner(); }, 403],
    ['TENANT_NETWORK without a relationship', () => { db.request = openRequest({ opportunity: { ...openRequest().opportunity, visibility: 'TENANT_NETWORK' } }); db.partner = approvedPartner(); }, 403],
    ['domain without capability', () => { db.request = openRequest({ opportunity: { ...openRequest().opportunity, domain: 'FREIGHT' } }); db.partner = approvedPartner(); }, 403],
    ['opportunity closed', () => { db.request = openRequest({ opportunity: { ...openRequest().opportunity, closesAt: new Date(Date.now() - 1000) } }); db.partner = approvedPartner(); }, 403],
  ])('refuses: %s', async (_name, arrange, status) => {
    arrange();
    expect(await checkQuoteEligibility('p1', 'r1')).toMatchObject({ ok: false, status });
  });

  it('allows TENANT_NETWORK for a partner with a relationship to the buyer', async () => {
    db.request = openRequest({ opportunity: { ...openRequest().opportunity, visibility: 'TENANT_NETWORK' } });
    db.partner = approvedPartner({ tenantRelationships: [{ status: 'APPROVED' }] });
    expect(await checkQuoteEligibility('p1', 'r1')).toMatchObject({ ok: true });
  });
});

describe('GET /api/exchange/marketplace', () => {
  it('no longer falls back to a default partner for a user without a membership', async () => {
    const res = await marketplaceGet(req('/api/exchange/marketplace', signedIn));
    expect(res.status).toBe(403);
    expect(listOpps).not.toHaveBeenCalled();
  });

  it('ignores a partnerId naming a partner the user does not belong to', async () => {
    db.memberships = [member('p1')];
    const res = await marketplaceGet(req('/api/exchange/marketplace?partnerId=p2', signedIn));
    expect(res.status).toBe(403);
    expect(listOpps).not.toHaveBeenCalled();
  });

  it('lists opportunities for the member partner', async () => {
    db.memberships = [member('p1')];
    const res = await marketplaceGet(req('/api/exchange/marketplace', signedIn));
    expect(res.status).toBe(200);
    expect(listOpps).toHaveBeenCalledWith('p1');
  });
});

describe('/api/exchange/jobs/quotes', () => {
  it('POST quotes as the member partner, not the partnerId in the body, in the buyer tenant', async () => {
    db.memberships = [member('p1')];
    db.request = openRequest(); db.partner = approvedPartner({ tenantRelationships: [{ status: 'APPROVED' }] });
    submit.mockResolvedValue({ id: 'q1', revisionNo: 1, amount: 100, vatAmount: 5, totalAmount: 105, currency: 'AED', validUntil: new Date(), status: 'SUBMITTED', request: { tenantId: 'tenant-buyer', pickupLocation: 'secret' } });

    const res = await quotesPost(req('/api/exchange/jobs/quotes', signedIn, { requestId: 'r1', partnerId: 'someone-else', amount: 100 }));
    expect(res.status).toBe(200);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ partnerId: 'p1', actorUserId: 'user-1', requestId: 'r1' }));
    // Eligibility in platform context, then the engine runs as the buyer tenant.
    expect(db.scope).toEqual(['*', 'as:tenant-buyer']);
    const body = await res.json();
    expect(body.quote).toMatchObject({ id: 'q1', totalAmount: 105 });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('POST refuses a viewer', async () => {
    db.memberships = [member('p1', 'PARTNER_VIEWER')];
    const res = await quotesPost(req('/api/exchange/jobs/quotes', signedIn, { requestId: 'r1', amount: 100 }));
    expect(res.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it('POST refuses a request the partner may not quote on', async () => {
    db.memberships = [member('p1')];
    db.request = openRequest({ opportunity: { ...openRequest().opportunity, visibility: 'DIRECT' } });
    db.partner = approvedPartner();
    const res = await quotesPost(req('/api/exchange/jobs/quotes', signedIn, { requestId: 'r1', amount: 100 }));
    expect(res.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it('GET lists only the member partner\'s quotes', async () => {
    db.memberships = [member('p1')];
    const { prisma } = await import('@/lib/prisma');
    const res = await quotesGet(req('/api/exchange/jobs/quotes?partnerId=p1', signedIn));
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.partnerQuote.findMany).mock.calls.at(-1)?.[0]).toMatchObject({ where: { partnerId: 'p1' } });
  });
});
