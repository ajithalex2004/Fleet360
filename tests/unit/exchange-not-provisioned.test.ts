/**
 * Before 20260926120000_add_remaining_exchange_partner_tables is applied, the
 * Exchange tables do not exist (Prisma P2021) and the marketplace and portal
 * routes answered with an empty-body 500. They now answer 503
 * { code: 'EXCHANGE_NOT_PROVISIONED' }, like /partner/profile already did;
 * other errors are not disguised as that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const state = vi.hoisted(() => ({ fail: null as Error | null }));
const missingTable = () =>
  new Prisma.PrismaClientKnownRequestError('The table `public.partner_users` does not exist in the current database.', {
    code: 'P2021',
    clientVersion: '5.22.0',
  });

vi.mock('@/lib/prisma', () => {
  const failing = vi.fn(async () => { if (state.fail) throw state.fail; return []; });
  return {
    prisma: {
      partnerUser: { findMany: failing, findUnique: failing },
      tenantPartnerRelationship: { findMany: failing },
      partnerSettlementStatement: { findUnique: failing },
    },
  };
});
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return {
    withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)),
    withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn(prisma)),
  };
});
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { NextRequest } from 'next/server';
import { GET as marketplace } from '@/app/api/exchange/marketplace/route';
import { POST as quote } from '@/app/api/exchange/jobs/quotes/route';
import { GET as fleet } from '@/app/api/exchange/partner/fleet/route';
import { GET as me } from '@/app/api/exchange/partner/me/route';
import { GET as profile } from '@/app/api/exchange/partner/profile/route';
import { GET as scorecard } from '@/app/api/exchange/scorecard/route';
import { GET as statementPdf } from '@/app/api/exchange/statements/[id]/pdf/route';
import { DELETE as adminDelete, GET as adminList } from '@/app/api/admin/exchange/partner-users/route';

const headers = { 'content-type': 'application/json', 'x-user-id': 'u1', 'x-tenant-id': 'tenant-a' };
const get = (url: string, extra: Record<string, string> = {}) => new NextRequest(`http://localhost${url}`, { headers: { ...headers, ...extra } });
const params = { params: Promise.resolve({ id: 's1' }) };

beforeEach(() => { state.fail = missingTable(); });

const expectNotProvisioned = async (res: Response) => {
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: 'The partner exchange is not set up in this environment yet.',
    code: 'EXCHANGE_NOT_PROVISIONED',
  });
};

describe('Exchange routes before the Exchange migration', () => {
  it.each([
    ['marketplace', () => marketplace(get('/api/exchange/marketplace'))],
    ['quote submission', () => quote(new NextRequest('http://localhost/api/exchange/jobs/quotes', { method: 'POST', headers, body: JSON.stringify({ requestId: 'r1', amount: 10 }) }))],
    ['partner fleet', () => fleet(get('/api/exchange/partner/fleet'))],
    ['partner/me', () => me(get('/api/exchange/partner/me'))],
    ['partner profile', () => profile(get('/api/exchange/partner/profile'))],
    ['scorecard', () => scorecard(get('/api/exchange/scorecard'))],
    ['statement PDF', () => statementPdf(get('/api/exchange/statements/s1/pdf'), params)],
    ['admin membership list', () => adminList(get('/api/admin/exchange/partner-users?partnerId=p1', { 'x-user-role': 'SUPER_ADMIN' }))],
    ['admin membership delete', () => adminDelete(new NextRequest('http://localhost/api/admin/exchange/partner-users?id=m1', { method: 'DELETE', headers: { ...headers, 'x-user-role': 'SUPER_ADMIN' } }))],
  ])('%s answers 503 EXCHANGE_NOT_PROVISIONED', async (_name, call) => {
    await expectNotProvisioned(await call());
  });

  it('does not disguise other database errors as not provisioned', async () => {
    state.fail = new Error('connection reset');
    await expect(marketplace(get('/api/exchange/marketplace'))).rejects.toThrow('connection reset');
    const res = await statementPdf(get('/api/exchange/statements/s1/pdf'), params);
    expect(res.status).toBe(500);
  });
});
