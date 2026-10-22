/**
 * Payments reach an invoice through an allocation, never by setting
 * paid_amount directly.
 *
 * POST /api/finance/payments and PATCH /api/finance/invoices/[id]
 * (record_payment) added the payment to finance_invoices.paid_amount and
 * wrote no allocation. The trigger on finance_payment_allocations sets
 * paid_amount to the SUM of allocations, so the first allocation on the
 * invoice erased every payment recorded the direct way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const st = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; args: unknown[] }> }));

function run(sql: string, args: unknown[]): unknown[] {
  st.sql.push({ sql, args });
  if (sql.includes('INSERT INTO finance_payments')) return [{ id: 'pay-1' }];
  if (sql.includes('FROM finance_invoices')) return [{ id: 'inv-1', paid_amount: 400, payment_status: 'PARTIAL' }];
  return [];
}

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) => run(sql, args),
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) => { run(sql, args); return 1; },
  }),
}));

import { NextRequest } from 'next/server';
import { POST as postPayment } from '@/app/api/finance/payments/route';
import { PATCH as patchInvoice } from '@/app/api/finance/invoices/[id]/route';

const INV = '11111111-2222-4333-8444-555555555555';
const headers = { 'x-tenant-id': 'tenant-a', 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };

beforeEach(() => { st.sql.length = 0; });

function expectAllocationOnly() {
  const alloc = st.sql.find((q) => q.sql.includes('INSERT INTO finance_payment_allocations'));
  expect(alloc, 'an allocation is written').toBeDefined();
  expect(alloc!.args.slice(0, 3)).toEqual(['pay-1', INV, 400]);
  const direct = st.sql.find((q) => /UPDATE finance_invoices[\s\S]*paid_amount/.test(q.sql));
  expect(direct, 'paid_amount is left to the allocation trigger').toBeUndefined();
}

describe('POST /api/finance/payments', () => {
  it('allocates the payment to its invoice and reports the trigger’s status', async () => {
    const res = await postPayment(new NextRequest('http://localhost/api/finance/payments', {
      method: 'POST', headers,
      body: JSON.stringify({ invoiceId: INV, amount: 400, paymentMethod: 'BANK_TRANSFER' }),
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).newInvoiceStatus).toBe('PARTIAL');
    expectAllocationOnly();
  });
});

describe('PATCH /api/finance/invoices/[id] record_payment', () => {
  it('records the payment and its allocation, and returns the trigger’s figures', async () => {
    const res = await patchInvoice(new NextRequest(`http://localhost/api/finance/invoices/${INV}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ action: 'record_payment', amount: 400 }),
    }), { params: Promise.resolve({ id: INV }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, newPaidAmount: 400, newStatus: 'PARTIAL' });
    expectAllocationOnly();
  });
});
