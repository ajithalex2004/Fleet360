import { describe, expect, it } from 'vitest';
import { payableTotals } from '@/lib/finance/payable-totals';

describe('payable totals from lines', () => {
  it('adds the lines and 5% VAT', () => {
    expect(payableTotals([{ description: 'Paper', amount: 600 }, { description: 'Toner', amount: '400.005' }]))
      .toEqual({ lineItems: [{ description: 'Paper', amount: 600 }, { description: 'Toner', amount: 400.01 }], subtotal: 1000.01, vatAmount: 50, total: 1050.01 });
  });

  it('uses the VAT given, including zero', () => {
    expect(payableTotals([{ description: 'a', amount: 100 }], 0)?.total).toBe(100);
    expect(payableTotals([{ description: 'a', amount: 100 }], '7.5')?.vatAmount).toBe(7.5);
    expect(payableTotals([{ description: 'a', amount: 100 }], '')?.vatAmount).toBe(5);
    expect(payableTotals([{ description: 'a', amount: 100 }], -3)?.vatAmount).toBe(5);
  });

  it('drops empty or negative lines, and has no totals without an amount', () => {
    expect(payableTotals([{ description: 'x', amount: 0 }, { description: 'y', amount: -5 }, { amount: 'abc' }])).toBeNull();
    expect(payableTotals([{ amount: 20 }, { description: 'skip', amount: '' }])?.lineItems).toEqual([{ description: '', amount: 20 }]);
    expect(payableTotals(undefined)).toBeNull();
    expect(payableTotals('nope')).toBeNull();
  });
});
