/**
 * The partner portal routes beyond the marketplace: fleet, drivers,
 * compliance, invoices, job assignment, profile, scorecard, and the statement
 * and proof-of-delivery PDFs.
 *
 * They used to take the partner from ?partnerId= or the body (and without one
 * listed every partner's data), and the PDFs rendered made-up documents for
 * any id. The partner now comes from the caller's partner_users membership;
 * buyer staff reach only partners and records of their own tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  memberships: [] as unknown[],
  related: [] as { partnerId: string }[],
  award: null as unknown,
  vehicle: {} as unknown,
  driver: {} as unknown,
  statement: null as unknown,
  assignment: null as unknown,
  scope: [] as string[],
  calls: [] as { model: string; args: unknown }[],
}));

vi.mock('@/lib/prisma', () => {
  const rec = (model: string, result: () => unknown) =>
    vi.fn(async (args: unknown) => { db.calls.push({ model, args }); return result(); });
  return {
    prisma: {
      partnerUser: { findMany: vi.fn(async () => db.memberships) },
      tenantPartnerRelationship: { findMany: vi.fn(async () => db.related) },
      partnerVehicle: { findMany: rec('partnerVehicle.findMany', () => []), findFirst: rec('partnerVehicle.findFirst', () => db.vehicle) },
      partnerDriver: { findMany: rec('partnerDriver.findMany', () => []), findFirst: rec('partnerDriver.findFirst', () => db.driver) },
      partnerComplianceDoc: { findMany: rec('partnerComplianceDoc.findMany', () => []) },
      partnerInvoice: { findMany: rec('partnerInvoice.findMany', () => []) },
      outsourceAward: { findFirst: rec('outsourceAward.findFirst', () => db.award) },
      transportPartner: { update: rec('transportPartner.update', () => ({ id: 'p1' })) },
      partnerSettlementStatement: { findUnique: vi.fn(async () => db.statement) },
      partnerAssignment: { findUnique: vi.fn(async () => db.assignment) },
      tenant: { findUnique: vi.fn(async () => ({ name: 'Buyer Co' })) },
    },
  };
});
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return {
    withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => { db.scope.push('*'); return fn(prisma); }),
    withTenantRls: vi.fn(async (_p: unknown, t: string, fn: (tx: unknown) => unknown) => { db.scope.push(t); return fn(prisma); }),
  };
});
vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: vi.fn(async (t: string, fn: () => unknown) => { db.scope.push(`as:${t}`); return fn(); }),
}));

const svc = vi.hoisted(() => ({
  registerVehicle: vi.fn(async (i: unknown) => i),
  registerDriver: vi.fn(async (i: unknown) => i),
  uploadComplianceDoc: vi.fn(async (i: unknown) => i),
  getPartnerProfile: vi.fn(async (id: string) => ({ id })),
  submitInvoice: vi.fn(async (i: unknown) => i),
  assign: vi.fn(async () => ({ assignmentId: 'a1' })),
  getScorecard: vi.fn(async (id: string) => ({ partnerId: id })),
  evaluate: vi.fn(async (id: string) => ({ partnerId: id })),
  pdf: vi.fn(() => new Uint8Array([37, 80, 68, 70])),
}));
vi.mock('@/lib/exchange/partner-service', () => ({
  PartnerService: {
    registerVehicle: svc.registerVehicle,
    registerDriver: svc.registerDriver,
    uploadComplianceDoc: svc.uploadComplianceDoc,
    getPartnerProfile: svc.getPartnerProfile,
  },
}));
vi.mock('@/lib/exchange/partner-invoice-service', () => ({ PartnerInvoiceService: { submitInvoice: svc.submitInvoice } }));
vi.mock('@/lib/exchange/outsource-engine', () => ({ OutsourceEngine: { assignVehicleAndDriver: svc.assign } }));
vi.mock('@/lib/exchange/scorecard-service', () => ({
  ScorecardService: { getPartnerScorecard: svc.getScorecard, evaluatePartnerScorecard: svc.evaluate },
}));
vi.mock('@/lib/exchange/pdf-service', () => ({
  PdfDocumentService: { generateTaxInvoicePdf: svc.pdf, generatePodReceiptPdf: svc.pdf },
}));

import { NextRequest } from 'next/server';
import * as fleet from '@/app/api/exchange/partner/fleet/route';
import * as drivers from '@/app/api/exchange/partner/drivers/route';
import * as compliance from '@/app/api/exchange/partner/compliance/route';
import * as invoices from '@/app/api/exchange/invoices/route';
import * as assign from '@/app/api/exchange/jobs/assign/route';
import * as profile from '@/app/api/exchange/partner/profile/route';
import * as scorecard from '@/app/api/exchange/scorecard/route';
import { GET as statementPdf } from '@/app/api/exchange/statements/[id]/pdf/route';
import { GET as podPdf } from '@/app/api/exchange/pod/[assignmentId]/pdf/route';

const member = (partnerId: string, role = 'PARTNER_ADMIN') => ({
  role,
  partner: { id: partnerId, legalName: `Partner ${partnerId}`, marketplaceStatus: 'APPROVED', operationalStatus: 'ACTIVE' },
});
const headers = (tenant = 'tenant-partner') => ({ 'content-type': 'application/json', 'x-user-id': 'user-1', 'x-tenant-id': tenant });
const get = (url: string, tenant?: string) => new NextRequest(`http://localhost${url}`, { headers: headers(tenant) });
const send = (method: string, url: string, body: unknown, tenant?: string) =>
  new NextRequest(`http://localhost${url}`, { method, headers: headers(tenant), body: JSON.stringify(body) });
const lastCall = (model: string) => [...db.calls].reverse().find((c) => c.model === model)?.args;

beforeEach(() => {
  db.memberships = []; db.related = []; db.award = null; db.vehicle = {}; db.driver = {};
  db.statement = null; db.assignment = null; db.scope = []; db.calls = [];
  Object.values(svc).forEach((f) => f.mockClear());
});

describe('partner-only routes', () => {
  it.each([
    ['fleet', () => fleet.GET(get('/api/exchange/partner/fleet?partnerId=p2')), 'partnerVehicle.findMany'],
    ['drivers', () => drivers.GET(get('/api/exchange/partner/drivers')), 'partnerDriver.findMany'],
    ['compliance', () => compliance.GET(get('/api/exchange/partner/compliance')), 'partnerComplianceDoc.findMany'],
    ['invoices', () => invoices.GET(get('/api/exchange/invoices')), 'partnerInvoice.findMany'],
  ])('%s GET refuses a user linked to no partner', async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(403);
  });

  it('fleet GET lists only the member partner, and a foreign ?partnerId= is refused', async () => {
    db.memberships = [member('p1')];
    expect((await fleet.GET(get('/api/exchange/partner/fleet'))).status).toBe(200);
    expect(lastCall('partnerVehicle.findMany')).toMatchObject({ where: { partnerId: 'p1', isActive: true } });
    expect((await fleet.GET(get('/api/exchange/partner/fleet?partnerId=p2'))).status).toBe(403);
  });

  it('POSTs register for the member partner, ignoring partnerId in the body', async () => {
    db.memberships = [member('p1', 'PARTNER_OPERATIONS')];
    await fleet.POST(send('POST', '/api/exchange/partner/fleet', { partnerId: 'p2', licensePlate: 'D 1', vehicleType: 'Bus', seatingCapacity: 30 }));
    await drivers.POST(send('POST', '/api/exchange/partner/drivers', { partnerId: 'p2', fullName: 'X', mobileNumber: '1' }));
    await compliance.POST(send('POST', '/api/exchange/partner/compliance', { partnerId: 'p2', docType: 'TL', fileUrl: 'f' }));
    expect(svc.registerVehicle).toHaveBeenCalledWith(expect.objectContaining({ partnerId: 'p1' }));
    expect(svc.registerDriver).toHaveBeenCalledWith(expect.objectContaining({ partnerId: 'p1' }));
    expect(svc.uploadComplianceDoc).toHaveBeenCalledWith(expect.objectContaining({ partnerId: 'p1' }));
  });

  it('a viewer cannot register fleet', async () => {
    db.memberships = [member('p1', 'PARTNER_VIEWER')];
    const res = await fleet.POST(send('POST', '/api/exchange/partner/fleet', { licensePlate: 'D 1', vehicleType: 'Bus', seatingCapacity: 30 }));
    expect(res.status).toBe(403);
    expect(svc.registerVehicle).not.toHaveBeenCalled();
  });
});

describe('invoices and job assignment act on the partner\'s own awards, as the buyer tenant', () => {
  it('invoice POST 404s another partner\'s award', async () => {
    db.memberships = [member('p1', 'PARTNER_FINANCE')];
    db.award = null;
    const res = await invoices.POST(send('POST', '/api/exchange/invoices', { awardId: 'aw1', invoiceNumber: 'INV-1', subtotalAmount: 100 }));
    expect(res.status).toBe(404);
    expect(lastCall('outsourceAward.findFirst')).toMatchObject({ where: { id: 'aw1', partnerId: 'p1' } });
    expect(svc.submitInvoice).not.toHaveBeenCalled();
  });

  it('invoice POST submits as the member partner in the buyer tenant', async () => {
    db.memberships = [member('p1', 'PARTNER_FINANCE')];
    db.award = { tenantId: 'tenant-buyer' };
    const res = await invoices.POST(send('POST', '/api/exchange/invoices', { partnerId: 'p2', awardId: 'aw1', invoiceNumber: 'INV-1', subtotalAmount: 100 }));
    expect(res.status).toBe(200);
    expect(svc.submitInvoice).toHaveBeenCalledWith(expect.objectContaining({ partnerId: 'p1', awardId: 'aw1' }));
    expect(db.scope).toContain('as:tenant-buyer');
  });

  it('operations staff cannot submit invoices', async () => {
    db.memberships = [member('p1', 'PARTNER_OPERATIONS')];
    const res = await invoices.POST(send('POST', '/api/exchange/invoices', { awardId: 'aw1', invoiceNumber: 'INV-1', subtotalAmount: 100 }));
    expect(res.status).toBe(403);
  });

  it('assign refuses a vehicle from another partner\'s fleet', async () => {
    db.memberships = [member('p1', 'PARTNER_OPERATIONS')];
    db.award = { tenantId: 'tenant-buyer' };
    db.vehicle = null;
    const res = await assign.POST(send('POST', '/api/exchange/jobs/assign', { awardId: 'aw1', vehicleId: 'v-other', vehiclePlate: 'D 1', driverName: 'X', driverPhone: '1' }));
    expect(res.status).toBe(404);
    expect(lastCall('partnerVehicle.findFirst')).toMatchObject({ where: { id: 'v-other', partnerId: 'p1' } });
    expect(svc.assign).not.toHaveBeenCalled();
  });

  it('assign runs as the buyer tenant for the member partner', async () => {
    db.memberships = [member('p1', 'PARTNER_OPERATIONS')];
    db.award = { tenantId: 'tenant-buyer' };
    const res = await assign.POST(send('POST', '/api/exchange/jobs/assign', { partnerId: 'p2', awardId: 'aw1', vehicleId: 'v1', driverId: 'd1', vehiclePlate: 'D 1', driverName: 'X', driverPhone: '1' }));
    expect(res.status).toBe(200);
    expect(svc.assign).toHaveBeenCalledWith(expect.objectContaining({ partnerId: 'p1', actorUserId: 'user-1' }));
    expect(db.scope).toContain('as:tenant-buyer');
  });
});

describe('profile and scorecard: the partner itself, or buyer staff for partners in their network', () => {
  it('a partner member gets its own profile', async () => {
    db.memberships = [member('p1', 'PARTNER_VIEWER')];
    const res = await profile.GET(get('/api/exchange/partner/profile'));
    expect(res.status).toBe(200);
    expect(svc.getPartnerProfile).toHaveBeenCalledWith('p1');
  });

  it('buyer staff get a related partner, and are refused an unrelated one', async () => {
    db.related = [{ partnerId: 'p7' }];
    const first = await profile.GET(get('/api/exchange/partner/profile', 'tenant-buyer'));
    expect(first.status).toBe(200);
    expect(svc.getPartnerProfile).toHaveBeenCalledWith('p7');
    const other = await profile.GET(get('/api/exchange/partner/profile?partnerId=p9', 'tenant-buyer'));
    expect(other.status).toBe(403);
  });

  it('buyer staff with no partner network get no profile (no fallback to another tenant\'s partner)', async () => {
    const res = await profile.GET(get('/api/exchange/partner/profile', 'tenant-buyer'));
    expect(await res.json()).toEqual({ partner: null });
    expect(svc.getPartnerProfile).not.toHaveBeenCalled();
  });

  it('profile PUT updates the member partner only, and only for a partner admin', async () => {
    db.memberships = [member('p1', 'PARTNER_ADMIN')];
    const ok = await profile.PUT(send('PUT', '/api/exchange/partner/profile', { partnerId: 'p2', legalName: 'New' }));
    expect(ok.status).toBe(200);
    expect(lastCall('transportPartner.update')).toMatchObject({ where: { id: 'p1' } });
    db.memberships = [member('p1', 'PARTNER_OPERATIONS')];
    expect((await profile.PUT(send('PUT', '/api/exchange/partner/profile', { legalName: 'New' }))).status).toBe(403);
    db.memberships = [];
    expect((await profile.PUT(send('PUT', '/api/exchange/partner/profile', { partnerId: 'p1', legalName: 'New' }))).status).toBe(403);
  });

  it('scorecard POST honours a body partnerId only within the caller\'s network, computed in platform context', async () => {
    db.related = [{ partnerId: 'p7' }];
    expect((await scorecard.POST(send('POST', '/api/exchange/scorecard', { partnerId: 'p9' }, 'tenant-buyer'))).status).toBe(403);
    const res = await scorecard.POST(send('POST', '/api/exchange/scorecard', { partnerId: 'p7' }, 'tenant-buyer'));
    expect(res.status).toBe(200);
    expect(svc.evaluate).toHaveBeenCalledWith('p7');
    expect(db.scope).toContain('as:*');
  });
});

describe('statement and proof-of-delivery PDFs', () => {
  const statement = { statementNumber: 'ST-1', tenantId: 'tenant-buyer', partnerId: 'p1', tenantTrn: null, partnerTrn: null, periodStart: new Date(), periodEnd: new Date(), grossAmount: 1, vatAmount: 0, totalDeductions: 0, netPayable: 1, partner: { legalName: 'P1', taxRegistrationNumber: null }, invoices: [], deductions: [] };
  const params = (id: string) => ({ params: Promise.resolve({ id, assignmentId: id }) });

  it('an unknown statement is a 404, not a made-up document', async () => {
    const res = await statementPdf(get('/x', 'tenant-buyer'), params('nope'));
    expect(res.status).toBe(404);
    expect(svc.pdf).not.toHaveBeenCalled();
  });

  it('is refused to a tenant that is neither the buyer nor the partner', async () => {
    db.statement = statement;
    const res = await statementPdf(get('/x', 'tenant-other'), params('s1'));
    expect(res.status).toBe(404);
  });

  it('is served to the buyer tenant\'s staff and to the partner\'s members', async () => {
    db.statement = statement;
    expect((await statementPdf(get('/x', 'tenant-buyer'), params('s1'))).status).toBe(200);
    db.memberships = [member('p1', 'PARTNER_VIEWER')];
    expect((await statementPdf(get('/x', 'tenant-partner'), params('s1'))).status).toBe(200);
  });

  it('POD: 404 for strangers, 409 before completion, served to the buyer once completed', async () => {
    const assignment = { partnerId: 'p1', vehiclePlate: 'D 1', driverName: 'X', driverPhone: '1', completedAt: null as Date | null, pod: null, award: { tenantId: 'tenant-buyer', request: { requestNumber: 'OR-1', domain: 'PASSENGER_TRANSPORT', pickupLocation: 'A', dropoffLocation: 'B' } } };
    db.assignment = assignment;
    expect((await podPdf(get('/x', 'tenant-other'), params('a1'))).status).toBe(404);
    expect((await podPdf(get('/x', 'tenant-buyer'), params('a1'))).status).toBe(409);
    assignment.completedAt = new Date();
    const res = await podPdf(get('/x', 'tenant-buyer'), params('a1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });
});
