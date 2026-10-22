/**
 * An invoiced traffic fine is judged on its invoice, and counted once.
 *
 * evaluateContractSettlementLiabilities counted an invoiced fine twice — its
 * raw amount as TRAFFIC_FINE (outstanding until paidDate was set) and its
 * invoice as OTHER_INVOICE — and paying the invoice never set paidDate, so
 * once paid the fine still read outstanding and blocked contract closure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ balances: new Map<string, number>() }));

vi.mock('@/lib/leasing/invoice-balance', () => ({
  getInvoiceOutstandingBalance: async (_tx: unknown, _t: string, id: string) => st.balances.get(id) ?? 0,
}));

import { evaluateContractSettlementLiabilities } from '@/lib/leasing/return-workflow';

const fine = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
  id, fineAmount: amount, finalAmount: null, billingStatus: 'INVOICED', paymentRef: 'INV-000010', paidDate: null, ...over,
});

function txWith(fines: unknown[]) {
  return {
    leaseVehicleReturn: { findMany: async () => [] },
    leaseTrafficFine: { findMany: async () => fines },
    leaseInvoice: {
      findFirst: async ({ where }: { where: { invoiceNo?: string; id?: string } }) =>
        where.invoiceNo === 'INV-000010' || where.id === 'inv-fines'
          ? { id: 'inv-fines', status: 'SENT' }
          : where.id === 'inv-rent' ? { id: 'inv-rent', status: 'SENT' } : null,
    },
    // The fines' invoice and an unrelated rent invoice are both on the contract.
    leaseInvoiceLine: { findMany: async () => [{ invoiceId: 'inv-fines' }, { invoiceId: 'inv-rent' }] },
  } as never;
}

beforeEach(() => {
  st.balances = new Map([['inv-fines', 300], ['inv-rent', 0]]);
});

describe('evaluateContractSettlementLiabilities with invoiced fines', () => {
  it('counts an unpaid fine invoice once', async () => {
    const r = await evaluateContractSettlementLiabilities(txWith([fine('f1', 300)]), 't1', 'c1');
    expect(r.outstandingTotal).toBe(300);
    expect(r.items.filter((i) => i.type === 'OTHER_INVOICE' && i.sourceId === 'inv-fines')).toHaveLength(0);
  });

  it('clears the fine when its invoice is paid, so closure is not blocked', async () => {
    st.balances.set('inv-fines', 0);
    const r = await evaluateContractSettlementLiabilities(txWith([fine('f1', 300)]), 't1', 'c1');
    expect(r.outstandingTotal).toBe(0);
    expect(r.blockers).toEqual([]);
    expect(r.items.find((i) => i.sourceId === 'f1')).toMatchObject({ state: 'PAID', amount: 0 });
  });

  it('shares a partly paid invoice across the fines it carries', async () => {
    st.balances.set('inv-fines', 250); // 400 billed for two fines, 150 paid
    const r = await evaluateContractSettlementLiabilities(txWith([fine('f1', 200), fine('f2', 200)]), 't1', 'c1');
    expect(r.outstandingTotal).toBe(250);
    expect(r.items.filter((i) => i.type === 'TRAFFIC_FINE').map((i) => i.amount)).toEqual([200, 50]);
  });

  it('still counts other contract invoices', async () => {
    st.balances.set('inv-rent', 1000);
    const r = await evaluateContractSettlementLiabilities(txWith([fine('f1', 300)]), 't1', 'c1');
    expect(r.outstandingTotal).toBe(1300);
    expect(r.items.find((i) => i.sourceId === 'inv-rent')).toMatchObject({ type: 'OTHER_INVOICE', amount: 1000 });
  });
});
