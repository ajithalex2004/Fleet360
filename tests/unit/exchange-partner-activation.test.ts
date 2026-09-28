/**
 * Partner activation: a partner onboarded by a tenant starts Pending
 * Activation, uploads the compliance documents its service areas and emirate
 * require, submits them, and the onboarding tenant's administrators review
 * them and activate it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Doc = {
  id: string; docType: string; docNumber: string | null; fileUrl: string; expiryDate: Date | null;
  status: string; reviewNote: string | null; reviewedAt: Date | null; createdAt: Date;
};

const db = vi.hoisted(() => ({
  membershipStatus: 'DRAFT',
  role: 'PARTNER_ADMIN',
  partner: null as null | Record<string, unknown>,
  docs: [] as Doc[],
  partnerUpdates: [] as unknown[],
  docCreates: [] as unknown[],
  docUpdates: [] as unknown[],
  relationshipUpserts: [] as unknown[],
  emails: [] as unknown[],
}));

vi.mock('@/lib/prisma', () => {
  const partnerUser = {
    findMany: vi.fn(async (args: { select: Record<string, unknown> }) => {
      if (args.select.user) return [{ user: { email: 'admin@partner.ae' } }];
      return [{
        role: db.role,
        partner: {
          id: 'p1', legalName: 'Gulf Coaches LLC', partnerCode: 'GULF', city: 'Dubai', emirate: 'DUBAI',
          marketplaceStatus: 'NOT_APPLIED', operationalStatus: 'ACTIVE', onboardingStatus: db.membershipStatus,
        },
      }];
    }),
  };
  const transportPartner = {
    findFirst: vi.fn(async (args: { where: { id: string; onboardedByTenantId?: string } }) => {
      const p = db.partner;
      if (!p || args.where.id !== p.id) return null;
      if (args.where.onboardedByTenantId && args.where.onboardedByTenantId !== p.onboardedByTenantId) return null;
      return { ...p, complianceDocuments: db.docs };
    }),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => {
      db.partnerUpdates.push(args);
      if (db.partner) Object.assign(db.partner, args.data);
      return db.partner;
    }),
  };
  const partnerComplianceDoc = {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      db.docCreates.push(args);
      return { id: 'new-doc', ...args.data, createdAt: new Date() };
    }),
    findFirst: vi.fn(async (args: { where: { id: string; partnerId: string } }) =>
      db.docs.find((d) => d.id === args.where.id && args.where.partnerId === 'p1') ?? null),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      db.docUpdates.push(args);
      const d = db.docs.find((x) => x.id === args.where.id)!;
      Object.assign(d, args.data);
      return d;
    }),
  };
  return {
    prisma: {
      partnerUser,
      transportPartner,
      partnerComplianceDoc,
      tenantPartnerRelationship: { upsert: vi.fn(async (a: unknown) => { db.relationshipUpserts.push(a); return {}; }) },
      userTenant: { findMany: vi.fn(async () => [{ user: { email: 'admin@lease-a.ae' } }]) },
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
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (m: unknown) => { db.emails.push(m); return { sent: true }; }) }));
const stored = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('@/lib/storage', async (orig) => {
  const real = await orig<typeof import('@/lib/storage')>();
  return {
    ...real,
    getStorage: () => ({
      upload: vi.fn(async (i: { buffer: Buffer; originalName: string; mimeType: string; prefix: string }) => {
        const key = `${i.prefix}/00000000-0000-0000-0000-000000000000-${i.originalName}`;
        stored.set(key, i.buffer);
        return { url: `/uploads/${key}`, key, size: i.buffer.length, mimeType: i.mimeType, originalName: i.originalName };
      }),
      delete: vi.fn(),
    }),
    readStoredFile: vi.fn(async (key: string) => stored.get(key) ?? null),
  };
});

import { NextRequest } from 'next/server';
import {
  emirateOf, onboardingChecklist, requiredDocuments,
} from '@/lib/exchange/partner-activation';
import { complianceFileResponse } from '@/lib/exchange/compliance-files';
import * as compliance from '@/app/api/exchange/partner/compliance/route';
import { GET as onboardingGet } from '@/app/api/exchange/partner/onboarding/route';
import { POST as submit } from '@/app/api/exchange/partner/onboarding/submit/route';
import { GET as reviewList } from '@/app/api/admin/exchange/onboarding/route';
import { GET as reviewDetail } from '@/app/api/admin/exchange/onboarding/[id]/route';
import { PATCH as reviewDoc } from '@/app/api/admin/exchange/onboarding/[id]/documents/[docId]/route';
import { POST as decide } from '@/app/api/admin/exchange/onboarding/[id]/decision/route';

const partnerHeaders = { 'x-user-id': 'partner-user', 'x-tenant-id': 'lease-a', 'x-user-role': 'PARTNER' };
const adminHeaders = (tenant = 'lease-a', role = 'TENANT_ADMIN') =>
  ({ 'content-type': 'application/json', 'x-user-id': 'reviewer', 'x-tenant-id': tenant, 'x-user-role': role });

const future = new Date(Date.now() + 365 * 86_400_000);
const doc = (docType: string, status = 'PENDING', id = docType): Doc => ({
  id, docType, docNumber: 'N-1', fileUrl: `/uploads/exchange/partner-compliance/p1/x-${docType}.pdf`,
  expiryDate: future, status, reviewNote: null, reviewedAt: null, createdAt: new Date(),
});
const DUBAI_PASSENGER_DOCS = ['TRADE_LICENSE', 'TAX_CERTIFICATE', 'COMMERCIAL_INSURANCE', 'LIABILITY_INSURANCE', 'BANK_LETTER', 'PARTNER_AGREEMENT', 'RTA_PERMIT'];

function upload(fields: Record<string, string>, file?: { name: string; body?: string }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('file', new File([file.body ?? '%PDF-1.4'], file.name));
  return compliance.POST(new NextRequest('http://localhost/api/exchange/partner/compliance', { method: 'POST', headers: partnerHeaders, body: form }));
}

beforeEach(() => {
  db.membershipStatus = 'DRAFT';
  db.role = 'PARTNER_ADMIN';
  db.partner = {
    id: 'p1', legalName: 'Gulf Coaches LLC', tradeName: null, partnerCode: 'GULF', city: 'Dubai', emirate: 'DUBAI',
    tradeLicenseNumber: null, taxRegistrationNumber: null, primaryContactName: null, primaryContactEmail: null, primaryContactPhone: null,
    onboardingStatus: 'DRAFT', marketplaceStatus: 'NOT_APPLIED', operationalStatus: 'ACTIVE',
    approvedAt: null, rejectionReason: null, onboardedByTenantId: 'lease-a', createdAt: new Date(),
    capabilities: [{ domain: 'PASSENGER_TRANSPORT' }],
  };
  db.docs = [];
  db.partnerUpdates = []; db.docCreates = []; db.docUpdates = []; db.relationshipUpserts = []; db.emails = [];
});

describe('mandatory documents', () => {
  const types = (domains: string[], emirate: Parameters<typeof requiredDocuments>[0]['emirate']) =>
    requiredDocuments({ domains, emirate }).map((d) => d.docType);

  it('asks every partner for the company documents', () => {
    expect(types([], 'DUBAI')).toEqual(DUBAI_PASSENGER_DOCS.slice(0, 6));
  });

  it('asks for the passenger permit of the partner\'s emirate', () => {
    expect(types(['PASSENGER_TRANSPORT'], 'DUBAI')).toContain('RTA_PERMIT');
    expect(types(['LIMOUSINE'], 'ABU_DHABI')).toContain('ITC_PERMIT');
    expect(types(['PASSENGER_TRANSPORT'], 'SHARJAH')).toContain('TRANSPORT_AUTHORITY_PERMIT');
    expect(types(['PASSENGER_TRANSPORT'], null)).toContain('TRANSPORT_AUTHORITY_PERMIT');
  });

  it('adds the permits each service area needs, once each', () => {
    const docs = requiredDocuments({ domains: ['PASSENGER_TRANSPORT', 'SCHOOL_TRANSPORT', 'FREIGHT', 'RECOVERY'], emirate: 'DUBAI' });
    const t = docs.map((d) => d.docType);
    expect(t).toEqual(expect.arrayContaining(['RTA_PERMIT', 'SCHOOL_TRANSPORT_PERMIT', 'GOODS_TRANSPORT_PERMIT', 'RECOVERY_PERMIT']));
    expect(t.filter((x) => x === 'RTA_PERMIT')).toHaveLength(1);
    expect(docs.find((d) => d.docType === 'RTA_PERMIT')?.reason).toBe('Passenger transport, School transport');
  });

  it('guesses the emirate from the city when none is recorded', () => {
    expect(emirateOf({ emirate: null, city: 'Al Ain' })).toBe('ABU_DHABI');
    expect(emirateOf({ emirate: 'SHARJAH', city: 'Dubai' })).toBe('SHARJAH');
    expect(emirateOf({ city: 'Muscat' })).toBeNull();
  });

  it('is complete once everything is uploaded, and ready for activation once everything is approved', () => {
    const input = { domains: ['PASSENGER_TRANSPORT'], emirate: 'DUBAI' as const };
    const pending = onboardingChecklist(input, DUBAI_PASSENGER_DOCS.map((t) => doc(t)));
    expect(pending).toMatchObject({ complete: true, allApproved: false, missing: [] });
    const approved = onboardingChecklist(input, DUBAI_PASSENGER_DOCS.map((t) => doc(t, 'VALID')));
    expect(approved).toMatchObject({ complete: true, allApproved: true });
    const oneRejected = onboardingChecklist(input, [...DUBAI_PASSENGER_DOCS.slice(1).map((t) => doc(t, 'VALID')), doc('TRADE_LICENSE', 'REJECTED')]);
    expect(oneRejected).toMatchObject({ complete: false, allApproved: false, missing: ['Trade licence'] });
  });
});

describe('partner uploads (Pending Activation)', () => {
  it('stores the file in the partner\'s folder and records a document awaiting review', async () => {
    const res = await upload({ docType: 'TRADE_LICENSE', docNumber: 'TL-1', expiryDate: future.toISOString().slice(0, 10) }, { name: 'licence.pdf' });
    expect(res.status).toBe(201);
    const data = (db.docCreates[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ partnerId: 'p1', docType: 'TRADE_LICENSE', docNumber: 'TL-1', status: 'PENDING' });
    expect(String(data.fileUrl)).toMatch(/^\/uploads\/exchange\/partner-compliance\/p1\//);
  });

  it.each([
    ['an unknown document type', { docType: 'SELFIE' }, { name: 'a.pdf' }],
    ['no file', { docType: 'BANK_LETTER' }, undefined],
    ['a file type that is not a PDF or image', { docType: 'BANK_LETTER' }, { name: 'a.html' }],
    ['a numbered document without its number', { docType: 'TAX_CERTIFICATE' }, { name: 'a.pdf' }],
    ['an expiring document without its expiry', { docType: 'RTA_PERMIT', docNumber: 'R1' }, { name: 'a.pdf' }],
    ['an expired document', { docType: 'RTA_PERMIT', docNumber: 'R1', expiryDate: '2020-01-01' }, { name: 'a.pdf' }],
  ])('refuses %s', async (_n, fields, file) => {
    expect((await upload(fields as Record<string, string>, file)).status).toBe(400);
    expect(db.docCreates).toHaveLength(0);
  });

  it('keeps the marketplace closed until activation', async () => {
    const { requirePartnerContext } = await import('@/lib/exchange/partner-auth');
    const r = await requirePartnerContext(new NextRequest('http://localhost/x', { headers: partnerHeaders }));
    expect(r).toMatchObject({ ok: false, status: 403, code: 'PARTNER_PENDING_ACTIVATION' });
  });

  it('shows the checklist for the partner\'s services and emirate', async () => {
    db.docs = [doc('TRADE_LICENSE', 'VALID')];
    const res = await onboardingGet(new NextRequest('http://localhost/api/exchange/partner/onboarding', { headers: partnerHeaders }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.partner).toMatchObject({ onboardingStatus: 'DRAFT', onboardingLabel: 'Pending activation', emirate: 'DUBAI' });
    expect(body.checklist.items.map((i: { docType: string }) => i.docType)).toEqual(DUBAI_PASSENGER_DOCS);
    expect(body.documents[0]).toMatchObject({ hasFile: true });
    expect(body.documents[0]).not.toHaveProperty('fileUrl');
  });
});

describe('submitting for review', () => {
  const post = () => submit(new NextRequest('http://localhost/api/exchange/partner/onboarding/submit', { method: 'POST', headers: partnerHeaders }));

  it('needs every mandatory document uploaded', async () => {
    db.docs = [doc('TRADE_LICENSE')];
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/RTA passenger transport permit/);
    expect(db.partnerUpdates).toHaveLength(0);
  });

  it('is for the partner\'s administrator', async () => {
    db.role = 'PARTNER_OPERATIONS';
    db.docs = DUBAI_PASSENGER_DOCS.map((t) => doc(t));
    expect((await post()).status).toBe(403);
  });

  it('moves the partner to Under review and emails the onboarding tenant\'s administrators', async () => {
    db.docs = DUBAI_PASSENGER_DOCS.map((t) => doc(t));
    const res = await post();
    expect(res.status).toBe(200);
    expect(db.partnerUpdates).toEqual([{ where: { id: 'p1' }, data: { onboardingStatus: 'UNDER_REVIEW', marketplaceStatus: 'UNDER_REVIEW' } }]);
    expect(db.emails).toEqual([expect.objectContaining({ to: ['admin@lease-a.ae'] })]);
  });

  it('cannot be submitted twice', async () => {
    db.docs = DUBAI_PASSENGER_DOCS.map((t) => doc(t));
    db.partner!.onboardingStatus = 'UNDER_REVIEW';
    expect((await post()).status).toBe(409);
  });
});

describe('the onboarding tenant\'s review', () => {
  const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });
  const decision = (body: unknown, tenant?: string, role?: string) =>
    decide(new NextRequest('http://localhost/api/admin/exchange/onboarding/p1/decision', {
      method: 'POST', headers: adminHeaders(tenant, role), body: JSON.stringify(body),
    }), params({ id: 'p1' }));

  it('is limited to the tenant\'s administrators', async () => {
    const list = await reviewList(new NextRequest('http://localhost/api/admin/exchange/onboarding', { headers: adminHeaders('lease-a', 'STAFF') }));
    expect(list.status).toBe(403);
  });

  it('hides another tenant\'s partner', async () => {
    const res = await reviewDetail(new NextRequest('http://localhost/api/admin/exchange/onboarding/p1', { headers: adminHeaders('other-tenant') }), params({ id: 'p1' }));
    expect(res.status).toBe(404);
    expect((await decision({ decision: 'ACTIVATE' }, 'other-tenant')).status).toBe(404);
    expect(db.partnerUpdates).toHaveLength(0);
  });

  it('lets a platform administrator review any partner', async () => {
    const res = await reviewDetail(new NextRequest('http://localhost/api/admin/exchange/onboarding/p1', { headers: adminHeaders('platform', 'SUPER_ADMIN') }), params({ id: 'p1' }));
    expect(res.status).toBe(200);
  });

  it('approves and rejects documents, a rejection with a note', async () => {
    db.docs = [doc('TRADE_LICENSE')];
    const patch = (body: unknown) => reviewDoc(new NextRequest('http://localhost/x', {
      method: 'PATCH', headers: adminHeaders(), body: JSON.stringify(body),
    }), params({ id: 'p1', docId: 'TRADE_LICENSE' }));
    expect((await patch({ decision: 'REJECT' })).status).toBe(400);
    expect((await patch({ decision: 'APPROVE' })).status).toBe(200);
    expect(db.docUpdates[0]).toMatchObject({ data: { status: 'VALID', reviewedBy: 'reviewer' } });
  });

  it('activates only once every mandatory document is approved', async () => {
    db.partner!.onboardingStatus = 'UNDER_REVIEW';
    db.docs = [...DUBAI_PASSENGER_DOCS.slice(1).map((t) => doc(t, 'VALID')), doc('TRADE_LICENSE')];
    const refused = await decision({ decision: 'ACTIVATE' });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/Trade licence/);
    expect(db.partnerUpdates).toHaveLength(0);
  });

  it('activates the partner into the tenant\'s network and emails its administrators', async () => {
    db.partner!.onboardingStatus = 'UNDER_REVIEW';
    db.docs = DUBAI_PASSENGER_DOCS.map((t) => doc(t, 'VALID'));
    const res = await decision({ decision: 'ACTIVATE' });
    expect(res.status).toBe(200);
    expect(db.partnerUpdates[0]).toMatchObject({
      data: { onboardingStatus: 'APPROVED', marketplaceStatus: 'APPROVED', operationalStatus: 'ACTIVE', approvedBy: 'reviewer' },
    });
    expect(db.relationshipUpserts[0]).toMatchObject({
      create: { tenantId: 'lease-a', partnerId: 'p1', status: 'APPROVED' }, update: {},
    });
    expect(db.emails).toEqual([expect.objectContaining({ to: ['admin@partner.ae'] })]);
  });

  it('won\'t activate a partner without service areas', async () => {
    db.partner!.capabilities = [];
    db.docs = DUBAI_PASSENGER_DOCS.map((t) => doc(t, 'VALID'));
    expect((await decision({ decision: 'ACTIVATE' })).status).toBe(409);
  });

  it('asks for more information or rejects, each with a note', async () => {
    expect((await decision({ decision: 'MORE_INFO' })).status).toBe(400);
    expect((await decision({ decision: 'MORE_INFO', note: 'Upload the stamped agreement' })).status).toBe(200);
    expect(db.partnerUpdates[0]).toMatchObject({
      data: { onboardingStatus: 'MORE_INFO_REQUIRED', rejectionReason: 'Upload the stamped agreement' },
    });
    expect((await decision({ decision: 'REJECT', note: 'Not licensed' })).status).toBe(200);
    expect(db.partnerUpdates[1]).toMatchObject({ data: { onboardingStatus: 'REJECTED', marketplaceStatus: 'REJECTED' } });
  });
});

describe('compliance files', () => {
  it('serves only files in the partner\'s own folder', async () => {
    const res = await upload({ docType: 'BANK_LETTER' }, { name: 'bank.pdf', body: '%PDF-bank' });
    expect(res.status).toBe(201);
    const url = String((db.docCreates[0] as { data: { fileUrl: string } }).data.fileUrl);
    const ok = await complianceFileResponse('p1', url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(ok.headers.get('content-security-policy')).toContain('sandbox');
    expect((await complianceFileResponse('p2', url)).status).toBe(404);
    expect((await complianceFileResponse('p1', 'https://evil.example/x.pdf')).status).toBe(404);
    expect((await complianceFileResponse('p1', '/uploads/exchange/partner-compliance/p1/../p2/x.pdf')).status).toBe(404);
  });
});
