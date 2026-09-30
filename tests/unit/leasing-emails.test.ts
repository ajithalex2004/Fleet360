/**
 * tests/unit/leasing-emails.test.ts
 *
 * Leasing emails sent through the tenant email templates.
 *
 * Covered:
 *  - quotation approval notifications: internal approval to Leasing
 *    Managers, credit review to Finance Managers, the quotation to the
 *    customer, handover to the customer; never to made-up team addresses
 *    or customer@example.com; an approver's recipient list is validated
 *  - staff recipients: role holders, else the tenant contact, else nobody
 *  - document expiry sweep: emails after the tenant transaction, with the
 *    expiring / expired template; nothing in a dry run
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  templated: [] as Array<Record<string, unknown>>,
  quotationEmails: [] as Array<Record<string, unknown>>,
  holders: {} as Record<string, Array<{ email: string }>>,
  contact: { contactEmail: 'office@acme.test', contactName: 'Acme Office', name: 'Acme' } as Record<string, string | null> | null,
  txResult: null as null | Record<string, unknown>,
  sweepTenants: [] as Array<{ tenantId: string; docs: Array<Record<string, unknown>> }>,
  inTx: false,
  sentInTx: 0,
}));

vi.mock('@/lib/email-templates', () => ({
  appUrl: (p: string) => `https://app.test${p}`,
  sendTemplatedEmail: async (args: Record<string, unknown>) => {
    if (state.inTx) state.sentInTx += 1;
    state.templated.push(args);
    return { sent: true };
  },
}));
vi.mock('@/lib/leasing/quotation-email', () => ({
  sendQuotationEmail: async (args: Record<string, unknown>) => { state.quotationEmails.push(args); return { sent: true }; },
}));
vi.mock('@/lib/session-user', () => ({ sessionUser: async () => ({ email: 'sales@acme.test', name: 'Sam' }) }));
vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: <T>(_t: string, fn: () => Promise<T>) => fn(),
  runOutsideRlsScope: <T>(fn: () => Promise<T>) => fn(),
}));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async () => state.txResult,
  withPlatformAdmin: async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    userTenant: {
      findMany: async ({ where }: { where: { role: { code: { equals: string } } } }) =>
        (state.holders[where.role.code.equals] ?? []).map((h) => ({ user: { email: h.email, firstName: null, lastName: null } })),
    },
  }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { tenant: { findUnique: async () => state.contact } },
}));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));
vi.mock('@/lib/prisma-sweep', () => ({
  runSweep: async (fn: (ctx: { tx: unknown; tenantId: string }) => Promise<unknown>) => {
    const out = [];
    for (const t of state.sweepTenants) {
      const tx = {
        leaseDocument: { findMany: async () => t.docs, update: async () => ({}) },
        leaseAlert: { findFirst: async () => null, create: async () => ({}) },
        lessee: { findUnique: async () => ({ email: 'lessee@cust.test', name: 'Cust LLC' }) },
        leaseContract2: { findUnique: async () => null },
      };
      state.inTx = true;
      const result = await fn({ tx, tenantId: t.tenantId });
      state.inTx = false;
      out.push({ tenantId: t.tenantId, result });
    }
    return out;
  },
}));

import { POST as approve } from '@/app/api/leasing/quotations/[id]/approve/route';
import { staffRecipients } from '@/lib/leasing/staff-recipients';
import { runExpirySweep } from '@/lib/leasing/expiry-sweep';
import { NextRequest } from 'next/server';

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const quotation = (email: string | null) => ({
  id: 'q1', quotationNumber: 'QT-9', currency: 'AED', totalMonthlyRate: 1000,
  lessee: { name: 'Cust LLC', email }, vehicles: [],
});
const post = (body: Record<string, unknown> = {}) => approve(new NextRequest('http://x/api/leasing/quotations/q1/approve', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-user-id': 'u1', 'x-tenant-id': TENANT, 'x-user-role': 'LEASING_MANAGER' },
  body: JSON.stringify(body),
}), { params: Promise.resolve({ id: 'q1' }) });
const day = 86400000;

beforeEach(() => {
  state.templated = []; state.quotationEmails = []; state.holders = {};
  state.contact = { contactEmail: 'office@acme.test', contactName: 'Acme Office', name: 'Acme' };
  state.sweepTenants = []; state.sentInTx = 0;
});

describe('quotation approval notifications', () => {
  it('asks Leasing Managers for internal approval, else the tenant contact', async () => {
    state.holders.LEASING_MANAGER = [{ email: 'lm1@acme.test' }, { email: 'lm2@acme.test' }];
    state.txResult = { updated: {}, quotation: quotation('c@cust.test'), nextStatus: 'PENDING_APPROVAL' };
    expect((await post()).status).toBe(200);
    expect(state.templated[0]).toMatchObject({ tenantId: TENANT, key: 'leasing.quotation_internal_approval', to: ['lm1@acme.test', 'lm2@acme.test'] });
    state.templated = []; state.holders = {};
    await post();
    expect(state.templated[0]).toMatchObject({ to: ['office@acme.test'] });
  });

  it('sends credit review to Finance Managers', async () => {
    state.holders.FINANCE_MANAGER = [{ email: 'fm@acme.test' }];
    state.txResult = { updated: {}, quotation: quotation('c@cust.test'), nextStatus: 'PENDING_CREDIT_APPROVAL' };
    await post();
    expect(state.templated).toEqual([expect.objectContaining({ key: 'leasing.quotation_credit_review', to: ['fm@acme.test'] })]);
  });

  it('sends the quotation to the lessee, or to a validated recipient list', async () => {
    state.txResult = { updated: {}, quotation: quotation('C@Cust.test'), nextStatus: 'SENT_TO_CUSTOMER' };
    await post();
    expect(state.quotationEmails[0]).toMatchObject({ tenantId: TENANT, to: ['c@cust.test'] });
    state.quotationEmails = [];
    await post({ recipientEmail: 'a@x.test; not-an-email, b@x.test' });
    expect(state.quotationEmails[0]).toMatchObject({ to: ['a@x.test', 'b@x.test'] });
  });

  it('never falls back to made-up addresses when the lessee has no email', async () => {
    state.txResult = { updated: {}, quotation: quotation(null), nextStatus: 'SENT_TO_CUSTOMER' };
    await post();
    state.txResult = { updated: {}, quotation: quotation(null), nextStatus: 'DELIVERED' };
    await post();
    state.contact = null;
    state.txResult = { updated: {}, quotation: quotation(null), nextStatus: 'PENDING_APPROVAL' };
    await post();
    expect(state.quotationEmails).toEqual([]);
    expect(state.templated).toEqual([]);
  });

  it('sends the handover email to the customer', async () => {
    state.txResult = { updated: {}, quotation: quotation('c@cust.test'), nextStatus: 'DELIVERED' };
    await post();
    expect(state.templated).toEqual([expect.objectContaining({ key: 'leasing.vehicle_handover', to: ['c@cust.test'] })]);
  });
});

describe('staffRecipients', () => {
  it('uses role holders, then the tenant contact, then nobody', async () => {
    state.holders.FINANCE_MANAGER = [{ email: 'fm@acme.test' }];
    expect(await staffRecipients(TENANT, 'FINANCE_MANAGER')).toEqual(['fm@acme.test']);
    expect(await staffRecipients(TENANT, 'LEASING_MANAGER')).toEqual(['office@acme.test']);
    state.contact = null;
    expect(await staffRecipients(TENANT, 'LEASING_MANAGER')).toEqual([]);
  });
});

describe('document expiry sweep emails', () => {
  const doc = (id: string, days: number) => ({
    id, tenantId: TENANT, docName: `Doc ${id}`, docType: 'TRADE_LICENSE', entityType: 'LESSEE', entityId: 'l1',
    status: 'VALID', expiryDate: new Date(Date.now() + days * day),
  });

  it('emails after the transaction, with the expiring or expired template', async () => {
    state.sweepTenants = [{ tenantId: TENANT, docs: [doc('d1', 10), doc('d2', -3)] }];
    const result = await runExpirySweep();
    expect(state.sentInTx).toBe(0);
    expect(result.emailsSent).toBe(2);
    expect(state.templated.map((t) => [t.key, t.tenantId, t.to])).toEqual([
      ['leasing.document_expiring', TENANT, 'lessee@cust.test'],
      ['leasing.document_expired', TENANT, 'lessee@cust.test'],
    ]);
    expect((state.templated[0].values as Record<string, string>).daysLeft).toBe('10');
  });

  it('sends nothing in a dry run', async () => {
    state.sweepTenants = [{ tenantId: TENANT, docs: [doc('d1', 10)] }];
    await runExpirySweep({ dryRun: true });
    expect(state.templated).toEqual([]);
  });
});
