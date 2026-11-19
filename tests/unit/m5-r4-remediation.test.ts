/**
 * Behavioral regression tests for Milestone M5-R4 remediation (WP1 & WP4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  authz: {
    ok: true as const,
    tenantId: 'tenant-a',
    userId: 'user-admin',
    role: 'TENANT_ADMIN',
  },
  leaseTrafficFine: null as Record<string, unknown> | null,
  trafficFine: null as Record<string, unknown> | null,
  leaseInvoiceCount: 0,
  txQueryMock: vi.fn(),
  leaseInvoiceCreateMock: vi.fn(),
  leaseTrafficFineUpdateMock: vi.fn(),
  trafficFineUpdateMock: vi.fn(),
  postOperationalJournalMock: vi.fn(),
  postLeaseInvoiceToGlMock: vi.fn(),
}));

vi.mock('@/lib/tenant-context', () => ({
  requireAuthorizedTenant: vi.fn(() => state.authz),
  stripTenantOwnershipFields: vi.fn((body: Record<string, unknown>) => {
    const copy = { ...body };
    delete copy.tenantId;
    delete copy.tenant_id;
    return copy;
  }),
}));

const mockTx = {
  $queryRawUnsafe: (...args: unknown[]) => state.txQueryMock(...args),
  $executeRawUnsafe: vi.fn(async () => 0),
  $executeRaw: vi.fn(async () => 0),
  leaseTrafficFine: {
    findFirst: vi.fn(async () => state.leaseTrafficFine),
    updateMany: vi.fn(async (args: { where?: { billingStatus?: string; OR?: Array<{ billingStatus?: string | null }> }; data?: { billingStatus?: string } }) => {
      if (!state.leaseTrafficFine) return { count: 0 };
      const current = state.leaseTrafficFine.billingStatus as string | null | undefined;
      if (current === 'PENDING' || current == null) {
        state.leaseTrafficFine.billingStatus = args.data?.billingStatus ?? 'PROCESSING';
        return { count: 1 };
      }
      return { count: 0 };
    }),
    update: (...args: unknown[]) => state.leaseTrafficFineUpdateMock(...args),
  },
  trafficFine: {
    findFirst: vi.fn(async () => state.trafficFine),
    updateMany: vi.fn(async (args: { data?: { status?: string } }) => {
      if (!state.trafficFine) return { count: 0 };
      const currentStatus = state.trafficFine.status as string | null | undefined;
      const billed = Boolean(state.trafficFine.isBilledToCustomer);
      if (!billed && currentStatus !== 'RECHARGED' && currentStatus !== 'PROCESSING') {
        state.trafficFine.status = args.data?.status ?? 'PROCESSING';
        return { count: 1 };
      }
      return { count: 0 };
    }),
    update: (...args: unknown[]) => state.trafficFineUpdateMock(...args),
  },
  leaseInvoice: {
    count: vi.fn(async () => state.leaseInvoiceCount),
    create: (...args: unknown[]) => state.leaseInvoiceCreateMock(...args),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  },
}));

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

vi.mock('@/lib/leasing/serial-lock', () => ({
  lockSerialSeries: vi.fn(async () => undefined),
}));

vi.mock('@/lib/finance/journal-service', () => ({
  assertPeriodOpen: vi.fn(async () => undefined),
  postOperationalJournalEntry: (...args: unknown[]) => state.postOperationalJournalMock(...args),
}));

vi.mock('@/lib/leasing/leasing-gl-posting', () => ({
  postLeaseInvoiceToGl: (...args: unknown[]) => state.postLeaseInvoiceToGlMock(...args),
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

import { POST as rechargePost } from '@/app/api/leasing/traffic-fines/recharge/route';
import { POST as exchangeInvoicesPost } from '@/app/api/exchange/invoices/route';

describe('M5-R4 Remediation Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.leaseTrafficFine = null;
    state.trafficFine = null;
    state.leaseInvoiceCount = 0;
  });

  describe('Authentic /api/leasing/traffic-fines/recharge', () => {
    it('returns 400 when fineId is missing', async () => {
      const req = new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
        method: 'POST',
        body: JSON.stringify({ fineAmount: 500, adminFee: 50 }),
      });
      const res = await rechargePost(req);
      expect(res.status).toBe(400);
    });

    it('returns 422 when fineTaxRateOverride tries to charge VAT on statutory fine', async () => {
      const req = new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
        method: 'POST',
        body: JSON.stringify({ fineId: 'fine-1', fineAmount: 500, adminFee: 50, fineTaxRateOverride: 0.05 }),
      });
      const res = await rechargePost(req);
      expect(res.status).toBe(422);
    });

    it('returns 404 when neither LeaseTrafficFine nor TrafficFine exists', async () => {
      const req = new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
        method: 'POST',
        body: JSON.stringify({ fineId: '00000000-0000-0000-0000-000000000001', fineAmount: 500, adminFee: 50 }),
      });
      const res = await rechargePost(req);
      expect(res.status).toBe(404);
    });

    it('returns 409 when LeaseTrafficFine is already INVOICED', async () => {
      state.leaseTrafficFine = {
        id: 'ltf-1',
        fineNo: 'TF-000001',
        billingStatus: 'INVOICED',
        fineAmount: 500,
        finalAmount: 500,
        contract: { id: 'c-1', lesseeId: 'lessee-1', currency: 'AED' },
      };
      const req = new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
        method: 'POST',
        body: JSON.stringify({ fineId: 'ltf-1', fineAmount: 500, adminFee: 50 }),
      });
      const res = await rechargePost(req);
      expect(res.status).toBe(409);
    });

    it('creates LeaseInvoice + posts GL via postLeaseInvoiceToGl for valid LeaseTrafficFine', async () => {
      state.leaseTrafficFine = {
        id: 'ltf-2',
        fineNo: 'TF-000002',
        billingStatus: 'PENDING',
        violationType: 'SPEEDING',
        fineAmount: 600,
        finalAmount: 600,
        currency: 'AED',
        contractId: 'c-1',
        vehicleId: 'v-1',
        lesseeId: 'lessee-1',
        contract: { id: 'c-1', lesseeId: 'lessee-1', currency: 'AED' },
      };
      state.leaseInvoiceCreateMock.mockResolvedValueOnce({ id: 'linv-1', invoiceNo: 'INV-000001' });
      state.postLeaseInvoiceToGlMock.mockResolvedValueOnce({ id: 'je-1', number: 'JE-0001', created: true });
      state.leaseTrafficFineUpdateMock.mockResolvedValueOnce({ id: 'ltf-2', billingStatus: 'INVOICED' });

      const req = new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
        method: 'POST',
        body: JSON.stringify({ fineId: 'ltf-2', fineAmount: 600, adminFee: 60 }),
      });
      const res = await rechargePost(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.invoiceId).toBe('linv-1');
      expect(data.journalEntryId).toBe('je-1');
      expect(data.vatAmount).toBe(3);
      expect(data.totalAmount).toBe(663);
      expect(state.leaseInvoiceCreateMock).toHaveBeenCalledTimes(1);
      expect(state.postLeaseInvoiceToGlMock).toHaveBeenCalledTimes(1);
      expect(state.leaseTrafficFineUpdateMock).toHaveBeenCalledTimes(1);
    });

    it('posts GL via postOperationalJournalEntry for valid TrafficFine', async () => {
      state.trafficFine = {
        id: 'tf-1',
        fineRef: 'DXB-FINE-1',
        fineAmount: 500,
        adminFee: 50,
        status: 'PAID',
        isBilledToCustomer: false,
      };
      state.postOperationalJournalMock.mockResolvedValueOnce({ id: 'je-2', number: 'JE-0002', created: true });
      state.trafficFineUpdateMock.mockResolvedValueOnce({ id: 'tf-1', isBilledToCustomer: true });

      const req = new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
        method: 'POST',
        body: JSON.stringify({ fineId: 'tf-1', fineAmount: 500, adminFee: 50 }),
      });
      const res = await rechargePost(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.rechargeId).toBe('je-2');
      expect(data.vatAmount).toBe(2.5);
      expect(data.totalAmount).toBe(552.5);
      expect(state.postOperationalJournalMock).toHaveBeenCalledTimes(1);
      expect(state.trafficFineUpdateMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Removal of synthetic invalidGlAccount hook in /api/exchange/invoices', () => {
    it('does not short-circuit on body.invalidGlAccount with synthetic 422 message', async () => {
      const req = new NextRequest('http://localhost/api/exchange/invoices', {
        method: 'POST',
        body: JSON.stringify({ invalidGlAccount: true }),
      });
      const res = await exchangeInvoicesPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Missing required invoice fields');
    });
  });
});
