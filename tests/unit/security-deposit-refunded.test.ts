/**
 * Money refunded from a security deposit is no longer available.
 *
 * availableBalance subtracted deductions and refunds reserved but not paid —
 * not refunds paid. executeRefund moves an amount from reserved_amount to
 * refunded_amount, so a paid refund became "available" again: the deposit
 * could be refunded twice, or deducted after the money had gone back.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { addDeduction, availableBalance, startRefundRequest, type DepositRow } from '@/lib/finance/security-deposit';

const row = (over: Partial<DepositRow> = {}): DepositRow => ({
  id: 'd1', tenant_id: 't1', collected_amount: '5000', total_deducted: '0',
  reserved_amount: '0', refunded_amount: '0', refund_status: null, refund_requested_amount: null, status: 'HELD',
  ...over,
});

/** A transaction whose locked deposit row is `r`; any write is recorded. */
function txFor(r: DepositRow) {
  const writes: string[] = [];
  return {
    writes,
    tx: {
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes('FOR UPDATE')) return [r];
        writes.push(sql);
        return [r];
      },
      $executeRawUnsafe: async (sql: string) => { writes.push(sql); return 1; },
    } as never,
  };
}

describe('availableBalance', () => {
  it('subtracts refunds already paid', () => {
    expect(availableBalance(row({ refunded_amount: '5000', refund_status: 'REFUNDED' }))).toBe(0);
    expect(availableBalance(row({ total_deducted: '1200', refunded_amount: '3000' }))).toBe(800);
  });

  it('still subtracts deductions and reserved refunds', () => {
    expect(availableBalance(row({ total_deducted: '1000', reserved_amount: '1500' }))).toBe(2500);
  });
});

describe('after a full refund', () => {
  const refunded = row({ refunded_amount: '5000', refund_status: 'REFUNDED', status: 'FULLY_REFUNDED' });

  it('refuses a second refund (the default amount is what remains: nothing)', async () => {
    const { tx, writes } = txFor(refunded);
    await expect(startRefundRequest(tx, 't1', 'd1', { actor: 'a', payNow: true }))
      .rejects.toThrow(/more than zero/);
    expect(writes).toHaveLength(0);
  });

  it('refuses an explicit second refund', async () => {
    const { tx, writes } = txFor(refunded);
    await expect(startRefundRequest(tx, 't1', 'd1', { amount: 5000, actor: 'a', payNow: true }))
      .rejects.toThrow(/exceeds available deposit balance/);
    expect(writes).toHaveLength(0);
  });

  it('refuses a deduction', async () => {
    const { tx, writes } = txFor(refunded);
    await expect(addDeduction(tx, 't1', 'd1', { description: 'Damage', amount: 100 }))
      .rejects.toThrow(/exceeds available deposit balance/);
    expect(writes).toHaveLength(0);
  });
});

describe('after a partial refund', () => {
  it('allows a deduction from the remainder only', async () => {
    const partly = row({ refunded_amount: '4000' });
    await expect(addDeduction(txFor(partly).tx, 't1', 'd1', { description: 'Fuel', amount: 1500 }))
      .rejects.toThrow(/exceeds available deposit balance of 1000/);
  });
});
