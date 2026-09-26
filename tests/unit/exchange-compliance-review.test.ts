/**
 * Compliance documents are reviewed before they count as valid: uploads start
 * PENDING, and only a platform administrator approves (VALID) or rejects
 * (REJECTED, with a note the partner sees) them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ doc: null as unknown, docs: [] as unknown[] }));
const create = vi.hoisted(() => vi.fn(async (args: { data: unknown }) => args.data));
const update = vi.hoisted(() => vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'd1', docType: 'TRADE_LICENSE', ...args.data })));
const audit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  prisma: {
    partnerComplianceDoc: {
      create,
      update,
      findFirst: vi.fn(async () => db.doc),
      findMany: vi.fn(async () => db.docs),
    },
  },
}));
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return { withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)) };
});
vi.mock('@/lib/audit', () => ({ logAudit: audit }));
vi.mock('@/lib/alerts/raise', () => ({ raiseAlert: vi.fn() }));

import { NextRequest } from 'next/server';
import { PartnerService } from '@/lib/exchange/partner-service';
import { GET } from '@/app/api/admin/exchange/partners/[id]/compliance/route';
import { PATCH } from '@/app/api/admin/exchange/partners/[id]/compliance/[docId]/route';

const headers = (role: string) => ({ 'content-type': 'application/json', 'x-user-id': 'admin-1', 'x-tenant-id': 'platform', 'x-user-role': role });
const list = (role: string) =>
  GET(new NextRequest('http://localhost/api/admin/exchange/partners/p1/compliance', { headers: headers(role) }), { params: Promise.resolve({ id: 'p1' }) });
const decide = (role: string, body: unknown, docId = 'd1') =>
  PATCH(
    new NextRequest(`http://localhost/api/admin/exchange/partners/p1/compliance/${docId}`, { method: 'PATCH', headers: headers(role), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'p1', docId }) },
  );

beforeEach(() => {
  db.doc = { id: 'd1', docType: 'TRADE_LICENSE', partner: { legalName: 'Gulf Coaches' } };
  db.docs = [];
  create.mockClear(); update.mockClear(); audit.mockClear();
});

describe('uploading a compliance document', () => {
  it('stores it as PENDING, not VALID', async () => {
    await PartnerService.uploadComplianceDoc({ partnerId: 'p1', docType: 'TRADE_LICENSE', fileUrl: 'https://x.test/tl.pdf' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'PENDING' }) });
  });
});

describe('GET /api/admin/exchange/partners/:id/compliance', () => {
  it('refuses anyone but a super admin', async () => {
    expect((await list('TENANT_ADMIN')).status).toBe(403);
  });

  it('lists pending documents first', async () => {
    db.docs = [{ id: 'a', status: 'VALID' }, { id: 'b', status: 'PENDING' }, { id: 'c', status: 'REJECTED' }];
    const res = await list('SUPER_ADMIN');
    expect((await res.json()).documents.map((d: { id: string }) => d.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('PATCH /api/admin/exchange/partners/:id/compliance/:docId', () => {
  it('refuses anyone but a super admin', async () => {
    expect((await decide('TENANT_ADMIN', { decision: 'APPROVE' })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('approves a document as VALID, records the reviewer and audits it', async () => {
    const res = await decide('SUPER_ADMIN', { decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'd1' },
      data: expect.objectContaining({ status: 'VALID', reviewNote: null, reviewedBy: 'admin-1' }),
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'PartnerComplianceDoc', userId: 'admin-1' }));
  });

  it('rejects with the note the partner sees', async () => {
    await decide('SUPER_ADMIN', { decision: 'REJECT', note: '  Licence is expired  ' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED', reviewNote: 'Licence is expired' }),
    }));
  });

  it('needs a valid decision, a note to reject, and a document of this partner', async () => {
    expect((await decide('SUPER_ADMIN', { decision: 'MAYBE' })).status).toBe(400);
    expect((await decide('SUPER_ADMIN', { decision: 'REJECT' })).status).toBe(400);
    db.doc = null;
    expect((await decide('SUPER_ADMIN', { decision: 'APPROVE' }, 'other')).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
