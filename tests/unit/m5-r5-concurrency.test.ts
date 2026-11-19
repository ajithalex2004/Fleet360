/**
 * Concurrent double-recharge regression tests for Milestone M5-R5 (WP1).
 *
 * Verifies that 5 simultaneous POST /api/leasing/traffic-fines/recharge calls
 * against the same PENDING LeaseTrafficFine or TrafficFine serialize through
 * the row-level FOR UPDATE lock + atomic conditional claim (updateMany) so
 * exactly ONE returns 201 Created and FOUR return 409 Conflict.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  authz: {
    ok: true as const,
    tenantId: 'tenant-r5',
    userId: 'user-r5-admin',
    role: 'TENANT_ADMIN',
  },
  leaseTrafficFine: null as Record<string, unknown> | null,
  trafficFine: null as Record<string, unknown> | null,
  leaseInvoiceCount: 0,
  invoiceCreates: 0,
  glPostings: 0,
  opGlPostings: 0,
  callOrder: [] as string[],
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

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
  logAuditInTx: vi.fn(async () => undefined),
}));

vi.mock('@/lib/leasing/serial-lock', () => ({
  lockSerialSeries: vi.fn(async () => undefined),
}));

vi.mock('@/lib/finance/journal-service', () => ({
  assertPeriodOpen: vi.fn(async () => undefined),
  postOperationalJournalEntry: vi.fn(async () => {
    state.callOrder.push('postOperationalJournalEntry');
    state.opGlPostings += 1;
    return { id: `je-op-${state.opGlPostings}`, number: `JE-OP-${state.opGlPostings}`, created: true };
  }),
}));

vi.mock('@/lib/leasing/leasing-gl-posting', () => ({
  postLeaseInvoiceToGl: vi.fn(async () => {
    state.callOrder.push('postLeaseInvoiceToGl');
    state.glPostings += 1;
    return { id: `je-inv-${state.glPostings}`, number: `JE-INV-${state.glPostings}`, created: true };
  }),
}));

// Simulate PostgreSQL row-level FOR UPDATE lock across concurrent transactions
let rowLockTail: Promise<void> = Promise.resolve();
function acquireRowLock(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitForPrior = rowLockTail;
  rowLockTail = next;
  return waitForPrior.then(() => release);
}

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => {
    let releaseLock: (() => void) | null = null;
    const tx = {
      $executeRaw: vi.fn(async () => {
        state.callOrder.push('FOR_UPDATE');
        releaseLock = await acquireRowLock();
        return 0;
      }),
      leaseTrafficFine: {
        findFirst: vi.fn(async () => {
          // Yield a microtask so all 5 concurrent callers observe initial PENDING state before locking
          await Promise.resolve();
          return state.leaseTrafficFine ? { ...state.leaseTrafficFine } : null;
        }),
        updateMany: vi.fn(async (args: { data?: { billingStatus?: string } }) => {
          state.callOrder.push('leaseTrafficFine.updateMany');
          if (!state.leaseTrafficFine) return { count: 0 };
          const status = state.leaseTrafficFine.billingStatus as string | null | undefined;
          if (status === 'PENDING' || status == null) {
            state.leaseTrafficFine.billingStatus = args.data?.billingStatus ?? 'PROCESSING';
            return { count: 1 };
          }
          return { count: 0 };
        }),
        update: vi.fn(async (args: { data?: Record<string, unknown> }) => {
          if (state.leaseTrafficFine && args.data) {
            Object.assign(state.leaseTrafficFine, args.data);
          }
          return state.leaseTrafficFine;
        }),
      },
      trafficFine: {
        findFirst: vi.fn(async () => {
          await Promise.resolve();
          return state.trafficFine ? { ...state.trafficFine } : null;
        }),
        updateMany: vi.fn(async (args: { data?: { status?: string } }) => {
          state.callOrder.push('trafficFine.updateMany');
          if (!state.trafficFine) return { count: 0 };
          const status = state.trafficFine.status as string | null | undefined;
          const billed = Boolean(state.trafficFine.isBilledToCustomer);
          if (!billed && status !== 'RECHARGED' && status !== 'PROCESSING') {
            state.trafficFine.status = args.data?.status ?? 'PROCESSING';
            return { count: 1 };
          }
          return { count: 0 };
        }),
        update: vi.fn(async (args: { data?: Record<string, unknown> }) => {
          if (state.trafficFine && args.data) {
            Object.assign(state.trafficFine, args.data);
          }
          return state.trafficFine;
        }),
      },
      leaseInvoice: {
        count: vi.fn(async () => state.leaseInvoiceCount),
        create: vi.fn(async () => {
          state.callOrder.push('leaseInvoice.create');
          state.invoiceCreates += 1;
          state.leaseInvoiceCount += 1;
          return { id: `linv-${state.invoiceCreates}`, invoiceNo: `INV-${String(state.invoiceCreates).padStart(6, '0')}` };
        }),
      },
    };
    try {
      return await fn(tx);
    } finally {
      if (releaseLock) (releaseLock as () => void)();
    }
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

import { POST as rechargePost } from '@/app/api/leasing/traffic-fines/recharge/route';

describe('M5-R5 Concurrent Traffic Fine Recharge Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rowLockTail = Promise.resolve();
    state.leaseTrafficFine = null;
    state.trafficFine = null;
    state.leaseInvoiceCount = 0;
    state.invoiceCreates = 0;
    state.glPostings = 0;
    state.opGlPostings = 0;
    state.callOrder = [];
  });

  it('allows exactly 1x 201 and 4x 409 across 5 simultaneous requests on the same LeaseTrafficFine', async () => {
    state.leaseTrafficFine = {
      id: 'ltf-race-1',
      fineNo: 'TF-RACE-001',
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

    const requests = Array.from({ length: 5 }, () =>
      rechargePost(
        new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
          method: 'POST',
          body: JSON.stringify({ fineId: 'ltf-race-1', fineAmount: 600, adminFee: 60 }),
        }),
      ),
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);

    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(state.invoiceCreates).toBe(1);
    expect(state.glPostings).toBe(1);
    expect(state.leaseTrafficFine.billingStatus).toBe('INVOICED');

    // Verify FOR UPDATE + updateMany happened BEFORE leaseInvoice.create
    const lockIdx = state.callOrder.indexOf('FOR_UPDATE');
    const claimIdx = state.callOrder.indexOf('leaseTrafficFine.updateMany');
    const createIdx = state.callOrder.indexOf('leaseInvoice.create');
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(claimIdx).toBeGreaterThan(lockIdx);
    expect(createIdx).toBeGreaterThan(claimIdx);
  });

  it('allows exactly 1x 201 and 4x 409 across 5 simultaneous requests on the same TrafficFine', async () => {
    state.trafficFine = {
      id: 'tf-race-1',
      fineRef: 'DXB-RACE-001',
      fineAmount: 500,
      adminFee: 50,
      status: 'PAID',
      isBilledToCustomer: false,
    };

    const requests = Array.from({ length: 5 }, () =>
      rechargePost(
        new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
          method: 'POST',
          body: JSON.stringify({ fineId: 'tf-race-1', fineAmount: 500, adminFee: 50 }),
        }),
      ),
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);

    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(state.opGlPostings).toBe(1);
    expect(state.trafficFine.status).toBe('RECHARGED');
    expect(state.trafficFine.isBilledToCustomer).toBe(true);

    const lockIdx = state.callOrder.indexOf('FOR_UPDATE');
    const claimIdx = state.callOrder.indexOf('trafficFine.updateMany');
    const glIdx = state.callOrder.indexOf('postOperationalJournalEntry');
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(claimIdx).toBeGreaterThan(lockIdx);
    expect(glIdx).toBeGreaterThan(claimIdx);
  });
});
