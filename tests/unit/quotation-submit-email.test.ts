/**
 * tests/unit/quotation-submit-email.test.ts
 *
 * POST /api/leasing/quotations/[id]/submit emails the lessee through the
 * platform email sender. It used to read an EMAIL row of "IntegrationConfig",
 * which no admin screen creates, so quotations were never emailed.
 *
 * Covered:
 *  - the lessee is emailed, with the tenant's name and replies to the sender
 *  - email not set up → status still updated, message points to the settings
 *  - no customer address → nothing sent, status still updated
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  sendResult: { sent: true } as { sent: boolean; reason?: string },
  lesseeEmail: 'customer@lessee.test' as string | null,
}));

vi.mock('@/lib/email', () => ({
  sendEmail: async (msg: Record<string, unknown>) => { state.sent.push(msg); return state.sendResult; },
}));
vi.mock('@/lib/session-user', () => ({ sessionUser: async () => ({ email: 'sales@a.test', name: 'Sam' }) }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => fn({
    leaseQuotation: { updateMany: async () => ({ count: 1 }) },
    $queryRawUnsafe: async () => [{ name: 'Acme Leasing' }],
  }),
}));
vi.mock('@/lib/branding', () => ({ getBranding: async () => null }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => (sql.includes('FROM tenants') ? [{ name: 'Acme Leasing', default_language: 'en' }] : []),
    leaseQuotation: {
      findFirst: async () => ({
        id: 'q1', quotationNumber: 'Q-100', leaseType: 'LONG_TERM', currency: 'AED',
        totalMonthlyRate: 1000, totalContractValue: 12000, securityDeposit: 0,
        lessee: { name: 'Lessee Co', email: state.lesseeEmail }, vehicles: [], lineItems: [],
      }),
    },
  },
}));

import { POST } from '@/app/api/leasing/quotations/[id]/submit/route';
import { NextRequest } from 'next/server';

const submit = () => POST(new NextRequest('http://x/api/leasing/quotations/q1/submit', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-user-id': 'u1', 'x-tenant-id': 'aaaaaaaa-0000-4000-8000-000000000001', 'x-user-role': 'LEASING_MANAGER' },
  body: '{}',
}), { params: Promise.resolve({ id: 'q1' }) });

beforeEach(() => {
  state.sent = [];
  state.sendResult = { sent: true };
  state.lesseeEmail = 'customer@lessee.test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('quotation submit email', () => {
  it('emails the lessee with the tenant name, replying to the sender', async () => {
    const res = await submit();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.email).toMatchObject({ sent: true, recipient: 'customer@lessee.test' });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ to: 'customer@lessee.test', replyTo: 'sales@a.test' });
    expect(String(state.sent[0].subject)).toContain('Acme Leasing');
  });

  it('still updates the status when email is not set up', async () => {
    state.sendResult = { sent: false, reason: 'smtp_not_configured' };
    const body = await (await submit()).json();
    expect(body.status).toBe('SENT_TO_CUSTOMER');
    expect(body.email.sent).toBe(false);
    expect(body.email.message).toContain('Admin > Settings > Notifications');
  });

  it('sends nothing without a customer address', async () => {
    state.lesseeEmail = null;
    const body = await (await submit()).json();
    expect(body.status).toBe('SENT_TO_CUSTOMER');
    expect(state.sent).toHaveLength(0);
  });
});
