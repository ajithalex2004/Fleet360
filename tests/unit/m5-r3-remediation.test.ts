/**
 * Behavioral regression tests for Milestone M5-R3 remediation (WP2, WP4, WP5, WP6, WP7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const state = vi.hoisted(() => ({
  authz: {
    ok: true as const,
    tenantId: 'tenant-a',
    userId: 'user-maker',
    role: 'TENANT_ADMIN',
  },
  stripeConfigured: true,
  stripeSession: {
    payment_status: 'paid',
    currency: 'aed',
    amount_total: 157500,
    metadata: { tenantId: 'tenant-a', targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY' } as Record<string, string>,
    customer: 'cus_123',
    subscription: 'sub_123',
    invoice: 'in_123',
  },
  redeemedEvent: null as { id: string } | null,
  txQueryMock: vi.fn(),
  txExecMock: vi.fn(),
  partnerInvoiceCreateMock: vi.fn(),
  partnerInvoiceFindFirstMock: vi.fn(),
  outsourceAwardFindFirstMock: vi.fn(),
  vehicleFindManyMock: vi.fn(),
  aiGatewayStructuredMock: vi.fn(),
}));

vi.mock('@/lib/tenant-context', () => ({
  requireAuthorizedTenant: vi.fn(() => state.authz),
  requireSuperAdminForTenant: vi.fn((authz: { role: string | null; tenantId: string }, requested: string) =>
    authz.role === 'SUPER_ADMIN' || authz.tenantId === requested
      ? { ok: true }
      : { ok: false, status: 403, error: 'Only a platform admin can access another tenant' },
  ),
  stripTenantOwnershipFields: vi.fn((body: Record<string, unknown>) => {
    const copy = { ...body };
    delete copy.tenantId;
    delete copy.tenant_id;
    return copy;
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => state.txQueryMock(...args),
    $executeRawUnsafe: (...args: unknown[]) => state.txExecMock(...args),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  },
}));

const mockTx = {
  $queryRawUnsafe: (...args: unknown[]) => state.txQueryMock(...args),
  $executeRawUnsafe: (...args: unknown[]) => state.txExecMock(...args),
  stripeEventProcessed: {
    findUnique: vi.fn(async () => state.redeemedEvent),
    create: vi.fn(async () => ({ id: 'evt-1' })),
  },
  tenant: {
    findUnique: vi.fn(async () => ({ id: 'tenant-a', name: 'Tenant A', contactEmail: 'a@test.ae', plan: 'STANDARD' })),
    update: vi.fn(async () => ({ id: 'tenant-a' })),
  },
  platformSubscriptionInvoice: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'inv-1', ...data })),
  },
  subscription: {
    upsert: vi.fn(async () => ({ id: 'sub-row-1' })),
  },
  outsourceAward: {
    findFirst: (...args: unknown[]) => state.outsourceAwardFindFirstMock(...args),
  },
  partnerInvoice: {
    findFirst: (...args: unknown[]) => state.partnerInvoiceFindFirstMock(...args),
    create: (...args: unknown[]) => state.partnerInvoiceCreateMock(...args),
  },
  vehicle: {
    findMany: (...args: unknown[]) => state.vehicleFindManyMock(...args),
  },
};

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
}));

vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: vi.fn(async (_t: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
  logAuditInTx: vi.fn(async () => undefined),
}));

vi.mock('@/lib/audited-action', () => ({
  withAuditedAction: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock('@/lib/auth/session-revocation', () => ({
  revokeSessionsSafely: vi.fn(async () => undefined),
}));

vi.mock('@/lib/billing', () => ({
  PLAN_CODES: ['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'],
  isStripeConfigured: () => state.stripeConfigured,
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => state.stripeSession),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(async () => ({
        status: 'succeeded',
        currency: 'aed',
        amount_received: 157500,
        metadata: { tenantId: 'tenant-a', targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY' },
        customer: 'cus_123',
      })),
    },
  }),
}));

vi.mock('@/lib/exchange/partner-auth', () => ({
  FINANCE_ROLES: ['PARTNER_ADMIN', 'PARTNER_FINANCE'],
  partnerAuthFailure: vi.fn(),
  requirePartnerContext: vi.fn(async () => ({
    ok: true,
    ctx: { partnerId: 'partner-1', userId: 'user-partner-1', role: 'PARTNER_FINANCE' },
  })),
  awardTenantForPartner: vi.fn(async () => null),
}));

vi.mock('@/lib/agents/gateway', () => ({
  aiGateway: {
    structuredOutput: (...args: unknown[]) => state.aiGatewayStructuredMock(...args),
  },
}));

import { assertPeriodOpen } from '@/lib/finance/journal-service';
import { POST as upgradePost } from '@/app/api/tenant-subscriptions/upgrade/route';
import { POST as journalsPost } from '@/app/api/finance/journals/route';
import { POST as journalPostAction } from '@/app/api/finance/journals/[id]/post/route';
import { POST as exchangeSubmitPost } from '@/app/api/exchange/invoices/submit/route';
import { POST as exchangeInvoicesPost } from '@/app/api/exchange/invoices/route';
import { GET as fleetAvailabilityGet } from '@/app/api/fleet/availability/route';
import { extractRentalIntent } from '@/lib/agents/rental-copilot/agent';

describe('M5-R3 Remediation Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.authz = { ok: true, tenantId: 'tenant-a', userId: 'user-maker', role: 'TENANT_ADMIN' };
    state.stripeConfigured = true;
    state.redeemedEvent = null;
    state.stripeSession = {
      payment_status: 'paid',
      currency: 'aed',
      amount_total: 157500,
      metadata: { tenantId: 'tenant-a', targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY' },
      customer: 'cus_123',
      subscription: 'sub_123',
      invoice: 'in_123',
    };
  });

  describe('WP2: assertPeriodOpen period_from/period_to query', () => {
    it('queries period_from and period_to directly without referencing start_date or end_date', async () => {
      state.txQueryMock.mockResolvedValueOnce([]);
      await assertPeriodOpen(mockTx, 'tenant-a', '2026-11-17');
      const sql = String(state.txQueryMock.mock.calls[0]?.[0] ?? '');
      expect(sql).toContain('period_from');
      expect(sql).toContain('period_to');
      expect(sql).not.toContain('start_date');
      expect(sql).not.toContain('end_date');
    });

    it('throws 422 when period is LOCKED', async () => {
      state.txQueryMock.mockResolvedValueOnce([{ status: 'LOCKED', period_name: '2026-11' }]);
      await expect(assertPeriodOpen(mockTx, 'tenant-a', '2026-11-17')).rejects.toMatchObject({
        statusCode: 422,
      });
    });
  });

  describe('WP4: Subscription Upgrade Security & Replay Prevention', () => {
    it('rejects missing metadata.tenantId with 403 Forbidden: Tenant mismatch', async () => {
      state.stripeSession.metadata = { targetPlan: 'PROFESSIONAL' };
      const req = new NextRequest('http://localhost/api/tenant-subscriptions/upgrade', {
        method: 'POST',
        body: JSON.stringify({ targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY', stripeSessionId: 'cs_test_1' }),
      });
      const res = await upgradePost(req);
      expect(res.status).toBe(403);
    });

    it('rejects non-AED currency with 400', async () => {
      state.stripeSession.currency = 'usd';
      const req = new NextRequest('http://localhost/api/tenant-subscriptions/upgrade', {
        method: 'POST',
        body: JSON.stringify({ targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY', stripeSessionId: 'cs_test_2' }),
      });
      const res = await upgradePost(req);
      expect(res.status).toBe(400);
    });

    it('rejects underpaid Stripe session with 402', async () => {
      state.stripeSession.amount_total = 78750; // STANDARD price when requesting PROFESSIONAL
      const req = new NextRequest('http://localhost/api/tenant-subscriptions/upgrade', {
        method: 'POST',
        body: JSON.stringify({ targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY', stripeSessionId: 'cs_test_3' }),
      });
      const res = await upgradePost(req);
      expect(res.status).toBe(402);
    });

    it('rejects plan mismatch in metadata with 400', async () => {
      state.stripeSession.metadata = { tenantId: 'tenant-a', targetPlan: 'STANDARD', billingCycle: 'MONTHLY' };
      const req = new NextRequest('http://localhost/api/tenant-subscriptions/upgrade', {
        method: 'POST',
        body: JSON.stringify({ targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY', stripeSessionId: 'cs_test_4' }),
      });
      const res = await upgradePost(req);
      expect(res.status).toBe(400);
    });

    it('rejects replayed stripeSessionId with 409', async () => {
      state.redeemedEvent = { id: 'evt-already-used' };
      const req = new NextRequest('http://localhost/api/tenant-subscriptions/upgrade', {
        method: 'POST',
        body: JSON.stringify({ targetPlan: 'PROFESSIONAL', billingCycle: 'MONTHLY', stripeSessionId: 'cs_test_replay' }),
      });
      const res = await upgradePost(req);
      expect(res.status).toBe(409);
    });
  });

  describe('WP5: Manual Journals SoD, Locking & CoA Validation', () => {
    it('rejects posting when prepared_by is null/empty with 422', async () => {
      state.txQueryMock.mockResolvedValueOnce([
        { id: 'je-1', je_number: 'JE-1', status: 'DRAFT', prepared_by: null, entry_date: '2026-11-17' },
      ]);
      const req = new NextRequest('http://localhost/api/finance/journals/je-1/post', { method: 'POST' });
      const res = await journalPostAction(req, { params: Promise.resolve({ id: 'je-1' }) });
      expect(res.status).toBe(422);
      const selectSql = String(state.txQueryMock.mock.calls[0]?.[0] ?? '');
      expect(selectSql).toContain('FOR UPDATE');
    });

    it('rejects unknown/header CoA account codes on journal creation with 422', async () => {
      state.txQueryMock
        .mockResolvedValueOnce([]) // assertPeriodOpen
        .mockResolvedValueOnce([{ account_code: '1110', account_name: 'Cash', normal_balance: 'DEBIT', is_header: false, is_active: true }]);
      const req = new NextRequest('http://localhost/api/finance/journals', {
        method: 'POST',
        body: JSON.stringify({
          date: '2026-11-17',
          description: 'Test CoA',
          lines: [
            { accountCode: '1110', debit: 100, credit: 0 },
            { accountCode: '9999', debit: 0, credit: 100 },
          ],
        }),
      });
      const res = await journalsPost(req);
      expect(res.status).toBe(422);
    });
  });

  describe('WP6: Exchange Invoices P2002, Line Validation & No In-Memory Facade', () => {
    it('returns 400 when line item quantity is <= 0', async () => {
      state.outsourceAwardFindFirstMock.mockResolvedValueOnce({
        id: 'aw-1',
        tenantId: 'tenant-b',
        quoteId: 'q-1',
        awardedPrice: 1000,
        vatAmount: 50,
        totalAwarded: 1050,
        currency: 'AED',
      });
      const req = new NextRequest('http://localhost/api/exchange/invoices/submit', {
        method: 'POST',
        body: JSON.stringify({
          awardId: 'aw-1',
          items: [{ description: 'Line', quantity: 0, unitPrice: 100 }],
        }),
      });
      const res = await exchangeSubmitPost(req);
      expect(res.status).toBe(400);
    });

    it('catches Prisma P2002 cross-tenant duplicate invoiceNumber collision and returns 409', async () => {
      state.outsourceAwardFindFirstMock.mockResolvedValueOnce({
        id: 'aw-1',
        tenantId: 'tenant-b',
        quoteId: 'q-1',
        awardedPrice: 1000,
        vatAmount: 50,
        totalAwarded: 1050,
        currency: 'AED',
      });
      state.partnerInvoiceFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      state.partnerInvoiceCreateMock.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
      );
      const req = new NextRequest('http://localhost/api/exchange/invoices/submit', {
        method: 'POST',
        body: JSON.stringify({ awardId: 'aw-1', invoiceNumber: 'DUP-001' }),
      });
      const res = await exchangeSubmitPost(req);
      expect(res.status).toBe(409);
    });

    it('rejects legacy in-memory orderId stub payload instead of returning fake 201 glLines', async () => {
      const req = new NextRequest('http://localhost/api/exchange/invoices', {
        method: 'POST',
        body: JSON.stringify({ orderId: 'ord-123', amount: 500 }),
      });
      const res = await exchangeInvoicesPost(req);
      expect(res.status).toBe(400);
    });
  });

  describe('WP7: Real Fleet Availability & AI Gateway Routing', () => {
    it('returns real zero counts for empty tenant DB without synthesized demo fallback', async () => {
      state.vehicleFindManyMock.mockResolvedValueOnce([]);
      const req = new NextRequest('http://localhost/api/fleet/availability?serviceType=RENTAL');
      const res = await fleetAvailabilityGet(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { categories: Array<{ availableCount: number; totalCount: number }> };
      expect(body.categories.every((c) => c.availableCount === 0 && c.totalCount === 0)).toBe(true);
    });

    it('routes rental-copilot LLM intent extraction through aiGateway when API key is set', async () => {
      const prevKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';
      state.aiGatewayStructuredMock.mockResolvedValueOnce({
        fromFallback: false,
        model: 'gemini-flash-latest',
        inputTokens: 42,
        outputTokens: 18,
        data: {
          vehicleCategory: 'SUV',
          pickupDate: '2026-11-20',
          dropoffDate: '2026-11-23',
          rentalDays: 3,
          pickupLocation: 'DXB Airport',
          dropoffLocation: 'DXB Airport',
          customerType: 'INDIVIDUAL',
          channel: 'DIRECT',
          insurancePlanCode: 'CDW',
          requestedAncillaries: [],
          detectedLanguage: 'en',
          confidence: 'HIGH',
          warnings: [],
        },
      });
      try {
        const result = await extractRentalIntent('Need an SUV at DXB Airport for 3 days', 'tenant-a');
        expect(state.aiGatewayStructuredMock).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.modelUsed).toBe('gemini-flash-latest');
        }
      } finally {
        if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = prevKey;
      }
    });
  });
});
